import { TrafficLight } from './TrafficLight.js';

/**
 * Intersection — A node in the city graph with traffic signal control
 */
export class Intersection {
  constructor(id, x, y, zone = 'residential', layer = 0, isSignalized = true, lng = null, lat = null) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.lng = lng;
    this.lat = lat;
    this.zone = zone;
    this.layer = layer || 0;
    this.isSignalized = isSignalized;
    this.trafficLight = isSignalized ? new TrafficLight() : null;

    // Queue counts per direction
    this.queues = { N: 0, S: 0, E: 0, W: 0 };
    // Pedestrian counts waiting
    this.pedestriansWaiting = 0;
    // Emergency approaching
    this.emergencyApproaching = false;
    // AI decision overlay animation
    this.aiPulseTimer = 0;
    this.aiPulseActive = false;
    this.lastAIAction = null;
    // Phase history
    this.phaseHistory = [];
    // Traffic police
    this.policeActive = false;
    this.policeDirection = null;
    this.policeOverrideTimer = 0;
    this.policeInitialTransitionTriggered = false;
    // Callback for green phase tracking (set externally to decouple from React)
    this.onGreenPhaseEnd = null;
    this.lastObservedPhase = this.trafficLight ? this.trafficLight.currentPhase : 'FREE_FLOW';
    
    // Accumulators for AI throughput tracking
    this.vehiclesPassedAccumulatedController = 0;
    this.vehiclesPassedAccumulatedRL = 0;
    this.vehiclesPassedThisGreenPhase = 0;
  }

  getColorNS() {
    return this.trafficLight ? this.trafficLight.getColorNS() : 'GREEN';
  }

  getColorEW() {
    return this.trafficLight ? this.trafficLight.getColorEW() : 'GREEN';
  }

  update(dt) {
    if (!this.isSignalized || !this.trafficLight) return;

    if (this.policeActive) {
      this.policeOverrideTimer += dt;
      // Traffic police dynamically manages and alternates corridors (max 15s per phase)
      // Guarantees that neither corridor is ever locked on eternal red!
      if (this.policeOverrideTimer >= 15) {
        this.policeOverrideTimer = 0;
        const nsQ = this.getQueueNS();
        const ewQ = this.getQueueEW();
        const nextDir = nsQ >= ewQ ? 'N' : 'E';
        if (nextDir !== this.policeDirection) {
          this.policeDirection = nextDir;
          const currentIsNS = this.trafficLight?.currentPhase ? this.trafficLight.currentPhase.includes('NS') : true;
          if ((nextDir === 'N' && !currentIsNS) || (nextDir === 'E' && currentIsNS)) {
            this.trafficLight.forcePhase(currentIsNS ? 1 : 3); // Brisk yellow transition
          }
        }
      } else if (!this.policeInitialTransitionTriggered && this.policeDirection) {
        // Initial dispatch priority
        this.policeInitialTransitionTriggered = true;
        const currentIsNS = this.trafficLight?.currentPhase ? this.trafficLight.currentPhase.includes('NS') : true;
        if ((this.policeDirection === 'N' && !currentIsNS) || (this.policeDirection === 'E' && currentIsNS)) {
          this.trafficLight.forcePhase(currentIsNS ? 1 : 3);
        }
      }

      // Automatically step down once queues normalize
      if (this.getTotalQueue() === 0 && this.policeOverrideTimer > 5) {
        this.policeActive = false;
        this.policeOverrideTimer = 0;
        this.policeInitialTransitionTriggered = false;
      }
    }

    this.trafficLight.update(dt);
    
    // Green Efficiency Tracking (triggered on every completed green phase with traffic demand)
    const currentPhase = this.trafficLight?.currentPhase || 'FREE_FLOW';
    if (this.lastObservedPhase !== currentPhase) {
      const prevPhase = this.lastObservedPhase;
      this.lastObservedPhase = currentPhase;
      if (prevPhase === 'NS_GREEN' || prevPhase === 'EW_GREEN') {
        const queueNS = this.getQueueNS();
        const queueEW = this.getQueueEW();
        const passed = this.vehiclesPassedThisGreenPhase || 0;
        const totalTrafficDemand = queueNS + queueEW + passed;
        
        // Only record phases where traffic demand was present at the junction
        if (totalTrafficDemand > 0) {
          const activeQueue = prevPhase === 'NS_GREEN' ? queueNS : queueEW;
          const hadVehicles = activeQueue > 0 || passed > 0;
          if (this.onGreenPhaseEnd) this.onGreenPhaseEnd(hadVehicles);
        }
        this.vehiclesPassedThisGreenPhase = 0;
      }
    }

    // Decay AI pulse
    if (this.aiPulseActive) {
      this.aiPulseTimer -= dt;
      if (this.aiPulseTimer <= 0) {
        this.aiPulseActive = false;
        this.aiPulseTimer = 0;
      }
    }
  }

  triggerAIPulse(action) {
    this.aiPulseActive = true;
    this.aiPulseTimer = 1.1; // 300ms in + 800ms out
    this.lastAIAction = action;
    this.phaseHistory.push({
      phase: this.trafficLight ? this.trafficLight.currentPhase : 'FREE_FLOW',
      action,
      time: Date.now()
    });
    if (this.phaseHistory.length > 5) this.phaseHistory.shift();
  }

  getTotalQueue() {
    return this.queues.N + this.queues.S + this.queues.E + this.queues.W;
  }

  getQueueNS() { return this.queues.N + this.queues.S; }
  getQueueEW() { return this.queues.E + this.queues.W; }
}
