/**
 * Statistics utilities — rolling averages, percentiles
 */
export class RollingAverage {
  constructor(windowSize = 100) {
    this.window = windowSize;
    this.values = [];
    this.sum = 0;
  }
  push(v) {
    this.values.push(v);
    this.sum += v;
    if (this.values.length > this.window) {
      this.sum -= this.values.shift();
    }
  }
  get avg() { return this.values.length > 0 ? this.sum / this.values.length : 0; }
  get last() { return this.values.length > 0 ? this.values[this.values.length - 1] : 0; }
  get count() { return this.values.length; }
}

export class EMA {
  constructor(alpha = 0.1) { this.alpha = alpha; this.value = 0; this.init = false; }
  push(v) {
    if (!this.init) { this.value = v; this.init = true; }
    else { this.value = this.alpha * v + (1 - this.alpha) * this.value; }
  }
  get() { return this.value; }
}

export function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export function lerpValue(a, b, t) { return a + (b - a) * t; }

export function formatTime(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ampm}`;
}
