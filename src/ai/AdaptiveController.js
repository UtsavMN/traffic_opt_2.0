import { useAIStore } from '../store/aiStore.js';
import { safeExecuteRLAction, MIN_GREEN_S, MAX_GREEN_S } from './SafetyComplianceWrapper.js';
import { computeReward } from './RewardFunction.js';

const ACTIONS = [
  'KEEP_PHASE', 'SWITCH_PHASE'
];

export class AdaptiveController {
  constructor() {
    this.evaluateInterval = 0.5; // evaluate every 0.5s
    this.timer = 0;
    this.decisions = [];
    this.totalDecisions = 0;
    this.totalReward = 0;
    this.rewardHistory = [];
    this.mode = 'ADAPTIVE';
    this.coordinator = null; // Set externally in useSimulation.js

    // Queue-proportional parameters
    this.MIN_GREEN = MIN_GREEN_S; // 10s minimum — safety clearance & anti-flapping
    this.MAX_GREEN = MAX_GREEN_S; // 60s maximum — prevent starvation
    this.MAX_EXPECTED = 30;       // vehicles — scale reference

    this.onDecision = null;
  }

  get rlActive() {
    return this.mode === 'RL_ACTIVE';
  }
  set rlActive(val) {
    if (val) {
      this.mode = 'RL_ACTIVE';
      useAIStore.getState().setMode('RL_ACTIVE');
    } else {
      this.mode = 'ADAPTIVE';
      useAIStore.getState().setMode('ADAPTIVE');
    }
  }

  update(dt, engine) {
    // Decrement simulation-time based cooldowns per intersection
    for (const [, int] of engine.intersections) {
      if (int.aiCooldown === undefined) int.aiCooldown = 0;
      if (int.aiCooldown > 0) int.aiCooldown -= dt;
    }

    this.timer += dt;
    if (this.timer < this.evaluateInterval) return;
    this.timer = 0;

    // Read active mode from Zustand store
    const currentMode = useAIStore.getState().mode;
    this.mode = currentMode;

    for (const [id, int] of engine.intersections) {
      if (int.aiCooldown > 0) continue;

      // Ensure physical traffic light has balanced realistic cycle limits (15s to 25s).
      // Never lock traffic lights to 9999s! Traffic lights MUST always cycle even in jams!
      if (int.trafficLight.greenDuration > 25 || int.trafficLight.greenDuration < 10) {
        int.trafficLight.setGreenDuration(18);
      }

      const decision = this._evaluate(int, engine);
      if (decision) {
        int.aiCooldown = decision.action.startsWith('SWITCH') ? 3.0 : 1.5; // Debounce
        this.totalDecisions++;
        int.triggerAIPulse(decision.action);

        const reward = this._computeReward(int, decision, int.vehiclesPassedAccumulatedRL || 0);
        int.vehiclesPassedAccumulatedRL = 0;
        this.totalReward += reward;
        this.rewardHistory.push(reward);
        if (this.rewardHistory.length > 500) this.rewardHistory.shift();

        decision.reward = reward;
        this.decisions.push(decision);
        if (this.decisions.length > 20) this.decisions.shift();

        if (this.onDecision) this.onDecision(decision);

        // Global bridge for UI metrics
        if (typeof window !== 'undefined' && (window.__sancharAI || window.__trafficOptAI)) {
          (window.__sancharAI || window.__trafficOptAI).logDecision({
            time: new Date().toLocaleTimeString(),
            intersectionId: int.id,
            action: decision.action,
            reason: decision.reason,
            reward: reward,
            queues: { ...int.queues },
          });
        }
      }
    }
  }

  _idealGreen(queueCount) {
    if (queueCount === 0) return this.MIN_GREEN;
    return this.MIN_GREEN + (Math.min(queueCount, this.MAX_EXPECTED) / this.MAX_EXPECTED) * (this.MAX_GREEN - this.MIN_GREEN);
  }

