import React, { useState } from 'react';
import { useSimStore } from '../../store/simStore.js';
import { useUIStore } from '../../store/uiStore.js';
import { SCENARIOS } from '../../city/CityLoader.js';

const WEATHER_OPTIONS = [
  { id: 'clear', icon: '☀️', label: 'Clear' },
  { id: 'light_rain', icon: '🌦️', label: 'L.Rain' },
  { id: 'heavy_rain', icon: '🌧️', label: 'H.Rain' },
  { id: 'fog', icon: '🌫️', label: 'Fog' },
  { id: 'ice', icon: '❄️', label: 'Ice' },
  { id: 'storm', icon: '⛈️', label: 'Storm' },
];

const SPEED_OPTIONS = [0.5, 1, 2, 4];

const OVERLAY_OPTIONS = [
  { id: 'heatmap', label: 'Congestion Heatmap' },
  { id: 'aiDecisions', label: 'AI Decision Pulses' },
  { id: 'vehicleRoutes', label: 'Vehicle Routes' },
  { id: 'pedestrianPaths', label: 'Pedestrian Paths' },
  { id: 'zoneColors', label: 'Zone Colors' },
];

export default function Sidebar({
  setSimSpeed, setSpawnRate, setWeather, setTimeOfDay,
  changeScenario, triggerAccident, setOverlay,
}) {
  const simSpeed = useSimStore(s => s.simSpeed);
  const weather = useSimStore(s => s.weather);
  const vehicleCount = useSimStore(s => s.vehicleCount);
  const avgWaitTime = useSimStore(s => s.avgWaitTime);
  const throughput = useSimStore(s => s.throughput);
  const overlays = useUIStore(s => s.overlays);
  const [spawnVal, setSpawnVal] = useState(1.0);
  const [timeVal, setTimeVal] = useState(8);
  const [selectedScenario, setSelectedScenario] = useState('bengaluru');

  const waitColor = avgWaitTime < 10 ? 'green' : avgWaitTime < 30 ? 'amber' : 'red';

  // AI Efficiency (simple heuristic: lower wait = better)
  const efficiency = Math.max(0, Math.min(100, Math.round(100 - avgWaitTime * 2)));

  return (
    <div className="sidebar">
      {/* Section 1: Live KPIs */}
      <div className="panel-section">
        <div className="panel-section__title">Live Metrics</div>
        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-card__label">Vehicles</span>
            <span className="metric-card__value">{vehicleCount}</span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">Avg Wait</span>
            <span className={`metric-card__value metric-card__value--${waitColor}`}>
              {avgWaitTime.toFixed(1)}s
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">Throughput</span>
            <span className="metric-card__value metric-card__value--blue">
              {Math.round(throughput)}/m
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">AI Score</span>
            <span className={`metric-card__value metric-card__value--${efficiency > 70 ? 'green' : efficiency > 40 ? 'amber' : 'red'}`}>
              {efficiency}
            </span>
          </div>
        </div>
      </div>

      {/* Section 2: Controls */}
      <div className="panel-section">
        <div className="panel-section__title">City Controls</div>

        <div className="control-row">
          <span className="control-row__label">Time of Day</span>
          <span className="control-row__value">{Math.floor(timeVal)}:00</span>
        </div>
        <input
          type="range" className="range-slider" min="0" max="23" step="0.5"
          value={timeVal}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setTimeVal(v);
            setTimeOfDay(v);
          }}
        />

        <div className="control-row">
          <span className="control-row__label">Sim Speed</span>
        </div>
        <div className="speed-buttons">
          {SPEED_OPTIONS.map(s => (
            <button key={s}
              className={`speed-btn ${simSpeed === s ? 'speed-btn--active' : ''}`}
              onClick={() => setSimSpeed(s)}
            >{s}×</button>
          ))}
        </div>

        <div className="control-row" style={{ marginTop: 8 }}>
          <span className="control-row__label">Spawn Rate</span>
          <span className="control-row__value">{spawnVal.toFixed(1)}/s</span>
        </div>
        <input
          type="range" className="range-slider" min="0.1" max="3" step="0.1"
          value={spawnVal}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setSpawnVal(v);
            setSpawnRate(v);
          }}
        />

        <div className="control-row" style={{ marginTop: 8 }}>
          <span className="control-row__label">Weather</span>
        </div>
        <div className="weather-grid">
          {WEATHER_OPTIONS.map(w => (
            <button key={w.id}
              className={`weather-btn ${weather === w.id ? 'weather-btn--active' : ''}`}
              onClick={() => setWeather(w.id)}
            >
              {w.icon}
              <span>{w.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Section 3: Scenarios */}
      <div className="panel-section">
        <div className="panel-section__title">Scenarios</div>
        <select className="scenario-select" value={selectedScenario}
          onChange={(e) => setSelectedScenario(e.target.value)}
        >
          {Object.entries(SCENARIOS).map(([id, s]) => (
            <option key={id} value={id}>{s.name}</option>
          ))}
        </select>
        <button className="scenario-btn" onClick={() => changeScenario(selectedScenario)}>
          Load Scenario
        </button>
        <button className="scenario-btn" style={{ marginTop: 4 }}
          onClick={() => triggerAccident('major')}>
          Trigger Incident
        </button>
      </div>

      {/* Section 4: Overlays */}
      <div className="panel-section">
        <div className="panel-section__title">Overlays</div>
        <div className="toggle-list">
          {OVERLAY_OPTIONS.map(o => (
            <label key={o.id} className="toggle-item">
              <input type="checkbox"
                checked={overlays[o.id] || false}
                onChange={(e) => setOverlay(o.id, e.target.checked)}
              />
              <span className="toggle-item__label">{o.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
