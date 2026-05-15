import { create } from 'zustand';

export const useMetricsStore = create((set) => ({
  history: [], // { time, vehicleCount, avgWait, throughput }

  pushSnapshot: (snapshot) => set((state) => {
    const history = [...state.history, { ...snapshot, time: Date.now() }];
    if (history.length > 500) history.shift();
    return { history };
  }),
}));
