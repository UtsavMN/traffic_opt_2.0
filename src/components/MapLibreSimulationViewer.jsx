import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Map, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getMetersPerPixel } from '../utils/geoUtils.js';
import { useUIStore } from '../store/uiStore.js';

const MAP_STYLES = {
  osm_dark: {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: [
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm-tiles-layer',
        type: 'raster',
        source: 'osm-tiles',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  },
  osm_standard: {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: [
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm-tiles-layer',
        type: 'raster',
        source: 'osm-tiles',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  },
  satellite: {
    version: 8,
    sources: {
      'satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: '© Esri, Maxar, Earthstar Geographics'
      }
    },
    layers: [
      {
        id: 'satellite-layer',
        type: 'raster',
        source: 'satellite',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  }
};

const BENGALURU_PRESETS = [
  { name: 'City Overview', coords: [77.6142, 13.0038], zoom: 15.2, pitch: 0 },
  { name: 'Davis Road Junction', coords: [77.6140, 13.0040], zoom: 18.2, pitch: 35 },
  { name: 'Arabic College 4-Way', coords: [77.6200, 13.0180], zoom: 18.4, pitch: 25 },
  { name: 'Tannery Road Corridor', coords: [77.6160, 13.0090], zoom: 18.0, pitch: 30 },
  { name: 'Armstrong Road', coords: [77.6080, 12.9980], zoom: 18.5, pitch: 20 },
];

export default function MapLibreSimulationViewer({ engine, onSelectIntersection }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const animFrameRef = useRef(null);

  const selectedIntersection = useUIStore(s => s.selectedIntersection);
  const mapStyle = useUIStore(s => s.mapStyle);
  const setMapStyle = useUIStore(s => s.setMapStyle);

  const [is3D, setIs3D] = useState(false);

  // Initialize MapLibre
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: MAP_STYLES[mapStyle] || MAP_STYLES.carto_dark,
      center: [77.6142, 13.0038],
      zoom: 16.5,
      minZoom: 13,
      maxZoom: 20,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    mapRef.current = map;

    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-left');

    map.on('click', (e) => {
      const activeEngine = engine || (typeof window !== 'undefined' ? window.__sancharEngine : null);
      if (!activeEngine || !activeEngine.intersections) return;
      const clickPt = e.point;
      let closestInt = null;
      let minDistSq = 35 * 35; // 35px click tolerance

      for (const [, int] of activeEngine.intersections) {
        if (!int.lng || !int.lat) continue;
        const p = map.project([int.lng, int.lat]);
        const dx = p.x - clickPt.x;
        const dy = p.y - clickPt.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) {
          minDistSq = distSq;
          closestInt = int;
        }
      }

      if (closestInt) {
        if (onSelectIntersection) onSelectIntersection(closestInt.id);
      } else {
        if (onSelectIntersection) onSelectIntersection(null);
      }
    });

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle map style changes
  useEffect(() => {
    if (mapRef.current && MAP_STYLES[mapStyle]) {
      mapRef.current.setStyle(MAP_STYLES[mapStyle]);
    }
  }, [mapStyle]);

  // Main Render Loop (Synchronized with MapLibre & Simulation state)
  useEffect(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas) return;

    let isRunning = true;

    const render = () => {
      if (!isRunning) return;
      const activeEngine = engine || (typeof window !== 'undefined' ? window.__sancharEngine : null);

      if (map && activeEngine) {
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
        }

        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const zoom = map.getZoom();
        const mapBearing = map.getBearing();
        const mapPitch = map.getPitch() * Math.PI / 180;
        const mPerPx = getMetersPerPixel(13.0038, zoom);

        // 1. Draw Road Stop Beacons and Signals at Intersections
        if (activeEngine.intersections) {
          for (const [, int] of activeEngine.intersections) {
            if (!int.isSignalized || !int.lng || !int.lat) continue;
            const p = map.project([int.lng, int.lat]);
            if (p.x < -60 || p.x > width + 60 || p.y < -60 || p.y > height + 60) continue;

            const isSelected = selectedIntersection === int.id;
            const colorNS = int.getColorNS();
            const colorEW = int.getColorEW();

            const hexNS = colorNS === 'GREEN' ? '#00E87A' : (colorNS === 'YELLOW' ? '#FFB400' : '#FF3B5C');
            const hexEW = colorEW === 'GREEN' ? '#00E87A' : (colorEW === 'YELLOW' ? '#FFB400' : '#FF3B5C');

            // Draw Signal Beacon Rings
            const baseRadius = Math.max(6, Math.min(18, 12 / mPerPx));
            
            // Glow effect
            ctx.shadowBlur = 8;
            ctx.shadowColor = hexNS;

            // Semi-transparent junction disc
            ctx.fillStyle = 'rgba(10, 16, 24, 0.75)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseRadius, 0, Math.PI * 2);
            ctx.fill();

            // Dual Aspect indicator (NS on top/bottom, EW on left/right)
            ctx.lineWidth = Math.max(2, baseRadius * 0.3);
            
            // NS ring segment
            ctx.strokeStyle = hexNS;
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseRadius - 2, -Math.PI * 0.75, -Math.PI * 0.25);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseRadius - 2, Math.PI * 0.25, Math.PI * 0.75);
            ctx.stroke();

            // EW ring segment
            ctx.strokeStyle = hexEW;
            ctx.shadowColor = hexEW;
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseRadius - 2, -Math.PI * 0.25, Math.PI * 0.25);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseRadius - 2, Math.PI * 0.75, Math.PI * 1.25);
            ctx.stroke();

            ctx.shadowBlur = 0;

            // AI Decision pulse indicator
            if (int.aiPulseActive || (int.trafficLight && int.trafficLight.isAdaptive)) {
              const now = performance.now() / 1000;
              const pulseR = baseRadius + (Math.sin(now * 4) + 1) * 4;
              ctx.strokeStyle = 'rgba(0, 232, 122, 0.4)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(p.x, p.y, pulseR, 0, Math.PI * 2);
              ctx.stroke();
            }

            // Highlighting if selected
            if (isSelected) {
              ctx.strokeStyle = '#3D9EFF';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.arc(p.x, p.y, baseRadius + 7, 0, Math.PI * 2);
              ctx.stroke();

              // Label
              ctx.font = 'bold 10px monospace';
              ctx.fillStyle = '#3D9EFF';
              ctx.textAlign = 'center';
              ctx.fillText(`#${int.id}`, p.x, p.y - baseRadius - 9);
            }
          }
        }

        // 2. Draw Realistic Commuter Vehicles
        if (activeEngine.vehicles) {
          const now = performance.now();
          const isNight = activeEngine.timeOfDay ? activeEngine.timeOfDay.isNight : false;

          for (const v of activeEngine.vehicles) {
            if (!v.alive || !v.lng || !v.lat) continue;
            const p = map.project([v.lng, v.lat]);
            if (p.x < -30 || p.x > width + 30 || p.y < -30 || p.y > height + 30) continue;

            // Calibrate visual proportions against OpenStreetMap road line styling
            const cartoMultiplier = zoom >= 17.5 ? 1.75 : (zoom >= 16 ? 1.4 : 1.15);
            const lenPx = Math.max(5.5, ((v.lengthM || 4.2) * cartoMultiplier) / mPerPx);
            const widPx = Math.max(3.2, ((v.widthM || 1.8) * cartoMultiplier) / mPerPx);

            // Vehicle screen bearing
            const screenBearing = v.bearingDeg - mapBearing;
            const rotRad = (screenBearing * Math.PI) / 180;

            ctx.save();
            ctx.translate(p.x, p.y);
            // Perspective pitch compression along Y axis
            if (mapPitch > 0) {
              ctx.scale(1, Math.cos(mapPitch * 0.55));
            }
            ctx.rotate(rotRad);

            // Draw Vehicle Body
            ctx.fillStyle = v.color || '#3D9EFF';
            const radius = Math.min(widPx * 0.35, 3.5);
            
            ctx.beginPath();
            ctx.roundRect(-widPx / 2, -lenPx / 2, widPx, lenPx, radius);
            ctx.fill();

            // Indian vehicle details based on type & zoom
            if (zoom >= 16.5) {
              // Roof / Windshield
              if (v.type === 'rickshaw') {
                // Auto-rickshaw signature black canvas top & yellow hood
                ctx.fillStyle = '#181818';
                ctx.fillRect(-widPx * 0.45, -lenPx * 0.1, widPx * 0.9, lenPx * 0.55);
                ctx.fillStyle = '#FFD600'; // Yellow front apron
                ctx.fillRect(-widPx * 0.40, -lenPx * 0.45, widPx * 0.8, lenPx * 0.3);
              } else if (v.type === 'bus') {
                // BMTC City Bus white roof with destination board
                ctx.fillStyle = '#F5F5F5';
                ctx.fillRect(-widPx * 0.35, -lenPx * 0.35, widPx * 0.7, lenPx * 0.65);
                ctx.fillStyle = '#1A73E8'; // Blue BMTC signage band
                ctx.fillRect(-widPx * 0.38, -lenPx * 0.45, widPx * 0.76, lenPx * 0.08);
              } else if (v.type === 'motorcycle') {
                // Helmet / Rider torso
                ctx.fillStyle = '#263238';
                ctx.beginPath();
                ctx.arc(0, 0, Math.max(1.5, widPx * 0.35), 0, Math.PI * 2);
                ctx.fill();
              } else {
                // Car / Cab windshield
                ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
                ctx.fillRect(-widPx * 0.38, -lenPx * 0.22, widPx * 0.76, lenPx * 0.26);
              }

              // Headlights (Front: -lenPx / 2)
              ctx.fillStyle = isNight ? '#FFF9C4' : 'rgba(255, 255, 255, 0.9)';
              const lightW = Math.max(1, widPx * 0.28);
              ctx.fillRect(-widPx / 2 + 0.3, -lenPx / 2, lightW, 1.8);
              ctx.fillRect(widPx / 2 - lightW - 0.3, -lenPx / 2, lightW, 1.8);

              // Tail / Brake Lights (Rear: +lenPx / 2)
              const isBraking = v.speed < 2.0;
              ctx.fillStyle = isBraking ? '#FF1744' : '#B71C1C';
              if (isBraking) {
                ctx.shadowColor = '#FF1744';
                ctx.shadowBlur = 5;
              }
              ctx.fillRect(-widPx / 2 + 0.3, lenPx / 2 - 1.8, lightW, 1.8);
              ctx.fillRect(widPx / 2 - lightW - 0.3, lenPx / 2 - 1.8, lightW, 1.8);
              ctx.shadowBlur = 0;

              // Emergency Ambulance Siren Strobe
              if (v.type === 'emergency') {
                const strobe = Math.floor(now / 140) % 2 === 0;
                ctx.fillStyle = strobe ? '#FF1744' : '#2979FF';
                ctx.shadowColor = strobe ? '#FF1744' : '#2979FF';
                ctx.shadowBlur = 9;
                ctx.fillRect(-widPx * 0.35, -1.2, widPx * 0.7, 2.5);
                ctx.shadowBlur = 0;
              }
            }

            ctx.restore();
          }
        }

        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [engine, selectedIntersection]);

  const jumpTo = useCallback((preset) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: preset.coords,
      zoom: preset.zoom,
      pitch: preset.pitch || 0,
      duration: 1500,
      essential: true,
    });
  }, []);

  const toggle3D = useCallback(() => {
    if (!mapRef.current) return;
    const targetPitch = is3D ? 0 : 50;
    mapRef.current.easeTo({ pitch: targetPitch, duration: 800 });
    setIs3D(!is3D);
  }, [is3D]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* MapLibre Map Container */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          filter: mapStyle === 'osm_dark' ? 'invert(90%) hue-rotate(180deg) brightness(85%) contrast(115%)' : 'none',
          transition: 'filter 0.3s ease',
        }}
      />

      {/* Synchronized Simulation Canvas Overlay */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* Real Map Floating Controls & Preset Bar */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 5,
        }}
      >
        {/* Style Selector & 3D Tilt */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(13, 17, 23, 0.88)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 8,
            padding: '5px 8px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', marginRight: 2 }}>MAP:</span>
          {[
            { id: 'osm_dark', label: 'Cyber Dark' },
            { id: 'osm_standard', label: 'OpenStreetMap' },
            { id: 'satellite', label: 'Satellite Photoreal' },
          ].map(s => (
            <button
              key={s.id}
              onClick={() => setMapStyle(s.id)}
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '3px 7px',
                borderRadius: 5,
                border: 'none',
                cursor: 'pointer',
                background: mapStyle === s.id ? '#3D9EFF' : 'rgba(255, 255, 255, 0.06)',
                color: mapStyle === s.id ? '#0A0C0F' : '#E8EAED',
                transition: 'all 0.15s ease',
              }}
            >
              {s.label}
            </button>
          ))}

          <div style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.15)', margin: '0 4px' }} />

          <button
            onClick={toggle3D}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 5,
              border: is3D ? '1px solid #00E87A' : '1px solid rgba(255, 255, 255, 0.15)',
              background: is3D ? 'rgba(0, 232, 122, 0.18)' : 'rgba(255, 255, 255, 0.06)',
              color: is3D ? '#00E87A' : '#E8EAED',
              cursor: 'pointer',
            }}
          >
            {is3D ? '3D TILT ON' : '3D TILT'}
          </button>
        </div>

        {/* Quick Bengaluru Landmark Jump Pills */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'rgba(13, 17, 23, 0.88)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 8,
            padding: '4px 8px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', marginRight: 2 }}>📍 JUMP:</span>
          {BENGALURU_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => jumpTo(p)}
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: 4,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.04)',
                color: '#D8DEE9',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(61, 158, 255, 0.2)';
                e.currentTarget.style.color = '#3D9EFF';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                e.currentTarget.style.color = '#D8DEE9';
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
