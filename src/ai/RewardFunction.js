/**
 * RewardFunction — Computes reward for RL training
 */
export function computeReward(prevState, nextState, action, info) {
  let reward = 0.0;
  
  // 1. Throughput Bonus
  const throughput = info ? (info.completedThisStep || 0) : 0;
  reward += throughput * 20.0;

  // 2. Action Penalties (tuned down per Python ablation findings)
  if (action === 'SWITCH_PHASE') reward -= 1.0;
  if (action === 'EXTEND_PHASE') reward -= 0.5;
  if (action === 'PEDESTRIAN_SCRAMBLE') reward -= 2.0;

  // 3. Pressure Reduction (using v10 invariant state indices 0 and 1)
  if (prevState && nextState) {
    const prevPressure = prevState[0] + prevState[1];
    const currPressure = nextState[0] + nextState[1];
    if (currPressure < prevPressure) {
      reward += 15.0; // Rewarded for clearing queues
    } else if (currPressure > prevPressure) {
      reward -= 10.0; // Penalized for allowing queues to grow
    }
  }

  // 4. Starvation Penalty (state index 9 is starvation flag)
  if (nextState && nextState[9] > 0.0) {
    reward -= 50.0;
  }

  // 5. Emergency Vehicle Priority (state index 6 is emergency in v10)
  if (nextState && nextState[6] > 0.0 && action === 'SWITCH_PHASE') {
    reward += 30.0;
  }

  // Bound reward to prevent extreme spikes
  return Math.max(-100.0, Math.min(100.0, reward));
}
