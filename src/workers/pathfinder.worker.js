import { CityGraph } from '../simulation/CityGraph.js';
import { findPath } from '../utils/pathfinding.js';

let graph = null;

self.onmessage = ({ data }) => {
  if (data.type === 'INIT') { 
    graph = data.graph; 
    // Restore prototype so the cloned graph object has all CityGraph methods
    Object.setPrototypeOf(graph, CityGraph.prototype);
    return; 
  }
  
  if (data.type === 'FIND_PATH') {
    const route = findPath(graph, data.startId, data.endId);
    self.postMessage({ id: data.id, route });
  }
};
