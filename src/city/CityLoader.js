import { loadBengaluruArea } from './cities/bengaluru.js';

export const SCENARIOS = {
  bengaluru_central: {
    name: 'Bengaluru Central',
    description: 'Central Bangalore Hub',
    generator: async () => await loadBengaluruArea('central'),
    config: { spawnRate: 1.2 }
  },
  bengaluru_north: {
    name: 'Bengaluru North',
    description: 'Northern Bangalore District',
    generator: async () => await loadBengaluruArea('north'),
    config: { spawnRate: 1.0 }
  },
  bengaluru_south: {
    name: 'Bengaluru South',
    description: 'Southern Bangalore District',
    generator: async () => await loadBengaluruArea('south'),
    config: { spawnRate: 1.1 }
  },
  bengaluru_east: {
    name: 'Bengaluru East',
    description: 'Eastern Bangalore District',
    generator: async () => await loadBengaluruArea('east'),
    config: { spawnRate: 1.0 }
  },
  bengaluru_west: {
    name: 'Bengaluru West',
    description: 'Western Bangalore District',
    generator: async () => await loadBengaluruArea('west'),
    config: { spawnRate: 1.0 }
  }
};

export async function loadScenario(scenarioId, engine) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    throw new Error(`Scenario '${scenarioId}' not found in SCENARIOS`);
  }

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
