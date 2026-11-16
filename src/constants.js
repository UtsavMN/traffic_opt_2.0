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
    surfaceColor: '#4C5B72',
    casingColor: '#1C2332',
    divider: 'double_yellow',
  },
  trunk: {
    tier: 'arterial',
    name: 'National Highway / Major Corridor',
    laneWidthM: 3.5,
    defaultLanes: 3,
    speedLimitKmh: 65,
    surfaceColor: '#435165',
    casingColor: '#181F2C',
    divider: 'double_yellow',
  },
  primary: {
    tier: 'arterial',
    name: 'Major City Arterial (e.g. Hennur Main Rd, Outer Ring Rd)',
    laneWidthM: 3.4,
    defaultLanes: 2,
    speedLimitKmh: 55,
    surfaceColor: '#3A4658',
    casingColor: '#151A25',
    divider: 'double_yellow',
  },
  secondary: {
    tier: 'main',
    name: 'Commercial Main Road (e.g. Coles Rd, MM Rd, Mosque Rd)',
    laneWidthM: 3.1,
    defaultLanes: 2,
    speedLimitKmh: 48,
    surfaceColor: '#323D4E',
    casingColor: '#121721',
    divider: 'dashed_white',
  },
  tertiary: {
    tier: 'collector',
    name: 'Collector & Connector Street (e.g. Spencer Rd, Davis Rd)',
    laneWidthM: 2.85,
    defaultLanes: 1,
    speedLimitKmh: 40,
    surfaceColor: '#2B3444',
    casingColor: '#10151E',
    divider: 'dashed_white',
  },
  residential: {
    tier: 'cross',
    name: 'Residential Cross Road (e.g. 1st to 9th Cross, Benson Cross)',
    laneWidthM: 2.6,
    defaultLanes: 1,
    speedLimitKmh: 35,
    surfaceColor: '#2D3748', // High-contrast crisp slate asphalt
    casingColor: '#121822', // Distinct edge boundary
    divider: 'none', // Authentic: NO bright yellow highway stripe!
  },
  unclassified: {
    tier: 'cross',
    name: 'Layout Cross Road',
    laneWidthM: 2.6,
    defaultLanes: 1,
    speedLimitKmh: 35,
    surfaceColor: '#2D3748',
    casingColor: '#121822',
    divider: 'none',
  },
  service: {
    tier: 'gully',
    name: 'Narrow Gully / Commercial Alley',
    laneWidthM: 2.3,
    defaultLanes: 1,
    speedLimitKmh: 25,
    surfaceColor: '#242D3C',
    casingColor: '#0E131A',
    divider: 'none',
  },
  default: {
    tier: 'cross',
    name: 'Urban Street',
    laneWidthM: 2.6,
    defaultLanes: 1,
    speedLimitKmh: 35,
    surfaceColor: '#2D3748',
    casingColor: '#121822',
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
    freeFlowSpeedKmh: 54, // Quick, agile Bangalore two-wheelers
    approachSpeedKmh: 38,
    accel: 4.5,           // Eager launch acceleration
    decel: 5.5,
    headway: 0.50,        // Tight urban headway
    minGap: 2.5,          // Minimal queue bumper distance
  },
  rickshaw: {
    length: 2.8,
    width: 1.4,
    freeFlowSpeedKmh: 42,
    approachSpeedKmh: 30,
    accel: 2.8,
    decel: 4.2,
    headway: 0.70,
    minGap: 3.5,
  },
  car: {
    length: 4.5,
    width: 1.8,
    freeFlowSpeedKmh: 50,
    approachSpeedKmh: 35,
    accel: 3.2,
    decel: 4.8,
    headway: 0.80,
    minGap: 5.0,
  },
  bus: {
    length: 11.5,
    width: 2.5,
    freeFlowSpeedKmh: 40,
    approachSpeedKmh: 26,
    accel: 2.0,
    decel: 3.2,
    headway: 1.1,
    minGap: 8.0,
  },
  truck: {
    length: 8.5,
    width: 2.4,
    freeFlowSpeedKmh: 36,
    approachSpeedKmh: 24,
    accel: 1.6,
    decel: 2.8,
    headway: 1.2,
    minGap: 9.0,
  },
  emergency: {
    length: 5.5,
    width: 2.1,
    freeFlowSpeedKmh: 68,
    approachSpeedKmh: 50,
    accel: 4.8,
    decel: 5.5,
    headway: 0.60,
    minGap: 3.5,
  },
};
