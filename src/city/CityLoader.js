import { loadBengaluruArea } from './cities/bengaluru.js';

export const SCENARIOS = {
  bengaluru_central: {
    name: 'Greater Bengaluru Central Hub',
    description: 'Metropolitan hub spanning Frazer Town, Cantonment & Hennur (1,200+ junctions)',
    generator: async () => await loadBengaluruArea('central'),
    config: { spawnRate: 1.25, timeOfDay: 8.5 }
  },
  bengaluru_frazer_town: {
    name: 'Frazer Town & Coles Road Hub',
    description: 'Commercial & dining grid: Coles Rd, MM Rd, Mosque Rd & dense residential crosses',
    generator: async () => await loadBengaluruArea('frazer_town'),
    config: { spawnRate: 1.35, timeOfDay: 19.0 }
  },
  bengaluru_lingarajapuram: {
    name: 'Lingarajapuram - Hennur Flyover Corridor',
    description: 'Notorious arterial bottleneck: Flyover railway crossing, Hennur Main Rd & Banaswadi Rd',
    generator: async () => await loadBengaluruArea('lingarajapuram'),
    config: { spawnRate: 1.4, timeOfDay: 8.5 }
  },
  bengaluru_cantonment: {
    name: 'Cantonment & Shivaji Nagar Gateway',
    description: 'Transit hub: Millers Rd, Cantonment Station & heavy BMTC bus interchange',
    generator: async () => await loadBengaluruArea('cantonment'),
    config: { spawnRate: 1.2, timeOfDay: 9.0 }
  },
  bengaluru_benson_town: {
    name: 'Benson Town & Richards Town Layouts',
    description: 'Residential layout grid: Nandi Durga Rd, Benson Cross, Davis Rd & gully filtering',
    generator: async () => await loadBengaluruArea('benson_town'),
    config: { spawnRate: 1.0, timeOfDay: 14.0 }
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

  // Center camera on sector if camera params provided
  if (result.config && result.config.cameraParams && engine.camera) {
    const cp = result.config.cameraParams;
    engine.camera.centerOn(cp.x, cp.y, cp.zoom);
  }

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
