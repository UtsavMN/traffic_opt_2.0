import { CityGraph } from '../simulation/CityGraph.js';
import { ROAD_TIER_CONFIG } from '../constants.js';

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
    const props = road.properties || {};
    const nameLower = (props.name || '').toLowerCase();
    let rLayer = 0;
    if (props.layer !== undefined && props.layer !== null) rLayer = parseInt(props.layer) || 0;
    if (props.bridge && props.bridge !== 'no' && rLayer === 0) rLayer = 1;
    if (props.tunnel && props.tunnel !== 'no' && rLayer === 0) rLayer = -1;
    if (nameLower.includes('flyover') && rLayer <= 0) rLayer = 1;
    if (nameLower.includes('underpass') && rLayer >= 0) rLayer = -1;

    for (let i = 0; i < coords.length; i++) {
      const coord = coords[i];
      const key = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
      const current = nodeCount.get(key) || { count: 0, isEnd: false, lng: coord[0], lat: coord[1], layers: new Set() };
      current.count++;
      if (i === 0 || i === coords.length - 1) current.isEnd = true;
      current.layers.add(rLayer);
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
      let nodeLayer = 0;
      if (data.layers.has(0)) nodeLayer = 0;
      else if (data.layers.has(1)) nodeLayer = 1;
      else if (data.layers.has(-1)) nodeLayer = -1;
      graph.addNode(id, pos.x, pos.y, 'junction', 'residential', nodeLayer);
    }
  }

  // 3. Create edges with authentic Indian / Bengaluru road hierarchy & elevation layers
  roads.forEach(road => {
    const props = road.properties || {};
    const coords = road.geometry.coordinates;
    const name = props.name || '';
    const nameLower = name.toLowerCase();
    
    let layer = 0;
    if (props.layer !== undefined && props.layer !== null) {
      layer = parseInt(props.layer) || 0;
    }
    let isBridge = (props.bridge && props.bridge !== 'no');
    let isTunnel = (props.tunnel && props.tunnel !== 'no');

    // Bengaluru infrastructure naming cues
    if (nameLower.includes('flyover') || nameLower.includes('elevated') || nameLower.includes('overpass')) {
      isBridge = true;
      if (layer <= 0) layer = 1;
    } else if (nameLower.includes('underpass') || nameLower.includes('subway')) {
      isTunnel = true;
      if (layer >= 0) layer = -1;
    }

    if (isBridge && layer <= 0) layer = 1;
    if (isTunnel && layer >= 0) layer = -1;

    let currentSegmentStartKey = null;
    let currentSegmentStartId = null;

    const hw = props.highway || 'unclassified';

    // Differentiate road hierarchy using OSM tag + Bengaluru road nomenclature cues
    let resolvedHw = hw;
    if (nameLower.includes('flyover') || nameLower.includes('ring road') || nameLower.includes('expressway') || nameLower.includes('bypass')) {
      resolvedHw = 'primary';
    } else if (nameLower.includes('main road') || nameLower.includes('avenue') || nameLower.includes('coles') || nameLower.includes('mm road') || nameLower.includes('mosque') || nameLower.includes('millers') || nameLower.includes('davis')) {
      if (resolvedHw === 'residential' || resolvedHw === 'unclassified') {
        resolvedHw = 'secondary';
      }
    } else if (nameLower.includes('cross') || nameLower.includes('cross road') || nameLower.includes('gully') || nameLower.includes('lane') || nameLower.includes('layout')) {
      resolvedHw = 'residential';
    }

    const tierConfig = ROAD_TIER_CONFIG[resolvedHw] || ROAD_TIER_CONFIG.default;
    const roadTier = tierConfig.tier;
    const laneWidthM = tierConfig.laneWidthM;
    const divider = tierConfig.divider;
    const speedLimit = parseInt(props.maxspeed) || tierConfig.speedLimitKmh || 30;
    const oneway = props.oneway === 'yes' || props.oneway === '1' || resolvedHw === 'motorway' || props.junction === 'roundabout';
    const type = resolvedHw;

    let forwardLanes = 1;
    let backwardLanes = 1;

    if (oneway) {
      forwardLanes = parseInt(props.lanes) || tierConfig.defaultLanes || 2;
      backwardLanes = 0;
    } else {
      if (props['lanes:forward']) {
        forwardLanes = parseInt(props['lanes:forward']) || 1;
      }
      if (props['lanes:backward']) {
        backwardLanes = parseInt(props['lanes:backward']) || 1;
      }
      if (!props['lanes:forward'] && !props['lanes:backward']) {
        if (props.lanes) {
          const totalParsed = parseInt(props.lanes);
          if (totalParsed > 1) {
            forwardLanes = Math.max(1, Math.floor(totalParsed / 2));
            backwardLanes = totalParsed - forwardLanes;
          } else {
            forwardLanes = 1;
            backwardLanes = 1;
          }
        } else {
          forwardLanes = tierConfig.defaultLanes || 1;
          backwardLanes = forwardLanes;
        }
      }
    }

    let currentSegmentGeom = [];

    for (let i = 0; i < coords.length; i++) {
      const coord = coords[i];
      const key = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
      const pos = transform(coord[0], coord[1]);
      
      if (currentSegmentStartId) {
        currentSegmentGeom.push(pos);
      }

      if (nodes.has(key)) {
        const nodeId = nodes.get(key);
        if (currentSegmentStartId && currentSegmentStartId !== nodeId) {
          // Add edge with waypoints, road hierarchy and elevation layers
          graph.addEdge(currentSegmentStartId, nodeId, forwardLanes, type, speedLimit, currentSegmentGeom, roadTier, laneWidthM, name, divider, layer, isBridge, isTunnel);
          if (!oneway && backwardLanes > 0) {
            const revGeom = [...currentSegmentGeom].reverse();
            graph.addEdge(nodeId, currentSegmentStartId, backwardLanes, type, speedLimit, revGeom, roadTier, laneWidthM, name, divider, layer, isBridge, isTunnel);
          }
        }
        currentSegmentStartId = nodeId;
        currentSegmentStartKey = key;
        currentSegmentGeom = [pos];
      }
    }
  });

  // 4. Prune disconnected nodes
  pruneDisconnectedNodes(graph);

  // 5. Cluster nearby nodes (flower effect fix)
  clusterNearbyNodes(graph, 1); // 1 = default scale for now

  // 6. Compute vertical grade separations & underpass zones
  computeGradeSeparations(graph);

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
  const THRESHOLD_PX = 20 * CANVAS_SCALE;  // 20 real meters to merge super junctions
  const nodes = [...graph.getAllNodes()];
  const merged = new Map();  // oldId -> superJunctionId

  // 1. Identify clusters and map old node IDs to superJunction IDs
  for (const node of nodes) {
    if (merged.has(node.id)) continue;
    
    // Find nearby nodes on the EXACT SAME ELEVATION LAYER
    const nearby = [];
    for (const n of graph.getAllNodes()) {
      if (n.id === node.id || merged.has(n.id)) continue;
      // Do not merge flyover nodes with surface nodes or underpasses!
      if ((n.layer || 0) !== (node.layer || 0)) continue;
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
    // Add the super junction node preserving elevation layer
    graph.addNode(superId, cx, cy, 'junction', 'residential', node.layer || 0);
    
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

  // 4. Re-add remapped edges and filter out self-loops with full metadata preserved
  for (const edge of originalEdges) {
    const newFrom = merged.get(edge.from) || edge.from;
    const newTo = merged.get(edge.to) || edge.to;
    
    if (newFrom !== newTo) {
      // Correctly update the polyline geometry endpoints to match the new super-junction node centers!
      let remappedGeom = null;
      if (edge.geometry && edge.geometry.length >= 2) {
        remappedGeom = [...edge.geometry];
        const startNode = graph.nodes.get(newFrom);
        const endNode = graph.nodes.get(newTo);
        if (startNode) remappedGeom[0] = { x: startNode.x, y: startNode.y };
        if (endNode) remappedGeom[remappedGeom.length - 1] = { x: endNode.x, y: endNode.y };
      }
      graph.addEdge(
        newFrom, newTo,
        edge.lanes, edge.type, edge.speedLimit,
        remappedGeom,
        edge.roadTier, edge.laneWidthM, edge.name, edge.divider,
        edge.layer, edge.isBridge, edge.isTunnel
      );
    }
  }

  console.log(`[Cluster] ${nodes.length} -> ${graph.getAllNodes().length} nodes after super-junction merging`);
  // Pre-filter spawnable nodes again (degree >= 2) after cluster deletion
  graph.spawnableNodes = graph.getAllNodes().filter(n => graph.getDegree(n.id) >= 2);
}

/**
 * 2D Line segment intersection helper
 */
function getLineIntersection(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t >= 0.001 && t <= 0.999 && u >= 0.001 && u <= 0.999) {
    return {
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
      t, u
    };
  }
  return null;
}

