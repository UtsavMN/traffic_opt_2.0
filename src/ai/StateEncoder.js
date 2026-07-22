/**
 * StateEncoder — Encodes intersection observation for RL agent
 * V7: Graph-Structure-Invariant & Pressure-based Normalization
 */
export class StateEncoder {
  encode(intersection, engine) {
    const int = intersection;
    const tl = int.trafficLight;
    const maxQ = 20;

    // Use estimated queues from the sensor-realism layer!
    const sensorRealism = engine.sensorRealism;
    const est = sensorRealism ? sensorRealism.getEstimatedQueues(int.id) : int.queues;

    // Calculate downstream queue estimates (for pressure calculation)
    const neighbors = engine.graph.getNeighbors(int.id);
    let downstreamTotal = 0;
    let downstreamCount = 0;
    for (const nId of neighbors) {
      const nEst = sensorRealism ? sensorRealism.getEstimatedQueues(nId) : engine.intersections.get(nId)?.queues;
      if (nEst) {
        downstreamTotal += (nEst.N + nEst.S + nEst.E + nEst.W);
        downstreamCount++;
      }
    }
    const avgDownstream = downstreamCount > 0 ? (downstreamTotal / downstreamCount) / 4 : 0; // Avg downstream per lane

    // Compute local pressure per direction
    const pN = Math.max(0, est.N - avgDownstream);
    const pS = Math.max(0, est.S - avgDownstream);
    const pE = Math.max(0, est.E - avgDownstream);
    const pW = Math.max(0, est.W - avgDownstream);

    // Phase-invariant local state representation
    const currentIsNS = tl.currentPhase.includes('NS');
    const activePressure = currentIsNS ? (pN + pS) : (pE + pW);
    const opposingPressure = currentIsNS ? (pE + pW) : (pN + pS);
    
    const normActive = Math.min(1, activePressure / (maxQ * 2));
    const normOpposing = Math.min(1, opposingPressure / (maxQ * 2));

    // Time in phase normalized
    const tip = tl.phaseProgress;

    // GNN-style Message Passing (1-hop permutation invariant neighbor aggregation)
    let sumNeighborActive = 0;
    let sumNeighborOpposing = 0;
    
    for (const nId of neighbors) {
      const ni = engine.intersections.get(nId);
      if (!ni) continue;
      const nEst = sensorRealism ? sensorRealism.getEstimatedQueues(nId) : ni.queues;
      const nIsNS = ni.trafficLight.currentPhase.includes('NS');
      
      const nQNS = Math.max(0, nEst.N + nEst.S - avgDownstream);
      const nQEW = Math.max(0, nEst.E + nEst.W - avgDownstream);
      
      // Neighbor's active/opposing queues relative to THEIR current phase
      const nActive = nIsNS ? nQNS : nQEW;
      const nOpposing = nIsNS ? nQEW : nQNS;
      
      sumNeighborActive += Math.min(1, nActive / (maxQ * 2));
      sumNeighborOpposing += Math.min(1, nOpposing / (maxQ * 2));
    }

    const avgNeighborActive = downstreamCount > 0 ? sumNeighborActive / downstreamCount : 0;
    const avgNeighborOpposing = downstreamCount > 0 ? sumNeighborOpposing / downstreamCount : 0;

    // Context features
    const pedWaiting = Math.min(1, int.pedestriansWaiting / 10);
    const emergency = int.emergencyApproaching ? 1 : 0;
    const weatherFactor = 1 - engine.weather.speedMult;
    const tod = engine.timeOfDay.normalized;
    const starvationFlag = (int.maxWait || 0) > 30 ? 1 : 0;

    return new Float32Array([
      normActive,
      normOpposing,
      tip,
      avgNeighborActive,
      avgNeighborOpposing,
      pedWaiting,
      emergency,
      weatherFactor,
      tod,
      starvationFlag
    ]);
  }

  get inputSize() { return 10; } // Graph-invariant 10-dimensional state
}
