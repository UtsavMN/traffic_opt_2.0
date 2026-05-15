/**
 * TrafficLight — 4-phase signal state machine
 * Phases: NS_GREEN → NS_YELLOW → EW_GREEN → EW_YELLOW → (repeat)
 */
export const PHASES = ['NS_GREEN', 'NS_YELLOW', 'EW_GREEN', 'EW_YELLOW'];
export const SIGNAL_COLORS = { GREEN: '#00E87A', YELLOW: '#FFB400', RED: '#FF3B5C' };

export class TrafficLight {
  constructor(greenDuration = 20, yellowDuration = 3) {
    this.phase = 0; // index into PHASES
    this.timer = 0;
    this.greenDuration = greenDuration;
    this.yellowDuration = yellowDuration;
    this.phaseDurations = [greenDuration, yellowDuration, greenDuration, yellowDuration];
    this.lastSwitchTime = 0;
    this.emergencyOverride = false;
    this.pedestrianPhase = false;
  }

  get currentPhase() { return PHASES[this.phase]; }

  get timeInPhase() { return this.timer; }

  get phaseDuration() { return this.phaseDurations[this.phase]; }

  get phaseProgress() { return Math.min(1, this.timer / this.phaseDuration); }

  get remaining() { return Math.max(0, this.phaseDuration - this.timer); }

  update(dt) {
    if (this.emergencyOverride) return;
    this.timer += dt;
    if (this.timer >= this.phaseDuration) {
      this.advancePhase();
    }
  }

  advancePhase() {
    this.phase = (this.phase + 1) % 4;
    this.timer = 0;
    this.lastSwitchTime = performance.now();
  }

  forcePhase(phaseIndex) {
    if (phaseIndex >= 0 && phaseIndex < 4 && phaseIndex !== this.phase) {
      this.phase = phaseIndex;
      this.timer = 0;
      this.lastSwitchTime = performance.now();
    }
  }

  forceGreen(dir) {
    if (dir === 'N' || dir === 'S') {
      this.forcePhase(0); // NS_GREEN
    } else {
      this.forcePhase(2); // EW_GREEN
    }
  }

  setGreenDuration(d) {
    this.greenDuration = d;
    this.phaseDurations[0] = d;
    this.phaseDurations[2] = d;
  }

  canPassNS() {
    if (this.emergencyOverride) return false;
    return this.phase === 0 || this.phase === 1; // NS_GREEN or NS_YELLOW
  }

  canPassEW() {
    if (this.emergencyOverride) return false;
    return this.phase === 2 || this.phase === 3; // EW_GREEN or EW_YELLOW
  }

  canPass(direction) {
    // direction: 'N','S','E','W'
    if (direction === 'N' || direction === 'S') return this.canPassNS();
    return this.canPassEW();
  }

  getColorNS() {
    if (this.emergencyOverride) return 'RED';
    if (this.phase === 0) return 'GREEN';
    if (this.phase === 1) return 'YELLOW';
    return 'RED';
  }

  getColorEW() {
    if (this.emergencyOverride) return 'RED';
    if (this.phase === 2) return 'GREEN';
    if (this.phase === 3) return 'YELLOW';
    return 'RED';
  }
}
