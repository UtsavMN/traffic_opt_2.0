import React from 'react';
import { useSimStore } from '../../store/simStore.js';

export default function StatusBar() {
  const vehicleCount = useSimStore(s => s.vehicleCount);
  const avgWaitTime = useSimStore(s => s.avgWaitTime);
  const throughput = useSimStore(s => s.throughput);
  const pedestrianCount = useSimStore(s => s.pedestrianCount);
  const cyclistCount = useSimStore(s => s.cyclistCount);
  const fps = useSimStore(s => s.fps);
  const intersectionCount = useSimStore(s => s.intersectionCount);

  return (
    <div className="statusbar">
      <div className="statusbar__metrics">
        <div className="statusbar__metric">
          <span className="statusbar__metric-dot" style={{ background: '#3D9EFF' }} />
          <span className="statusbar__metric-label">Vehicles</span>
          <span className="statusbar__metric-value">{vehicleCount}</span>
        </div>
        <div className="statusbar__metric">
          <span className="statusbar__metric-dot" style={{ background: '#9B6FFF' }} />
          <span className="statusbar__metric-label">Pedestrians</span>
          <span className="statusbar__metric-value">{pedestrianCount}</span>
        </div>
        <div className="statusbar__metric">
          <span className="statusbar__metric-dot" style={{ background: '#6FCF97' }} />
          <span className="statusbar__metric-label">Cyclists</span>
          <span className="statusbar__metric-value">{cyclistCount}</span>
        </div>
        <div className="statusbar__metric">
          <span className="statusbar__metric-dot" style={{ background: avgWaitTime < 10 ? '#00E87A' : avgWaitTime < 30 ? '#FFB400' : '#FF3B5C' }} />
          <span className="statusbar__metric-label">Avg Wait</span>
          <span className="statusbar__metric-value">{avgWaitTime.toFixed(1)}s</span>
        </div>
        <div className="statusbar__metric">
          <span className="statusbar__metric-dot" style={{ background: '#00E87A' }} />
          <span className="statusbar__metric-label">Throughput</span>
          <span className="statusbar__metric-value">{Math.round(throughput)}/min</span>
        </div>
        <div className="statusbar__metric">
          <span className="statusbar__metric-label">Intersections</span>
          <span className="statusbar__metric-value">{intersectionCount}</span>
        </div>
      </div>
      <div className="statusbar__right">
        <span className="statusbar__fps">{fps} FPS</span>
      </div>
    </div>
  );
}
