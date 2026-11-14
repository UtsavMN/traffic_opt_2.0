import { parseOSMRoads } from '../osmParser.js';
import { renderBuildingsToBitmap } from '../buildingParser.js';
import { setCanvasScale } from '../../constants.js';

const AREAS = {
  central: {
    name: 'Greater Bengaluru Central',
    description: 'Metropolitan hub spanning Frazer Town, Cantonment, and Hennur corridors',
    minLng: 77.5932, maxLng: 77.6351,
    minLat: 12.9872, maxLat: 13.0204,
    camera: { x: 2000, y: 2000, zoom: 0.8 },
    spawnRate: 3.5,
  },
  frazer_town: {
    name: 'Frazer Town & Coles Road Hub',
    description: 'High-density commercial & market grid with Coles Rd, MM Rd, Mosque Rd & residential crosses',
    minLng: 77.6060, maxLng: 77.6250,
    minLat: 12.9930, maxLat: 13.0045,
    camera: { x: 2000, y: 2000, zoom: 1.2 },
    spawnRate: 3.2,
  },
  lingarajapuram: {
    name: 'Lingarajapuram - Hennur Flyover Corridor',
    description: 'Major arterial bottleneck: Lingarajapuram Flyover railway crossing, Hennur Main Rd & Banaswadi Rd',
    minLng: 77.6160, maxLng: 77.6345,
    minLat: 13.0020, maxLat: 13.0180,
    camera: { x: 2000, y: 2000, zoom: 1.15 },
    spawnRate: 3.8,
  },
  cantonment: {
    name: 'Cantonment & Shivaji Nagar Gateway',
    description: 'Multi-modal transit gateway: Millers Rd, Cantonment Station & heavy BMTC bus transit',
    minLng: 77.5932, maxLng: 77.6110,
    minLat: 12.9872, maxLat: 13.0015,
    camera: { x: 2000, y: 2000, zoom: 1.2 },
    spawnRate: 3.4,
  },
  benson_town: {
    name: 'Benson Town & Richards Town Layouts',
    description: 'Residential layout grid: Nandi Durga Rd, Benson Cross, Davis Rd & quiet gully networks',
    minLng: 77.5980, maxLng: 77.6210,
    minLat: 13.0010, maxLat: 13.0125,
    camera: { x: 2000, y: 2000, zoom: 1.2 },
    spawnRate: 3.0,
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

  const areaConfig = AREAS[areaName] || AREAS.central;

  return {
    id: `bengaluru_${areaName}`,
    name: areaConfig.name,
    description: areaConfig.description,
    graph,
    buildingsBitmap,
    hospitals,
    config: {
      spawnRate: areaConfig.spawnRate || 1.2,
      cameraParams: areaConfig.camera || { x: 2000, y: 2000, zoom: 0.8 },
    }
  };
}
