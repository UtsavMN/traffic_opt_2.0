import { CityGraph } from '../simulation/CityGraph.js';
import { findPath } from '../utils/pathfinding.js';

let graph = null;

self.onmessage = ({ data }) => {
  if (data.type === 'INIT') { 
    const raw = data.graph;
    graph = new CityGraph();
    graph.nodes = new Map(raw.nodes);
    graph.edges = new Map(raw.edges);
    graph.adjacency = new Map(raw.adjacency.map(([k, v]) => [k, new Set(v)]));
    return; 
  }
  
  if (data.type === 'FIND_PATH') {
    const blockedSet = new Set(data.blocked || []);
    const jammedSet = new Set(data.jammed || []);
    const route = findPath(graph, data.startId, data.endId, blockedSet, jammedSet);
    self.postMessage({ id: data.id, route });
  }
};
