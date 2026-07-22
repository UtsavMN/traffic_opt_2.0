export const MIN_GREEN_S = 5;   // matches AdaptiveController.js's existing MIN_GREEN
export const MAX_GREEN_S = 60;  // matches AdaptiveController.js's existing MAX_GREEN

/**
 * Call this INSTEAD of calling _executeRLAction() directly from the
 * RL_ACTIVE branch of _evaluate(). Vetoes any policy action that would
 * violate the same safety ceilings the rule-based path already guarantees.
 */
export function safeExecuteRLAction(int, actionName, executeFn) {
  const tl = int.trafficLight;
  const currentIsNS = tl.currentPhase === 'NS_GREEN';
  const timeInPhase = tl.timeInPhase;

  // Hard ceiling — this is the guarantee that was missing entirely.
  if (timeInPhase >= MAX_GREEN_S) {
    const forced = 'SWITCH_PHASE';
    executeFn(int, forced);
    return {
      executed: forced,
      vetoed: actionName,
      reason: `MAX_GREEN (${MAX_GREEN_S}s) exceeded — policy action overridden by safety layer`,
    };
  }

  // Hard floor — belt-and-suspenders alongside AdaptiveController's
  // existing upstream MIN_GREEN check (that check already prevents
  // _evaluate() from reaching this branch too early, but this wrapper
  // shouldn't assume that upstream check will never change).
  const isSwitchAction = actionName === 'SWITCH_PHASE';
  if (isSwitchAction && timeInPhase < MIN_GREEN_S) {
    executeFn(int, 'KEEP_PHASE'); // no-op, hold current phase
    return {
      executed: 'KEEP_PHASE',
      vetoed: actionName,
      reason: `MIN_GREEN (${MIN_GREEN_S}s) not yet reached — switch vetoed by safety layer`,
    };
  }

  executeFn(int, actionName);
  return { executed: actionName, vetoed: null, reason: null };
}
