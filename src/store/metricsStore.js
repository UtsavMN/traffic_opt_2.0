import { create } from 'zustand';

export const useMetricsStore = create((set, get) => ({
  history: [],

  // ── Live KPIs ──────────────────────────────────────
  avgWaitTime: 0,
  throughput: 0,
  greenEfficiency: 0,
  imbalance: 0,
  aiDecisionsPerMin: 0,
  optimizationScore: 0,
  vehicleCount: 0,
  spawnRate: 0.8,
  timeSaved: 0,
  congestionLevel: 0,
  avgSpeedKmh: 40,
  economicLoss: 0,
  moneySaved: 0,

  // ── Trip Tracking ──────────────────────────────────
  completedTrips: [],   // { waitTime, travelTime, distance, time }
  aiDecisions: [],      // { time, action, ... }

  // ── Green Efficiency Tracking ──────────────────────
  totalGreenPhases: 0,
  usedGreenPhases: 0,

  pushSnapshot: (snapshot) => set((state) => {
    const history = [...state.history, { ...snapshot, time: Date.now() }];
    if (history.length > 500) history.shift();

    // Compute 6 KPIs
    const now = Date.now();
    const oneMin = 60000;

    // KPI 1: Average Wait Time
    const avgWaitTime = snapshot.avgWaitTime || 0;

    // KPI 2: Throughput (trips completed in last 60s of simulation time)
    const throughput = snapshot.throughput !== undefined ? snapshot.throughput : state.throughput;

    // KPI 3: Green Efficiency
    const greenEfficiency = state.totalGreenPhases > 0
      ? (state.usedGreenPhases / state.totalGreenPhases) * 100
      : 85; // default assumption

    // KPI 4: Queue Imbalance
    const imbalance = snapshot.avgImbalance || state.imbalance;

    // KPI 5: AI Decisions per Minute
    const recentDecisions = state.aiDecisions.filter(d => d.time > now - oneMin);
    const aiDecisionsPerMin = recentDecisions.length;

    // KPI 6: Optimization Score (composite)
    const waitScore = Math.max(0, 100 - avgWaitTime * 2);
    const sr = snapshot.spawnRate || state.spawnRate || 0.8;
    const throughputScore = Math.min(100, (throughput / (sr * 60)) * 100);
    const efficiencyScore = greenEfficiency;
    const balanceScore = Math.max(0, 100 - imbalance);

    const optimizationScore = Math.round(
      waitScore * 0.40 +
      throughputScore * 0.30 +
      efficiencyScore * 0.20 +
      balanceScore * 0.10
    );

    // Compute Time Saved vs. Static baseline: Baseline = 22.0 + (spawnRate * 16.0) seconds
    const baseline = 22.0 + (sr * 16.0);
    const timeSaved = Math.max(0, baseline - avgWaitTime);

     // Compute accrued economic loss and money saved index (at ₹0.095 per vehicle-second waiting loss)
     const dtSeconds = 0.1; // Matches Engine.js tick rate
     const waitingVehicles = snapshot.waitingCount || 0;
     const newEconomicLoss = state.economicLoss + (waitingVehicles * dtSeconds * 0.095);

     // Money saved per tick = (trips/min / 60) * dtSeconds * timeSaved * 0.095;
     const tripsCompletedThisTick = (throughput / 60) * dtSeconds;
     const newMoneySaved = state.moneySaved + (tripsCompletedThisTick * timeSaved * 0.095);

     return {
       history,
       avgWaitTime,
       throughput,
       greenEfficiency,
       imbalance,
       aiDecisionsPerMin,
       optimizationScore,
       vehicleCount: snapshot.vehicleCount || 0,
       spawnRate: sr,
       timeSaved,
       congestionLevel: snapshot.congestionLevel || 0,
       avgSpeedKmh: snapshot.avgSpeedKmh || 0,
       economicLoss: newEconomicLoss,
       moneySaved: newMoneySaved,
     };
  }),

  recordTripComplete: (trip) => set((state) => {
    const completedTrips = [...state.completedTrips, { ...trip, time: Date.now() }];
    // Keep last 2 minutes of data
    const cutoff = Date.now() - 120000;
    return { completedTrips: completedTrips.filter(t => t.time > cutoff) };
  }),

  logAIDecision: (decision) => set((state) => {
    const aiDecisions = [...state.aiDecisions, { ...decision, time: Date.now() }];
    // Keep last 2 minutes of data
    const cutoff = Date.now() - 120000;
    return { aiDecisions: aiDecisions.filter(d => d.time > cutoff) };
  }),

  recordGreenPhase: (hadVehicles) => set((state) => ({
    totalGreenPhases: state.totalGreenPhases + 1,
    usedGreenPhases: state.usedGreenPhases + (hadVehicles ? 1 : 0),
  })),
}));

// ── Global Bridges ─────────────────────────────────────
// These allow the vanilla-JS engine to communicate with React state
if (typeof window !== 'undefined') {
  window.__trafficOptMetrics = {
    recordTripComplete: (trip) => {
      useMetricsStore.getState().recordTripComplete(trip);
    },
    getMetrics: () => {
      const state = useMetricsStore.getState();
      return {
        avgWait: state.avgWaitTime,
        throughput: state.throughput,
        avgSpeed: state.avgSpeedKmh,
        greenEfficiency: state.greenEfficiency,
        activeCount: state.vehicleCount
      };
    }
  };

  window.__trafficOptAI = {
    logDecision: (decision) => {
      useMetricsStore.getState().logAIDecision(decision);
    },
  };
}
