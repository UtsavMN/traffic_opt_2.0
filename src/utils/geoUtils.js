/**
 * Geodesic distance and geographic interpolation utilities for real-world simulation mapping
 */

export function getDistanceMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculatePolylineLengthMeters(coords) {
  if (!coords || coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += getDistanceMeters(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
  }
  return total;
}

export function interpolateGeoPoint(geoCoords, progress, laneOffsetM = 0) {
  if (!geoCoords || geoCoords.length === 0) return { lng: 0, lat: 0, bearing: 0 };
  if (geoCoords.length === 1) return { lng: geoCoords[0][0], lat: geoCoords[0][1], bearing: 0 };

  // Calculate cumulative distances
  let totalDist = 0;
  const dists = [0];
  for (let i = 0; i < geoCoords.length - 1; i++) {
    const d = getDistanceMeters(geoCoords[i][0], geoCoords[i][1], geoCoords[i+1][0], geoCoords[i+1][1]);
    totalDist += d;
    dists.push(totalDist);
  }

  const targetDist = Math.max(0, Math.min(totalDist, progress * totalDist));
  
  // Find segment
  let segIdx = 0;
  for (let i = 0; i < dists.length - 1; i++) {
    if (targetDist >= dists[i] && targetDist <= dists[i+1]) {
      segIdx = i;
      break;
    }
  }

  const p1 = geoCoords[segIdx];
  const p2 = geoCoords[segIdx + 1] || p1;
  const segLen = dists[segIdx + 1] - dists[segIdx];
  const segT = segLen > 0 ? (targetDist - dists[segIdx]) / segLen : 0;

  let lng = p1[0] + (p2[0] - p1[0]) * segT;
  let lat = p1[1] + (p2[1] - p1[1]) * segT;

  // Bearing in degrees from p1 to p2
  let bp1 = p1;
  let bp2 = p2;
  if (bp1[0] === bp2[0] && bp1[1] === bp2[1] && segIdx > 0) {
    bp1 = geoCoords[segIdx - 1];
    bp2 = geoCoords[segIdx];
  }
  const dLng = (bp2[0] - bp1[0]) * Math.PI / 180;
  const lat1Rad = bp1[1] * Math.PI / 180;
  const lat2Rad = bp2[1] * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  let bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

  // Lateral lane offset in meters
  if (laneOffsetM !== 0) {
    const perpBearing = (bearing + 90) * Math.PI / 180;
    const R = 6371000;
    const dLatOffset = (laneOffsetM * Math.cos(perpBearing)) / R * (180 / Math.PI);
    const dLngOffset = (laneOffsetM * Math.sin(perpBearing)) / (R * Math.cos(lat1Rad)) * (180 / Math.PI);
    lat += dLatOffset;
    lng += dLngOffset;
  }

  return { lng, lat, bearing };
}

export function getMetersPerPixel(lat, zoom) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}
