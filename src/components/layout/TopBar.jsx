import React, { useState, useRef, useEffect } from 'react';
import { useSimStore } from '../../store/simStore.js';
import { formatTime } from '../../utils/statistics.js';
import { SCENARIOS } from '../../city/CityLoader.js';

const WEATHER_ICONS = {
  clear: '☀️', light_rain: '🌦️', heavy_rain: '🌧️',
  fog: '🌫️', ice: '❄️', storm: '⛈️',
};

const TIME_PRESETS = [
  { label: 'Morning Peak', hour: 8.5, icon: '🌅' },
  { label: 'Midday', hour: 13.0, icon: '☀️' },
  { label: 'Evening Peak', hour: 18.0, icon: '🌆' },
  { label: 'Night', hour: 22.0, icon: '🌙' },
];

export default function TopBar({ setTimeOfDay, setTimeLocked, togglePause, restartSim }) {
  const timeOfDay = useSimStore(s => s.timeOfDay);
  const timeLocked = useSimStore(s => s.timeLocked);
  const weather = useSimStore(s => s.weather);
  const scenario = useSimStore(s => s.scenario);
  const simSpeed = useSimStore(s => s.simSpeed);
  const running = useSimStore(s => s.running);

  const [showTimeModal, setShowTimeModal] = useState(false);
  const modalRef = useRef(null);

  // Close modal when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        setShowTimeModal(false);
      }
    }
    if (showTimeModal) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTimeModal]);

  return (
    <div className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo">◆ Sanchar</span>
        <div className="topbar__divider" />
        <span className="topbar__tagline">Digital Twin</span>
      </div>

      <div className="topbar__info">
        <div className="topbar__info-item">
          <span className="label">Sector</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{SCENARIOS[scenario]?.name || 'Bengaluru Central'}</span>
        </div>

        <div className="topbar__divider" />

        {/* Interactive Manual Time Controller */}
        <div 
          className="topbar__info-item topbar__info-item--interactive"
          style={{ position: 'relative', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, background: showTimeModal ? 'rgba(61, 158, 255, 0.15)' : 'transparent' }}
          onClick={() => setShowTimeModal(!showTimeModal)}
          title="Click to manually adjust Time of Day"
        >
          <span className="label">Time</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span>{timeOfDay >= 6 && timeOfDay < 18 ? '☀️' : '🌙'}</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{formatTime(timeOfDay)}</span>
            {timeLocked && <span style={{ fontSize: 9, color: '#FFB400' }}>[LOCKED]</span>}
            <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
          </span>

          {showTimeModal && (
            <div 
              ref={modalRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 8,
                background: 'rgba(17, 20, 25, 0.96)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 6,
                padding: '12px 14px',
                zIndex: 99999,
                width: 250,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#FFFFFF' }}>MANUAL TIME CONTROL</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#3D9EFF', fontWeight: 600 }}>
                  {formatTime(timeOfDay)}
                </span>
              </div>

              {/* Slider */}
              <input
                type="range"
                className="range-slider"
                min="0"
                max="23.9"
                step="0.25"
                value={timeOfDay}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (setTimeOfDay) setTimeOfDay(val);
                }}
                style={{ width: '100%', cursor: 'pointer' }}
              />

              {/* Quick Presets */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {TIME_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      if (setTimeOfDay) setTimeOfDay(p.hour);
                    }}
                    style={{
                      background: Math.abs(timeOfDay - p.hour) < 0.5 ? 'rgba(61, 158, 255, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#E8EAED',
                      fontSize: 10,
                      padding: '4px 6px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>

              {/* Lock Toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Time Progression:</span>
                <button
                  onClick={() => {
                    if (setTimeLocked) setTimeLocked(!timeLocked, timeOfDay);
                  }}
                  style={{
                    background: timeLocked ? 'rgba(255, 180, 0, 0.2)' : 'rgba(0, 232, 122, 0.15)',
                    border: `1px solid ${timeLocked ? '#FFB400' : '#00E87A'}`,
                    color: timeLocked ? '#FFB400' : '#00E87A',
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {timeLocked ? '🔒 Fixed (Locked)' : '⏱️ Moving Smoothly'}
                </button>
              </div>
            </div>
          )}
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

        {/* Primary Simulation Controls: Pause & Restart */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={togglePause}
            title={running ? 'Pause Simulation' : 'Resume Simulation'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 9px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              border: running ? '1px solid rgba(255, 180, 0, 0.45)' : '1px solid rgba(0, 232, 122, 0.55)',
              background: running ? 'rgba(255, 180, 0, 0.14)' : 'rgba(0, 232, 122, 0.16)',
              color: running ? '#FFB400' : '#00E87A',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{running ? '⏸' : '▶'}</span>
            <span>{running ? 'PAUSE' : 'RESUME'}</span>
          </button>

          <button
            onClick={restartSim}
            title="Restart simulation (re-clear and re-populate all vehicles, signals, and metrics)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 9px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              border: '1px solid rgba(61, 158, 255, 0.4)',
              background: 'rgba(61, 158, 255, 0.12)',
              color: '#3D9EFF',
              transition: 'all 0.15s ease',
            }}
          >
            <span>🔄</span>
            <span>RESTART</span>
          </button>
        </div>

        <div className="topbar__divider" />
        <div className="topbar__status">
          <span className="topbar__status-dot" style={{ background: running ? '#00E87A' : '#FFB400' }} />
          <span>{running ? 'LIVE' : 'PAUSED'}</span>
        </div>
      </div>
    </div>
  );
}
