import { create } from 'zustand';

export const useAIStore = create((set) => ({
  mode: 'DYNAMIC_AUTO', // Flagship mode: Autonomous Dynamic Selection
  currentReward: 0,
  rewardHistory: [],
  decisions: [],
  trainingSteps: 0,
  replaySize: 0,
  epsilon: 1.0,

  // Dynamic model arbitration stats
  dynamicStats: {
    dqnDecisions: 0,
    adaptiveDecisions: 0,
    totalDecisions: 0,
    dqnPercentage: 50,
    lastSelectedModel: 'DQN',
  },

  recordDynamicDecision: (chosenModel) => set((state) => {
    const isDQN = chosenModel === 'DQN' || chosenModel === 'RL_ACTIVE';
    const isAdapt = chosenModel === 'ADAPTIVE' || chosenModel === 'ADAPT';
    if (!isDQN && !isAdapt) return state;

    const dqnDecisions = state.dynamicStats.dqnDecisions + (isDQN ? 1 : 0);
    const adaptiveDecisions = state.dynamicStats.adaptiveDecisions + (isAdapt ? 1 : 0);
    const totalDecisions = dqnDecisions + adaptiveDecisions;
    const dqnPercentage = totalDecisions > 0 ? Math.round((dqnDecisions / totalDecisions) * 100) : 50;

    return {
      dynamicStats: {
        dqnDecisions,
        adaptiveDecisions,
        totalDecisions,
        dqnPercentage,
        lastSelectedModel: isDQN ? 'DQN' : 'ADAPTIVE',
      }
    };
  }),

  pushReward: (r) => set((state) => {
    const history = [...state.rewardHistory, r];
    if (history.length > 500) history.shift();
    return { rewardHistory: history, currentReward: r };
  }),

  pushDecision: (d) => set((state) => {
    const decisions = [...state.decisions, d];
    if (decisions.length > 25) decisions.shift();
    return { decisions };
  }),

  updateStats: (stats) => set({
    trainingSteps: stats.trainingSteps,
    replaySize: stats.replaySize,
    epsilon: stats.epsilon,
  }),

  setMode: (mode) => set({ mode }),

  reset: () => set({
    rewardHistory: [],
    decisions: [],
    currentReward: 0,
    dynamicStats: {
      dqnDecisions: 0,
      adaptiveDecisions: 0,
      totalDecisions: 0,
      dqnPercentage: 50,
      lastSelectedModel: 'DQN',
    },
  }),
}));

