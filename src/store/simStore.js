import { create } from 'zustand';

export const useSimStore = create((set) => ({
  vehicleCount: 0,
  pedestrianCount: 0,
  cyclistCount: 0,
  policeCount: 0,
  avgWaitTime: 0,
  throughput: 0,
  totalSpawned: 0,
  totalDespawned: 0,
  fps: 60,
  timeOfDay: 8,
  weather: 'clear',
  simSpeed: 1,
  spawnRate: 1.0,
  scenario: 'generic_grid',
  running: true,
  intersectionCount: 0,
  loading: 'Initializing Engine...',

  updateMetrics: (data) => set(data),
  setSimSpeed: (speed) => set({ simSpeed: speed }),
  setSpawnRate: (rate) => set({ spawnRate: rate }),
  setWeather: (w) => set({ weather: w }),
  setScenario: (s) => set({ scenario: s }),
  setRunning: (r) => set({ running: r }),
  setLoading: (l) => set({ loading: l }),
}));
