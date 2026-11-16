export const SIGNAL_COLORS = { GREEN: '#00E87A', YELLOW: '#FFB400', RED: '#FF3B5C' };

/**
 * TrafficLight — Dynamic M-Phase Traffic Signal Controller
 * Supports 2-way, 3-way, 4-way, 5-way, 6-way, and roundabout circle junctions.
 * Strictly guarantees conflict-free phasing: at any time, exactly ONE phase corridor
 * receives Green (or clearance Yellow). All conflicting movements are strictly RED.
 */
export class TrafficLight {
  constructor(greenDuration = 18, yellowDuration = 3, numPhases = 2) {
    this.numPhases = Math.max(2, numPhases);
    this.phase = 0; // sub-phase index: 0 .. (2 * numPhases - 1)
    this.timer = 0;
    this.greenDuration = greenDuration;
    this.yellowDuration = yellowDuration;
    
    // Per-subphase durations (even = Green, odd = Yellow clearance)
    this.phaseDurations = [];
    this._rebuildDurations();

    this.emergencyOverridePhase = null; // number or null
    this.emergencyOverrideDir = null;   // 'NS' or 'EW' (legacy compatibility)
    this.emergencyTimer = 0;

    // Starvation tracking durations (seconds of red per phase)
    this.redDurations = new Array(this.numPhases).fill(0);
    this.redDurationNS = 0;
    this.redDurationEW = 0;
  }

  setNumPhases(n) {
    const validN = Math.max(2, n);
    if (this.numPhases !== validN) {
      this.numPhases = validN;
      this.phase = 0;
      this.timer = 0;
      this._rebuildDurations();
      this.redDurations = new Array(this.numPhases).fill(0);
    }
  }

  _rebuildDurations() {
    this.phaseDurations = [];
    for (let p = 0; p < this.numPhases; p++) {
      this.phaseDurations.push(this.greenDuration);  // even: Green
      this.phaseDurations.push(this.yellowDuration); // odd: Yellow clearance
    }
  }

  get currentPhaseIndex() {
    return Math.floor(this.phase / 2);
  }

  get isYellow() {
    return this.phase % 2 === 1;
  }

  get currentPhase() {
    if (this.numPhases === 2) {
      const names = ['NS_GREEN', 'NS_YELLOW', 'EW_GREEN', 'EW_YELLOW'];
      return names[this.phase] || 'NS_GREEN';
    }
    const p = this.currentPhaseIndex;
    return this.isYellow ? `PHASE_${p}_YELLOW` : `PHASE_${p}_GREEN`;
  }

  get timeInPhase() { return this.timer; }
  get phaseDuration() { return this.phaseDurations[this.phase] || this.greenDuration; }
  get phaseProgress() { return Math.min(1, this.timer / this.phaseDuration); }
  get remaining() { return Math.ceil(Math.max(0, this.phaseDuration - this.timer)); }

  update(dt) {
    if (this.emergencyTimer > 0) {
      this.emergencyTimer -= dt;
      if (this.emergencyTimer <= 0) {
        this.emergencyOverridePhase = null;
        this.emergencyOverrideDir = null;
        this.emergencyTimer = 0;
      }
      return; // Freeze normal progression during emergency corridor priority
    }

    this.timer += dt;

    // Track red durations per phase for starvation avoidance
    const activeP = this.currentPhaseIndex;
    for (let p = 0; p < this.numPhases; p++) {
      if (p === activeP) {
        this.redDurations[p] = 0;
      } else {
        this.redDurations[p] = (this.redDurations[p] || 0) + dt;
      }
    }
    this.redDurationNS = this.redDurations[0] || 0;
    this.redDurationEW = this.redDurations[1] || 0;

    if (this.timer >= this.phaseDuration) {
      this.advancePhase();
    }
  }

  advancePhase() {
    const totalSubPhases = this.numPhases * 2;
    this.phase = (this.phase + 1) % totalSubPhases;
    this.timer = 0;
  }

  triggerYellow() {
    // If currently green (even sub-phase), switch immediately to yellow clearance
    if (!this.isYellow) {
      this.phase = this.phase + 1;
      this.timer = 0;
    }
  }

  forcePhase(targetSubPhase) {
    const totalSubPhases = this.numPhases * 2;
    // Backward compatibility: If caller passed 1 or 3 (or any odd number) to initiate yellow transition
    if (targetSubPhase % 2 === 1) {
      this.triggerYellow();
    } else {
      const validSubPhase = ((targetSubPhase % totalSubPhases) + totalSubPhases) % totalSubPhases;
      if (this.phase !== validSubPhase) {
        this.phase = validSubPhase;
        this.timer = 0;
      }
    }
  }

  forceGreenPhase(phaseIdx) {
    const targetSubPhase = (phaseIdx * 2) % (this.numPhases * 2);
    if (this.phase !== targetSubPhase) {
      this.phase = targetSubPhase;
      this.timer = 0;
    }
  }

  forceGreen(dir) {
    if (dir === 'N' || dir === 'S') this.forceGreenPhase(0);
    else this.forceGreenPhase(1);
  }

  extendPhase(seconds) {
    // Actuated green hold — maintains green smoothly without rolling back the clock
  }

  setGreenDuration(d) {
    const clamped = Math.max(10, Math.min(25, d));
    this.greenDuration = clamped;
    this._rebuildDurations();
  }

  getColorForPhase(phaseIndex) {
    // Emergency priority takes absolute precedence
    if (this.emergencyOverridePhase !== null) {
      return this.emergencyOverridePhase === phaseIndex ? 'GREEN' : 'RED';
    }
    if (this.emergencyOverrideDir === 'NS') {
      return phaseIndex === 0 ? 'GREEN' : 'RED';
    }
    if (this.emergencyOverrideDir === 'EW') {
      return phaseIndex === 1 ? 'GREEN' : 'RED';
    }

    if (this.currentPhaseIndex === phaseIndex) {
      return this.isYellow ? 'YELLOW' : 'GREEN';
    }
    return 'RED';
  }

  canPassPhase(phaseIndex) {
    if (this.emergencyOverridePhase !== null) {
      return this.emergencyOverridePhase === phaseIndex;
    }
    if (this.emergencyOverrideDir === 'NS') return phaseIndex === 0;
    if (this.emergencyOverrideDir === 'EW') return phaseIndex === 1;
    return this.currentPhaseIndex === phaseIndex;
  }

  canPassNS() { return this.canPassPhase(0); }
  canPassEW() { return this.canPassPhase(1); }

  canPass(direction) {
    if (direction === 'N' || direction === 'S') return this.canPassNS();
    return this.canPassEW();
  }

  getColorNS() { return this.getColorForPhase(0); }
  getColorEW() { return this.getColorForPhase(1); }
}
