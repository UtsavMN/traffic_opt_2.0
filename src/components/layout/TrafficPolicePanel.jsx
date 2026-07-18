import React from 'react';
import { useSimStore } from '../../store/simStore.js';

export default function TrafficPolicePanel() {
  const policeCount = useSimStore(s => s.policeCount);

  if (policeCount === 0) return null;

  return (
    <div className="panel-section" style={{ border: '1px solid #FF3B5C', background: 'rgba(255, 59, 92, 0.05)' }}>
      <div className="panel-section__title" style={{ color: '#FF3B5C' }}>
        🚨 ACTIVE INCIDENTS
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%', background: 'rgba(0, 102, 255, 0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #0066FF'
        }}>
          🚓
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{policeCount} Police Unit{policeCount > 1 ? 's' : ''} Deployed</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Resolving deadlocks...</div>
        </div>
      </div>
    </div>
  );
}
