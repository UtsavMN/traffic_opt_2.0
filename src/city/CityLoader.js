import { generateGridCity } from './cities/grid.js';
import { generateMumbaiCity } from './cities/mumbai.js';
import { loadBengaluru } from './cities/bengaluru.js';

/**
 * CityLoader — Loads city definitions and scenario configurations
 */

export const SCENARIOS = {
  bengaluru: {
    name: 'Bengaluru Central',
    description: 'Real OSM road network and buildings',
    generator: async () => await loadBengaluru(),
    config: { spawnRate: 1.2 }
  },
  generic_grid: {
    name: 'Generic Grid',
    description: '10×10 uniform grid — baseline for AI training',
    generator: () => ({ graph: generateGridCity(10, 10, 120) }),
    config: {}
  },
  mumbai: {
    name: 'Mumbai District',
    description: 'Irregular grid, mixed lanes, high pedestrian density',
    generator: () => ({ graph: generateMumbaiCity() }),
    config: { spawnRate: 1.5 }
  },
  rush_hour: {
    name: 'Rush Hour',
    description: 'Time locked 08:00–09:00, 2.5× spawn rate',
    generator: () => ({ graph: generateGridCity(10, 10, 120) }),
    config: { spawnRate: 2.5, lockTime: 8, timeOfDay: 8 }
  },
  incident_cascade: {
    name: 'Incident Cascade',
    description: '3 accidents over 10 min, tests rerouting',
    generator: () => ({ graph: generateGridCity(10, 10, 120) }),
    config: { autoAccidents: true, accidentInterval: 120 }
  },
  emergency_corridor: {
    name: 'Emergency Corridor',
    description: 'Ambulance south→north, AI clears path',
    generator: () => ({ graph: generateGridCity(10, 10, 120) }),
    config: { spawnEmergency: true }
  },
};

export async function loadScenario(scenarioId, engine) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) return;

  const result = await scenario.generator();
  const graph = result.graph;
  engine.loadCity(graph);
  
  if (result.buildingsBitmap) engine.buildingsBitmap = result.buildingsBitmap;
  else engine.buildingsBitmap = null;
  
  if (result.hospitals) engine.hospitals = result.hospitals;
  else engine.hospitals = [];

  // Apply config
  const cfg = scenario.config;
  if (cfg.spawnRate) engine.setSpawnRate(cfg.spawnRate);
  if (cfg.timeOfDay !== undefined) engine.timeOfDay.setHour(cfg.timeOfDay);
  if (cfg.lockTime !== undefined) engine.timeOfDay.lock(cfg.lockTime);
  else engine.timeOfDay.unlock();
  if (cfg.autoAccidents) {
    engine.accidents.autoSpawn = true;
    engine.accidents.autoSpawnInterval = cfg.accidentInterval || 180;
  } else {
    engine.accidents.autoSpawn = false;
  }

  // Emergency corridor: handled by engine spawn logic - emergency type vehicles
  // will naturally be spawned with siren active and trigger preemption

  return scenario;
}
