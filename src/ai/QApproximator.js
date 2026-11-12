/**
 * QApproximator — Neural Network Q-Value Inference Engine
 * Sanchar v2.0: Supports Deep Multi-Layer Perceptrons (MLP with ReLU)
 * and backwards-compatible linear approximations.
 */
export class QApproximator {
  constructor(actionCount = 2) {
    this.actionCount = actionCount;
    this.stateDim = null;
    this.mlpLayers = null; // Array of { in_features, out_features, weights, bias }
    this.weights = null;    // Linear fallback weights
    this.bias = new Float32Array(actionCount);
  }

  _ensureInit(stateDim) {
    if (this.weights) return;
    this.stateDim = this.stateDim || stateDim;
    this.weights = new Float32Array(this.actionCount * this.stateDim);
    for (let i = 0; i < this.weights.length; i++) {
      this.weights[i] = (Math.random() - 0.5) * 0.01;
    }
    if (!this.bias) {
      this.bias = new Float32Array(this.actionCount);
    }
  }

  predict(state) {
    if (!state || !state.length) {
      return new Float32Array(this.actionCount);
    }

    // 1. High-Performance Deep MLP Forward Pass (ReLU activations)
    if (this.mlpLayers && this.mlpLayers.length > 0) {
      let current = state;
      for (let l = 0; l < this.mlpLayers.length; l++) {
        const layer = this.mlpLayers[l];
        const next = new Float32Array(layer.out_features);
        const isOutput = (l === this.mlpLayers.length - 1);

        for (let o = 0; o < layer.out_features; o++) {
          let sum = layer.bias[o];
          const wRow = layer.weights[o];
          for (let i = 0; i < layer.in_features; i++) {
            sum += wRow[i] * current[i];
          }
          // Hidden layers use ReLU; output layer uses linear activation
          next[o] = isOutput ? sum : (sum > 0 ? sum : 0);
        }
        current = next;
      }
      return current;
    }

    // 2. Linear Model Fallback
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

  update(state, action, target, lr) {
    if (!state || !state.length) return;
    this._ensureInit(state.length);
    if (!this.weights || !this.bias) return;
    if (action < 0 || action >= this.actionCount) return;

    const base = action * this.stateDim;
    let predicted = this.bias[action];
    for (let i = 0; i < this.stateDim; i++) {
      predicted += this.weights[base + i] * state[i];
    }
    
    let error = target - predicted;
    if (isNaN(error)) error = 0;
    error = Math.max(-15.0, Math.min(15.0, error));
    
    for (let i = 0; i < this.stateDim; i++) {
      this.weights[base + i] += lr * error * state[i];
      this.weights[base + i] = Math.max(-2.5, Math.min(2.5, this.weights[base + i]));
    }
    
    this.bias[action] += lr * error;
    this.bias[action] = Math.max(-15.0, Math.min(15.0, this.bias[action]));
  }

  loadWeights(payload) {
    if (!payload) return;

    this.stateDim = payload.stateDim || 10;
    this.actionCount = payload.actionCount || 2;

    // Check for Deep MLP structure
    if (payload.layers && Array.isArray(payload.layers) && payload.layers.length > 0) {
      this.mlpLayers = payload.layers.map(layer => ({
        in_features: layer.in_features,
        out_features: layer.out_features,
        weights: layer.weights, // 2D array [out_features][in_features]
        bias: new Float32Array(layer.bias),
      }));
    }

    // Always ensure linear weights and bias are initialized Float32Arrays
    if (payload.weights && Array.isArray(payload.weights)) {
      this.weights = new Float32Array(payload.weights);
    } else if (!this.weights) {
      this.weights = new Float32Array(this.actionCount * this.stateDim);
    }

    if (payload.bias && Array.isArray(payload.bias)) {
      this.bias = new Float32Array(payload.bias);
    } else if (!this.bias) {
      this.bias = new Float32Array(this.actionCount);
    }
  }
}
