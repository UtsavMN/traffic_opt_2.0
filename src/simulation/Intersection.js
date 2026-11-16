import { TrafficLight } from './TrafficLight.js';

/**
 * Intersection — A node in the city graph with dynamic conflict-free traffic signal control
 * Supports 2-way, 3-way, 4-way, 5-way, 6-way, and roundabout circle junctions.
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

    // Road-aligned approach legs and conflict-free phase mapping
    this.approaches = []; // Array of Approach objects
    this.edgeToApproach = new Map(); // edgeId -> Approach
    this.numPhases = 2;

    // Queue counts per direction (maintained for backward compatibility)
    this.queues = { N: 0, S: 0, E: 0, W: 0 };
    // Pedestrian counts waiting
    this.pedestriansWaiting = 0;
    // Emergency approaching
    this.emergencyApproaching = false;
    this.emergencyPhase = 0;
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
    // Callback for green phase tracking (decoupled from React)
    this.onGreenPhaseEnd = null;
    this.lastObservedPhase = this.trafficLight ? this.trafficLight.currentPhase : 'FREE_FLOW';
    
    // Accumulators for throughput tracking
    this.vehiclesPassedAccumulatedController = 0;
    this.vehiclesPassedAccumulatedRL = 0;
    this.vehiclesPassedThisGreenPhase = 0;
  }

  /**
   * Initializes road-aligned incoming approaches and computes conflict-free phases.
   * Opposing through-movements are paired into the same phase group.
   * Perpendicular roads, diagonal legs, 5th-circle branches, and roundabouts get dedicated conflict-free phases.
   */
  initApproaches(graph) {
    if (!graph || !graph.edges) return;
    this.approaches = [];
    this.edgeToApproach = new Map();

    const incomingEdges = [];
    for (const [, edge] of graph.edges) {
      if (edge.to === this.id) {
        incomingEdges.push(edge);
      }
    }

    if (incomingEdges.length === 0) {
      this.numPhases = 2;
      return;
    }

    const rawApproaches = [];
    for (let idx = 0; idx < incomingEdges.length; idx++) {
      const edge = incomingEdges[idx];
      let pEnd, pPrev;
      if (edge.geometry && edge.geometry.length >= 2) {
        pEnd = edge.geometry[edge.geometry.length - 1];
        pPrev = edge.geometry[edge.geometry.length - 2];
      } else {
        pEnd = { x: this.x, y: this.y };
        const fromNode = graph.nodes.get(edge.from);
        pPrev = fromNode ? { x: fromNode.x, y: fromNode.y } : { x: this.x - 1, y: this.y };
      }

      // Vector pointing from intersection mouth outwards back along the incoming road
      const dx = pPrev.x - pEnd.x;
      const dy = pPrev.y - pEnd.y;
      const canvasAngle = Math.atan2(dy, dx); // [-PI, PI]

      // Geographic coordinates for real map projection
      const toNode = graph.nodes.get(this.id);
      const fromNode = graph.nodes.get(edge.from);
      let endLng = toNode?.lng ?? this.lng;
      let endLat = toNode?.lat ?? this.lat;
      let prevLng = null;
      let prevLat = null;

      if (edge.geoCoords && edge.geoCoords.length >= 2) {
        const lastCoord = edge.geoCoords[edge.geoCoords.length - 1];
        endLng = lastCoord[0];
        endLat = lastCoord[1];
        // Trace back along the incoming road to find a distinct upstream waypoint
        for (let k = edge.geoCoords.length - 2; k >= 0; k--) {
          const pt = edge.geoCoords[k];
          const dLng = pt[0] - endLng;
          const dLat = pt[1] - endLat;
          if (Math.hypot(dLng, dLat) > 0.00002 || k === 0) {
            prevLng = pt[0];
            prevLat = pt[1];
            break;
          }
        }
      } else if (edge.coordinates && edge.coordinates.length >= 2) {
        const lastCoord = edge.coordinates[edge.coordinates.length - 1];
        const secondLast = edge.coordinates[edge.coordinates.length - 2];
        endLng = lastCoord[0];
        endLat = lastCoord[1];
        prevLng = secondLast[0];
        prevLat = secondLast[1];
      }

      if ((!prevLng || !prevLat) && fromNode && fromNode.lng && fromNode.lat) {
        prevLng = fromNode.lng;
        prevLat = fromNode.lat;
      }

      if (!prevLng || !prevLat) {
        prevLng = endLng + Math.cos(canvasAngle) * 0.0002;
        prevLat = endLat - Math.sin(canvasAngle) * 0.0002;
      }

      // Compass angle in geographic coordinates (East = 0, North = PI/2)
      const dLngGeo = (prevLng - endLng) * Math.cos(((endLat || 13.0) * Math.PI) / 180);
      const dLatGeo = prevLat - endLat;
      const angle = (Math.abs(dLngGeo) > 1e-9 || Math.abs(dLatGeo) > 1e-9)
        ? Math.atan2(dLatGeo, dLngGeo)
        : canvasAngle;

      const roadName = edge.name || edge.streetName || '';

      rawApproaches.push({
        id: `${this.id}_app_${idx}`,
        edgeId: edge.id,
        edge,
        fromNodeId: edge.from,
        roadName,
        angle,
        lanes: edge.lanes || 1,
        queue: 0,
        mouthX: pEnd.x,
        mouthY: pEnd.y,
        prevX: pPrev.x,
        prevY: pPrev.y,
        mouthLng: endLng,
        mouthLat: endLat,
        prevLng,
        prevLat,
        phaseIndex: 0
      });
    }

    // Sort by angle for consistent, stable spatial layout around the ring
    rawApproaches.sort((a, b) => a.angle - b.angle);

    // Conflict-free phase pairing:
    // Pair opposing approaches within angular tolerance (~35-55 deg of 180 deg)
    const assigned = new Array(rawApproaches.length).fill(-1);
    let nextPhase = 0;

    for (let i = 0; i < rawApproaches.length; i++) {
      if (assigned[i] !== -1) continue;

      let bestPartner = -1;
      let minDiffFromPi = Infinity;

      for (let j = i + 1; j < rawApproaches.length; j++) {
        if (assigned[j] !== -1) continue;

        let diff = Math.abs(rawApproaches[i].angle - rawApproaches[j].angle);
        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);

        const diffFromPi = Math.abs(diff - Math.PI);
        const sameRoad = rawApproaches[i].roadName && rawApproaches[j].roadName && (rawApproaches[i].roadName === rawApproaches[j].roadName);
        const maxTol = sameRoad ? 0.96 : 0.62; // ~55 deg if named same road, ~35 deg otherwise

        if (diffFromPi < maxTol && diffFromPi < minDiffFromPi) {
          minDiffFromPi = diffFromPi;
          bestPartner = j;
        }
      }

      assigned[i] = nextPhase;
      rawApproaches[i].phaseIndex = nextPhase;

      if (bestPartner !== -1) {
        assigned[bestPartner] = nextPhase;
        rawApproaches[bestPartner].phaseIndex = nextPhase;
      }
      nextPhase++;
    }

    this.numPhases = Math.max(2, nextPhase);
    this.approaches = rawApproaches;
    for (const app of this.approaches) {
      this.edgeToApproach.set(app.edgeId, app);
    }

    if (this.trafficLight) {
      this.trafficLight.setNumPhases(this.numPhases);
    }
  }

  getLightColorForEdge(edgeId) {
    if (!this.isSignalized || !this.trafficLight) return 'GREEN';
    const app = this.edgeToApproach.get(edgeId);
    if (!app) return 'GREEN';
    return this.trafficLight.getColorForPhase(app.phaseIndex);
  }

  canEdgePass(edgeId) {
    if (!this.isSignalized || !this.trafficLight) return true;
    const app = this.edgeToApproach.get(edgeId);
    if (!app) return true;
    return this.trafficLight.canPassPhase(app.phaseIndex);
  }

  getPhaseQueue(phaseIdx) {
    if (!this.approaches || this.approaches.length === 0) {
      if (phaseIdx === 0) return this.queues.N + this.queues.S;
      if (phaseIdx === 1) return this.queues.E + this.queues.W;
      return 0;
    }
    let total = 0;
    for (const app of this.approaches) {
      if (app.phaseIndex === phaseIdx) {
        total += app.queue;
      }
    }
    return total;
  }

  getActiveQueue() {
    if (!this.trafficLight) return 0;
    return this.getPhaseQueue(this.trafficLight.currentPhaseIndex);
  }

  getOpposingQueue() {
    if (!this.trafficLight) return 0;
    const activeP = this.trafficLight.currentPhaseIndex;
    let sum = 0;
    for (let p = 0; p < this.numPhases; p++) {
      if (p !== activeP) sum += this.getPhaseQueue(p);
    }
    return sum;
  }

  getColorNS() {
    return this.trafficLight ? this.trafficLight.getColorNS() : 'GREEN';
  }

  getColorEW() {
    return this.trafficLight ? this.trafficLight.getColorEW() : 'GREEN';
  }

  getTotalQueue() {
    if (this.approaches && this.approaches.length > 0) {
      let q = 0;
      for (const app of this.approaches) q += app.queue;
      return q;
    }
    return this.queues.N + this.queues.S + this.queues.E + this.queues.W;
  }

  getQueueNS() { return this.getPhaseQueue(0); }
  getQueueEW() { return this.getPhaseQueue(1); }

  update(dt) {
    if (!this.isSignalized || !this.trafficLight) return;

    if (this.policeActive) {
      this.policeOverrideTimer += dt;
      // Traffic police dynamically manages and alternates corridors (max 15s per phase)
      if (this.policeOverrideTimer >= 15) {
        this.policeOverrideTimer = 0;
        this.trafficLight.triggerYellow();
      } else if (!this.policeInitialTransitionTriggered && this.policeDirection) {
        this.policeInitialTransitionTriggered = true;
        this.trafficLight.triggerYellow();
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
      if (prevPhase.includes('GREEN')) {
        const passed = this.vehiclesPassedThisGreenPhase || 0;
        const totalTrafficDemand = this.getTotalQueue() + passed;
        
        // Only record phases where traffic demand was present at the junction
        if (totalTrafficDemand > 0) {
          const hadVehicles = this.getActiveQueue() > 0 || passed > 0;
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
}
