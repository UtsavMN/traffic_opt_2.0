/**
 * ExperienceReplay — Circular buffer for storing RL transitions
 */
export class ExperienceReplay {
  constructor(capacity = 50000) {
    this.capacity = capacity;
    this.buffer = [];
    this.position = 0;
  }

  push(state, action, reward, nextState, done) {
    const transition = { state, action, reward, nextState, done };
    if (this.buffer.length < this.capacity) {
      this.buffer.push(transition);
    } else {
      this.buffer[this.position] = transition;
    }
    this.position = (this.position + 1) % this.capacity;
  }

  sample(batchSize) {
    const batch = [];
    const len = this.buffer.length;
    for (let i = 0; i < Math.min(batchSize, len); i++) {
      batch.push(this.buffer[Math.floor(Math.random() * len)]);
    }
    return batch;
  }

  get size() { return this.buffer.length; }
}
