import React from 'react';
import { useSimulation } from './hooks/useSimulation.js';
import TopBar from './components/layout/TopBar.jsx';
import Sidebar from './components/layout/Sidebar.jsx';
import StatusBar from './components/layout/StatusBar.jsx';
import AIBrainPanel from './components/panels/AIBrainPanel.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';

export default function App() {
  const sim = useSimulation();

  return (
    <div className="app-layout">
      <LoadingScreen />
      <TopBar />
      <Sidebar
        setSimSpeed={sim.setSimSpeed}
        setSpawnRate={sim.setSpawnRate}
        setWeather={sim.setWeather}
        setTimeOfDay={sim.setTimeOfDay}
        changeScenario={sim.changeScenario}
        triggerAccident={sim.triggerAccident}
        setOverlay={sim.setOverlay}
      />
      <div className="canvas-container">
        <canvas
          ref={sim.canvasRef}
          onClick={sim.handleCanvasClick}
          style={{ cursor: 'crosshair' }}
        />
      </div>
      <AIBrainPanel getIntersectionData={sim.getIntersectionData} />
      <StatusBar />
    </div>
  );
}
