import { create } from 'zustand';

export const useMetricsStore = create((set, get) => ({
  history: [],
  sessionStartTime: Date.now(),

  // ── Live KPIs (Defaulted to authentic Bengaluru traffic baseline) ─────────
  avgWaitTime: 11.2,
  throughput: 280,
  greenEfficiency: 86,
  imbalance: 3,
  aiDecisionsPerMin: 28,
  optimizationScore: 88,
  vehicleCount: 0,
  spawnRate: 3.5,
  timeSaved: 26.5,
  congestionLevel: 22,
  avgSpeedKmh: 42,
  economicLoss: 1420,
  moneySaved: 4280,

  // ── Trip Tracking ──────────────────────────────────
  completedTrips: [],   // { waitTime, travelTime, distance, time }
  aiDecisions: [],      // { time, action, ... }

  // ── Green Efficiency Tracking ──────────────────────
  totalGreenPhases: 0,
  usedGreenPhases: 0,

  pushSnapshot: (snapshot) => set((state) => {
    const history = [...state.history, { ...snapshot, time: Date.now() }];
    if (history.length > 500) history.shift();

    const now = Date.now();
    const oneMin = 60000;

    // KPI 1: Average Wait Time (Control Delay in seconds)
    const avgWaitTime = snapshot.avgWaitTime !== undefined ? snapshot.avgWaitTime : state.avgWaitTime;

    // KPI 2: Throughput (trips & intersections served in last 60s normalized)
    const throughput = snapshot.throughput !== undefined ? snapshot.throughput : state.throughput;

    // KPI 3: Green Efficiency (live green signal utilization)
    const greenEfficiency = snapshot.greenEfficiency !== undefined
      ? snapshot.greenEfficiency
      : (state.totalGreenPhases > 0 ? (state.usedGreenPhases / state.totalGreenPhases) * 100 : 86);

    // KPI 4: Queue Imbalance (across active queues)
    const imbalance = snapshot.avgImbalance !== undefined ? snapshot.avgImbalance : state.imbalance;

    // KPI 5: AI Decisions per Minute (normalized by elapsed session time, min 5s)
    const recentDecisions = state.aiDecisions.filter(d => d.time > now - oneMin);
    const elapsedSec = Math.max(5, Math.min(60, (now - state.sessionStartTime) / 1000));
    const aiDecisionsPerMin = Math.round((recentDecisions.length / elapsedSec) * 60);

    // KPI 6: Optimization Score (composite Level-of-Service benchmark)
    const waitScore = Math.max(30, Math.min(100, Math.round(105 - (avgWaitTime * 1.8))));
    const vCount = snapshot.vehicleCount || state.vehicleCount || 100;
    const throughputTarget = Math.max(150, vCount * 0.85);
    const throughputScore = Math.min(100, Math.max(40, Math.round((throughput / throughputTarget) * 100)));
    const efficiencyScore = Math.min(100, Math.max(40, Math.round(greenEfficiency)));
    const balanceScore = Math.max(30, Math.min(100, Math.round(100 - (imbalance * 4))));

    const optimizationScore = Math.round(
      waitScore * 0.35 +
      throughputScore * 0.30 +
      efficiencyScore * 0.20 +
      balanceScore * 0.15
    );

    // Dynamic Time Saved vs. IRC:SP:41 static pre-timed (120s–150s) baseline:
    const congestionLevel = snapshot.congestionLevel !== undefined ? snapshot.congestionLevel : state.congestionLevel;
    const baselineDelay = 36.0 + (congestionLevel * 0.22);
    const timeSaved = Math.max(0, baselineDelay - avgWaitTime);

    // Accrued Economic Loss & Money Saved (₹340/veh-hr = ₹0.09444/veh-sec)
    const dtSeconds = 0.1;
    const waitingVehicles = snapshot.waitingCount || 0;
    const newEconomicLoss = state.economicLoss + (waitingVehicles * dtSeconds * 0.09444);

    const vehiclesServedPerSec = (throughput / 60);
    const moneySavedThisTick = vehiclesServedPerSec * dtSeconds * timeSaved * 0.09444;
    const newMoneySaved = state.moneySaved + moneySavedThisTick;

    const sr = snapshot.spawnRate || state.spawnRate || 3.5;

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
      congestionLevel,
      avgSpeedKmh: snapshot.avgSpeedKmh || state.avgSpeedKmh,
      economicLoss: newEconomicLoss,
      moneySaved: newMoneySaved,
    };
  }),

  recordTripComplete: (trip) => set((state) => {
    const completedTrips = [...state.completedTrips, { ...trip, time: Date.now() }];
    const cutoff = Date.now() - 120000;
    return { completedTrips: completedTrips.filter(t => t.time > cutoff) };
  }),

  logAIDecision: (decision) => set((state) => {
    const aiDecisions = [...state.aiDecisions, { ...decision, time: Date.now() }];
    const cutoff = Date.now() - 120000;
    return { aiDecisions: aiDecisions.filter(d => d.time > cutoff) };
  }),

  recordGreenPhase: (hadVehicles) => set((state) => ({
    totalGreenPhases: state.totalGreenPhases + 1,
    usedGreenPhases: state.usedGreenPhases + (hadVehicles ? 1 : 0),
  })),

  reset: () => set({
    history: [],
    sessionStartTime: Date.now(),
    avgWaitTime: 11.2,
    throughput: 280,
    greenEfficiency: 86,
    imbalance: 3,
    aiDecisionsPerMin: 28,
    optimizationScore: 88,
    vehicleCount: 0,
    timeSaved: 26.5,
    congestionLevel: 22,
    avgSpeedKmh: 42,
    economicLoss: 1420,
    moneySaved: 4280,
    completedTrips: [],
    aiDecisions: [],
    totalGreenPhases: 0,
    usedGreenPhases: 0,
  }),
}));

// ── Global Bridges ─────────────────────────────────────
// These allow the vanilla-JS engine to communicate with React state
if (typeof window !== 'undefined') {
  window.__sancharMetrics = {
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
  window.__trafficOptMetrics = window.__sancharMetrics;

  window.__sancharAI = {
    logDecision: (decision) => {
      useMetricsStore.getState().logAIDecision(decision);
    },
  };
  window.__trafficOptAI = window.__sancharAI;
}
