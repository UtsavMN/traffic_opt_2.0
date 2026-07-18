/**
 * TrafficLight — 4-phase signal state machine
 * Phases: NS_GREEN → NS_YELLOW → EW_GREEN → EW_YELLOW → (repeat)
 */
export const PHASES = ['NS_GREEN', 'NS_YELLOW', 'ALL_RED_NS', 'EW_GREEN', 'EW_YELLOW', 'ALL_RED_EW'];
export const SIGNAL_COLORS = { GREEN: '#00E87A', YELLOW: '#FFB400', RED: '#FF3B5C' };

export class TrafficLight {
  constructor(greenDuration = 20, yellowDuration = 3, redDuration = 2) {
    this.phase = 0; // index into PHASES
    this.timer = 0;
    this.greenDuration = greenDuration;
    this.yellowDuration = yellowDuration;
    this.redDuration = redDuration;
    this.phaseDurations = [greenDuration, yellowDuration, redDuration, greenDuration, yellowDuration, redDuration];
    this.lastSwitchTime = 0;
    this.emergencyOverrideDir = null; // 'NS', 'EW', or null
    this.emergencyTimer = 0;
  }

  get currentPhase() { return PHASES[this.phase]; }
  get timeInPhase() { return this.timer; }
  get phaseDuration() { return this.phaseDurations[this.phase]; }
  get phaseProgress() { return Math.min(1, this.timer / this.phaseDuration); }
  
  // Bug 10 fix: Display in whole seconds
  get remaining() { return Math.ceil(Math.max(0, this.phaseDuration - this.timer)); }

  update(dt) {
    if (this.emergencyOverrideDir) {
      this.emergencyTimer -= dt;
      if (this.emergencyTimer <= 0) {
        this.emergencyOverrideDir = null;
        this.emergencyTimer = 0;
      }
      return;
    }
    this.timer += dt;
    if (this.timer >= this.phaseDuration) {
      this.advancePhase();
    }
  }

  advancePhase() {
    this.phase = (this.phase + 1) % 6;
    this.timer = 0;
    this.lastSwitchTime = performance.now();
  }

  forcePhase(phaseIndex) {
    if (phaseIndex >= 0 && phaseIndex < 6 && phaseIndex !== this.phase) {
      this.phase = phaseIndex;
      this.timer = 0;
      this.lastSwitchTime = performance.now();
    }
  }

  forceGreen(dir) {
    if (dir === 'N' || dir === 'S') this.forcePhase(0);
    else this.forcePhase(3);
  }

  setGreenDuration(d) {
    this.greenDuration = d;
    this.phaseDurations[0] = d;
    this.phaseDurations[3] = d;
  }

  canPassNS() {
    if (this.emergencyOverrideDir === 'EW') return false;
    if (this.emergencyOverrideDir === 'NS') return true;
    return this.phase === 0 || this.phase === 1; // NS_GREEN or NS_YELLOW
  }

  canPassEW() {
    if (this.emergencyOverrideDir === 'NS') return false;
    if (this.emergencyOverrideDir === 'EW') return true;
    return this.phase === 3 || this.phase === 4; // EW_GREEN or EW_YELLOW
  }

  canPass(direction) {
    if (direction === 'N' || direction === 'S') return this.canPassNS();
    return this.canPassEW();
  }

  getColorNS() {
    if (this.emergencyOverrideDir === 'NS') return 'GREEN';
    if (this.emergencyOverrideDir === 'EW') return 'RED';
    if (this.phase === 0) return 'GREEN';
    if (this.phase === 1) return 'YELLOW';
    return 'RED'; // covers ALL_RED and EW phases
  }

  getColorEW() {
    if (this.emergencyOverrideDir === 'EW') return 'GREEN';
    if (this.emergencyOverrideDir === 'NS') return 'RED';
    if (this.phase === 3) return 'GREEN';
    if (this.phase === 4) return 'YELLOW';
    return 'RED'; // covers ALL_RED and NS phases
  }
}
