import { MinHeap } from './MinHeap.js';

/**
 * Road Hierarchy Weighting:
 * Primary and arterial avenues (Tannery Road, Arabic College Main Road, Coles Road)
 * have highest speed limits, multi-lane capacity, and lowest impedance.
 * Local residential alleys and gullies have high impedance to strongly penalize
 * rat-running through quiet neighborhoods.
 */
const ROAD_TIER_WEIGHTS = {
  primary: 0.50,       // 50-60 km/h: Major arterial corridors
  trunk: 0.50,
  secondary: 0.70,     // 40 km/h: Major commercial/transit spines
  tertiary: 0.90,      // 30 km/h: Collector connectors
  residential: 2.30,   // 20 km/h: Local residential cross streets
  service: 3.80,       // 15 km/h: Narrow alleys / service lanes
  unclassified: 1.80,
};

/**
 * A* Pathfinding on CityGraph with realistic road hierarchy, corridor prioritization,
 * and controlled congestion avoidance.
 */
export function findPath(graph, startId, endId, blockedEdges = new Set(), jammedEdges = new Set(), randomize = true) {
  if (!graph.nodes.has(startId) || !graph.nodes.has(endId)) return null;
  const open = new MinHeap();
  const gScore = new Map([[startId, 0]]);
  const cameFrom = new Map();
  const closed = new Set();

  // Admissible heuristic scaled by the minimum road tier weight (0.50)
  const h = (id) => {
    const a = graph.nodes.get(id), b = graph.nodes.get(endId);
    if (!a || !b) return 0;
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) * 0.50;
  };
  open.push({ id: startId, f: h(startId) });
  
  let steps = 0;
  const maxSteps = 3000;
  while (open.size > 0 && steps++ < maxSteps) {
    const { id: cur } = open.pop();
    if (cur === endId) {
      const path = [];
      let c = cur;
      while (c) { path.unshift(c); c = cameFrom.get(c); }
      return path;
    }
    
    if (closed.has(cur)) continue;
    closed.add(cur);
    
    for (const nid of graph.getNeighbors(cur)) {
      if (closed.has(nid)) continue;
      const edgeKey = `${cur}->${nid}`;
      if (blockedEdges && blockedEdges.has(edgeKey)) continue;
      
      const edge = graph.getEdge(cur, nid);
      if (!edge) continue;
      
      // 1. Road hierarchy impedance (primary arterials preferred 4.6x over residential alleys)
      const tierWeight = ROAD_TIER_WEIGHTS[edge.type] || ROAD_TIER_WEIGHTS[edge.roadTier] || 1.8;

      // 2. Scaled cost for severe gridlock/jammed edges
      const jamFactor = (jammedEdges && jammedEdges.has(edgeKey)) ? 8.0 : 1.0;

      // 3. Live load avoidance: gentle scaling prevents sudden mass detour into residential alleys
      const liveVehicles = edge.vehicleCount || 0;
      const congestionFactor = 1.0 + Math.min(1.4, liveVehicles * 0.04);

      // 4. Subtle human route variation (prevents rigid single-line locking without chaotic zigzags)
      const driverJitter = randomize ? (0.96 + Math.random() * 0.08) : 1.0;
      
      const weight = tierWeight * jamFactor * congestionFactor * driverJitter;
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
