export const REAL_LANE_WIDTH_M = 3.5;

// Computed in CityLoader.js after parsing bbox
export let CANVAS_SCALE = 1;

export function setCanvasScale(scale) {
  CANVAS_SCALE = scale;
}

export const LANE_WIDTH_PX = () => REAL_LANE_WIDTH_M * CANVAS_SCALE;

// Vehicle real-world dimensions (meters):
export const VEHICLE_DIMS = {
  car:        { length: 4.5,  width: 1.8, maxSpeed: 150, accel: 2.5, decel: 4.0 },
  motorcycle: { length: 2.2,  width: 0.8, maxSpeed: 180, accel: 4.0, decel: 5.0 },
  bus:        { length: 12.0, width: 2.5, maxSpeed: 80,  accel: 1.2, decel: 2.5 },
  truck:      { length: 8.5,  width: 2.4, maxSpeed: 90,  accel: 1.0, decel: 2.0 },
  emergency:  { length: 5.5,  width: 2.1, maxSpeed: 160, accel: 3.5, decel: 4.5 },
  rickshaw:   { length: 2.8,  width: 1.4, maxSpeed: 60,  accel: 1.8, decel: 3.0 },
};
