import { TrafficLight } from './TrafficLight.js';

/**
 * Intersection — A node in the city graph with traffic signal control
 */
export class Intersection {
  constructor(id, x, y, zone = 'residential') {
    this.id = id;
    this.x = x;
    this.y = y;
    this.zone = zone;
    this.trafficLight = new TrafficLight();

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
    // Callback for green phase tracking (set externally to decouple from React)
    this.onGreenPhaseEnd = null;
  }

  update(dt) {
    if (this.policeActive) {
      this.policeOverrideTimer += dt;
      if (this.policeOverrideTimer >= 60) {
        // Max timer exceeded — force deactivate to prevent cross-traffic starvation
        this.policeActive = false;
        this.policeOverrideTimer = 0;
      } else if (this.policeDirection && (
        (this.policeDirection === 'N' && this.getQueueNS() === 0) ||
        (this.policeDirection === 'E' && this.getQueueEW() === 0)
      )) {
        this.policeActive = false; // Corridor queues cleared
        this.policeOverrideTimer = 0;
      } else {
        this.trafficLight.forceGreen(this.policeDirection);
      }
    }
    
    const prevPhase = this.trafficLight.currentPhase;
    this.trafficLight.update(dt);
    
    // Green Efficiency Tracking (only for active intersections)
    if (prevPhase !== this.trafficLight.currentPhase && this.getTotalQueue() > 0) {
      if (prevPhase === 'NS_GREEN') {
        const hadVehicles = this.getQueueNS() > 0 || this.vehiclesPassedThisGreenPhase > 0;
        if (this.onGreenPhaseEnd) this.onGreenPhaseEnd(hadVehicles);
        this.vehiclesPassedThisGreenPhase = 0;
      } else if (prevPhase === 'EW_GREEN') {
        const hadVehicles = this.getQueueEW() > 0 || this.vehiclesPassedThisGreenPhase > 0;
        if (this.onGreenPhaseEnd) this.onGreenPhaseEnd(hadVehicles);
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
      phase: this.trafficLight.currentPhase,
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
