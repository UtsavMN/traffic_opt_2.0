/**
 * buildingParser — Renders GeoJSON building polygons to an ImageBitmap
 */

export async function parseAndRenderBuildings(geojson, graph) {
  // We need the same transform as the road network
  // In a real app, we'd pass the transform from osmParser, but here we can just compute the bbox
  // or simply use the fact that the transform is deterministic.
  // To be safe, we'll recalculate the exact same transform from the road GeoJSON,
  // OR we can export the transform from osmParser.
  
  // For simplicity, let's just create a blank offscreen canvas.
  // Wait, we need the exact bounding box. It's better to pass it in.
  // We will assume `transform` is passed from the caller.
  return null; // Implemented below with proper transform logic
}

export async function renderBuildingsToBitmap(buildingsGeoJson, transform, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, width, height);

  const buildings = buildingsGeoJson.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));

  // Define styles
  // High-contrast modern dark-mode building styles
  const styles = {
    residential: { fill: '#1B1D25', stroke: 'rgba(255,255,255,0.14)' },
    commercial: { fill: '#222630', stroke: 'rgba(255,255,255,0.18)' },
    apartments: { fill: '#1D212A', stroke: 'rgba(255,255,255,0.14)' },
    hospital: { fill: '#1A2135', stroke: 'rgba(61,158,255,0.35)' },
    school: { fill: '#25211B', stroke: 'rgba(255,180,0,0.25)' },
    default: { fill: '#1B1D25', stroke: 'rgba(255,255,255,0.12)' }
  };

  for (const b of buildings) {
    const props = b.properties || {};
    const type = props.building || 'yes';
    const amenity = props.amenity;
    
    let style = styles.default;
    if (amenity === 'hospital') style = styles.hospital;
    else if (amenity === 'school') style = styles.school;
    else if (styles[type]) style = styles[type];

    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 1.0;

    ctx.beginPath();
    
    const drawPolygon = (ring) => {
      for (let i = 0; i < ring.length; i++) {
        const pt = transform(ring[i][0], ring[i][1]);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
    };

    if (b.geometry.type === 'Polygon') {
      drawPolygon(b.geometry.coordinates[0]); // Outer ring
    } else if (b.geometry.type === 'MultiPolygon') {
      for (const poly of b.geometry.coordinates) {
        drawPolygon(poly[0]);
      }
    }
    
    ctx.fill();
    ctx.stroke();

    // Random lit windows at night (we'll just draw them now as part of the texture)
    // To do day/night properly, we could have two bitmaps: base buildings and lights.
  }

  // Generate ImageBitmap
  return await createImageBitmap(canvas);
}
