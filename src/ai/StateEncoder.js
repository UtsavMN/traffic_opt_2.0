/**
 * StateEncoder — Encodes intersection observation for RL agent (~20 dims)
 */
export class StateEncoder {
  encode(intersection, engine) {
    const int = intersection;
    const tl = int.trafficLight;
    const maxQ = 15;

    // Queue counts normalized
    const qN = Math.min(1, int.queues.N / maxQ);
    const qS = Math.min(1, int.queues.S / maxQ);
    const qE = Math.min(1, int.queues.E / maxQ);
    const qW = Math.min(1, int.queues.W / maxQ);

    // Current phase one-hot
    const phase = [0, 0, 0, 0];
    phase[tl.phase] = 1;

    // Time in phase normalized
    const tip = tl.phaseProgress;

    // Neighbor pressure
    const neighbors = engine.graph.getNeighbors(int.id);
    let pN = 0, pS = 0, pE = 0, pW = 0;
    for (const nId of neighbors) {
      const ni = engine.intersections.get(nId);
      if (!ni) continue;
      const nn = engine.graph.nodes.get(nId);
      if (!nn) continue;
      const dx = nn.x - int.x, dy = nn.y - int.y;
      const pressure = ni.getTotalQueue() / (maxQ * 4);
      if (Math.abs(dy) > Math.abs(dx)) {
        if (dy < 0) pN = pressure; else pS = pressure;
      } else {
        if (dx > 0) pE = pressure; else pW = pressure;
      }
    }

    // Context
    const pedWaiting = Math.min(1, int.pedestriansWaiting / 10);
    const emergency = int.emergencyApproaching ? 1 : 0;
    const weatherFactor = 1 - engine.weather.speedMult;
    const tod = engine.timeOfDay.normalized;

    // V2 Dimensions
    const maxWait = Math.min(1, (int.maxWait || 0) / 120);
    const starvationFlag = (int.maxWait || 0) > 30 ? 1 : 0;
    
    // Determine emergency direction
    let eDirN = 0, eDirS = 0, eDirEW = 0;
    if (int.emergencyApproaching) {
      if (int.emergencyDir === 'N') eDirN = 1;
      else if (int.emergencyDir === 'S') eDirS = 1;
      else if (int.emergencyDir === 'E' || int.emergencyDir === 'W') eDirEW = 1;
    }

    return new Float32Array([
      qN, qS, qE, qW,
      ...phase,
      tip,
      pN, pS, pE, pW,
      pedWaiting, emergency, weatherFactor, tod,
      maxWait, starvationFlag, eDirN, eDirS, eDirEW
    ]);
  }

  get inputSize() { return 22; }
}
