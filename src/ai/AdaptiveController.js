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
    this.mode = 'DYNAMIC_AUTO'; // Flagship mode: Autonomous Dynamic Selection
    this.coordinator = null; // Set externally in useSimulation.js

    // Queue-proportional parameters
    this.MIN_GREEN = MIN_GREEN_S; // 10s minimum — safety clearance & anti-flapping
    this.MAX_GREEN = MAX_GREEN_S; // 25s maximum — prevent starvation
    this.MAX_EXPECTED = 30;       // vehicles — scale reference

    this.onDecision = null;
  }

  get rlActive() {
    return this.mode === 'RL_ACTIVE' || this.mode === 'DYNAMIC_AUTO';
  }
  set rlActive(val) {
    if (val) {
      this.mode = 'DYNAMIC_AUTO';
      useAIStore.getState().setMode('DYNAMIC_AUTO');
    } else {
      this.mode = 'ADAPTIVE';
      useAIStore.getState().setMode('ADAPTIVE');
    }
  }

  setMode(mode) {
    this.mode = mode;
    useAIStore.getState().setMode(mode);
  }

  update(dt, engine) {
    // Decrement simulation-time based cooldowns per intersection
    for (const [, int] of engine.intersections) {
      if (!int.isSignalized || !int.trafficLight) continue;
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
      if (!int.isSignalized || !int.trafficLight) continue;
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

        const passed = int.vehiclesPassedAccumulatedRL || 0;
        int.vehiclesPassedAccumulatedRL = 0;
        const reward = this._computeReward(int, decision, passed);
        this.totalReward += reward;
        this.rewardHistory.push(reward);
        if (this.rewardHistory.length > 500) this.rewardHistory.shift();

        decision.reward = reward;
        this.decisions.push(decision);
        if (this.decisions.length > 25) this.decisions.shift();

        // If in DYNAMIC_AUTO mode, update arbitration statistics
        if (this.mode === 'DYNAMIC_AUTO' && decision.model) {
          useAIStore.getState().recordDynamicDecision(decision.model);
        }

        if (this.onDecision) this.onDecision(decision);

        // Global bridge for UI metrics
        if (typeof window !== 'undefined' && (window.__sancharAI || window.__trafficOptAI)) {
          (window.__sancharAI || window.__trafficOptAI).logDecision({
            time: new Date().toLocaleTimeString(),
            intersectionId: int.id,
            action: decision.action,
            reason: decision.reason,
            reward: reward,
            model: decision.model,
            queues: { ...int.queues },
          });
        }
      } else {
        // Holding green phase (KEEP_PHASE): collect rewards for vehicle discharge
        const passed = int.vehiclesPassedAccumulatedRL || 0;
        if (passed > 0) {
          int.vehiclesPassedAccumulatedRL = 0;
          const keepReward = this._computeReward(int, { action: 'KEEP_PHASE' }, passed);
          this.totalReward += keepReward;
          this.rewardHistory.push(keepReward);
          if (this.rewardHistory.length > 500) this.rewardHistory.shift();
        }
      }
    }
  }

  _idealGreen(queueCount) {
    if (queueCount === 0) return this.MIN_GREEN;
    return this.MIN_GREEN + (Math.min(queueCount, this.MAX_EXPECTED) / this.MAX_EXPECTED) * (this.MAX_GREEN - this.MIN_GREEN);
  }

  _arbitrateModel(int, engine, state, qValues) {
    if (!this.coordinator || !this.coordinator.rlAgent) {
      return { model: 'ADAPTIVE', reasonDetail: 'Adaptive baseline' };
    }

    const totalQueue = int.getTotalQueue();
    const currentIsNS = int.trafficLight ? int.trafficLight.currentPhase.includes('NS') : true;
    const currentQueue = currentIsNS ? int.getQueueNS() : int.getQueueEW();
    const opposingQueue = currentIsNS ? int.getQueueEW() : int.getQueueNS();

    // Corridor & neighbor pressure from GNN state encoder (state[3]: avgNeighborActive, state[4]: avgNeighborOpposing)
    const neighborPressure = (state[3] || 0) + (state[4] || 0);

    // Neural policy confidence: advantage of switching vs holding
    const qAdvantage = Math.abs(qValues[1] - qValues[0]);

    // Fast-path for empty approaches: instant actuated clearance
    if (currentQueue === 0 && opposingQueue > 0) {
      return { model: 'ADAPTIVE', reasonDetail: 'empty approach clearance' };
    }

    // High corridor demand / wave conditions trigger Sanchar DQN:
    // 1. Total queues building up (>= 6)
    // 2. Opposing queue high (>= 5)
    // 3. Arterial corridor wave / neighbor pressure (>= 0.35)
    // 4. Strong neural policy advantage (|ΔQ| >= 1.0 with active vehicles)
    const isCorridorCongested = totalQueue >= 6 || opposingQueue >= 5;
    const isArterialWave = neighborPressure >= 0.35;
    const isHighConfidenceRL = qAdvantage >= 1.0 && totalQueue >= 3;

    if (isArterialWave || isCorridorCongested || isHighConfidenceRL) {
      const reasonDetail = isArterialWave
        ? `corridor wave (${(neighborPressure * 100).toFixed(0)}% pressure)`
        : isCorridorCongested
          ? `surge demand (${totalQueue} veh)`
          : `neural policy confidence (ΔQ=${qAdvantage.toFixed(1)})`;
      return { model: 'DQN', reasonDetail };
    }

    // Low-density, isolated platoon: Adaptive MaxPressure provides minimal delay
    return { model: 'ADAPTIVE', reasonDetail: `light demand (${totalQueue} veh)` };
  }

  _evaluate(int, engine) {
    const tl = int.trafficLight;
    if (!tl) return null;
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
        model: 'EMERGENCY',
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

    // Decide which model controls this evaluation
    let selectedModel = 'ADAPTIVE';
    let arbitrationDetail = '';
    let rlState = null;
    let rlQValues = null;

    if (this.coordinator && this.coordinator.rlAgent) {
      const rlAgent = this.coordinator.rlAgent;
      rlState = rlAgent.encoder.encode(int, engine);
      rlQValues = rlAgent._getQValues(rlState);

      if (this.mode === 'RL_ACTIVE') {
        selectedModel = 'DQN';
      } else if (this.mode === 'DYNAMIC_AUTO') {
        const arb = this._arbitrateModel(int, engine, rlState, rlQValues);
        selectedModel = arb.model;
        arbitrationDetail = arb.reasonDetail;
      } else {
        // 'ADAPTIVE' or 'RL_SHADOW'
        selectedModel = 'ADAPTIVE';
      }
    }

    // ── PATH A: Sanchar Deep Q-Network (RL) ──
    if (selectedModel === 'DQN' && this.coordinator && this.coordinator.rlAgent) {
      const rlAgent = this.coordinator.rlAgent;
      const actionIdx = rlAgent._selectAction(rlState);
      const actionName = ACTIONS[actionIdx];

      // Execute chosen action safely through compliance logic layer
      const result = safeExecuteRLAction(
        int,
        actionName,
        this._executeRLAction.bind(this),
        Array.from(rlQValues)
      );

      if (result.executed === 'KEEP_PHASE') {
        return null; // Quietly hold green
      }

      const isDynamic = this.mode === 'DYNAMIC_AUTO';
      const prefix = isDynamic ? `[Auto: DQN]` : `[Sanchar DQN]`;

      return {
        intersectionId: int.id,
        action: result.executed === 'SWITCH_PHASE' ? (currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS') : result.executed,
        reason: result.vetoed
          ? `${prefix} ${result.reason} (policy suggested ${result.vetoed})`
          : `${prefix} ${arbitrationDetail ? arbitrationDetail + ' ' : ''}(Q_sw=${rlQValues[1].toFixed(1)}, Q_kp=${rlQValues[0].toFixed(1)})`.trim(),
        time: Date.now(),
        model: 'DQN',
      };
    }

    // ── PATH B: Adaptive MaxPressure / Actuated Rules ──
    const isDynamic = this.mode === 'DYNAMIC_AUTO';
    const prefix = isDynamic ? `[Auto: Adaptive]` : `[Adaptive]`;

    // Rule 1: Switch if current direction is empty AND opposing has vehicles (must respect MIN_GREEN)
    if (timeInPhase >= this.MIN_GREEN && currentQueue === 0 && opposingQueue > 0) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `${prefix} Empty approach (0) vs opposing (${opposingQueue})`,
        time: Date.now(),
        model: 'ADAPTIVE',
      };
    }

    // Rule 1.5: Starvation Guard — If opposing vehicles have been waiting > 18s at this junction, switch (must respect MIN_GREEN)
    if (timeInPhase >= this.MIN_GREEN && int.maxWait > 18.0 && opposingQueue > 0) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `${prefix} Starvation guard: Opposing wait ${int.maxWait.toFixed(1)}s > 18s`,
        time: Date.now(),
        model: 'ADAPTIVE',
      };
    }

    // Rule 2: Force switch if max green reached (starvation prevention)
    if (timeInPhase >= this.MAX_GREEN) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `${prefix} Max green (${this.MAX_GREEN}s) ceiling reached`,
        time: Date.now(),
        model: 'ADAPTIVE',
      };
    }

    // Rule 3: Significant queue imbalance (must respect MIN_GREEN)
    const dynamicThreshold = Math.max(3, currentQueue * 0.5);
    if (timeInPhase >= this.MIN_GREEN && opposingQueue > currentQueue + dynamicThreshold) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `${prefix} Imbalance: Opposing (${opposingQueue}) > Active (${currentQueue})`,
        time: Date.now(),
        model: 'ADAPTIVE',
      };
    }

    // Rule 4: Ideal green time fulfilled (must respect MIN_GREEN)
    const ideal = Math.max(this.MIN_GREEN, this._idealGreen(currentQueue));
    if (timeInPhase >= ideal && opposingQueue > 0) {
      tl.forcePhase(currentIsNS ? 1 : 3);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `${prefix} Ideal green (${ideal.toFixed(1)}s) fulfilled`,
        time: Date.now(),
        model: 'ADAPTIVE',
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


