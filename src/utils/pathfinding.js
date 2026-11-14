import { MinHeap } from './MinHeap.js';

/**
 * A* Pathfinding on CityGraph using MinHeap with stochastic congestion avoidance.
 * Prevents corridor memorization / path overfitting by factoring in live vehicular
 * load and realistic human driver route variation.
 */
export function findPath(graph, startId, endId, blockedEdges = new Set(), jammedEdges = new Set(), randomize = true) {
  if (!graph.nodes.has(startId) || !graph.nodes.has(endId)) return null;
  const open = new MinHeap();
  const gScore = new Map([[startId, 0]]);
  const cameFrom = new Map();
  const h = (id) => {
    const a = graph.nodes.get(id), b = graph.nodes.get(endId);
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  };
  open.push({ id: startId, f: h(startId) });
  
  while (open.size > 0) {
    const { id: cur } = open.pop();
    if (cur === endId) {
      const path = [];
      let c = cur;
      while (c) { path.unshift(c); c = cameFrom.get(c); }
      return path;
    }
    
    for (const nid of graph.getNeighbors(cur)) {
      const edgeKey = `${cur}->${nid}`;
      if (blockedEdges && blockedEdges.has(edgeKey)) continue;
      
      const edge = graph.getEdge(cur, nid);
      if (!edge) continue;
      
      // Dynamic rerouting:
      // 1. Scaled cost for severe gridlock/jammed edges
      const jamFactor = (jammedEdges && jammedEdges.has(edgeKey)) ? 12.0 : 1.0;
      // 2. Live load avoidance: vehicles dynamically distribute across parallel streets
      const liveVehicles = edge.vehicleCount || 0;
      const congestionFactor = 1.0 + Math.min(2.5, liveVehicles * 0.18);
      // 3. Human driver route variance (prevents rigid deterministic locking)
      const driverJitter = randomize ? (0.88 + Math.random() * 0.24) : 1.0;
      
      const weight = jamFactor * congestionFactor * driverJitter;
      const g = (gScore.get(cur) || 0) + edge.length * weight;
      if (g < (gScore.get(nid) ?? Infinity)) {
        cameFrom.set(nid, cur);
        gScore.set(nid, g);
        open.push({ id: nid, f: g + h(nid) });
      }
    }
  }
  return null;
}
