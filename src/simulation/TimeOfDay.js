/**
 * TimeOfDay — Smooth, natural day/night cycle with manual control and spawn curves
 */

// Spawn rate multipliers by hour (0-23)
const SPAWN_CURVE = [
  0.4, 0.3,  0.3,  0.3,  0.4,  0.6,   // 00-05: night baseline
  0.8, 1.2,  1.5,  1.1,  0.9,  1.0,   // 06-11: morning peak
  1.1, 1.0,  0.9,  0.9,  1.1,  1.6,   // 12-17: evening peak
  1.4, 1.1,  0.8,  0.6,  0.5,  0.4,   // 18-23: night
];

// Sky gradient colors by time bracket
const SKY_COLORS = [
  { hour: 0,  color: [8, 10, 14] },     // deep night
  { hour: 5,  color: [15, 18, 30] },     // pre-dawn
  { hour: 6,  color: [40, 30, 25] },     // dawn
  { hour: 7,  color: [60, 45, 30] },     // sunrise
  { hour: 9,  color: [14, 18, 24] },     // morning
  { hour: 12, color: [16, 20, 28] },     // midday
  { hour: 17, color: [35, 28, 22] },     // golden hour
  { hour: 18, color: [45, 25, 20] },     // sunset
  { hour: 19, color: [20, 15, 25] },     // dusk
  { hour: 21, color: [10, 12, 16] },     // night
];

export class TimeOfDay {
  constructor(startHour = 8) {
    this.hour = startHour; // 0-24 float
    this.speed = 1; // simulation speed multiplier
    // Calibrated natural progression rate: ~0.15 sim minutes per second (1 sim hour takes ~6.6 min at 1x)
    this.simMinutesPerSecond = 0.15;
    this.locked = false;
    this.lockedHour = null;
  }

  get isNight() { return this.hour < 6 || this.hour > 19; }
  get isDusk() { return this.hour >= 17.5 && this.hour <= 19.5; }
  get isDawn() { return this.hour >= 5.5 && this.hour <= 7.5; }
  get isLocked() { return this.locked; }

  get spawnMultiplier() {
    const h = Math.floor(this.hour) % 24;
    const frac = this.hour % 1;
    const cur = SPAWN_CURVE[h];
    const next = SPAWN_CURVE[(h + 1) % 24];
    return cur + (next - cur) * frac;
  }

  get normalized() { return this.hour / 24; }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
    if (this.locked) {
      this.lockedHour = this.hour;
    }
  }

  lock(h = null) {
    this.locked = true;
    this.lockedHour = (h !== null) ? (((h % 24) + 24) % 24) : this.hour;
    this.hour = this.lockedHour;
  }

  unlock() {
    this.locked = false;
    this.lockedHour = null;
  }

  toggleLock() {
    if (this.locked) this.unlock();
    else this.lock();
  }

  update(dt) {
    if (this.locked) {
      this.hour = this.lockedHour;
      return;
    }
    // Time advances smoothly and monotonically forward
    this.hour += (this.simMinutesPerSecond / 60) * dt * this.speed;
    if (this.hour >= 24) this.hour -= 24;
  }

  getSkyColor() {
    const h = this.hour;
    let lo = SKY_COLORS[SKY_COLORS.length - 1];
    let hi = SKY_COLORS[0];
    for (let i = 0; i < SKY_COLORS.length - 1; i++) {
      if (h >= SKY_COLORS[i].hour && h < SKY_COLORS[i + 1].hour) {
        lo = SKY_COLORS[i];
        hi = SKY_COLORS[i + 1];
        break;
      }
    }
    const range = hi.hour > lo.hour ? hi.hour - lo.hour : (24 - lo.hour + hi.hour);
    const t = range > 0 ? ((h - lo.hour + 24) % 24) / range : 0;
    const r = Math.floor(lo.color[0] + (hi.color[0] - lo.color[0]) * t);
    const g = Math.floor(lo.color[1] + (hi.color[1] - lo.color[1]) * t);
    const b = Math.floor(lo.color[2] + (hi.color[2] - lo.color[2]) * t);
    return `rgb(${r},${g},${b})`;
  }

  getAmbientLight() {
    if (this.hour >= 7 && this.hour <= 17) return 1;
    if (this.hour >= 19 || this.hour <= 5) return 0.15;
    if (this.hour > 17 && this.hour < 19) return 1 - ((this.hour - 17) / 2) * 0.85;
    if (this.hour > 5 && this.hour < 7) return 0.15 + ((this.hour - 5) / 2) * 0.85;
    return 0.5;
  }
}
