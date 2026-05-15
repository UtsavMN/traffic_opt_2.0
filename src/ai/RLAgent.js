import { StateEncoder } from './StateEncoder.js';
import { ExperienceReplay } from './ExperienceReplay.js';
import { computeReward } from './RewardFunction.js';

/**
 * RLAgent — DQN shadow agent. Observes and logs but doesn't act (Phase 1).
 * Simple JS-based Q-value approximation for display purposes.
 */
const ACTIONS = [
  'KEEP_NS_GREEN', 'SWITCH_TO_NS_GREEN', 'SWITCH_TO_EW_GREEN',
  'EXTEND_NS_5S', 'EXTEND_EW_5S', 'EMERGENCY_OVERRIDE_NS',
  'EMERGENCY_OVERRIDE_EW', 'PEDESTRIAN_SCRAMBLE'
];

export class RLAgent {
  constructor() {
    this.encoder = new StateEncoder();
    this.replay = new ExperienceReplay(50000);
    this.actionCount = ACTIONS.length;
    this.epsilon = 1.0;
    this.epsilonDecay = 0.9995;
    this.epsilonMin = 0.05;
    this.gamma = 0.95;
    this.trainingSteps = 0;
    this.shadowMode = true;

    // Simple Q-table approximation (for shadow mode display)
    // In production, this would be a neural network
    this.qTable = new Map();

    // Per-intersection state tracking
    this.prevStates = new Map();
    this.prevActions = new Map();
    this.prevInfos = new Map();
  }

  observe(intersectionId, engine) {
    const int = engine.intersections.get(intersectionId);
    if (!int) return;

    const state = this.encoder.encode(int, engine);
    
    const info = {
      waitSeconds: int.totalWaitSeconds || 0,
      maxQueue: Math.max(int.queues.N, int.queues.S, int.queues.E, int.queues.W) || 0,
      qNS: int.queues.N + int.queues.S,
      qEW: int.queues.E + int.queues.W,
      emergencyBlocked: int.emergencyApproaching && (int.queues.N>0 || int.queues.S>0 || int.queues.E>0 || int.queues.W>0),
      completedThisStep: engine.completedThisStep || 0,
    };

    // If we have a previous state, store transition
    if (this.prevStates.has(intersectionId)) {
      const prevState = this.prevStates.get(intersectionId);
      const prevAction = this.prevActions.get(intersectionId);
      const prevInfo = this.prevInfos.get(intersectionId) || { waitSeconds: 0 };
      
      info.prevWaitSeconds = prevInfo.waitSeconds;
      
      const reward = computeReward(prevState, state, prevAction, info);
      this.replay.push(prevState, prevAction, reward, state, false);
    }

    // Choose action (epsilon-greedy, but don't execute in shadow mode)
    const action = this._selectAction(state);
    this.prevStates.set(intersectionId, state);
    this.prevActions.set(intersectionId, action);
    this.prevInfos.set(intersectionId, info);

    return { action: ACTIONS[action], qValues: this._getQValues(state) };
  }

  _selectAction(state) {
    if (Math.random() < this.epsilon) {
      return Math.floor(Math.random() * this.actionCount);
    }
    const qvals = this._getQValues(state);
    let best = 0;
    for (let i = 1; i < qvals.length; i++) {
      if (qvals[i] > qvals[best]) best = i;
    }
    return best;
  }

  _getQValues(state) {
    // Simple tabular approximation using state hash
    const key = this._hashState(state);
    if (!this.qTable.has(key)) {
      this.qTable.set(key, new Float32Array(this.actionCount));
    }
    return this.qTable.get(key);
  }

  _hashState(state) {
    // Discretize state into bins for tabular Q-learning
    let hash = '';
    for (let i = 0; i < state.length; i++) {
      hash += Math.floor(state[i] * 4).toString(36);
    }
    return hash;
  }

  train() {
    if (this.replay.size < 64) return;

    const batch = this.replay.sample(32);
    for (const { state, action, reward, nextState } of batch) {
      const qvals = this._getQValues(state);
      const nextQvals = this._getQValues(nextState);
      const maxNextQ = Math.max(...nextQvals);
      const target = reward + this.gamma * maxNextQ;
      const lr = 0.01;
      qvals[action] += lr * (target - qvals[action]);
    }

    this.trainingSteps++;
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
  }

  getConfidence(state) {
    const qvals = this._getQValues(state);
    // Softmax
    const max = Math.max(...qvals);
    const exps = Array.from(qvals).map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
  }

  get stats() {
    return {
      trainingSteps: this.trainingSteps,
      replaySize: this.replay.size,
      epsilon: this.epsilon,
      shadowMode: this.shadowMode,
    };
  }
}
