import { create } from 'zustand';

export const useUIStore = create((set) => ({
  selectedIntersection: null,
  viewMode: 'real_map', // 'real_map' | 'canvas'
  mapStyle: 'osm_dark', // 'osm_dark' | 'osm_standard' | 'satellite'
  overlays: {
    heatmap: false,
    aiDecisions: false,
    vehicleRoutes: false,
    zoneColors: false,
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setMapStyle: (style) => set({ mapStyle: style }),
  selectIntersection: (id) => set({ selectedIntersection: id }),
  clearSelection: () => set({ selectedIntersection: null }),
  setOverlay: (name, value) => set((state) => ({
    overlays: { ...state.overlays, [name]: value }
  })),
}));
