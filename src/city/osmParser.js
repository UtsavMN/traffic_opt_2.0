import { CityGraph } from '../simulation/CityGraph.js';

/**
 * Parses GeoJSON road network data into a CityGraph
 */
export function parseOSMRoads(geojson) {
  const graph = new CityGraph();
  const roads = geojson.features.filter(f => f.geometry.type === 'LineString');

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

    // Parse attributes
    const highway = props.highway || 'residential';
    let type = 'local';
    let lanes = 1;
    let speedLimit = 40;
    
    if (highway === 'motorway' || highway === 'trunk') { type = 'highway'; lanes = 3; speedLimit = 80; }
    else if (highway === 'primary') { type = 'arterial'; lanes = 2; speedLimit = 60; }
    else if (highway === 'secondary' || highway === 'tertiary') { type = 'arterial'; lanes = 2; speedLimit = 50; }
    
    // Override with specific tags if present
    if (props.lanes) {
      const parsedLanes = parseInt(props.lanes);
      if (!isNaN(parsedLanes) && parsedLanes > 0) lanes = parsedLanes;
    }
    if (props.maxspeed) {
      const parsedSpeed = parseInt(props.maxspeed);
      if (!isNaN(parsedSpeed) && parsedSpeed > 0) speedLimit = parsedSpeed;
    }

    const oneway = props.oneway === 'yes' || props.oneway === '1' || highway === 'motorway';

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

  return { graph, transform };
}
