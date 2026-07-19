import { useAIStore } from '../store/aiStore.js';
import { safeExecuteRLAction } from './SafetyComplianceWrapper.js';

const ACTIONS = [
  'KEEP_NS_GREEN', 'SWITCH_TO_NS_GREEN', 'SWITCH_TO_EW_GREEN',
  'EXTEND_NS_5S', 'EXTEND_EW_5S', 'EMERGENCY_OVERRIDE_NS',
  'EMERGENCY_OVERRIDE_EW', 'PEDESTRIAN_SCRAMBLE'
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
    this.MIN_GREEN = 5;    // 5s minimum — safety clearance
    this.MAX_GREEN = 60;   // 60s maximum — prevent starvation
    this.MAX_EXPECTED = 30; // vehicles — scale reference

    this.onDecision = null;
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
      // Safety simulation-time cooldown to prevent rapid evaluations
      if (int.aiCooldown > 0) continue;
      
      // Ensure AI has full control by preventing TrafficLight auto-advance
      if (int.trafficLight.greenDuration !== 9999) {
        int.trafficLight.setGreenDuration(9999);
      }

      const decision = this._evaluate(int, engine);
      if (decision) {
        int.aiCooldown = 3.0; // Debounce next evaluation for 3.0s simulation seconds
        this.totalDecisions++;
        int.triggerAIPulse(decision.action);

        const reward = this._computeReward(int, decision, int.vehiclesPassedAccumulatedController || 0);
        int.vehiclesPassedAccumulatedController = 0;
        this.totalReward += reward;
        this.rewardHistory.push(reward);
        if (this.rewardHistory.length > 500) this.rewardHistory.shift();

        decision.reward = reward;
        this.decisions.push(decision);
        if (this.decisions.length > 20) this.decisions.shift();

        if (this.onDecision) this.onDecision(decision);

        // Global bridge for metrics
        if (typeof window !== 'undefined' && window.__zenithAI) {
          window.__zenithAI.logDecision({
            time: new Date().toLocaleTimeString(),
            intersectionId: int.id,
            action: decision.action,
            reason: decision.reason,
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

    // Emergency preemption (always highest priority)
    if (int.emergencyApproaching) {
      int.emergencyApproaching = false;
      const dir = (int.emergencyDir === 'N' || int.emergencyDir === 'S') ? 'NS' : 'EW';
      tl.emergencyOverrideDir = dir;
      tl.emergencyTimer = 5; // 5 sim-seconds
      return {
        intersectionId: int.id,
        action: 'EMRG_PREEMPT',
        reason: `Emergency vehicle approaching from ${int.emergencyDir} — ${dir} green`,
        time: Date.now(),
      };
    }

    // Only evaluate during green phases to allow yellow/red safety clearances to complete
    if (phase !== 'NS_GREEN' && phase !== 'EW_GREEN') return null;

    // Wait for minimum green safety clearance before any switch
    if (timeInPhase < this.MIN_GREEN) return null;

    const currentIsNS = phase === 'NS_GREEN';
    const currentQueue = currentIsNS ? nsQ : ewQ;
    const opposingQueue = currentIsNS ? ewQ : nsQ;

    // Actuated Zero-Demand Hold Veto: if opposing direction is completely empty, lock current green!
    // Prevent vetoing if we have exceeded MAX_GREEN, avoiding starvation of pedestrians/other movements.
    const isGreenPhase = phase === 'NS_GREEN' || phase === 'EW_GREEN';
    if (isGreenPhase && opposingQueue === 0 && timeInPhase < this.MAX_GREEN) {
      // Hold green: do not switch, do not trigger yellow
      return null;
    }

    // Active Reinforcement Learning Decision Path
    if (this.mode === 'RL_ACTIVE' && this.coordinator) {
      const rlAgent = this.coordinator.rlAgent;
      const state = rlAgent.encoder.encode(int, engine);
      const actionIdx = rlAgent._selectAction(state);
      const actionName = ACTIONS[actionIdx];

      // Execute chosen action safely through the compliance logic layer
      const result = safeExecuteRLAction(int, actionName, this._executeRLAction.bind(this));

      return {
        intersectionId: int.id,
        action: result.executed,
        reason: result.vetoed
          ? `${result.reason} (policy requested ${result.vetoed})`
          : `DQN RL Agent (ε = ${rlAgent.epsilon.toFixed(3)})`,
        time: Date.now(),
      };
    }

    // Rule 1: Switch immediately if current direction is empty AND opposing has vehicles
    if (currentQueue === 0 && opposingQueue > 0) {
      tl.forcePhase(currentIsNS ? 1 : 4); // transition to yellow
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `Empty (0) vs opposing (${opposingQueue}) — instant switch`,
        time: Date.now(),
      };
    }

    // Rule 2: Switch if opposing queue is significantly larger
    const dynamicThreshold = Math.max(3, currentQueue * 0.5);
    if (opposingQueue > currentQueue + dynamicThreshold) {
      tl.forcePhase(currentIsNS ? 1 : 4);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `NS=${nsQ} EW=${ewQ} — imbalance trigger`,
        time: Date.now(),
      };
    }

    // Rule 3: Extend if current queue is large and hasn't reached ideal green time
    const ideal = this._idealGreen(currentQueue);
    if (timeInPhase < ideal && currentQueue > 0) {
      // Stay green — don't switch
      return null;
    }

    // Rule 4: Force switch if max green reached (starvation prevention)
    if (timeInPhase >= this.MAX_GREEN) {
      tl.forcePhase(currentIsNS ? 1 : 4);
      return {
        intersectionId: int.id,
        action: 'FORCE_SWITCH',
        reason: `Max green (${this.MAX_GREEN}s) reached — forced switch`,
        time: Date.now(),
      };
    }

    // Rule 5: Switch if ideal green time passed and both queues present
    if (timeInPhase >= ideal && opposingQueue > 0) {
      tl.forcePhase(currentIsNS ? 1 : 4);
      return {
        intersectionId: int.id,
        action: currentIsNS ? 'SWITCH_TO_EW' : 'SWITCH_TO_NS',
        reason: `Ideal green (${ideal.toFixed(1)}s) reached, NS=${nsQ} EW=${ewQ}`,
        time: Date.now(),
      };
    }

    return null;
  }

  _executeRLAction(int, actionName) {
    const tl = int.trafficLight;
    const currentIsNS = tl.currentPhase === 'NS_GREEN';

    switch (actionName) {
      case 'SWITCH_TO_NS_GREEN':
        if (!currentIsNS) {
          tl.forcePhase(4); // Force EW_YELLOW to transition to NS_GREEN safely
        }
        break;
      case 'SWITCH_TO_EW_GREEN':
        if (currentIsNS) {
          tl.forcePhase(1); // Force NS_YELLOW to transition to EW_GREEN safely
        }
        break;
      case 'EXTEND_NS_5S':
        if (currentIsNS) {
          tl.timer = Math.max(0, tl.timer - 5); // Subtract 5s to extend green phase
        }
        break;
      case 'EXTEND_EW_5S':
        if (!currentIsNS) {
          tl.timer = Math.max(0, tl.timer - 5); // Subtract 5s to extend green phase
        }
        break;
      case 'EMERGENCY_OVERRIDE_NS':
        tl.emergencyOverrideDir = 'NS';
        tl.emergencyTimer = 5;
        break;
      case 'EMERGENCY_OVERRIDE_EW':
        tl.emergencyOverrideDir = 'EW';
        tl.emergencyTimer = 5;
        break;
      case 'PEDESTRIAN_SCRAMBLE':
        // Safe scramble: force all vehicles to stop via ALL_RED phase
        tl.forcePhase(currentIsNS ? 2 : 5); 
        break;
      case 'KEEP_NS_GREEN':
      default:
        // No-op: keep current state
        break;
    }
  }

  _computeReward(int, decision, completedThisStep = 0) {
    const totalQ = int.getTotalQueue();
    const waitSeconds = int.totalWaitSeconds || 0;
    
    // Base penalty for queue size and delays
    let reward = -(totalQ * 0.3) - (waitSeconds * 0.05);

    // Throughput reward (incentivizes clearing vehicles)
    reward += completedThisStep * 0.8;

    // Starvation penalty (non-linear escalation after 30 seconds of red light)
    const tl = int.trafficLight;
    const starvationNS = tl.redDurationNS > 30 ? Math.pow(tl.redDurationNS - 30, 1.2) * 0.15 : 0;
    const starvationEW = tl.redDurationEW > 30 ? Math.pow(tl.redDurationEW - 30, 1.2) * 0.15 : 0;
    reward -= (starvationNS + starvationEW);

    if (decision.action === 'EMRG_PREEMPT') reward += 5;
    else if (decision.action.startsWith('SWITCH')) {
      const balance = Math.abs(int.getQueueNS() - int.getQueueEW());
      reward += (10 - balance) * 0.3;
      reward -= 1.5; // Switch penalty: discourage rapid, unnecessary switching!
    }
    return Math.round(reward * 10) / 10;
  }

  getAverageReward() {
    if (this.rewardHistory.length === 0) return 0;
    const sum = this.rewardHistory.reduce((a, b) => a + b, 0);
    return sum / this.rewardHistory.length;
  }
}

