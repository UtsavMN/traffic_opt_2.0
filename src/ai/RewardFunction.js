/**
 * RewardFunction — Computes reward for RL training
 */
export function computeReward(prevState, nextState, action, info) {
  // If we don't have info (v1 array states), approximate it:
  if (!info) {
    const pQ = (prevState[0]+prevState[1]+prevState[2]+prevState[3]) * 15;
    const nQ = (nextState[0]+nextState[1]+nextState[2]+nextState[3]) * 15;
    
    // Approximate wait reduction with queue length reduction
    const waitReduction = (pQ - nQ) * 2.0;
    
    const qNS = (nextState[0]+nextState[1]) * 15;
    const qEW = (nextState[2]+nextState[3]) * 15;
    const imbalance = Math.abs(qNS - qEW);
    const balancePenalty = imbalance > 5 ? -(imbalance - 5) * 0.2 : 0;
    
    const emergencyPenalty = nextState[14] === 1 ? -15 : 0;
    
    const maxQueue = Math.max(nextState[0], nextState[1], nextState[2], nextState[3]) * 15;
    const starvationPenalty = maxQueue > 20 ? -3 : 0;
    
    return waitReduction + balancePenalty + emergencyPenalty + starvationPenalty;
  }

  // V2 Logic with info object (Phase 4 starvation + throughput fix + Pressure)
  const totalQueue = (info.qNS || 0) + (info.qEW || 0);
  const avgWait = totalQueue > 0 ? (info.waitSeconds || 0) / totalQueue : 0;

  const QUEUE_WEIGHT = 0.3;
  const WAIT_WEIGHT = 0.2;
  const EMERGENCY_BONUS = 5;
  const BALANCE_PENALTY_WEIGHT = 0.15;
  const THROUGHPUT_REWARD_WEIGHT = 1.0;
  const STARVATION_PENALTY_WEIGHT = 0.05;
  const STARVATION_GRACE_STEPS = 20;

  // New in v10: Direct Pressure Reduction Reward
  let pressureReduction = 0;
  if (prevState && nextState) {
    const prevPressure = prevState[0] + prevState[1];
    const nextPressure = nextState[0] + nextState[1];
    pressureReduction = (prevPressure - nextPressure) * 10.0; // Scaled up to be significant
  }

  let reward = -(totalQueue * QUEUE_WEIGHT) - (avgWait * WAIT_WEIGHT) + pressureReduction;

  // Emergency preemption bonus
  if (action === 'EMERGENCY_OVERRIDE_NS' || action === 'EMERGENCY_OVERRIDE_EW' || action === 'PEDESTRIAN_SCRAMBLE') {
    if (info.emergencyBlocked === true) {
      reward += EMERGENCY_BONUS;
    }
  }

  // Balance penalty
  reward -= Math.abs((info.qNS || 0) - (info.qEW || 0)) * BALANCE_PENALTY_WEIGHT;

  // Throughput reward (direct incentive to clear vehicles)
  reward += (info.completedThisStep || 0) * THROUGHPUT_REWARD_WEIGHT;

  // Escalating starvation penalty based on consecutive red steps per direction
  if (info.redStreaks) {
    const worstStreak = Math.max(
      info.redStreaks.N || 0,
      info.redStreaks.S || 0,
      info.redStreaks.E || 0,
      info.redStreaks.W || 0
    );
    if (worstStreak > STARVATION_GRACE_STEPS) {
      const overage = worstStreak - STARVATION_GRACE_STEPS;
      reward -= overage * overage * STARVATION_PENALTY_WEIGHT * 0.01; // quadratic escalation
    }
  }

  return Math.max(-50, Math.min(50, reward)); // Bound reward to prevent extreme spikes
}
