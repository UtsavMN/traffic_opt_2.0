import React from 'react';
import { useSimStore } from '../../store/simStore.js';
import { formatTime } from '../../utils/statistics.js';

const WEATHER_ICONS = {
  clear: '☀️', light_rain: '🌦️', heavy_rain: '🌧️',
  fog: '🌫️', ice: '❄️', storm: '⛈️',
};

export default function TopBar() {
  const timeOfDay = useSimStore(s => s.timeOfDay);
  const weather = useSimStore(s => s.weather);
  const scenario = useSimStore(s => s.scenario);
  const simSpeed = useSimStore(s => s.simSpeed);

  return (
    <div className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo">◆ Zenith</span>
        <div className="topbar__divider" />
        <span className="topbar__tagline">Digital Twin</span>
      </div>

      <div className="topbar__info">
        <div className="topbar__info-item">
          <span className="label">City</span>
          <span>{scenario === 'bengaluru_central' ? 'Bengaluru Central' : scenario.replace('bengaluru_', 'Bengaluru ').replace(/^\w/, c => c.toUpperCase())}</span>
        </div>
        <div className="topbar__divider" />
        <div className="topbar__info-item">
          <span className="label">Time</span>
          <span>{formatTime(timeOfDay)}</span>
        </div>
        <div className="topbar__divider" />
        <div className="topbar__info-item">
          <span>{WEATHER_ICONS[weather] || '☀️'}</span>
          <span>{weather.replace('_', ' ')}</span>
        </div>
        <div className="topbar__divider" />
        <div className="topbar__info-item">
          <span className="label">Speed</span>
          <span>{simSpeed}×</span>
        </div>
        <div className="topbar__divider" />
        <div className="topbar__status">
          <span className="topbar__status-dot" />
          <span>LIVE</span>
        </div>
      </div>
    </div>
  );
}
