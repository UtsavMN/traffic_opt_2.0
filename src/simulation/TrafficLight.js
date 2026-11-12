export const PHASES = ['NS_GREEN', 'NS_YELLOW', 'EW_GREEN', 'EW_YELLOW'];
export const SIGNAL_COLORS = { GREEN: '#00E87A', YELLOW: '#FFB400', RED: '#FF3B5C' };

export class TrafficLight {
  constructor(greenDuration = 20, yellowDuration = 3) {
    this.phase = 0; // index into PHASES (0: NS_GREEN, 1: NS_YELLOW, 2: EW_GREEN, 3: EW_YELLOW)
    this.timer = 0;
    this.greenDuration = greenDuration;
    this.yellowDuration = yellowDuration;
    
    // Direct 4-phase vehicular durations (no all-red pedestrian delay)
    this.phaseDurations = [
      this.greenDuration,   // 0: NS_GREEN
      this.yellowDuration,  // 1: NS_YELLOW (stopping clearance before EW turns green)
      this.greenDuration,   // 2: EW_GREEN
      this.yellowDuration,  // 3: EW_YELLOW (stopping clearance before NS turns green)
    ];
    
    this.emergencyOverrideDir = null; // 'NS' or 'EW' or null
    this.emergencyTimer = 0;

    // Starvation tracking durations (seconds of red per direction)
    this.redDurationNS = 0;
    this.redDurationEW = 0;
  }

  get currentPhase() { return PHASES[this.phase]; }
  get timeInPhase() { return this.timer; }
  get phaseDuration() { return this.phaseDurations[this.phase]; }
  get phaseProgress() { return Math.min(1, this.timer / this.phaseDuration); }
  get remaining() { return Math.ceil(Math.max(0, this.phaseDuration - this.timer)); }

  update(dt) {
    if (this.emergencyOverrideDir) {
      this.emergencyTimer -= dt;
      if (this.emergencyTimer <= 0) {
        this.emergencyOverrideDir = null;
        this.emergencyTimer = 0;
      }
      return; // Freeze normal progression during emergency corridor priority
    }
    
    // Timer advances monotonically forward
    this.timer += dt;

    // Red duration tracking for starvation avoidance
    if (this.phase === 0 || this.phase === 1) {
      // NS is active (green or yellow); EW is red
      this.redDurationNS = 0;
      this.redDurationEW += dt;
    } else {
      // EW is active (green or yellow); NS is red
      this.redDurationEW = 0;
      this.redDurationNS += dt;
    }

    if (this.timer >= this.phaseDuration) {
      this.advancePhase();
    }
  }

  advancePhase() {
    this.phase = (this.phase + 1) % 4;
    this.timer = 0;
  }

  forcePhase(phaseIndex) {
    if (phaseIndex >= 0 && phaseIndex < 4 && phaseIndex !== this.phase) {
      this.phase = phaseIndex;
      this.timer = 0;
    }
  }

  forceGreen(dir) {
    if (dir === 'N' || dir === 'S') this.forcePhase(0); // NS_GREEN
    else this.forcePhase(2); // EW_GREEN
  }

  extendPhase(seconds) {
    // Actuated green hold — maintains green smoothly without rolling back the clock
    // Timer is left intact to ensure monotonic forward progression
  }

  setGreenDuration(d) {
    const clamped = Math.max(10, Math.min(25, d));
    this.greenDuration = clamped;
    this.phaseDurations[0] = clamped;
    this.phaseDurations[2] = clamped;
  }

  canPassNS() {
    if (this.emergencyOverrideDir === 'EW') return false;
    if (this.emergencyOverrideDir === 'NS') return true;
    return this.phase === 0 || this.phase === 1; // NS_GREEN or NS_YELLOW
  }

  canPassEW() {
    if (this.emergencyOverrideDir === 'NS') return false;
    if (this.emergencyOverrideDir === 'EW') return true;
    return this.phase === 2 || this.phase === 3; // EW_GREEN or EW_YELLOW
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
    return 'RED'; // Phase 2 (EW_GREEN) & Phase 3 (EW_YELLOW)
  }

  getColorEW() {
    if (this.emergencyOverrideDir === 'EW') return 'GREEN';
    if (this.emergencyOverrideDir === 'NS') return 'RED';
    if (this.phase === 2) return 'GREEN';
    if (this.phase === 3) return 'YELLOW';
    return 'RED'; // Phase 0 (NS_GREEN) & Phase 1 (NS_YELLOW)
  }
}
