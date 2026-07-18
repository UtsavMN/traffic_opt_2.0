import { create } from 'zustand';

export const useUIStore = create((set) => ({
  selectedIntersection: null,
  overlays: {
    heatmap: false,
    aiDecisions: false,
    vehicleRoutes: false,
    pedestrianPaths: false,
    zoneColors: false,
  },

  selectIntersection: (id) => set({ selectedIntersection: id }),
  clearSelection: () => set({ selectedIntersection: null }),
  setOverlay: (name, value) => set((state) => ({
    overlays: { ...state.overlays, [name]: value }
  })),
}));
