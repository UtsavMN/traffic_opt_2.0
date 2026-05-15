/**
 * A* Pathfinding on CityGraph
 */
export function findPath(graph, startId, endId, blockedEdges = new Set()) {
  if (startId === endId) return [startId];
  
  const openSet = new Set([startId]);
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();
  
  gScore.set(startId, 0);
  const startNode = graph.nodes.get(startId);
  const endNode = graph.nodes.get(endId);
  if (!startNode || !endNode) return null;
  
  fScore.set(startId, heuristic(startNode, endNode));

  while (openSet.size > 0) {
    let current = null;
    let bestF = Infinity;
    for (const id of openSet) {
      const f = fScore.get(id) ?? Infinity;
      if (f < bestF) { bestF = f; current = id; }
    }
    
    if (current === endId) return reconstructPath(cameFrom, current);
    
    openSet.delete(current);
    const neighbors = graph.getNeighbors(current);
    
    for (const neighborId of neighbors) {
      const edgeKey = `${current}->${neighborId}`;
      if (blockedEdges.has(edgeKey)) continue;
      
      const edge = graph.getEdge(current, neighborId);
      if (!edge) continue;
      
      const cost = edge.length / (edge.speedLimit || 60);
      const tentG = (gScore.get(current) ?? Infinity) + cost;
      
      if (tentG < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, current);
        gScore.set(neighborId, tentG);
        const neighborNode = graph.nodes.get(neighborId);
        fScore.set(neighborId, tentG + heuristic(neighborNode, endNode));
        openSet.add(neighborId);
      }
    }
  }
  return null; // no path found
}

function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstructPath(cameFrom, current) {
  const path = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current);
    path.unshift(current);
  }
  return path;
}
