import { parseOSMRoads } from '../osmParser.js';
import { renderBuildingsToBitmap } from '../buildingParser.js';

export async function loadBengaluru() {
  // Fetch GeoJSON datasets
  // Assumes datasets are available in the public folder, or we can import them if they are in src
  // Since they are in d:\My projects\trffic opt 2.0\datasets, we need to import them or copy them to public.
  // We will use Vite's dynamic import with ?url if possible, but for large JSONs, fetching is better.
  // Actually, let's just use fetch if we copy them to public, or we can use dynamic imports.
  // Given Vite setup, importing JSON directly might freeze the bundler for a 10MB file.
  // The datasets folder is outside src. Let's assume we can fetch them via a local server or we should copy them to public.
  // To make it work immediately without moving files, we can import them as URLs if configured, but let's try a direct fetch to the dev server path if mounted.
  // Vite exposes the root directory.
  
  const [roadsRes, buildingsRes] = await Promise.all([
    fetch('/datasets/export.geojson'),
    fetch('/datasets/export (1).geojson')
  ]);

  if (!roadsRes.ok || !buildingsRes.ok) {
    throw new Error("Failed to load OSM datasets. Ensure they are accessible at /datasets/");
  }

  const roadsData = await roadsRes.json();
  const buildingsData = await buildingsRes.json();

  const { graph, transform } = parseOSMRoads(roadsData);

  // Target canvas size we used was 4000x4000
  const buildingsBitmap = await renderBuildingsToBitmap(buildingsData, transform, 4000, 4000);

  // Find hospitals
  const hospitals = [];
  buildingsData.features.forEach(f => {
    if (f.properties && f.properties.amenity === 'hospital') {
      // Use the first coordinate of the polygon
      if (f.geometry && f.geometry.coordinates && f.geometry.coordinates[0]) {
        let coord;
        if (f.geometry.type === 'Polygon') coord = f.geometry.coordinates[0][0];
        else if (f.geometry.type === 'Point') coord = f.geometry.coordinates;
        
        if (coord) {
          const pt = transform(coord[0], coord[1]);
          hospitals.push({ id: `h_${hospitals.length}`, x: pt.x, y: pt.y, name: f.properties.name || 'Hospital' });
        }
      }
    }
  });

  return {
    id: 'bengaluru',
    name: 'Bengaluru Central',
    graph,
    buildingsBitmap,
    hospitals,
    config: {
      spawnRate: 1.2,
      cameraParams: { x: 2000, y: 2000, zoom: 0.8 }, // Center of the 4000x4000 map
    }
  };
}
