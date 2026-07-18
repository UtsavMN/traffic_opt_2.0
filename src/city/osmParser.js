import { CityGraph } from '../simulation/CityGraph.js';

/**
 * Parses GeoJSON road network data into a CityGraph
 */
export function parseOSMRoads(geojson, bounds = null) {
  const graph = new CityGraph();
  let roads = geojson.features.filter(f => f.geometry.type === 'LineString');

  if (bounds) {
    roads = roads.filter(road => {
      // Check if any coordinate of the road is within the bounds
      return road.geometry.coordinates.some(([lng, lat]) => {
        return lng >= bounds.minLng && lng <= bounds.maxLng &&
               lat >= bounds.minLat && lat <= bounds.maxLat;
      });
    });
  }

  // 1. Bounding box & coordinate transform
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  roads.forEach(road => {
    road.geometry.coordinates.forEach(([lng, lat]) => {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  });

  // Target canvas size ~4000x4000
  const TARGET_SIZE = 4000;
  const scaleX = TARGET_SIZE / (maxLng - minLng);
  const scaleY = TARGET_SIZE / (maxLat - minLat);
  const scale = Math.min(scaleX, scaleY) * 0.9;
  const offsetX = TARGET_SIZE / 2 - ((maxLng + minLng) / 2) * scale;
  const offsetY = TARGET_SIZE / 2 + ((maxLat + minLat) / 2) * scale; // Invert Y

  const transform = (lng, lat) => ({
    x: lng * scale + offsetX,
    y: -lat * scale + offsetY
  });

  // 2. Identify intersections (nodes shared by >= 2 roads, plus start/end points)
  const nodeCount = new Map();
  roads.forEach(road => {
    const coords = road.geometry.coordinates;
    for (let i = 0; i < coords.length; i++) {
      const coord = coords[i];
      const key = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
      const current = nodeCount.get(key) || { count: 0, isEnd: false, lng: coord[0], lat: coord[1] };
      current.count++;
      if (i === 0 || i === coords.length - 1) current.isEnd = true;
      nodeCount.set(key, current);
    }
  });

  // Nodes are intersections OR road ends
  const nodes = new Map(); // key -> id
  let nodeIdCounter = 0;
  for (const [key, data] of nodeCount.entries()) {
    if (data.count >= 2 || data.isEnd) {
      const id = `n${nodeIdCounter++}`;
      nodes.set(key, id);
      const pos = transform(data.lng, data.lat);
      // We will assign zones later, default to residential
      graph.addNode(id, pos.x, pos.y, 'junction', 'residential');
    }
  }

  // 3. Create edges
  roads.forEach(road => {
    const props = road.properties || {};
    const coords = road.geometry.coordinates;
    
    let currentSegmentStartKey = null;
    let currentSegmentStartId = null;

    const DEFAULT_LANES = { motorway:4, trunk:3, primary:2, secondary:2, tertiary:1, residential:1, unclassified:1, service:1 };
    const DEFAULT_SPEED_KMH = { motorway:100, trunk:80, primary:60, secondary:50, tertiary:40, residential:30, unclassified:30, service:15 };
    
    const hw = props.highway || 'unclassified';
    const lanes = parseInt(props.lanes) || DEFAULT_LANES[hw] || 1;
    const speedLimit = parseInt(props.maxspeed) || DEFAULT_SPEED_KMH[hw] || 30;
    const oneway = props.oneway === 'yes' || props.oneway === '1' || hw === 'motorway' || props.junction === 'roundabout';
    const type = hw;

    for (let i = 0; i < coords.length; i++) {
      const coord = coords[i];
      const key = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
      
      if (nodes.has(key)) {
        const nodeId = nodes.get(key);
        if (currentSegmentStartId && currentSegmentStartId !== nodeId) {
          // Add edge
          graph.addEdge(currentSegmentStartId, nodeId, lanes, type, speedLimit);
          if (!oneway) {
            graph.addEdge(nodeId, currentSegmentStartId, lanes, type, speedLimit);
          }
        }
        currentSegmentStartId = nodeId;
        currentSegmentStartKey = key;
      }
    }
  });

  // 4. Prune disconnected nodes
  pruneDisconnectedNodes(graph);

  // 5. Cluster nearby nodes (flower effect fix)
  clusterNearbyNodes(graph, 1); // 1 = default scale for now

  return { graph, transform };
}

export function pruneDisconnectedNodes(graph) {
  const nodes = graph.getAllNodes();
  if (nodes.length === 0) return;

  // Start BFS from highest-degree node
  const start = nodes.reduce((a, b) =>
    graph.getDegree(a.id) >= graph.getDegree(b.id) ? a : b
  );

  const visited = new Set();
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const nid of graph.getNeighbors(id)) {
      if (!visited.has(nid)) queue.push(nid);
    }
  }

  // Remove nodes not in main component
  let pruned = 0;
  for (const node of nodes) {
    if (!visited.has(node.id)) { graph.removeNode(node.id); pruned++; }
  }

  // Pre-filter spawnable nodes (degree >= 2)
  graph.spawnableNodes = graph.getAllNodes().filter(n => graph.getDegree(n.id) >= 2);

  console.log(`[Graph] Pruned ${pruned} disconnected nodes. Spawnable: ${graph.spawnableNodes.length}`);
}

export function clusterNearbyNodes(graph, CANVAS_SCALE) {
  const THRESHOLD_PX = 20 * CANVAS_SCALE;  // 20 real meters
  const nodes = [...graph.getAllNodes()];
  const merged = new Map();  // oldId -> superJunctionId

  // 1. Identify clusters and map old node IDs to superJunction IDs
  for (const node of nodes) {
    if (merged.has(node.id)) continue;
    
    // Find nearby nodes
    const nearby = [];
    for (const n of graph.getAllNodes()) {
      if (n.id === node.id || merged.has(n.id)) continue;
      const dist = Math.sqrt((n.x - node.x)**2 + (n.y - node.y)**2);
      if (dist < THRESHOLD_PX) nearby.push(n);
    }
    
    if (nearby.length === 0) {
      merged.set(node.id, node.id);
      continue;
    }

    const cluster = [node, ...nearby];
    const cx = cluster.reduce((s,n) => s+n.x, 0) / cluster.length;
    const cy = cluster.reduce((s,n) => s+n.y, 0) / cluster.length;
    
    const superId = `sj_${node.id}`;
    // Add the super junction node
    graph.addNode(superId, cx, cy, 'junction', 'residential');
    
    for (const n of cluster) { 
      merged.set(n.id, superId); 
    }
  }

  // 2. Clone the existing edges before modifying the graph
  const originalEdges = Array.from(graph.edges.values());

  // 3. Delete all old nodes (this will also delete all old edges and clean up adjacency list)
  for (const oldId of merged.keys()) {
    const newId = merged.get(oldId);
    if (oldId !== newId) {
      graph.removeNode(oldId);
    }
  }

  // 4. Re-add remapped edges and filter out self-loops
  for (const edge of originalEdges) {
    const newFrom = merged.get(edge.from) || edge.from;
    const newTo = merged.get(edge.to) || edge.to;
    
    if (newFrom !== newTo) {
      // Add the edge with its original properties
      graph.addEdge(newFrom, newTo, edge.lanes, edge.type, edge.speedLimit);
    }
  }

  console.log(`[Cluster] ${nodes.length} -> ${graph.getAllNodes().length} nodes after super-junction merging`);
}
