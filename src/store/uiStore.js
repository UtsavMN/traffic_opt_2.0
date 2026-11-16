import { create } from 'zustand';

export const useUIStore = create((set) => ({
  selectedIntersection: null,
  viewMode: 'real_map', // 'real_map' | 'canvas'
  mapStyle: 'osm_dark', // 'osm_dark' | 'osm_standard' | 'satellite'
  showAmbulancePath: true,
  showABComparison: false,
  benchmarkMode: 'AI', // 'AI' | 'FIXED_120S'
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
  toggleAmbulancePath: () => set((state) => ({ showAmbulancePath: !state.showAmbulancePath })),
  setShowAmbulancePath: (val) => set({ showAmbulancePath: val }),
  setShowABComparison: (val) => set({ showABComparison: val }),
  setBenchmarkMode: (mode) => set({ benchmarkMode: mode }),
  setOverlay: (name, value) => set((state) => ({
    overlays: { ...state.overlays, [name]: value }
  })),
}));
