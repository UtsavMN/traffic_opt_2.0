export const REAL_LANE_WIDTH_M = 3.1; // Baseline default for urban roads

// Computed in CityLoader.js after parsing bbox
export let CANVAS_SCALE = 1;

export function setCanvasScale(scale) {
  CANVAS_SCALE = scale;
}

export function getCanvasScale() {
  return CANVAS_SCALE || 1;
}

export const LANE_WIDTH_PX = () => REAL_LANE_WIDTH_M * CANVAS_SCALE;

// Indian Road Hierarchy Standards (IRC:73 / IRC:86 / Bengaluru Urban Mobility)
// Differentiates wide multi-lane highways/flyovers from narrow commercial avenues and residential crosses
export const ROAD_TIER_CONFIG = {
  motorway: {
    tier: 'arterial',
    name: 'Expressway / Flyover Corridor',
    laneWidthM: 3.5,
    defaultLanes: 3,
    speedLimitKmh: 60,
    surfaceColor: '#363E4D',
    casingColor: '#0A0C10',
    divider: 'double_yellow',
  },
  trunk: {
    tier: 'arterial',
    name: 'National Highway / Major Corridor',
    laneWidthM: 3.5,
    defaultLanes: 3,
    speedLimitKmh: 55,
    surfaceColor: '#303744',
    casingColor: '#090B0E',
    divider: 'double_yellow',
  },
  primary: {
    tier: 'arterial',
    name: 'Major City Arterial (e.g. Hennur Main Rd, Outer Ring Rd)',
    laneWidthM: 3.4,
    defaultLanes: 2,
    speedLimitKmh: 50,
    surfaceColor: '#2B323F',
    casingColor: '#080A0D',
    divider: 'double_yellow',
  },
  secondary: {
    tier: 'main',
    name: 'Commercial Main Road (e.g. Coles Rd, MM Rd, Mosque Rd)',
    laneWidthM: 3.1,
    defaultLanes: 2,
    speedLimitKmh: 40,
    surfaceColor: '#242A35',
    casingColor: '#07090C',
    divider: 'dashed_white',
  },
  tertiary: {
    tier: 'collector',
    name: 'Collector & Connector Street (e.g. Spencer Rd, Davis Rd)',
    laneWidthM: 2.85,
    defaultLanes: 1,
    speedLimitKmh: 32,
    surfaceColor: '#1F242E',
    casingColor: '#06070A',
    divider: 'dashed_white',
  },
  residential: {
    tier: 'cross',
    name: 'Residential Cross Road (e.g. 1st to 9th Cross, Benson Cross)',
    laneWidthM: 2.6,
    defaultLanes: 1,
    speedLimitKmh: 24,
    surfaceColor: '#1A1E26',
    casingColor: '#050608',
    divider: 'none', // Authentic: NO bright yellow highway stripe!
  },
  unclassified: {
    tier: 'cross',
    name: 'Layout Cross Road',
    laneWidthM: 2.6,
    defaultLanes: 1,
    speedLimitKmh: 24,
    surfaceColor: '#1A1E26',
    casingColor: '#050608',
    divider: 'none',
  },
  service: {
    tier: 'gully',
    name: 'Narrow Gully / Commercial Alley',
    laneWidthM: 2.3,
    defaultLanes: 1,
    speedLimitKmh: 18,
    surfaceColor: '#151820',
    casingColor: '#030406',
    divider: 'none',
  },
  default: {
    tier: 'cross',
    name: 'Urban Street',
    laneWidthM: 2.75,
    defaultLanes: 1,
    speedLimitKmh: 28,
    surfaceColor: '#1C2029',
    casingColor: '#050608',
    divider: 'none',
  }
};

export function getLaneWidthM(roadType) {
  return (ROAD_TIER_CONFIG[roadType] || ROAD_TIER_CONFIG.default).laneWidthM;
}

export function getLaneWidthPx(roadType = 'default') {
  return getLaneWidthM(roadType) * CANVAS_SCALE;
}

// Vehicle real-world dimensions (meters) & heterogeneous Bengaluru urban speed profiles
// Based on Indian Roads Congress (IRC), CiSTUP (IISc), and Bengaluru Traffic Police mobility surveys
export const VEHICLE_DIMS = {
  motorcycle: {
    length: 2.0,
    width: 0.8,
    freeFlowSpeedKmh: 46, // 40-52 km/h free flow
    approachSpeedKmh: 28,
    accel: 3.2,           // Agile 2-wheeler acceleration
    decel: 4.5,
    headway: 0.7,         // Tight time headway
    minGap: 3.5,          // Minimal queue bumper distance
  },
  rickshaw: {
    length: 2.8,
    width: 1.4,
    freeFlowSpeedKmh: 35, // 30-38 km/h free flow
    approachSpeedKmh: 22,
    accel: 1.8,
    decel: 3.2,
    headway: 0.9,
    minGap: 5.0,
  },
  car: {
    length: 4.5,
    width: 1.8,
    freeFlowSpeedKmh: 42, // 36-48 km/h free flow
    approachSpeedKmh: 25,
    accel: 2.2,
    decel: 3.8,
    headway: 1.1,
    minGap: 7.5,
  },
  bus: {
    length: 11.5,
    width: 2.5,
    freeFlowSpeedKmh: 32, // BMTC City Bus 26-36 km/h
    approachSpeedKmh: 18,
    accel: 1.1,
    decel: 2.4,
    headway: 1.5,
    minGap: 12.0,
  },
  truck: {
    length: 8.5,
    width: 2.4,
    freeFlowSpeedKmh: 28, // Heavy commercial 24-32 km/h
    approachSpeedKmh: 16,
    accel: 0.9,
    decel: 2.0,
    headway: 1.7,
    minGap: 14.0,
  },
  emergency: {
    length: 5.5,
    width: 2.1,
    freeFlowSpeedKmh: 58, // Ambulance 50-65 km/h
    approachSpeedKmh: 40,
    accel: 3.5,
    decel: 4.5,
    headway: 0.8,
    minGap: 5.0,
  },
};