  _evaluate(int, engine) {
    const tl = int.trafficLight;
    const nsQ = int.getQueueNS();
    const ewQ = int.getQueueEW();
    const timeInPhase = tl.timeInPhase;
    const phase = tl.currentPhase;

    // Emergency Preemption (Highest priority)
    if (int.emergencyApproaching) {
      int.emergencyApproaching = false;
      const dir = (int.emergencyDir === 'N' || int.emergencyDir === 'S') ? 'NS' : 'EW';
      tl.emergencyOverrideDir = dir;
      tl.emergencyTimer = 5; // 5s override
      return {
        intersectionId: int.id,
        action: 'EMRG_PREEMPT',
        reason: `Ambulance approaching from ${int.emergencyDir} — ${dir} corridor priority`,
        time: Date.now(),
      };
    }

    // Only evaluate during green phases
    if (phase !== 'NS_GREEN' && phase !== 'EW_GREEN') return null;

    // Wait for minimum green safety clearance before any evaluation
    if (timeInPhase < this.MIN_GREEN) return null;

    const currentIsNS = phase === 'NS_GREEN';
    const currentQueue = currentIsNS ? nsQ : ewQ;
    const opposingQueue = currentIsNS ? ewQ : nsQ;

    // Actuated Zero-Demand Hold Veto: if opposing direction is completely empty, lock current green!
    if (opposingQueue === 0 && timeInPhase < this.MAX_GREEN) {
      return null;
    }

    // Active Reinforcement Learning Decision Path
    if (this.mode === 'RL_ACTIVE' && this.coordinator) {
      const rlAgent = this.coordinator.rlAgent;
      const state = rlAgent.encoder.encode(int, engine);
      const qValues = rlAgent._getQValues(state);
      const actionIdx = rlAgent._selectAction(state);
      const actionName = ACTIONS[actionIdx];

      // Execute chosen action safely through the compliance logic layer
      const result = safeExecuteRLAction(
        int,
        actionName,
        this._executeRLAction.bind(this),
        Array.from(qValues)
      );

      if (result.executed === 'KEEP_PHASE') {
        return null; // Quietly hold green
      }

      return {
        intersectionId: int.id,
        action: result.executed === 'SWITCH_PHASE' ? (currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS') : result.executed,
        reason: result.vetoed
          ? `${result.reason} (policy suggested ${result.vetoed})`
          : `Sanchar DQN (Q_sw=${qValues[1].toFixed(1)}, Q_kp=${qValues[0].toFixed(1)})`,
        time: Date.now(),
      };
    }

    // Rule 1: Switch immediately if current direction is empty AND opposing has vehicles
    if (currentQueue === 0 && opposingQueue > 0) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `Empty current approach (0) vs opposing (${opposingQueue})`,
        time: Date.now(),
      };
    }

    // Rule 1.5: Starvation Guard — If opposing vehicles have been waiting > 12s, switch immediately!
    if (int.maxWait > 12.0 && opposingQueue > 0) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `Starvation guard: Opposing max wait ${int.maxWait.toFixed(1)}s > 12s`,
        time: Date.now(),
      };
    }

    // Rule 2: Force switch if max green reached (starvation prevention)
    if (timeInPhase >= this.MAX_GREEN) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `Max green (${this.MAX_GREEN}s) ceiling reached`,
        time: Date.now(),
      };
    }

    // Rule 3: Significant queue imbalance
    const dynamicThreshold = Math.max(3, currentQueue * 0.5);
    if (opposingQueue > currentQueue + dynamicThreshold) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `Imbalance trigger: Opposing (${opposingQueue}) > Active (${currentQueue})`,
        time: Date.now(),
      };
    }

    // Rule 4: Ideal green time fulfilled
    const ideal = this._idealGreen(currentQueue);
    if (timeInPhase >= ideal && opposingQueue > 0) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `Ideal green (${ideal.toFixed(1)}s) fulfilled`,
        time: Date.now(),
      };
    }

    return null;
  }

  _executeRLAction(int, actionName) {
    const tl = int.trafficLight;
    const currentIsNS = tl.currentPhase === 'NS_GREEN';

    switch (actionName) {
      case 'SWITCH_PHASE':
        tl.forcePhase(currentIsNS ? 1 : 3); // safely transition to yellow (1 for NS, 3 for EW)
        break;
      case 'KEEP_PHASE':
      default:
        // No-op: keep current green
        break;
    }
  }

  _computeReward(int, decision, completedThisStep = 0) {
    const w1 = 12.0;
    const w2 = 2.0;
    const w3 = 1.0;
    const w4 = 1.0;

    // 1. Throughput
    const rThroughput = w2 * completedThisStep;

    // 2. Pressure Reduction
    const currentIsNS = int.trafficLight.currentPhase.includes('NS');
    const qActive = currentIsNS ? int.getQueueNS() : int.getQueueEW();
    const qOpposing = currentIsNS ? int.getQueueEW() : int.getQueueNS();
    const normActive = Math.min(1, qActive / 40);
    const normOpposing = Math.min(1, qOpposing / 40);
    const currPressure = (normActive * normActive) + (normOpposing * normOpposing);

    let rPressure = 0.0;
    if (int._prevPressure !== undefined) {
      rPressure = w1 * (int._prevPressure - currPressure);
    }
    int._prevPressure = currPressure;

    // 3. Switching Cost (Lost physical clearance capacity during yellow phase)
    const isSwitch = decision && (decision.action === 'SWITCH_PHASE' || decision.action.startsWith('SWITCH'));
    const rSwitch = isSwitch ? -w3 : 0.0;

    // 4. Waiting & Delay Penalty
    const totalQ = int.getTotalQueue();
    const queueDelay = Math.min(1, totalQ / 40);
    const tl = int.trafficLight;
    const maxRed = Math.max(tl.redDurationNS || 0, tl.redDurationEW || 0);
    const starvationDelay = maxRed > 30 ? Math.min(2.0, Math.pow((maxRed - 30) / 20, 1.5)) : 0.0;
    const rWait = -w4 * (queueDelay + starvationDelay);

    // 5. Emergency Preemption
    const rEmergency = decision && decision.action === 'EMRG_PREEMPT' ? 5.0 : 0.0;

    const reward = rThroughput + rPressure + rSwitch + rWait + rEmergency;
    return Math.round(Math.max(-15.0, Math.min(15.0, reward)) * 10) / 10;
  }

  getAverageReward() {
    if (this.rewardHistory.length === 0) return 0;
    const sum = this.rewardHistory.reduce((a, b) => a + b, 0);
    return sum / this.rewardHistory.length;
  }
}


