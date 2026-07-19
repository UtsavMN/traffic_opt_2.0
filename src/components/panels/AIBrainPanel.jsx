import React, { useState, useEffect } from 'react';
import { useAIStore } from '../../store/aiStore.js';
import { useUIStore } from '../../store/uiStore.js';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

const ACTION_LABELS = {
  'KEEP_NS_GREEN': 'KEEP_NS',
  'SWITCH_TO_NS_GREEN': 'NS_GREEN',
  'SWITCH_TO_EW_GREEN': 'EW_GREEN',
  'EXTEND_NS_5S': 'EXT_NS_5s',
  'EXTEND_EW_5S': 'EXT_EW_5s',
  'EMERGENCY_OVERRIDE_NS': 'EMRG_NS',
  'EMERGENCY_OVERRIDE_EW': 'EMRG_EW',
  'PEDESTRIAN_SCRAMBLE': 'PED_SCRAM',
  'EMRG_PREEMPT': 'EMRG_PRE',
  'SWITCH_TO_EW': 'SW_EW',
  'SWITCH_TO_NS': 'SW_NS',
  'FORCE_SWITCH': 'FORCE_SW'
};

export default function AIBrainPanel({ getIntersectionData }) {
  const mode = useAIStore(s => s.mode);
  const rewardHistory = useAIStore(s => s.rewardHistory);
  const decisions = useAIStore(s => s.decisions);
  const trainingSteps = useAIStore(s => s.trainingSteps);
  const replaySize = useAIStore(s => s.replaySize);
  const epsilon = useAIStore(s => s.epsilon);
  const selectedId = useUIStore(s => s.selectedIntersection);
  const [intData, setIntData] = useState(null);

  // Poll intersection data
  useEffect(() => {
    if (!selectedId || !getIntersectionData) { setIntData(null); return; }
    // Immediate fetch
    const data = getIntersectionData(selectedId);
    setIntData(data);
    // Continue polling
    const interval = setInterval(() => {
      setIntData(getIntersectionData(selectedId));
    }, 100);
    return () => clearInterval(interval);
  }, [selectedId, getIntersectionData]);

  const avgReward = rewardHistory.length > 0
    ? (rewardHistory.slice(-100).reduce((a, b) => a + b, 0) / Math.min(100, rewardHistory.length))
    : 0;

  const mapRewardToScore = (r) => {
    // Maps raw negative reward (typically 0 to -250) to a positive 0-100 score
    return Math.round(Math.max(0, 100 - Math.min(100, Math.abs(r) * 0.45)) * 10) / 10;
  };

  const avgRewardScore = mapRewardToScore(avgReward);
  const chartData = rewardHistory.slice(-200).map((v, i) => ({ i, v: mapRewardToScore(v) }));

  return (
    <div className="ai-panel">
      {/* AI Status */}
      <div className="panel-section">
        <div className="panel-section__title">AI Engine</div>
        <div className="ai-mode-steps">
          <div 
            className={`ai-mode-step ${mode === 'ADAPTIVE' ? 'ai-mode-step--active' : 'ai-mode-step--completed'}`}
            style={{ cursor: 'pointer' }}
            onClick={() => useAIStore.getState().setMode('ADAPTIVE')}
          >
            Adaptive
          </div>
          <div 
            className={`ai-mode-step ${mode === 'RL_SHADOW' ? 'ai-mode-step--active' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => useAIStore.getState().setMode('RL_SHADOW')}
          >
            RL Shadow
          </div>
          <div 
            className={`ai-mode-step ${mode === 'RL_ACTIVE' ? 'ai-mode-step--active' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => useAIStore.getState().setMode('RL_ACTIVE')}
          >
            RL Active
          </div>
        </div>

        <div className="reward-stat">
          <span className={`reward-stat__value ${avgRewardScore >= 50 ? 'text-green' : 'text-red'}`}>
            {avgRewardScore.toFixed(1)}%
          </span>
          <span className="reward-stat__label">Flow Performance (100)</span>
        </div>

        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-tertiary)' }}>
          <span>Steps: <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{trainingSteps}</span></span>
          <span>Buffer: <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{replaySize}</span></span>
          <span>ε: <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{epsilon.toFixed(3)}</span></span>
        </div>
      </div>

      {/* Reward Curve */}
      <div className="panel-section">
        <div className="panel-section__title">Reward Curve</div>
        <div className="sparkline-container">
          {chartData.length > 2 ? (
            <ResponsiveContainer width="100%" height={60}>
              <LineChart data={chartData}>
                <YAxis hide domain={['auto', 'auto']} />
                <Line type="monotone" dataKey="v" stroke="#9B6FFF" strokeWidth={1.5}
                  dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-tertiary)', fontSize: 10 }}>
              Collecting data...
            </div>
          )}
        </div>
      </div>

      {/* Recent Decisions */}
      <div className="panel-section">
        <div className="panel-section__title">Recent Decisions</div>
        <div className="decision-log">
          {decisions.slice().reverse().slice(0, 10).map((d, i) => (
            <div key={i} className="decision-entry animate-fade-in">
              <span className="decision-entry__time">
                {new Date(d.time).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="decision-entry__action">
                #{d.intersectionId} {ACTION_LABELS[d.action] || d.action}
              </span>
              <span className={`decision-entry__reward ${(d.reward || 0) >= 0 ? 'decision-entry__reward--positive' : 'decision-entry__reward--negative'}`}>
                {(d.reward || 0) >= 0 ? '+' : ''}{(d.reward || 0).toFixed(1)}
              </span>
            </div>
          ))}
          {decisions.length === 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', padding: 8, textAlign: 'center' }}>
              Waiting for AI decisions...
            </div>
          )}
        </div>
      </div>

      {/* Intersection Detail */}
      {intData && (
        <div className="panel-section animate-slide-in">
          <div className="panel-section__title">Intersection #{intData.id}</div>

          {/* Phase Timer */}
          <div className="phase-timer">
            <div className="phase-timer__circle">
              <svg viewBox="0 0 36 36">
                <circle className="phase-timer__circle-bg" cx="18" cy="18" r="16" />
                <circle className="phase-timer__circle-progress" cx="18" cy="18" r="16"
                  stroke={intData.phase.includes('GREEN') ? '#00E87A' : intData.phase.includes('YELLOW') ? '#FFB400' : '#FF3B5C'}
                  strokeDasharray={`${intData.phaseProgress * 100} 100`}
                />
              </svg>
            </div>
            <div className="phase-timer__info">
              <span className="phase-timer__phase">{intData.phase}</span>
              <span className="phase-timer__remaining">
                {intData.remaining > 1000 
                  ? `${(intData.timeInPhase || 0).toFixed(1)}s elapsed (AI)`
                  : `${intData.remaining.toFixed(1)}s remaining`}
              </span>
            </div>
          </div>

          {/* Queue Bars */}
          <div className="queue-bars">
            {['N', 'S', 'E', 'W'].map(dir => {
              const q = intData.queues[dir] || 0;
              const pct = Math.min(100, (q / 15) * 100);
              const cls = q > 10 ? 'queue-bar__fill--high' : q > 5 ? 'queue-bar__fill--medium' : '';
              return (
                <div key={dir} className="queue-bar">
                  <span className="queue-bar__label">{dir}</span>
                  <div className="queue-bar__track">
                    <div className={`queue-bar__fill ${cls}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="queue-bar__count">{q}</span>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-tertiary)' }}>
            Pedestrians waiting: {intData.pedestriansWaiting}
          </div>
        </div>
      )}
    </div>
  );
}
