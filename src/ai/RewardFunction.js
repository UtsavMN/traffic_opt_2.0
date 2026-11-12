/**
 * RewardFunction — Sanchar Balanced MaxPressure Reward
 * Computes well-scaled reward for reinforcement learning, eliminating
 * short-sighted transition penalties and preventing signal flapping.
 */
export function computeReward(prevState, nextState, action, info) {
  let reward = 0.0;

  // 1. Steady Throughput Incentive (+2.5 per vehicle)
  const throughput = info ? (info.completedThisStep || 0) : 0;
  reward += throughput * 2.5;

  // 2. Queue Pressure Dynamics (Sum of squared normalized pressures)
  if (prevState && nextState) {
    const prevActive = prevState[0];
    const prevOpposing = prevState[1];
    const currActive = nextState[0];
    const currOpposing = nextState[1];

    const prevPressure = (prevActive * prevActive) + (prevOpposing * prevOpposing);
    const currPressure = (currActive * currActive) + (currOpposing * currOpposing);

    // Reward pressure reduction; penalize inflation
    reward += (prevPressure - currPressure) * 12.0;
  }

  // 3. Action-Specific Costs & Hysteresis
  if (action === 'SWITCH_PHASE') {
    reward -= 0.8; // Mild switch cost: deters high-frequency jitter/flapping
    if (nextState && nextState[1] > nextState[0] + 0.15) {
      reward += 4.0; // Reward switching when opposing queue is substantially larger
    }
  } else if (action === 'KEEP_PHASE') {
    // Reward holding green when active approach is heavier
    if (nextState && nextState[0] > nextState[1] + 0.10) {
      reward += 0.5;
    }
  }

  // 4. Starvation Penalty (state index 9 is starvation flag)
  if (nextState && nextState[9] > 0.5) {
    if (action === 'SWITCH_PHASE') {
      reward += 6.0; // Reward relieving starving queues
    } else {
      reward -= 10.0; // Penalize holding when starving
    }
  }

  // 5. Emergency Vehicle Priority (state index 6 is emergency flag)
  if (nextState && nextState[6] > 0.5 && action === 'SWITCH_PHASE') {
    reward += 8.0;
  }

  return Math.max(-25.0, Math.min(25.0, reward));
}
