import { parseOSMRoads } from '../osmParser.js';
import { renderBuildingsToBitmap } from '../buildingParser.js';
import { setCanvasScale } from '../../constants.js';

const AREAS = {
  central: {
    minLng: 77.6030, maxLng: 77.6250,
    minLat: 12.9950, maxLat: 13.0120
  },
  north: {
    minLng: 77.5932, maxLng: 77.6351,
    minLat: 13.0038, maxLat: 13.0204
  },
  south: {
    minLng: 77.5932, maxLng: 77.6351,
    minLat: 12.9872, maxLat: 13.0038
  },
  east: {
    minLng: 77.6141, maxLng: 77.6351,
    minLat: 12.9872, maxLat: 13.0204
  },
  west: {
    minLng: 77.5932, maxLng: 77.6141,
    minLat: 12.9872, maxLat: 13.0204
  }
};

export async function loadBengaluruArea(areaName = 'central') {
  const [roadsRes, buildingsRes] = await Promise.all([
    fetch('/datasets/export.geojson'),
    fetch('/datasets/export (1).geojson')
  ]);

  if (!roadsRes.ok || !buildingsRes.ok) {
    throw new Error("Failed to load OSM datasets. Ensure they are accessible at /datasets/");
  }

  const roadsData = await roadsRes.json();
  const buildingsData = await buildingsRes.json();
  
  const bounds = AREAS[areaName] || AREAS.central;

  function haversine(lon1, lat1, lon2, lat2) {
    const R = 6371e3; // meters
    const phi1 = lat1 * Math.PI/180;
    const phi2 = lat2 * Math.PI/180;
    const deltaPhi = (lat2-lat1) * Math.PI/180;
    const deltaLambda = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  const widthM = haversine(bounds.minLng, (bounds.minLat+bounds.maxLat)/2, bounds.maxLng, (bounds.minLat+bounds.maxLat)/2);
  const heightM = haversine((bounds.minLng+bounds.maxLng)/2, bounds.minLat, (bounds.minLng+bounds.maxLng)/2, bounds.maxLat);
  const scale = 4000 / Math.max(widthM, heightM);
  setCanvasScale(scale);
  console.log(`[Scale] Area: ${areaName}. Width: ${widthM.toFixed(0)}m, Height: ${heightM.toFixed(0)}m. 1px = ${(1/scale).toFixed(2)}m`);

  const { graph, transform } = parseOSMRoads(roadsData, bounds);
  graph.calculateBounds();

  // Target canvas size we used was 4000x4000
  const buildingsBitmap = await renderBuildingsToBitmap(buildingsData, transform, 4000, 4000);

  // Find hospitals
  const hospitals = [];
  buildingsData.features.forEach(f => {
    if (f.properties && f.properties.amenity === 'hospital') {
      if (f.geometry && f.geometry.coordinates && f.geometry.coordinates[0]) {
        let coord;
        if (f.geometry.type === 'Polygon') coord = f.geometry.coordinates[0][0];
        else if (f.geometry.type === 'Point') coord = f.geometry.coordinates;
        
        if (coord) {
          // Check if within bounds
          if (coord[0] >= bounds.minLng && coord[0] <= bounds.maxLng &&
              coord[1] >= bounds.minLat && coord[1] <= bounds.maxLat) {
            const pt = transform(coord[0], coord[1]);
            hospitals.push({ id: `h_${hospitals.length}`, x: pt.x, y: pt.y, name: f.properties.name || 'Hospital' });
          }
        }
      }
    }
  });

  return {
    id: `bengaluru_${areaName}`,
    name: `Bengaluru ${areaName.charAt(0).toUpperCase() + areaName.slice(1)}`,
    graph,
    buildingsBitmap,
    hospitals,
    config: {
      spawnRate: 1.2,
      cameraParams: { x: 2000, y: 2000, zoom: 0.8 },
    }
  };
}
