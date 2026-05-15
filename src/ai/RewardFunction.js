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

  // V2 Logic with info object
  const waitReduction = (info.prevWaitSeconds - info.waitSeconds) / 10;
  const throughputGain = info.completedThisStep * 0.5;
  const imbalance = Math.abs(info.qNS - info.qEW);
  const balancePenalty = imbalance > 5 ? -(imbalance - 5) * 0.2 : 0;
  const emergencyPenalty = info.emergencyBlocked ? -15 : 0;
  const starvationPenalty = info.maxQueue > 20 ? -3 : 0;
  
  return waitReduction + throughputGain + balancePenalty + emergencyPenalty + starvationPenalty;
}
