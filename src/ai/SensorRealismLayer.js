import { CANVAS_SCALE } from '../constants.js';

export class SensorRealismLayer {
  constructor() {
    // Stores history of estimated queues: intersectionId -> { N, S, E, W }
    this.estimates = new Map();
    // Stores sensor diagnostics: intersectionId -> { confidence, activeSensors, rawCounts }
    this.diagnostics = new Map();
  }

  /**
   * Evaluates the physical sensors at an intersection and returns fused estimates.
   * Runs at a throttled 5Hz inside Engine.js.
   */
  updateEstimates(engine) {
    const isNight = engine.timeOfDay.isNight;
    const weather = engine.weather.current || 'clear'; // 'clear', 'rain', 'fog'

    // Compute dynamic sensor confidences based on environment
    const confidences = this._getSensorConfidences(isNight, weather);

    for (const [id, int] of engine.intersections) {
      if (!this.estimates.has(id)) {
        this.estimates.set(id, { N: 0, S: 0, E: 0, W: 0 });
      }
      if (!this.diagnostics.has(id)) {
        this.diagnostics.set(id, { confidence: 1.0, activeSensors: ['visual', 'infrared', 'radar'] });
      }

      // 1. Gather all vehicles approaching this intersection
      const approachingVehicles = this._getApproachingVehicles(int, engine.vehicles);

      // 2. Perform occlusion and detection checks per direction
      const rawDetections = this._runDetections(int, approachingVehicles, confidences);

      // 3. Smooth raw sensor counts using EMA (Exponential Moving Average) filter
      const prevEst = this.estimates.get(id);
      const alpha = Math.max(0.05, Math.min(0.3, confidences.fusedConfidence)); // Trust factor matches confidence

      const newEst = {
        N: (1 - alpha) * prevEst.N + alpha * rawDetections.N,
        S: (1 - alpha) * prevEst.S + alpha * rawDetections.S,
        E: (1 - alpha) * prevEst.E + alpha * rawDetections.E,
        W: (1 - alpha) * prevEst.W + alpha * rawDetections.W,
      };

      this.estimates.set(id, newEst);
      this.diagnostics.set(id, {
        confidence: confidences.fusedConfidence,
        activeSensors: confidences.active,
        rawCounts: rawDetections
      });
    }
  }

  /**
   * Retrieves estimated queue length for an intersection.
   */
  getEstimatedQueues(intersectionId) {
    return this.estimates.get(intersectionId) || { N: 0, S: 0, E: 0, W: 0 };
  }

  /**
   * Retrieves sensor health diagnostics for the dashboard or agent.
   */
  getDiagnostics(intersectionId) {
    return this.diagnostics.get(intersectionId) || { confidence: 1.0, activeSensors: [] };
  }

  _getSensorConfidences(isNight, weather) {
    let visual = 0.98;
    let infrared = 0.80;
    let radar = 0.90;
    const active = ['visual', 'infrared', 'radar'];

    // Visual camera degraded heavily at night & rain
    if (isNight) {
      visual *= 0.35; // Headlight glare / poor contrast
    }
    if (weather === 'rain') {
      visual *= 0.45; // Water droplets / splash
      infrared *= 0.85; // Steam / heat attenuation
    } else if (weather === 'fog') {
      visual *= 0.25; // Blocked sight
      infrared *= 0.70;
    }

    // Radar is weather-resilient, but has slightly lower baseline accuracy
    const fusedConfidence = Math.max(visual, infrared, radar);

    return { visual, infrared, radar, fusedConfidence, active };
  }

  _getApproachingVehicles(intersection, vehicles) {
    const list = [];
    const maxApproachDist = 120 * CANVAS_SCALE; // Detect up to 120m away

    for (const v of vehicles) {
      if (!v.alive) continue;
      if (v.routeIndex + 1 >= v.route.length) continue;
      
      const nextNodeId = v.route[v.routeIndex + 1];
      if (nextNodeId === intersection.id) {
        const dx = intersection.x - v.pos.x;
        const dy = intersection.y - v.pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= maxApproachDist) {
          const dir = v._getDirection ? v._getDirection() : null;
          if (dir) {
            list.push({ vehicle: v, dist, dir });
          }
        }
      }
    }
    return list;
  }

  _runDetections(intersection, approaching, confidences) {
    const detections = { N: 0, S: 0, E: 0, W: 0 };

    // Group approaching vehicles by direction to calculate directional occlusions
    const dirs = { N: [], S: [], E: [], W: [] };
    for (const item of approaching) {
      dirs[item.dir].push(item);
    }

    // Process each direction separately
    for (const dir of ['N', 'S', 'E', 'W']) {
      const queue = dirs[dir];
      // Sort closest first (closest to camera intersection node)
      queue.sort((a, b) => a.dist - b.dist);

      let occlusionShadow = 0; // Cumulative occlusion shadow
      
      for (const item of queue) {
        const v = item.vehicle;
        const dist = item.dist;

        // Base detection probability for this specific vehicle
        let detectionProb = 1.0;

        // Apply line-of-sight occlusion: large vehicles block small ones behind them
        if (occlusionShadow > 0) {
          // Probability of being blocked increases with cumulative shadow
          detectionProb *= Math.max(0.15, 1 - (occlusionShadow / 100));
        }

        // Accrue occlusion shadow for the vehicles behind it
        const pcu = { car: 1.0, bus: 3.0, truck: 2.5, motorcycle: 0.4, emergency: 1.2, rickshaw: 0.8 }[v.type] || 1.0;
        occlusionShadow += pcu * 15; // Buses project larger shadows

        // Run sensor checks
        const visCheck = Math.random() < (confidences.visual * detectionProb);
        const irCheck = Math.random() < (confidences.infrared * detectionProb);
        
        // Radar has limited range (max 45m) but resists weather
        const radarMaxRange = 45 * CANVAS_SCALE;
        const radarCheck = (dist <= radarMaxRange) && (Math.random() < confidences.radar * detectionProb);

        // Fused check: if detected by any of the active sensor channels
        if (visCheck || irCheck || radarCheck) {
          // Only count if it's stationary or moving slowly (simulating stopped queue sensors)
          if (v.speed <= 15) {
            detections[dir]++;
          }
        }
      }
    }

    return detections;
  }
}
