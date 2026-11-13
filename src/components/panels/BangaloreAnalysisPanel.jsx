import React, { useState, useEffect } from 'react';
import { useSimStore } from '../../store/simStore.js';
import { computeBangaloreAnalytics } from '../../analysis/BangaloreAreaAnalysis.js';
import { SCENARIOS } from '../../city/CityLoader.js';

export default function BangaloreAnalysisPanel() {
  const scenario = useSimStore(s => s.scenario);
  const [data, setData] = useState(null);

  useEffect(() => {
    const update = () => {
      const engine = window.__sancharEngine || window.__trafficOptEngine;
      if (engine) {
        const res = computeBangaloreAnalytics(engine, scenario);
        if (res) setData(res);
      }
    };

    update();
    const interval = setInterval(update, 500); // 2Hz refresh
    return () => clearInterval(interval);
  }, [scenario]);

  if (!data) {
    return (
      <div className="panel-section" style={{ padding: '12px', color: 'var(--text-tertiary)', fontSize: 10 }}>
        Initializing Bengaluru mobility analytics...
      </div>
    );
  }

  const scenarioMeta = SCENARIOS[scenario] || {
    name: 'Bengaluru Central',
    description: 'Central Bangalore Metropolitan Corridor'
  };

  const bciColor = data.bciIndex > 65 ? '#FF3B5C' : (data.bciIndex > 40 ? '#FFB400' : '#00E87A');

  return (
    <div className="bangalore-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Area Header Card */}
      <div className="panel-section" style={{ background: 'rgba(155, 111, 255, 0.05)', border: '1px solid rgba(155, 111, 255, 0.2)', padding: '10px 12px', borderRadius: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-display)', color: 'var(--signal-purple)', fontWeight: 700, letterSpacing: '0.06em' }}>
            BENGALURU SECTOR TWIN
          </span>
          <span style={{ fontSize: 8, background: 'rgba(155, 111, 255, 0.2)', color: '#bfa4ff', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
            LIVE GPS & GIS
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
          {scenarioMeta.name}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.3 }}>
          {scenarioMeta.description}
        </div>
      </div>

      {/* Congestion Index & 10km Travel Time Benchmark */}
      <div className="panel-section" style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="panel-section__title" style={{ margin: 0 }}>BENGALURU CONGESTION (BCI)</span>
          <span style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 700, color: bciColor }}>
            {data.bciIndex}%
          </span>
        </div>
        
        {/* Progress bar */}
        <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', margin: '6px 0' }}>
          <div style={{ width: `${data.bciIndex}%`, height: '100%', background: bciColor, transition: 'width 0.4s ease' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>AVG VELOCITY</div>
            <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {data.avgSpeedKmh} <span style={{ fontSize: 9 }}>km/h</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>TIME / 10 KM</div>
            <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#00E87A' }}>
              {data.timePer10KmMin}m <span style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>(saved {data.timeSavedPer10KmMin}m)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Road Hierarchy Composition (Highways vs Avenues vs Crosses) */}
      <div className="panel-section" style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="panel-section__title" style={{ margin: 0 }}>ROAD HIERARCHY RATIO</span>
          <span style={{ fontSize: 8.5, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {data.roadHierarchy.totalKm} km network
          </span>
        </div>

        {/* Multi-tier visual stacked bar */}
        <div style={{ display: 'flex', height: 6, width: '100%', borderRadius: 3, overflow: 'hidden', margin: '4px 0 8px 0', background: 'rgba(255,255,255,0.05)' }}>
          <div style={{ width: `${data.roadHierarchy.arterial.pct}%`, background: '#9B6FFF' }} title={`Arterials/Flyovers: ${data.roadHierarchy.arterial.pct}%`} />
          <div style={{ width: `${data.roadHierarchy.main.pct}%`, background: '#3D9EFF' }} title={`Commercial Main Roads: ${data.roadHierarchy.main.pct}%`} />
          <div style={{ width: `${data.roadHierarchy.cross.pct}%`, background: '#00E87A' }} title={`Residential Cross Roads: ${data.roadHierarchy.cross.pct}%`} />
          <div style={{ width: `${data.roadHierarchy.gully.pct}%`, background: '#8B8F98' }} title={`Narrow Gullies: ${data.roadHierarchy.gully.pct}%`} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 8.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#9B6FFF', display: 'inline-block' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Arterials/Flyovers:</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{data.roadHierarchy.arterial.pct}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3D9EFF', display: 'inline-block' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Commercial Aves:</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{data.roadHierarchy.main.pct}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00E87A', display: 'inline-block' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Residential Crosses:</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{data.roadHierarchy.cross.pct}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8B8F98', display: 'inline-block' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Alleys / Gullies:</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{data.roadHierarchy.gully.pct}%</span>
          </div>
        </div>
      </div>

      {/* Bengaluru Modal Split Distribution */}
      <div className="panel-section" style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="panel-section__title" style={{ margin: 0 }}>MODAL VEHICLE SHARE</span>
          <span style={{ fontSize: 8.5, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {data.modalSplit.total} active
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 60, padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>🏍️ 2-WHEEL</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#E8EAED' }}>
              {data.modalSplit.motorcycle.pct}%
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 60, padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>🛺 AUTOS</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#FFB400' }}>
              {data.modalSplit.rickshaw.pct}%
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 60, padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>🚗 CARS</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#3D9EFF' }}>
              {data.modalSplit.car.pct}%
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 60, padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>🚌 BMTC BUS</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#00E87A' }}>
              {data.modalSplit.bus.pct}%
            </div>
          </div>
        </div>
      </div>

      {/* Real-Time Bottleneck Choke Point Radar */}
      <div className="panel-section" style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="panel-section__title" style={{ margin: 0 }}>ACTIVE CHOKE POINT RADAR</span>
          <span style={{ fontSize: 8, color: 'var(--signal-purple)', fontWeight: 600 }}>TOP BOTTLENECKS</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.topBottlenecks.map((b, idx) => (
            <div key={b.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', background: 'rgba(255,255,255,0.02)', borderRadius: 4, fontSize: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', fontSize: 8.5 }}>#{idx+1}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
                  {b.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontSize: 8.5 }}>
                  Q: {b.queue} ({b.maxWait}s)
                </span>
                <span style={{
                  fontSize: 7.5,
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: 2,
                  background: b.status === 'CRITICAL' ? 'rgba(255,59,92,0.2)' : (b.status === 'CONGESTED' ? 'rgba(255,180,0,0.2)' : 'rgba(0,232,122,0.15)'),
                  color: b.status === 'CRITICAL' ? '#FF3B5C' : (b.status === 'CONGESTED' ? '#FFB400' : '#00E87A'),
                  border: `1px solid ${b.status === 'CRITICAL' ? 'rgba(255,59,92,0.4)' : (b.status === 'CONGESTED' ? 'rgba(255,180,0,0.4)' : 'rgba(0,232,122,0.3)')}`
                }}>
                  {b.status}
                </span>
              </div>
            </div>
          ))}
          {data.topBottlenecks.length === 0 && (
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textAlign: 'center', padding: 6 }}>
              All corridors operating within capacity.
            </div>
          )}
        </div>
      </div>

      {/* Bangalore Traffic Police (BTP) Live Operational Advisory */}
      <div className="panel-section" style={{ background: 'rgba(61, 158, 255, 0.04)', border: '1px solid rgba(61, 158, 255, 0.25)', padding: '10px 12px', borderRadius: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <span style={{ fontSize: 10 }}>👮‍♂️</span>
          <span style={{ fontSize: 8.5, fontFamily: 'var(--font-display)', color: 'var(--signal-blue)', fontWeight: 700, letterSpacing: '0.05em' }}>
            BTP OPERATIONAL ADVISORY
          </span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
          {data.btpAdvisory}
        </div>
      </div>
    </div>
  );
}
