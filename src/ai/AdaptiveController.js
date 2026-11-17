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

    if (currentMode === 'TRADITIONAL_FIXED_120S' || engine.benchmarkMode === 'FIXED_120S') {
      return; // Rigid pre-timed mode: signals cycle on 120s clocks without AI intervention
    }

    for (const [id, int] of engine.intersections) {
      if (!int.isSignalized || !int.trafficLight) continue;
      if (int.aiCooldown > 0) continue;

      // Ensure physical traffic light has balanced realistic cycle limits (15s to 25s).
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

    const totalQueue = int.getTotalQueue ? int.getTotalQueue() : 0;
    const currentIsNS = (int?.trafficLight?.currentPhase) ? int.trafficLight.currentPhase.includes('NS') : true;
    const currentQueue = int.getActiveQueue ? int.getActiveQueue() : (currentIsNS ? int.getQueueNS() : int.getQueueEW());
    const opposingQueue = int.getOpposingQueue ? int.getOpposingQueue() : (currentIsNS ? int.getQueueEW() : int.getQueueNS());

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
    // 3. Arterial corridor wave / incoming platoon (>= 0.35 or active platoon)
    // 4. Strong neural policy advantage (|ΔQ| >= 1.0 with active vehicles)
    const isCorridorCongested = totalQueue >= 6 || opposingQueue >= 5;
    const isArterialWave = neighborPressure >= 0.35 || (int.platoonApproaching && int.platoonCount >= 3);
    const isHighConfidenceRL = qAdvantage >= 1.0 && totalQueue >= 3;

    if (isArterialWave || isCorridorCongested || isHighConfidenceRL) {
      const reasonDetail = int.platoonApproaching
        ? `corridor wave (${int.platoonCount} veh approaching on ${int.platoonEdgeName || 'corridor'})`
        : isArterialWave
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
    if (!int || !int.isSignalized || !int.trafficLight) return null;
    const tl = int.trafficLight;
    if (!tl) return null;
    const nsQ = int.getQueueNS();
    const ewQ = int.getQueueEW();
    const timeInPhase = tl.timeInPhase || 0;
    const phase = tl.currentPhase || 'NS_GREEN';

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

    // Only evaluate during green phases (all M-phases supported)
    if (tl.isYellow) return null;

    // Wait for minimum green safety clearance before any evaluation
    if (timeInPhase < this.MIN_GREEN) return null;

    const numPhases = tl.numPhases || 2;
    const currentPhaseIdx = tl.currentPhaseIndex || 0;
    const currentIsNS = phase.includes('NS');

    let currentQueue = 0;
    let maxOpposingQueue = 0;
    let totalOpposingQueue = 0;
    let bestTargetPhaseIdx = (currentPhaseIdx + 1) % numPhases;

    if (int.approaches && int.approaches.length > 0) {
      const phaseQueues = new Array(numPhases).fill(0);
      for (const app of int.approaches) {
        phaseQueues[app.phaseIndex] = (phaseQueues[app.phaseIndex] || 0) + (app.queue || 0);
      }
      currentQueue = phaseQueues[currentPhaseIdx] || 0;
      let bestQ = -1;
      for (let p = 0; p < numPhases; p++) {
        if (p === currentPhaseIdx) continue;
        const q = phaseQueues[p] || 0;
        totalOpposingQueue += q;
        if (q > bestQ) {
          bestQ = q;
          bestTargetPhaseIdx = p;
          maxOpposingQueue = q;
        }
      }
    } else {
      currentQueue = currentIsNS ? nsQ : ewQ;
      maxOpposingQueue = currentIsNS ? ewQ : nsQ;
      totalOpposingQueue = maxOpposingQueue;
      bestTargetPhaseIdx = currentIsNS ? 1 : 0;
    }

    const getSwitchActionName = (targetIdx) => {
      if (numPhases === 2) {
        return targetIdx === 0 ? 'SWITCH_TO_NS' : 'SWITCH_TO_EW';
      }
      return `SWITCH_TO_P${targetIdx}`;
    };

    // ── RULE 0: Arterial Green Wave Platoon Synchronization ──
    if (int.platoonApproaching) {
      // Case A: Platoon is arriving on the CURRENT active green phase
      if (int.platoonPhaseIndex === currentPhaseIdx) {
        // Hold green to let the platoon ride through uninterrupted without stopping
        if (int.platoonEta <= 6.5 && timeInPhase < this.MAX_GREEN + 8) {
          return null; // Continuous green wave progression
        }
      } else {
        // Case B: Platoon is arriving on a COMPETING phase
        // If current approach is cleared (<= 1 veh) and min green met, switch early!
        if (currentQueue <= 1 && timeInPhase >= this.MIN_GREEN) {
          tl.triggerYellow(int.platoonPhaseIndex);
          const isDynamic = this.mode === 'DYNAMIC_AUTO';
          const prefix = isDynamic ? `[Auto: Green Wave]` : `[Green Wave]`;
          return {
            intersectionId: int.id,
            action: getSwitchActionName(int.platoonPhaseIndex),
            reason: `${prefix} Coordinated wave for ${int.platoonCount} veh on ${int.platoonEdgeName} (ETA ${int.platoonEta.toFixed(1)}s)`,
            time: Date.now(),
            model: 'GREEN_WAVE'
          };
        }
      }
    }

    // Actuated Zero-Demand Hold Veto: if all opposing approaches are empty, lock current green!
    if (totalOpposingQueue === 0 && timeInPhase < this.MAX_GREEN) {
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
        (i, a) => this._executeRLAction(i, a, bestTargetPhaseIdx),
        Array.from(rlQValues)
      );

      if (result.executed === 'KEEP_PHASE') {
        return null; // Quietly hold green
      }

      const isDynamic = this.mode === 'DYNAMIC_AUTO';
      const prefix = isDynamic ? `[Auto: DQN]` : `[Sanchar DQN]`;

      return {
        intersectionId: int.id,
        action: result.executed === 'SWITCH_PHASE' ? getSwitchActionName(bestTargetPhaseIdx) : result.executed,
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
    if (timeInPhase >= this.MIN_GREEN && currentQueue === 0 && totalOpposingQueue > 0) {
      tl.triggerYellow(bestTargetPhaseIdx);
      return {
        intersectionId: int.id,
        action: getSwitchActionName(bestTargetPhaseIdx),
        reason: `${prefix} Cleared current phase (0) -> phase ${bestTargetPhaseIdx} demand (${maxOpposingQueue} veh)`,
        time: Date.now(),
        model: 'ADAPTIVE',
      };
    }

    // Rule 1.5: Starvation Guard — If opposing vehicles have been waiting > 18s at this junction, switch (must respect MIN_GREEN)
    if (timeInPhase >= this.MIN_GREEN && int.maxWait > 18.0 && totalOpposingQueue > 0) {
      tl.triggerYellow(bestTargetPhaseIdx);
      return {
        intersectionId: int.id,
        action: getSwitchActionName(bestTargetPhaseIdx),
        reason: `${prefix} Starvation guard: Opposing wait ${int.maxWait.toFixed(1)}s > 18s`,
        time: Date.now(),
        model: 'ADAPTIVE',
      };
    }

    // Rule 2: Force switch if max green reached (starvation prevention)
    if (timeInPhase >= this.MAX_GREEN) {
      tl.triggerYellow(bestTargetPhaseIdx);
      return {
        intersectionId: int.id,
        action: getSwitchActionName(bestTargetPhaseIdx),
        reason: `${prefix} Max green (${this.MAX_GREEN}s) ceiling reached`,
        time: Date.now(),
        model: 'ADAPTIVE',
      };
    }

    // Rule 3: Significant queue imbalance (must respect MIN_GREEN)
    const dynamicThreshold = Math.max(3, currentQueue * 0.5);
    if (timeInPhase >= this.MIN_GREEN && maxOpposingQueue > currentQueue + dynamicThreshold) {
      tl.triggerYellow(bestTargetPhaseIdx);
      return {
        intersectionId: int.id,
        action: getSwitchActionName(bestTargetPhaseIdx),
        reason: `${prefix} Imbalance: Phase ${bestTargetPhaseIdx} (${maxOpposingQueue}) > Active (${currentQueue})`,
        time: Date.now(),
        model: 'ADAPTIVE',
      };
    }

    // Rule 4: Ideal green time fulfilled (must respect MIN_GREEN)
    const ideal = Math.max(this.MIN_GREEN, this._idealGreen(currentQueue));
    if (timeInPhase >= ideal && totalOpposingQueue > 0) {
      tl.triggerYellow(bestTargetPhaseIdx);
      return {
        intersectionId: int.id,
        action: getSwitchActionName(bestTargetPhaseIdx),
        reason: `${prefix} Ideal green (${ideal.toFixed(1)}s) fulfilled -> phase ${bestTargetPhaseIdx}`,
        time: Date.now(),
        model: 'ADAPTIVE',
      };
    }

    return null;
  }

  _executeRLAction(int, actionName, targetPhaseIdx = null) {
    const tl = int?.trafficLight;
    if (!tl) return;

    switch (actionName) {
      case 'SWITCH_PHASE':
        tl.triggerYellow(targetPhaseIdx);
        break;
      case 'KEEP_PHASE':
      default:
        // No-op: keep current green
        break;
    }
  }

  _computeReward(int, decision, completedThisStep = 0) {
    if (!int) return 0;
    const w1 = 12.0;
    const w2 = 2.0;
    const w3 = 1.0;
    const w4 = 1.0;

    // 1. Throughput
    const rThroughput = w2 * completedThisStep;

    // 2. Pressure Reduction
    const tl = int.trafficLight;
    const currentIsNS = tl ? (tl.currentPhase ? tl.currentPhase.includes('NS') : true) : true;
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
    const maxRed = tl ? Math.max(tl.redDurationNS || 0, tl.redDurationEW || 0) : 0;
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


