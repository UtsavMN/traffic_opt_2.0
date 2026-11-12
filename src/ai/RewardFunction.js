/**
 * RewardFunction — Sanchar Objective-Driven Reward
 * 
 * R = w1 * (Pressure Reduction)
 *   + w2 * (Throughput)
 *   - w3 * (Switching Cost)
 *   - w4 * (Waiting & Delay Penalty)
 * 
 * Core Principle:
 * Reward the agent for improving traffic conditions, not merely for choosing a particular action.
 */
export function computeReward(prevState, nextState, action, info) {
  const w1 = 12.0;  // Weight on Pressure Reduction
  const w2 = 2.0;   // Weight on Throughput (per vehicle completed)
  const w3 = 1.0;   // Weight on Switching Cost (clearance loss penalty)
  const w4 = 1.0;   // Weight on Waiting / Delay Penalty

  // 1. Throughput (+2.0 per vehicle completed)
  const throughput = info ? (info.completedThisStep || 0) : 0;
  const rThroughput = w2 * throughput;

  // 2. Pressure Reduction (Lyapunov energy reduction across all approaches)
  let rPressure = 0.0;
  const currActive = nextState ? nextState[0] : 0;
  const currOpposing = nextState ? nextState[1] : 0;
  const currPressure = (currActive * currActive) + (currOpposing * currOpposing);

  if (prevState && nextState) {
    const prevActive = prevState[0];
    const prevOpposing = prevState[1];
    const prevPressure = (prevActive * prevActive) + (prevOpposing * prevOpposing);
    const deltaPressure = prevPressure - currPressure;
    rPressure = w1 * deltaPressure;
  } else {
    rPressure = -0.5 * currPressure;
  }

  // 3. Switching Cost (Lost physical clearance capacity during yellow phase)
  const isSwitch = (action === 'SWITCH_PHASE' || action === 1);
  const rSwitch = isSwitch ? -w3 : 0.0;

  // 4. Waiting & Delay Penalty (Total queue delay + starvation escalation)
  const queueDelay = currActive + currOpposing;
  const starvationFlag = (nextState && nextState[9] > 0.5) ? 1.0 : 0.0;
  const rWait = -w4 * (queueDelay + starvationFlag * 1.5);

  // 5. Emergency Vehicle Priority (Penalty while emergency vehicle is blocked)
  let rEmergency = 0.0;
  if (nextState && nextState[6] > 0.5) {
    rEmergency = -3.0;
  }

  const totalReward = rPressure + rThroughput + rSwitch + rWait + rEmergency;
  return Math.max(-15.0, Math.min(15.0, totalReward));
}