/**
 * Identifies grade-separated crossings where elevated flyovers pass above surface roads.
 * Marks underpass zones on surface edges so vehicles passing below are hidden momentarily.
 */
export function computeGradeSeparations(graph) {
  const flyoverEdges = [];
  const surfaceEdges = [];

  for (const [, edge] of graph.edges) {
    if (edge.layer > 0 || edge.isBridge) {
      flyoverEdges.push(edge);
    } else {
      surfaceEdges.push(edge);
    }
  }

  if (flyoverEdges.length === 0 || surfaceEdges.length === 0) return;

  let separationCount = 0;
  for (const surfaceEdge of surfaceEdges) {
    const sGeom = surfaceEdge.geometry;
    if (!sGeom || sGeom.length < 2) continue;

    // Cumulative distances along surface edge
    const sDists = [0];
    for (let i = 0; i < sGeom.length - 1; i++) {
      const d = Math.hypot(sGeom[i+1].x - sGeom[i].x, sGeom[i+1].y - sGeom[i].y);
      sDists.push(sDists[i] + d);
    }
    const totalSurfaceLen = sDists[sDists.length - 1] || surfaceEdge.length || 1;

    for (const flyoverEdge of flyoverEdges) {
      // Skip connected ramp edges (these are transitions, not grade-separated crossings)
      if (surfaceEdge.from === flyoverEdge.from || surfaceEdge.from === flyoverEdge.to ||
          surfaceEdge.to === flyoverEdge.from || surfaceEdge.to === flyoverEdge.to) {
        continue;
      }

      const fGeom = flyoverEdge.geometry;
      if (!fGeom || fGeom.length < 2) continue;

      for (let sIdx = 0; sIdx < sGeom.length - 1; sIdx++) {
        const sp1 = sGeom[sIdx], sp2 = sGeom[sIdx + 1];

        for (let fIdx = 0; fIdx < fGeom.length - 1; fIdx++) {
          const fp1 = fGeom[fIdx], fp2 = fGeom[fIdx + 1];

          const inter = getLineIntersection(sp1, sp2, fp1, fp2);
          if (inter) {
            const segDist = Math.hypot(sp2.x - sp1.x, sp2.y - sp1.y);
            const distAlong = sDists[sIdx] + inter.t * segDist;
            const progress = Math.max(0, Math.min(1, distAlong / totalSurfaceLen));

            // Estimate flyover bridge deck footprint (lanes * width + crash barrier buffer)
            const flyoverDeckWidthM = (flyoverEdge.lanes || 2) * (flyoverEdge.laneWidthM || 3.2);
            const halfSpanPx = Math.max(12, flyoverDeckWidthM * 1.5);
            const halfSpanProgress = halfSpanPx / totalSurfaceLen;

            const startProgress = Math.max(0, progress - halfSpanProgress);
            const endProgress = Math.min(1, progress + halfSpanProgress);

            surfaceEdge.underpasses.push({
              startProgress,
              endProgress,
              flyoverName: flyoverEdge.name || 'Flyover',
              crossingPoint: { x: inter.x, y: inter.y }
            });
            separationCount++;
          }
        }
      }
    }

    // Merge overlapping underpass intervals on this edge
    if (surfaceEdge.underpasses.length > 1) {
      surfaceEdge.underpasses.sort((a, b) => a.startProgress - b.startProgress);
      const merged = [surfaceEdge.underpasses[0]];
      for (let i = 1; i < surfaceEdge.underpasses.length; i++) {
        const curr = surfaceEdge.underpasses[i];
        const last = merged[merged.length - 1];
        if (curr.startProgress <= last.endProgress) {
          last.endProgress = Math.max(last.endProgress, curr.endProgress);
        } else {
          merged.push(curr);
        }
      }
      surfaceEdge.underpasses = merged;
    }
  }
  console.log(`[GradeSeparations] Identified ${separationCount} underpass crossings beneath elevated flyovers`);
}
