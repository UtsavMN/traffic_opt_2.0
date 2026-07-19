import React from 'react';
import { useSimStore } from '../../store/simStore.js';
import { useMetricsStore } from '../../store/metricsStore.js';

function getKPIColor(value, thresholds, dir) {
  if (dir === 'lower') return value < thresholds[0] ? '#00E87A' : value < thresholds[2] ? '#FFB400' : '#FF3B5C';
  if (dir === 'higher') return value > thresholds[2] ? '#00E87A' : value > thresholds[1] ? '#FFB400' : '#FF3B5C';
  if (dir === 'range') return (value >= thresholds[1] && value <= thresholds[2]) ? '#00E87A' : '#FFB400';
  return '#E8EAED';
}

export default function MetricsDashboard() {
  const vehicleCount = useSimStore(s => s.vehicleCount);

  // Metrics from metricsStore
  const avgWaitTime = useMetricsStore(s => s.avgWaitTime);
  const throughput = useMetricsStore(s => s.throughput);
  const greenEfficiency = useMetricsStore(s => s.greenEfficiency);
  const imbalance = useMetricsStore(s => s.imbalance);
  const aiDecisionsPerMin = useMetricsStore(s => s.aiDecisionsPerMin);
  const optimizationScore = useMetricsStore(s => s.optimizationScore);

  const congestionLevel = useMetricsStore(s => s.congestionLevel);
  const avgSpeedKmh = useMetricsStore(s => s.avgSpeedKmh);

  const timeSaved = useMetricsStore(s => s.timeSaved);

  const optColor = optimizationScore > 75 ? '#00E87A' : optimizationScore > 45 ? '#FFB400' : '#FF3B5C';

  return (
    <>
      {/* Section 0: Optimization Score */}
      <div className="panel-section" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="panel-section__title">OPTIMIZATION SCORE</div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '8px 0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ fontSize: 36, fontFamily: '"DM Mono", monospace', fontWeight: 700, color: optColor }}>
              {optimizationScore}
            </span>
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginLeft: 2 }}>/100</span>
          </div>
        </div>
        <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: `${optimizationScore}%`,
            height: '100%',
            borderRadius: 3,
            background: optColor,
            transition: 'width 1s ease, background 0.5s ease',
            boxShadow: `0 0 8px ${optColor}`,
          }}/>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 9, color: '#FF3B5C' }}>0 — broken</span>
          <span style={{ fontSize: 9, color: '#FFB400' }}>55 — working</span>
          <span style={{ fontSize: 9, color: '#00E87A' }}>90 — optimal</span>
        </div>
      </div>

      {/* Section 0.5: Time Saved Benchmark */}
      <div className="panel-section" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0, 232, 122, 0.03)', padding: '12px 14px', borderRadius: 6, margin: '8px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>TIME SAVED / VEHICLE</span>
          <span style={{ fontSize: 8, background: 'rgba(0, 232, 122, 0.15)', color: '#00E87A', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>VS. STATIC BASELINE</span>
        </div>
        <div style={{ fontSize: 24, fontFamily: '"DM Mono", monospace', fontWeight: 700, color: '#00E87A', marginTop: 4 }}>
          +{timeSaved.toFixed(1)}s <span style={{ fontSize: 11, fontWeight: 400, color: 'rgba(255,255,255,0.6)' }}>saved avg</span>
        </div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
          Dynamic coordination vs. traditional fixed-time cycles (120s–150s).
        </div>
      </div>

      {/* Section 1: 6 KPI Dashboard */}
      <div className="panel-section">
        <div className="panel-section__title">Live Metrics</div>
        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-card__label">AVG WAIT</span>
            <span className="metric-card__value" style={{ color: getKPIColor(avgWaitTime, [15, 30, 45], 'lower') }}>
              {avgWaitTime.toFixed(1)}s
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">THROUGHPUT</span>
            <span className="metric-card__value" style={{ color: getKPIColor(throughput, [10, 20, 30], 'higher') }}>
              {throughput}/min
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">GREEN EFF</span>
            <span className="metric-card__value" style={{ color: getKPIColor(greenEfficiency, [60, 75, 85], 'higher') }}>
              {greenEfficiency.toFixed(0)}%
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">IMBALANCE</span>
            <span className="metric-card__value" style={{ color: getKPIColor(imbalance, [10, 25, 40], 'lower') }}>
              {imbalance.toFixed(0)}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">AI DECISIONS</span>
            <span className="metric-card__value" style={{ color: getKPIColor(aiDecisionsPerMin, [10, 20, 80], 'range') }}>
              {aiDecisionsPerMin}/min
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">CONGESTION</span>
            <span className="metric-card__value" style={{ color: getKPIColor(congestionLevel, [30, 50, 70], 'lower') }}>
              {congestionLevel.toFixed(0)}%
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">AVG SPEED</span>
            <span className="metric-card__value" style={{ color: getKPIColor(avgSpeedKmh, [12, 18, 28], 'higher') }}>
              {avgSpeedKmh.toFixed(1)} km/h
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">VEHICLES</span>
            <span className="metric-card__value" style={{ color: '#3D9EFF' }}>
              {vehicleCount}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
