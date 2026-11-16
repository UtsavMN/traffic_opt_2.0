import React from 'react';
import { useSimulation } from './hooks/useSimulation.js';
import { useUIStore } from './store/uiStore.js';
import TopBar from './components/layout/TopBar.jsx';
import Sidebar from './components/layout/Sidebar.jsx';
import StatusBar from './components/layout/StatusBar.jsx';
import AIBrainPanel from './components/panels/AIBrainPanel.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import MapLibreSimulationViewer from './components/MapLibreSimulationViewer.jsx';

export default function App() {
  const sim = useSimulation();
  const viewMode = useUIStore(s => s.viewMode);

  return (
    <div className="app-layout">
      <LoadingScreen />
      <TopBar
        setTimeOfDay={sim.setTimeOfDay}
        setTimeLocked={sim.setTimeLocked}
        togglePause={sim.togglePause}
        restartSim={sim.restartSim}
      />
      <Sidebar
        setSimSpeed={sim.setSimSpeed}
        togglePause={sim.togglePause}
        restartSim={sim.restartSim}
        setSpawnRate={sim.setSpawnRate}
        setWeather={sim.setWeather}
        setTimeOfDay={sim.setTimeOfDay}
        setTimeLocked={sim.setTimeLocked}
        changeScenario={sim.changeScenario}
        triggerAccident={sim.triggerAccident}
        setOverlay={sim.setOverlay}
      />
      <div className="canvas-container" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
        <canvas
          ref={sim.canvasRef}
          onClick={sim.handleCanvasClick}
          style={{
            cursor: 'crosshair',
            display: viewMode === 'canvas' ? 'block' : 'none',
            width: '100%',
            height: '100%',
          }}
        />
        {viewMode === 'real_map' && (
          <MapLibreSimulationViewer
            engine={sim.engineRef.current}
            onSelectIntersection={(id) => useUIStore.getState().selectIntersection(id)}
          />
        )}
      </div>
      <AIBrainPanel getIntersectionData={sim.getIntersectionData} />
      <StatusBar />
    </div>
  );
}
