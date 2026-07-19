import { StateEncoder } from './StateEncoder.js';
import { ExperienceReplay } from './ExperienceReplay.js';
import { computeReward } from './RewardFunction.js';
import { QApproximator } from './QApproximator.js';

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

    // Linear Function Approximator
    this.q = new QApproximator(this.actionCount);

    // Per-intersection state tracking
    this.prevStates = new Map();
    this.prevActions = new Map();
    this.prevInfos = new Map();
    this.redStreaks = new Map();
  }

  observe(intersectionId, engine) {
    const int = engine.intersections.get(intersectionId);
    if (!int) return;

    const state = this.encoder.encode(int, engine);

    // Track consecutive-red steps per direction to feed the starvation penalty
    if (!this.redStreaks.has(intersectionId)) {
      this.redStreaks.set(intersectionId, { N: 0, S: 0, E: 0, W: 0 });
    }
    const streaks = this.redStreaks.get(intersectionId);
    for (const dir of ['N', 'S', 'E', 'W']) {
      const isGreen = int.trafficLight.canPass(dir);
      const hasQueue = int.queues[dir] > 0;
      streaks[dir] = (isGreen || !hasQueue) ? 0 : streaks[dir] + 1;
    }
    
    const info = {
      waitSeconds: int.totalWaitSeconds || 0,
      maxQueue: Math.max(int.queues.N, int.queues.S, int.queues.E, int.queues.W) || 0,
      qNS: int.queues.N + int.queues.S,
      qEW: int.queues.E + int.queues.W,
      emergencyBlocked: int.emergencyApproaching && (int.queues.N>0 || int.queues.S>0 || int.queues.E>0 || int.queues.W>0),
      completedThisStep: int._vehiclesPassed || 0,
      redStreaks: { ...streaks },
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

    // Choose action (epsilon-greedy)
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
    return this.q.predict(state);
  }

  train() {
    if (this.replay.size < 64) return;

    const batch = this.replay.sample(32);
    for (const { state, action, reward, nextState } of batch) {
      const nextQ = this.q.predict(nextState);
      let maxNextQ = Math.max(...nextQ);
      if (isNaN(maxNextQ)) maxNextQ = 0;
      const target = reward + this.gamma * maxNextQ;
      this.q.update(state, action, target, 0.01);
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
