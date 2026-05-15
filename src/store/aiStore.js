import { create } from 'zustand';

export const useAIStore = create((set) => ({
  mode: 'ADAPTIVE',
  currentReward: 0,
  rewardHistory: [],
  decisions: [],
  trainingSteps: 0,
  replaySize: 0,
  epsilon: 1.0,

  pushReward: (r) => set((state) => {
    const history = [...state.rewardHistory, r];
    if (history.length > 500) history.shift();
    return { rewardHistory: history, currentReward: r };
  }),

  pushDecision: (d) => set((state) => {
    const decisions = [...state.decisions, d];
    if (decisions.length > 20) decisions.shift();
    return { decisions };
  }),

  updateStats: (stats) => set({
    trainingSteps: stats.trainingSteps,
    replaySize: stats.replaySize,
    epsilon: stats.epsilon,
  }),

  setMode: (mode) => set({ mode }),
}));
