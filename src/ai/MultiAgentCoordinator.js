import { RLAgent } from './RLAgent.js';
import { CANVAS_SCALE } from '../constants.js';

/**
 * MultiAgentCoordinator — Global coordinator for all intersection AI agents
 * Handles arterial green wave coordination, platoon progression, and dynamic arbitration
 */
export class MultiAgentCoordinator {
  constructor() {
    this.rlAgent = new RLAgent();
    this.observeInterval = 2.0; // observe every 2 sim seconds
    this.trainInterval = 1.0;   // train every 1 sim seconds
    this.waveInterval = 0.5;    // scan arterial corridor platoons at 2Hz
    this.observeTimer = 0;
    this.trainTimer = 0;
    this.waveTimer = 0;
    this.lastObservations = new Map();
  }

  update(dt, engine) {
    this.observeTimer += dt;
    this.trainTimer += dt;
    this.waveTimer += dt;

    // 1. Arterial Green Wave Platoon Tracking across corridors
    if (this.waveTimer >= this.waveInterval && engine && engine.vehicles && engine.graph) {
      this.waveTimer = 0;
      this._updateGreenWaves(engine);
    }

    // 2. Shadow observation (optimized: only run for active or visible intersections)
    if (this.observeTimer >= this.observeInterval) {
      this.observeTimer = 0;
      const bounds = engine.renderer ? engine.renderer.getViewportBounds(100) : null;
      
      for (const [id, int] of engine.intersections) {
        if (!int.isSignalized || !int.trafficLight) continue;
        const inViewport = bounds
          ? (int.x > bounds.minX && int.x < bounds.maxX && int.y > bounds.minY && int.y < bounds.maxY)
          : true;
          
        if (int.getTotalQueue() > 0 || inViewport) {
          const obs = this.rlAgent.observe(id, engine);
          if (obs) this.lastObservations.set(id, obs);
        }
      }
    }

    // 3. Training
    if (this.trainTimer >= this.trainInterval) {
      this.trainTimer = 0;
      this.rlAgent.train();
    }
  }

  /**
   * Tracks moving vehicle platoons along incoming road links to signalized junctions.
   * Enables downstream traffic lights to detect arriving green wave surges and clear corridors in advance.
   */
  _updateGreenWaves(engine) {
    // Reset platoon status
    for (const [, int] of engine.intersections) {
      if (!int.isSignalized) continue;
      int.platoonApproaching = false;
      int.platoonCount = 0;
      int.platoonEta = 0;
      int.platoonPhaseIndex = 0;
      int.platoonEdgeName = '';
    }

    // Aggregate moving vehicles by incoming edge
    const edgeVehicles = new Map(); // edgeId -> array of { progress, speed }
    const scale = CANVAS_SCALE || 1;

    for (let i = 0; i < engine.vehicles.length; i++) {
      const v = engine.vehicles[i];
      if (!v.alive || !v.currentEdgeId || v.speed < 2.5 * scale) continue;
      // Vehicle is moving along edge and approaching downstream mouth
      if (v.segmentProgress >= 0.25) {
        let arr = edgeVehicles.get(v.currentEdgeId);
        if (!arr) {
          arr = [];
          edgeVehicles.set(v.currentEdgeId, arr);
        }
        arr.push(v);
      }
    }

    for (const [edgeId, vList] of edgeVehicles) {
      if (vList.length < 3) continue; // Platoon threshold: >= 3 cohesive moving vehicles
      const edge = engine.graph.edges.get(edgeId);
      if (!edge) continue;

      const targetInt = engine.intersections.get(edge.to);
      if (!targetInt || !targetInt.isSignalized || !targetInt.trafficLight) continue;

      const avgProgress = vList.reduce((s, v) => s + v.segmentProgress, 0) / vList.length;
      const avgSpeed = vList.reduce((s, v) => s + v.speed, 0) / vList.length;
      const lengthM = edge.lengthMeters || (edge.length * 1.13);
      const remainingDistM = Math.max(0, (1 - avgProgress) * lengthM);
      const speedMps = Math.max(3.0, (avgSpeed / scale));
      const etaSeconds = remainingDistM / speedMps;

      // Green wave arrival window: 1.5s to 8.5s ahead
      if (etaSeconds >= 1.2 && etaSeconds <= 8.5) {
        let phaseIdx = 0;
        if (targetInt.edgeToApproach) {
          const app = targetInt.edgeToApproach.get(edgeId);
          if (app) phaseIdx = app.phaseIndex;
        } else {
          // 2-phase fallback
          const isNS = (edge.cardinalDir === 'N' || edge.cardinalDir === 'S');
          phaseIdx = isNS ? 0 : 1;
        }

        // Only register if higher count or closer ETA
        if (!targetInt.platoonApproaching || vList.length > targetInt.platoonCount) {
          targetInt.platoonApproaching = true;
          targetInt.platoonCount = vList.length;
          targetInt.platoonEta = etaSeconds;
          targetInt.platoonPhaseIndex = phaseIdx;
          targetInt.platoonEdgeName = edge.name || edge.roadTier || 'Arterial';
        }
      }
    }
  }

  getObservation(intersectionId) {
    return this.lastObservations.get(intersectionId) || null;
  }

  get stats() {
    return this.rlAgent.stats;
  }
}
