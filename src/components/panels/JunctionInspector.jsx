import React, { useState, useEffect, useRef } from 'react';
import { useUIStore } from '../../store/uiStore.js';
import { useSimStore } from '../../store/simStore.js';

const DIRECTIONS = ['N', 'S', 'E', 'W'];

const DIR_LABELS = {
  N: 'Northbound Approach',
  S: 'Southbound Approach',
  E: 'Eastbound Approach',
  W: 'Westbound Approach',
};

export default function JunctionInspector() {
  const selectedId = useUIStore(s => s.selectedIntersection);
  const clearSelection = useUIStore(s => s.clearSelection);
  const [intState, setIntState] = useState(null);
  const [activeTab, setActiveTab] = useState('cctv'); // 'cctv' | 'queues' | 'controls'
  const [toastMessage, setToastMessage] = useState(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const canvasRefs = useRef({});

  // Poll junction state at 15Hz
  useEffect(() => {
    if (!selectedId) {
      setIntState(null);
      return;
    }

    const updateData = () => {
      const engine = window.__sancharEngine;
      if (!engine || !engine.intersections) return;
      const int = engine.intersections.get(selectedId);
      if (!int) return;

      const tl = int.trafficLight;
      const approaches = int.approaches || [];
      const numPhases = int.numPhases || 2;
      const activePhase = tl ? tl.currentPhaseIndex : 0;
      const isYellow = tl ? tl.isYellow : false;
      const currentPhaseName = tl ? tl.currentPhase : 'FREE_FLOW';
      const remaining = tl ? tl.remaining : 0;
      const timeInPhase = tl ? tl.timeInPhase : 0;

      // Extract road names
      const roadNames = Array.from(new Set(approaches.map(a => a.roadName).filter(Boolean)));
      const junctionTitle = roadNames.length > 0 
        ? roadNames.slice(0, 2).join(' × ') + (roadNames.length > 2 ? ` (+${roadNames.length - 2} roads)` : '')
        : `Intersection #${int.id}`;

      setIntState({
        id: int.id,
        title: junctionTitle,
        zone: int.zone || 'Commercial Hub',
        lng: int.lng,
        lat: int.lat,
        numApps: approaches.length,
        numPhases,
        activePhase,
        isYellow,
        currentPhaseName,
        remaining,
        timeInPhase,
        totalQueue: int.getTotalQueue ? int.getTotalQueue() : 0,
        policeActive: int.policeActive,
        approaches: approaches.map(a => ({
          id: a.id,
          roadName: a.roadName || 'Arterial Road',
          angleDeg: Math.round(a.angle * 180 / Math.PI),
          phaseIndex: a.phaseIndex,
          queue: a.queue || 0,
          lanes: a.lanes || 2,
          color: int.getLightColorForEdge ? int.getLightColorForEdge(a.edgeId) : (tl ? tl.getColorForPhase(a.phaseIndex) : 'GREEN'),
        })),
        queues: { ...int.queues },
      });
    };

    updateData();
    const interval = setInterval(updateData, 80);
    return () => clearInterval(interval);
  }, [selectedId]);

  // Render simulated CCTV camera canvases
  useEffect(() => {
    if (!intState || activeTab !== 'cctv') return;

    const feeds = [
      { id: 'cam1', label: 'CAM 01', dir: 'North', app: intState.approaches[0] },
      { id: 'cam2', label: 'CAM 02', dir: 'South', app: intState.approaches[1] },
      { id: 'cam3', label: 'CAM 03', dir: 'East', app: intState.approaches[2] },
      { id: 'cam4', label: 'CAM 04', dir: 'West', app: intState.approaches[3] },
    ];

    feeds.forEach((feed, idx) => {
      const canvas = canvasRefs.current[feed.id];
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;

      // Dark asphalt surveillance scene
      ctx.fillStyle = '#0B0F14';
      ctx.fillRect(0, 0, w, h);

      // Road perspective trapezoid
      ctx.fillStyle = '#141A23';
      ctx.beginPath();
      ctx.moveTo(w * 0.28, 0);
      ctx.lineTo(w * 0.72, 0);
      ctx.lineTo(w * 0.88, h);
      ctx.lineTo(w * 0.12, h);
      ctx.fill();

      // Road borders & curbs
      ctx.strokeStyle = '#2A3649';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(w * 0.28, 0);
      ctx.lineTo(w * 0.12, h);
      ctx.moveTo(w * 0.72, 0);
      ctx.lineTo(w * 0.88, h);
      ctx.stroke();

      // Dashed lane divider
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 0);
      ctx.lineTo(w * 0.5, h);
      ctx.stroke();
      ctx.setLineDash([]);

      const app = feed.app;
      const isGreen = app ? app.color === 'GREEN' : (idx % 2 === intState.activePhase);
      const isYellow = app ? app.color === 'YELLOW' : false;
      const signalHex = isGreen ? '#00E87A' : (isYellow ? '#FFB400' : '#FF3B5C');

      // Stop Line Bar
      ctx.strokeStyle = signalHex;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(w * 0.20, h * 0.35);
      ctx.lineTo(w * 0.80, h * 0.35);
      ctx.stroke();

      // Render simulated vehicles in approach queue
      const qCount = app ? app.queue : Math.max(0, (intState.queues[DIRECTIONS[idx]] || 0));
      const vehColors = ['#E2E8F0', '#38BDF8', '#F59E0B', '#EF4444', '#10B981', '#A855F7'];

      const now = performance.now() / 1000;
      const drawVehicles = Math.min(6, qCount + (isGreen ? 1 : 0));

      for (let i = 0; i < drawVehicles; i++) {
        // Position along the lane
        const laneX = (i % 2 === 0 ? w * 0.38 : w * 0.62) + Math.sin(i * 1.5) * 4;
        let basePosY = h * 0.42 + (i * 18);
        if (isGreen) {
          // Animated green flow moving forward
          basePosY = ((basePosY - (now * 25) % (h * 0.6)) + (h * 0.6)) % (h * 0.6) + h * 0.25;
        }

        const vColor = vehColors[(idx + i) % vehColors.length];
        const vW = 12;
        const vH = 18;

        // Vehicle body
        ctx.fillStyle = vColor;
        ctx.beginPath();
        ctx.roundRect(laneX - vW / 2, basePosY - vH / 2, vW, vH, 2);
        ctx.fill();

        // Windshield
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(laneX - vW / 2 + 1.5, basePosY - vH / 2 + 3, vW - 3, 4);

        // AI Computer Vision Object Detection Bounding Box
        ctx.strokeStyle = isGreen ? 'rgba(0, 232, 122, 0.7)' : 'rgba(255, 59, 92, 0.7)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(laneX - vW / 2 - 2, basePosY - vH / 2 - 2, vW + 4, vH + 4);

        // AI Confidence Label
        if (i === 0) {
          ctx.fillStyle = isGreen ? '#00E87A' : '#FF3B5C';
          ctx.font = '6.5px monospace';
          ctx.fillText(`CAR 98%`, laneX - vW / 2 - 2, basePosY - vH / 2 - 4);
        }
      }

      // CCTV HUD Scanlines overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }

      // Vignette effect
      const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.7);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
  }, [intState, activeTab]);

  if (!selectedId || !intState) return null;

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2200);
  };

  const handleSwitchPhase = () => {
    const engine = window.__sancharEngine;
    if (!engine) return;
    const int = engine.intersections.get(selectedId);
    if (!int || !int.trafficLight) return;
    int.trafficLight.triggerYellow();
    showToast('Phase switched — clearance yellow initiated');
  };

  const handleForcePhase = (phaseIdx) => {
    const engine = window.__sancharEngine;
    if (!engine) return;
    const int = engine.intersections.get(selectedId);
    if (!int || !int.trafficLight) return;
    int.trafficLight.forceGreenPhase(phaseIdx);
    showToast(`Corridor Phase ${phaseIdx} forced GREEN`);
  };

  const handleHoldGreen = () => {
    const engine = window.__sancharEngine;
    if (!engine) return;
    const int = engine.intersections.get(selectedId);
    if (!int || !int.trafficLight) return;
    int.trafficLight.setGreenDuration(45);
    showToast('Actuated Green Hold: Extended to 45s');
  };

  const handleEmergencyPreempt = () => {
    const engine = window.__sancharEngine;
    if (!engine) return;
    const int = engine.intersections.get(selectedId);
    if (!int || !int.trafficLight) return;
    int.trafficLight.emergencyOverridePhase = intState.activePhase;
    int.trafficLight.emergencyTimer = 15;
    showToast('🚨 Emergency Siren Preemption locked for 15s');
  };

  const handleResumeAI = () => {
    const engine = window.__sancharEngine;
    if (!engine) return;
    const int = engine.intersections.get(selectedId);
    if (!int || !int.trafficLight) return;
    int.trafficLight.emergencyOverridePhase = null;
    int.trafficLight.emergencyTimer = 0;
    int.policeActive = false;
    int.trafficLight.setGreenDuration(18);
    showToast('🤖 Sanchar AI Autonomous Control Resumed');
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 320,
        width: isMinimized ? 320 : 490,
        maxHeight: isMinimized ? 52 : 'calc(100vh - 120px)',
        background: 'rgba(10, 14, 22, 0.95)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(61, 158, 255, 0.35)',
        borderRadius: 8,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.75), 0 0 20px rgba(61, 158, 255, 0.15)',
        zIndex: 9000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(61, 158, 255, 0.95)',
            color: '#0A0C0F',
            fontWeight: 700,
            fontSize: 11,
            padding: '4px 12px',
            borderRadius: 20,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 9999,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Header Bar */}
      <div
        style={{
          padding: '10px 14px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🚦</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                {intState.title}
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontFamily: 'monospace',
                  background: 'rgba(61, 158, 255, 0.15)',
                  color: '#3D9EFF',
                  padding: '1px 5px',
                  borderRadius: 3,
                  fontWeight: 700,
                }}
              >
                #{intState.id}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.45)', marginTop: 1 }}>
              {intState.numApps} Approaches • {intState.numPhases} Conflict-Free Phases • {intState.zone}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              fontSize: 12,
              cursor: 'pointer',
              padding: '2px 6px',
            }}
            title={isMinimized ? 'Expand Inspector' : 'Minimize Inspector'}
          >
            {isMinimized ? '▢' : '—'}
          </button>
          <button
            onClick={clearSelection}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 4,
              padding: '3px 7px',
            }}
            title="Close Inspector"
          >
            ✕
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Real-time Status Banner */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 14px',
              background: intState.isYellow
                ? 'rgba(255, 180, 0, 0.12)'
                : 'rgba(0, 232, 122, 0.08)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: intState.isYellow ? '#FFB400' : '#00E87A',
                  boxShadow: `0 0 8px ${intState.isYellow ? '#FFB400' : '#00E87A'}`,
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#FFFFFF' }}>
                {intState.isYellow ? 'YELLOW CLEARANCE' : `CORRIDOR PHASE ${intState.activePhase} GREEN`}
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                ({intState.currentPhaseName})
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace', fontSize: 11 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>Countdown:</span>
              <span style={{ fontWeight: 700, color: intState.isYellow ? '#FFB400' : '#00E87A', fontSize: 13 }}>
                {intState.remaining}s
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                ({intState.timeInPhase.toFixed(1)}s elapsed)
              </span>
            </div>
          </div>

          {/* Tab Navigation */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.2)' }}>
            {[
              { id: 'cctv', label: '📹 Live 4-Way CCTV Feeds' },
              { id: 'queues', label: '📊 Queue Backlogs & Splits' },
              { id: 'controls', label: '🎛️ Manual Phase Override' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: '7px 4px',
                  background: activeTab === tab.id ? 'rgba(61, 158, 255, 0.12)' : 'transparent',
                  color: activeTab === tab.id ? '#3D9EFF' : 'rgba(255, 255, 255, 0.5)',
                  border: 'none',
                  borderBottom: activeTab === tab.id ? '2px solid #3D9EFF' : '2px solid transparent',
                  fontSize: 10.5,
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Scrollable Content Body */}
          <div style={{ padding: 14, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* TAB 1: 4-WAY LIVE CCTV FEEDS */}
            {activeTab === 'cctv' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.04em' }}>
                    TACTICAL APPROACH SURVEILLANCE • 1080P HD
                  </span>
                  <span style={{ fontSize: 9, color: '#00E87A', fontFamily: 'monospace' }}>
                    ● 4 CAMERAS SYNCHRONIZED
                  </span>
                </div>

                {/* 2x2 CCTV Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { id: 'cam1', camNum: 'CAM 01', title: 'North / Approach 1', app: intState.approaches[0] },
                    { id: 'cam2', camNum: 'CAM 02', title: 'South / Approach 2', app: intState.approaches[1] },
                    { id: 'cam3', camNum: 'CAM 03', title: 'East / Approach 3', app: intState.approaches[2] },
                    { id: 'cam4', camNum: 'CAM 04', title: 'West / Approach 4', app: intState.approaches[3] },
                  ].map((cam, i) => {
                    const app = cam.app;
                    const color = app ? app.color : (i % 2 === intState.activePhase ? 'GREEN' : 'RED');
                    const isGreen = color === 'GREEN';
                    const isYellow = color === 'YELLOW';
                    const hex = isGreen ? '#00E87A' : (isYellow ? '#FFB400' : '#FF3B5C');

                    return (
                      <div
                        key={cam.id}
                        style={{
                          background: '#0B0F14',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          borderRadius: 6,
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                      >
                        {/* Video Header HUD */}
                        <div
                          style={{
                            padding: '3px 6px',
                            background: 'rgba(0, 0, 0, 0.75)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 8.5,
                            fontFamily: 'monospace',
                            color: 'rgba(255,255,255,0.8)',
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ color: '#FF3B5C', fontSize: 8 }}>●</span>
                            <span style={{ fontWeight: 700 }}>{cam.camNum}</span>
                            <span style={{ opacity: 0.6 }}>•</span>
                            <span style={{ color: '#3D9EFF' }}>{app ? app.roadName.slice(0, 14) : cam.title}</span>
                          </span>
                          <span
                            style={{
                              background: isGreen ? 'rgba(0, 232, 122, 0.2)' : isYellow ? 'rgba(255, 180, 0, 0.2)' : 'rgba(255, 59, 92, 0.2)',
                              color: hex,
                              padding: '1px 4px',
                              borderRadius: 2,
                              fontWeight: 700,
                            }}
                          >
                            {isGreen ? 'GREEN' : isYellow ? 'YELLOW' : 'RED'}
                          </span>
                        </div>

                        {/* Simulated Canvas Stream */}
                        <canvas
                          ref={el => canvasRefs.current[cam.id] = el}
                          width={220}
                          height={125}
                          style={{ width: '100%', height: 110, display: 'block' }}
                        />

                        {/* Bottom HUD metrics */}
                        <div
                          style={{
                            padding: '3px 6px',
                            background: 'rgba(0, 0, 0, 0.75)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 8,
                            fontFamily: 'monospace',
                            color: 'rgba(255,255,255,0.6)',
                          }}
                        >
                          <span>Queue: <strong style={{ color: '#FFFFFF' }}>{app ? app.queue : 0} veh</strong></span>
                          <span>Speed: <strong style={{ color: isGreen ? '#00E87A' : '#FFB400' }}>{isGreen ? '42' : '0'} km/h</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 2: QUEUE BACKLOGS & GREEN SPLITS */}
            {activeTab === 'queues' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: '0.04em' }}>
                    APPROACH QUEUES & CORRIDOR CONGESTION
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {intState.approaches.map((app, idx) => {
                      const pct = Math.min(100, (app.queue / 12) * 100);
                      const isGreen = app.color === 'GREEN';
                      const isYellow = app.color === 'YELLOW';
                      const hex = isGreen ? '#00E87A' : (isYellow ? '#FFB400' : '#FF3B5C');

                      return (
                        <div
                          key={app.id || idx}
                          style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            padding: '8px 10px',
                            borderRadius: 6,
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span
                                style={{
                                  width: 7,
                                  height: 7,
                                  borderRadius: '50%',
                                  background: hex,
                                  boxShadow: `0 0 6px ${hex}`,
                                }}
                              />
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#FFFFFF' }}>
                                {app.roadName} ({app.angleDeg}°)
                              </span>
                              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
                                Phase {app.phaseIndex}
                              </span>
                            </div>
                            <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: app.queue > 4 ? '#FF3B5C' : '#FFFFFF' }}>
                              {app.queue} vehicles queued
                            </span>
                          </div>

                          <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${pct}%`,
                                height: '100%',
                                background: app.queue > 5 ? '#FF3B5C' : app.queue > 2 ? '#FFB400' : '#00E87A',
                                borderRadius: 3,
                                transition: 'width 0.2s ease',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Green Splits Allocation */}
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 10, borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                    DYNAMIC GREEN SPLIT ALLOCATION
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.7)', marginBottom: 3 }}>
                        <span>Corridor Phase 0 Split</span>
                        <strong style={{ color: '#00E87A' }}>58% (18s default)</strong>
                      </div>
                      <div style={{ width: '100%', height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: '58%', height: '100%', background: '#00E87A' }} />
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.7)', marginBottom: 3 }}>
                        <span>Corridor Phase 1 Split</span>
                        <strong style={{ color: '#3D9EFF' }}>42% (15s default)</strong>
                      </div>
                      <div style={{ width: '100%', height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: '42%', height: '100%', background: '#3D9EFF' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: MANUAL PHASE OVERRIDE */}
            {activeTab === 'controls' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.04em' }}>
                  MANUAL TRAFFIC POLICE & CONTROLLER OVERRIDE
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    onClick={handleSwitchPhase}
                    style={{
                      padding: '10px 8px',
                      background: 'rgba(255, 180, 0, 0.16)',
                      border: '1px solid rgba(255, 180, 0, 0.4)',
                      borderRadius: 6,
                      color: '#FFB400',
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <span>⚡</span>
                    <span>Switch Phase (Yellow)</span>
                  </button>

                  <button
                    onClick={handleHoldGreen}
                    style={{
                      padding: '10px 8px',
                      background: 'rgba(0, 232, 122, 0.14)',
                      border: '1px solid rgba(0, 232, 122, 0.4)',
                      borderRadius: 6,
                      color: '#00E87A',
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <span>🔒</span>
                    <span>Hold Current Green (45s)</span>
                  </button>
                </div>

                {/* Direct Force Phase Buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {Array.from({ length: intState.numPhases }).map((_, pIdx) => (
                    <button
                      key={pIdx}
                      onClick={() => handleForcePhase(pIdx)}
                      style={{
                        flex: 1,
                        padding: '8px 4px',
                        background: intState.activePhase === pIdx ? 'rgba(0, 232, 122, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                        border: intState.activePhase === pIdx ? '1px solid #00E87A' : '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: 4,
                        color: intState.activePhase === pIdx ? '#00E87A' : '#E8EAED',
                        fontWeight: 700,
                        fontSize: 10,
                        cursor: 'pointer',
                      }}
                    >
                      Force Phase {pIdx}
                    </button>
                  ))}
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleEmergencyPreempt}
                    style={{
                      flex: 1,
                      padding: '8px',
                      background: 'rgba(255, 59, 92, 0.16)',
                      border: '1px solid rgba(255, 59, 92, 0.4)',
                      borderRadius: 6,
                      color: '#FF3B5C',
                      fontWeight: 700,
                      fontSize: 10.5,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <span>🚨</span>
                    <span>Emergency Preempt (15s)</span>
                  </button>

                  <button
                    onClick={handleResumeAI}
                    style={{
                      flex: 1,
                      padding: '8px',
                      background: 'rgba(61, 158, 255, 0.16)',
                      border: '1px solid rgba(61, 158, 255, 0.4)',
                      borderRadius: 6,
                      color: '#3D9EFF',
                      fontWeight: 700,
                      fontSize: 10.5,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <span>🤖</span>
                    <span>Resume Sanchar AI</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
