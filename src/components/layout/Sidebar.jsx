import React, { useState } from 'react';
import { useSimStore } from '../../store/simStore.js';
import { useUIStore } from '../../store/uiStore.js';
import { SCENARIOS } from '../../city/CityLoader.js';
import TrafficPolicePanel from './TrafficPolicePanel.jsx';
import MetricsDashboard from './MetricsDashboard.jsx';

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
  { id: 'zoneColors', label: 'Zone Colors' },
  { id: 'sensorCones', label: 'Virtual Sensor Cones' },
];

export default function Sidebar({
  setSimSpeed, setSpawnRate, setWeather, setTimeOfDay, setTimeLocked,
  changeScenario, triggerAccident, setOverlay, togglePause, restartSim,
}) {
  const simSpeed = useSimStore(s => s.simSpeed);
  const weather = useSimStore(s => s.weather);
  const running = useSimStore(s => s.running);
  const timeOfDay = useSimStore(s => s.timeOfDay);
  const timeLocked = useSimStore(s => s.timeLocked);
  const overlays = useUIStore(s => s.overlays);

  const [spawnVal, setSpawnVal] = useState(1.0);
  const [selectedScenario, setSelectedScenario] = useState('bengaluru_central');

  const currentHour = typeof timeOfDay === 'number' ? timeOfDay : 8;
  const hours = Math.floor(currentHour);
  const minutes = Math.floor((currentHour - hours) * 60);
  const timeFormatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return (
    <div className="sidebar">
      <TrafficPolicePanel />
      <MetricsDashboard />

      {/* Section 2: Controls */}
      <div className="panel-section">
        <div className="panel-section__title">City Controls</div>

        <div className="control-row" style={{ display: 'flex', alignItems: 'center' }}>
          <span className="control-row__label">Time of Day</span>
          <span className="control-row__value" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {timeFormatted}
          </span>
          <button
            onClick={() => setTimeLocked(!timeLocked, currentHour)}
            style={{
              marginLeft: 'auto',
              padding: '2px 6px',
              fontSize: 9,
              borderRadius: 3,
              fontWeight: 700,
              cursor: 'pointer',
              border: timeLocked ? '1px solid #FFB400' : '1px solid rgba(255, 255, 255, 0.15)',
              background: timeLocked ? 'rgba(255, 180, 0, 0.15)' : 'transparent',
              color: timeLocked ? '#FFB400' : 'var(--text-tertiary)',
            }}
            title={timeLocked ? 'Time is locked. Click to let time move naturally' : 'Click to lock time'}
          >
            {timeLocked ? '🔒 LOCKED' : '🔓 AUTO'}
          </button>
        </div>
        <input
          type="range" className="range-slider" min="0" max="23.95" step="0.25"
          value={currentHour}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setTimeOfDay(v);
          }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 4, marginBottom: 8 }}>
          {[
            { label: '08:30', h: 8.5 },
            { label: '13:00', h: 13.0 },
            { label: '18:00', h: 18.0 },
            { label: '22:00', h: 22.0 },
          ].map(p => (
            <button
              key={p.h}
              onClick={() => {
                setTimeOfDay(p.h);
              }}
              style={{
                fontSize: 9,
                padding: '2px 0',
                background: Math.abs(currentHour - p.h) < 0.3 ? 'rgba(61, 158, 255, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                border: Math.abs(currentHour - p.h) < 0.3 ? '1px solid #3D9EFF' : '1px solid rgba(255, 255, 255, 0.08)',
                color: Math.abs(currentHour - p.h) < 0.3 ? '#3D9EFF' : 'var(--text-secondary)',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="control-row" style={{ display: 'flex', alignItems: 'center' }}>
          <span className="control-row__label">Simulation</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button 
              className="speed-btn" 
              style={{ 
                background: running ? 'rgba(255, 180, 0, 0.15)' : 'rgba(0, 232, 122, 0.15)',
                color: running ? '#FFB400' : '#00E87A',
                border: running ? '1px solid rgba(255, 180, 0, 0.35)' : '1px solid rgba(0, 232, 122, 0.35)',
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 3,
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onClick={togglePause}
              title={running ? 'Pause simulation' : 'Resume simulation'}
            >
              {running ? '⏸ PAUSE' : '▶ RESUME'}
            </button>
            <button 
              className="speed-btn" 
              style={{ 
                background: 'rgba(61, 158, 255, 0.15)',
                color: '#3D9EFF',
                border: '1px solid rgba(61, 158, 255, 0.35)',
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 3,
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onClick={restartSim}
              title="Restart simulation"
            >
              🔄 RESTART
            </button>
          </div>
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
