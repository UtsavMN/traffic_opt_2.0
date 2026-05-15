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
  }

  update(dt) {
    if (this.policeActive) {
      if (this.queues[this.policeDirection] === 0) {
        this.policeActive = false; // Queue cleared
      } else {
        this.trafficLight.forceGreen(this.policeDirection);
      }
    }
    
    this.trafficLight.update(dt);
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
