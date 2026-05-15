/**
 * AdaptiveController — Rule-based traffic signal controller (Phase 1 active policy)
 * Monitors queue lengths and dynamically adjusts signal phases per intersection
 */
export class AdaptiveController {
  constructor() {
    this.evaluateInterval = 1.0; // seconds
    this.timer = 0;
    this.decisions = []; // log of recent decisions
    this.totalDecisions = 0;
    this.totalReward = 0;
    this.rewardHistory = [];
    this.mode = 'ADAPTIVE'; // ADAPTIVE | RL_SHADOW | RL_ACTIVE

    // Adaptive parameters
    this.minPhaseDuration = 5;
    this.maxPhaseDuration = 30;
    this.queueThreshold = 3;
    this.pedestrianThreshold = 3;

    // Callbacks
    this.onDecision = null;
  }

  update(dt, engine) {
    this.timer += dt;
    if (this.timer < this.evaluateInterval) return;
    this.timer = 0;

    for (const [id, int] of engine.intersections) {
      const decision = this._evaluate(int, engine);
      if (decision) {
        this.totalDecisions++;
        int.triggerAIPulse(decision.action);

        // Compute simple reward
        const reward = this._computeReward(int, decision);
        this.totalReward += reward;
        this.rewardHistory.push(reward);
        if (this.rewardHistory.length > 500) this.rewardHistory.shift();

        decision.reward = reward;
        this.decisions.push(decision);
        if (this.decisions.length > 20) this.decisions.shift();

        if (this.onDecision) this.onDecision(decision);
      }
    }
  }

  _evaluate(int, engine) {
    const tl = int.trafficLight;
    const nsQ = int.getQueueNS();
    const ewQ = int.getQueueEW();
    const timeInPhase = tl.timeInPhase;
    const phase = tl.currentPhase;

    // Emergency preemption
    if (int.emergencyApproaching) {
      int.emergencyApproaching = false;
      tl.emergencyOverride = true;
      setTimeout(() => { tl.emergencyOverride = false; }, 5000);
      return {
        intersectionId: int.id,
        action: 'EMERGENCY_PREEMPT',
        reason: 'Emergency vehicle approaching',
        time: Date.now(),
      };
    }

    // Pedestrian phase trigger
    if (int.pedestriansWaiting > this.pedestrianThreshold && timeInPhase > this.minPhaseDuration) {
      return {
        intersectionId: int.id,
        action: 'TRIGGER_PED_PHASE',
        reason: `${int.pedestriansWaiting} pedestrians waiting`,
        time: Date.now(),
      };
    }

    // Phase switching logic
    if (timeInPhase < this.minPhaseDuration) return null;

    if (phase === 'NS_GREEN') {
      if ((nsQ === 0 && ewQ > 0) || ewQ > nsQ + this.queueThreshold || timeInPhase > this.maxPhaseDuration) {
        tl.forcePhase(1); // NS_YELLOW
        return {
          intersectionId: int.id,
          action: 'SWITCH_TO_EW_GREEN',
          reason: `NS=${nsQ} EW=${ewQ}`,
          time: Date.now(),
        };
      }
    } else if (phase === 'EW_GREEN') {
      if ((ewQ === 0 && nsQ > 0) || nsQ > ewQ + this.queueThreshold || timeInPhase > this.maxPhaseDuration) {
        tl.forcePhase(3); // EW_YELLOW
        return {
          intersectionId: int.id,
          action: 'SWITCH_TO_NS_GREEN',
          reason: `NS=${nsQ} EW=${ewQ}`,
          time: Date.now(),
        };
      }
    }

    // Extend current phase if queue still present
    if (timeInPhase > 10 && timeInPhase < this.maxPhaseDuration) {
      const currentQ = (phase === 'NS_GREEN') ? nsQ : ewQ;
      if (currentQ > 3) {
        return {
          intersectionId: int.id,
          action: 'EXTEND_CURRENT_5S',
          reason: `Queue=${currentQ}, extending`,
          time: Date.now(),
        };
      }
    }

    return null;
  }

  _computeReward(int, decision) {
    const totalQ = int.getTotalQueue();
    let reward = -totalQ * 0.3; // penalize queues

    if (decision.action === 'EMERGENCY_PREEMPT') reward += 5;
    else if (decision.action === 'TRIGGER_PED_PHASE') reward += 2;
    else if (decision.action.startsWith('SWITCH')) {
      const balance = Math.abs(int.getQueueNS() - int.getQueueEW());
      reward += (10 - balance) * 0.3;
    }
    return Math.round(reward * 10) / 10;
  }

  getAverageReward() {
    if (this.rewardHistory.length === 0) return 0;
    const sum = this.rewardHistory.reduce((a, b) => a + b, 0);
    return sum / this.rewardHistory.length;
  }
}
