import { create } from 'zustand';

export const useUIStore = create((set) => ({
  selectedIntersection: null,
  overlays: {
    heatmap: false,
    aiDecisions: true,
    vehicleRoutes: false,
    pedestrianPaths: false,
    zoneColors: true,
  },

  selectIntersection: (id) => set({ selectedIntersection: id }),
  clearSelection: () => set({ selectedIntersection: null }),
  setOverlay: (name, value) => set((state) => ({
    overlays: { ...state.overlays, [name]: value }
  })),
}));
