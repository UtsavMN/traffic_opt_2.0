export const MIN_GREEN_S = 10;  // 10s minimum green to prevent rapid flapping
export const MAX_GREEN_S = 25;  // 25s maximum green — guarantees light cycles regularly even in heavy jams
export const HYSTERESIS_MARGIN = 0.75; // Q-margin required for switch

/**
 * Validates and executes RL actions safely through NEMA TS 2 compliance.
 * Vetoes jittery, un-warranted, or unsafe actions.
 */
export function safeExecuteRLAction(int, actionName, executeFn, qValues = null) {
  const tl = int.trafficLight;
  if (!tl) return { executed: 'KEEP_PHASE', vetoed: actionName, reason: 'Unsignalized node' };
  const currentIsNS = tl.currentPhase === 'NS_GREEN';
  const timeInPhase = tl.timeInPhase;
  const queues = int.queues || { N: 0, S: 0, E: 0, W: 0 };
  const currentQueue = currentIsNS ? (queues.N + queues.S) : (queues.E + queues.W);
  const opposingQueue = currentIsNS ? (queues.E + queues.W) : (queues.N + queues.S);

  // 1. Hard ceiling — Max green exceeded -> Force switch to prevent starvation
  if (timeInPhase >= MAX_GREEN_S) {
    const forced = 'SWITCH_PHASE';
    executeFn(int, forced);
    return {
      executed: forced,
      vetoed: actionName,
      reason: `MAX_GREEN (${MAX_GREEN_S}s) reached — starvation prevention override`,
    };
  }

  // 2. Hard floor — Min green not yet satisfied
  if (actionName === 'SWITCH_PHASE' && timeInPhase < MIN_GREEN_S) {
    executeFn(int, 'KEEP_PHASE');
    return {
      executed: 'KEEP_PHASE',
      vetoed: actionName,
      reason: `MIN_GREEN (${MIN_GREEN_S}s) not yet reached (${timeInPhase.toFixed(1)}s) — switch vetoed`,
    };
  }

  // 3. Actuated zero-demand hold veto
  if (actionName === 'SWITCH_PHASE' && opposingQueue === 0) {
    executeFn(int, 'KEEP_PHASE');
    return {
      executed: 'KEEP_PHASE',
      vetoed: actionName,
      reason: 'Zero demand on opposing approach — holding green',
    };
  }

  // 4. Anti-flapping hysteresis check
  if (actionName === 'SWITCH_PHASE' && qValues && qValues.length >= 2) {
    const qKeep = qValues[0];
    const qSwitch = qValues[1];
    if (qSwitch < qKeep + HYSTERESIS_MARGIN && opposingQueue <= currentQueue) {
      executeFn(int, 'KEEP_PHASE');
      return {
        executed: 'KEEP_PHASE',
        vetoed: actionName,
        reason: `Hysteresis guard: Q_sw (${qSwitch.toFixed(2)}) does not exceed Q_kp (${qKeep.toFixed(2)}) + margin`,
      };
    }
  }

  // Safe action execution
  executeFn(int, actionName);
  return { executed: actionName, vetoed: null, reason: null };
}
