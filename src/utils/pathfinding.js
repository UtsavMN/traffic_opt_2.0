import { MinHeap } from './MinHeap.js';

/**
 * A* Pathfinding on CityGraph using MinHeap
 */
export function findPath(graph, startId, endId, blockedEdges = new Set()) {
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
      
      const g = (gScore.get(cur) || 0) + edge.length;
      if (g < (gScore.get(nid) ?? Infinity)) {
        cameFrom.set(nid, cur);
        gScore.set(nid, g);
        open.push({ id: nid, f: g + h(nid) });
      }
    }
  }
  return null;
}
