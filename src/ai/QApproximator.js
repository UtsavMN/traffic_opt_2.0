export class QApproximator {
  constructor(actionCount) {
    this.actionCount = actionCount;
    this.stateDim = null;   // lazily set on first predict() call
    this.weights = null;    // Float32Array[actionCount][stateDim], flattened
    this.bias = new Float32Array(actionCount);
  }

  _ensureInit(stateDim) {
    if (this.weights) return;
    this.stateDim = stateDim;
    // Small random init, not zero — zero-init linear models can get stuck
    this.weights = new Float32Array(this.actionCount * stateDim);
    for (let i = 0; i < this.weights.length; i++) {
      this.weights[i] = (Math.random() - 0.5) * 0.01;
    }
  }

  predict(state) {
    this._ensureInit(state.length);
    const q = new Float32Array(this.actionCount);
    for (let a = 0; a < this.actionCount; a++) {
      let sum = this.bias[a];
      const base = a * this.stateDim;
      for (let i = 0; i < this.stateDim; i++) {
        sum += this.weights[base + i] * state[i];
      }
      q[a] = sum;
    }
    return q;
  }

  /**
   * Single TD-error gradient step for one (state, action, target) sample.
   * For a linear model, d Q(s,a) / d w_a[i] = s[i], so this is plain SGD.
   */
  update(state, action, target, lr) {
    this._ensureInit(state.length);
    const base = action * this.stateDim;
    let predicted = this.bias[action];
    for (let i = 0; i < this.stateDim; i++) {
      predicted += this.weights[base + i] * state[i];
    }
    
    // Gradient clipping: clamp target error to prevent exploding weight updates
    let error = target - predicted;
    if (isNaN(error)) error = 0;
    error = Math.max(-15.0, Math.min(15.0, error));
    
    for (let i = 0; i < this.stateDim; i++) {
      this.weights[base + i] += lr * error * state[i];
      // Weight clipping to maintain long-term numerical bounds
      this.weights[base + i] = Math.max(-2.5, Math.min(2.5, this.weights[base + i]));
    }
    
    this.bias[action] += lr * error;
    this.bias[action] = Math.max(-15.0, Math.min(15.0, this.bias[action]));
  }

  loadWeights({ weights, bias }) {
    if (weights) {
      const expectedStateDim = 10;
      const expectedActionCount = 4;
      if (this.actionCount !== expectedActionCount) {
        throw new Error(`[QApproximator] Validation failed: expected actionCount=${expectedActionCount}, got ${this.actionCount}`);
      }
      const inferredStateDim = weights.length / this.actionCount;
      if (inferredStateDim !== expectedStateDim) {
        throw new Error(`[QApproximator] Validation failed: expected stateDim=${expectedStateDim} (for ${weights.length} weights and ${this.actionCount} actions), got ${inferredStateDim}`);
      }
      this.stateDim = inferredStateDim;
      this.weights = new Float32Array(weights);
    }
    if (bias) {
      this.bias = new Float32Array(bias);
    }
  }
}
