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
  const styles = {
    residential: { fill: '#16181E', stroke: 'rgba(255,255,255,0.07)' },
    commercial: { fill: '#1C2028', stroke: 'rgba(255,255,255,0.1)' },
    apartments: { fill: '#191C23', stroke: 'rgba(255,255,255,0.08)' },
    hospital: { fill: '#16181E', stroke: 'rgba(61,158,255,0.25)' },
    school: { fill: '#1A1C20', stroke: 'rgba(255,180,0,0.15)' },
    default: { fill: '#16181E', stroke: 'rgba(255,255,255,0.05)' }
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
    ctx.lineWidth = 0.5;

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
