/**
 * StateEncoder — Encodes intersection observation for RL agent
 * V7: Graph-Structure-Invariant & Pressure-based Normalization
 */
export class StateEncoder {
  encode(intersection, engine) {
    const int = intersection;
    if (!int || !int.isSignalized || !int.trafficLight) {
      return new Float32Array(10);
    }
    const tl = int.trafficLight;
    if (!tl) return new Float32Array(10);
    const maxQ = 20;

    // Use estimated queues from the sensor-realism layer!
    const sensorRealism = engine ? engine.sensorRealism : null;
    const est = sensorRealism ? sensorRealism.getEstimatedQueues(int.id) : (int.queues || { N: 0, S: 0, E: 0, W: 0 });

    // Calculate downstream queue estimates (for pressure calculation)
    const neighbors = (engine && engine.graph) ? engine.graph.getNeighbors(int.id) : [];
    let downstreamTotal = 0;
    let downstreamLanes = 0;
    for (const nId of neighbors) {
      const nEst = sensorRealism ? sensorRealism.getEstimatedQueues(nId) : engine?.intersections?.get(nId)?.queues;
      if (nEst) {
        downstreamTotal += ((nEst.N || 0) + (nEst.S || 0) + (nEst.E || 0) + (nEst.W || 0));
        const nInt = engine?.intersections ? engine.intersections.get(nId) : null;
        downstreamLanes += nInt ? Math.max(2, (nInt.maxLanes || 2) * 2) : 4;
      }
    }
    const avgDownstream = downstreamLanes > 0 ? (downstreamTotal / downstreamLanes) : 0; // Avg downstream per lane

    // Compute local pressure per direction
    const pN = Math.max(0, (est?.N || 0) - avgDownstream);
    const pS = Math.max(0, (est?.S || 0) - avgDownstream);
    const pE = Math.max(0, (est?.E || 0) - avgDownstream);
    const pW = Math.max(0, (est?.W || 0) - avgDownstream);

    // M-Phase Invariant Local State Representation
    let activePressure = 0;
    let opposingPressure = 0;

    if (int.approaches && int.approaches.length > 0) {
      const currentP = tl.currentPhaseIndex || 0;
      const phaseQueues = new Array(tl.numPhases || 2).fill(0);
      for (const app of int.approaches) {
        phaseQueues[app.phaseIndex] = (phaseQueues[app.phaseIndex] || 0) + (app.queue || 0);
      }
      const activeQueue = phaseQueues[currentP] || 0;
      let maxOpposingQueue = 0;
      for (let p = 0; p < (tl.numPhases || 2); p++) {
        if (p === currentP) continue;
        if (phaseQueues[p] > maxOpposingQueue) maxOpposingQueue = phaseQueues[p];
      }
      activePressure = Math.max(0, activeQueue - avgDownstream);
      opposingPressure = Math.max(0, maxOpposingQueue - avgDownstream);
    } else {
      const currentIsNS = tl.currentPhase ? tl.currentPhase.includes('NS') : true;
      activePressure = currentIsNS ? (pN + pS) : (pE + pW);
      opposingPressure = currentIsNS ? (pE + pW) : (pN + pS);
    }
    
    const normActive = Math.min(1, activePressure / (maxQ * 2));
    const normOpposing = Math.min(1, opposingPressure / (maxQ * 2));

    // Time in phase normalized
    const tip = tl.phaseProgress || 0;

    // GNN-style Message Passing (1-hop permutation invariant neighbor aggregation)
    let sumNeighborActive = 0;
    let sumNeighborOpposing = 0;
    let signalizedNeighborCount = 0;
    
    for (const nId of neighbors) {
      const ni = engine?.intersections ? engine.intersections.get(nId) : null;
      if (!ni || !ni.isSignalized || !ni.trafficLight) continue;
      signalizedNeighborCount++;
      const nEst = sensorRealism ? sensorRealism.getEstimatedQueues(nId) : ni.queues;
      const nIsNS = (ni.trafficLight && ni.trafficLight.currentPhase) ? ni.trafficLight.currentPhase.includes('NS') : true;
      
      const nQNS = Math.max(0, (nEst?.N || 0) + (nEst?.S || 0) - avgDownstream);
      const nQEW = Math.max(0, (nEst?.E || 0) + (nEst?.W || 0) - avgDownstream);
      
      // Neighbor's active/opposing queues relative to THEIR current phase
      const nActive = nIsNS ? nQNS : nQEW;
      const nOpposing = nIsNS ? nQEW : nQNS;
      
      sumNeighborActive += Math.min(1, nActive / (maxQ * 2));
      sumNeighborOpposing += Math.min(1, nOpposing / (maxQ * 2));
    }

    const avgNeighborActive = signalizedNeighborCount > 0 ? sumNeighborActive / signalizedNeighborCount : 0;
    const avgNeighborOpposing = signalizedNeighborCount > 0 ? sumNeighborOpposing / signalizedNeighborCount : 0;

    // Platoon Green Wave coordination indicator (1.0 = arriving on active green, 0.5 = arriving on competing phase)
    const platoonWave = (int.platoonApproaching && int.platoonPhaseIndex === tl.currentPhaseIndex)
      ? 1.0
      : (int.platoonApproaching ? 0.5 : 0.0);

    const emergency = int.emergencyApproaching ? 1.0 : 0.0;
    const weatherFactor = engine?.weather ? (1 - (engine.weather.speedMult || 1)) : 0;
    const tod = engine?.timeOfDay ? (engine.timeOfDay.normalized || 0) : 0.5;

    // Multi-phase starvation check: any competing phase waiting > 22 seconds
    let starvationFlag = 0;
    if (tl.redDurations && tl.redDurations.length > 0) {
      for (let p = 0; p < (tl.numPhases || 2); p++) {
        if (p !== tl.currentPhaseIndex && (tl.redDurations[p] || 0) > 22) {
          starvationFlag = 1.0;
          break;
        }
      }
    } else {
      starvationFlag = ((tl.redDurationNS || 0) > 22 || (tl.redDurationEW || 0) > 22) ? 1.0 : 0.0;
    }

    return new Float32Array([
      normActive,
      normOpposing,
      tip,
      avgNeighborActive,
      avgNeighborOpposing,
      platoonWave,
      emergency,
      weatherFactor,
      tod,
      starvationFlag
    ]);
  }

  get inputSize() { return 10; } // Graph-invariant 10-dimensional state
}
