import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Map, NavigationControl, config } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getMetersPerPixel } from '../utils/geoUtils.js';
import { getGPUInfo, getOptimal2DContext, getMapLibreContextAttributes } from '../utils/gpuUtils.js';
import { useUIStore } from '../store/uiStore.js';

// Explicitly provide the local MapLibre worker script to prevent unhandled actor rejections
config.WORKER_URL = '/maplibre-gl-worker.mjs';

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
  { name: 'Davis Road Junction', coords: [77.6162, 13.0054], zoom: 18.2, pitch: 32 },
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
  const [gpuInfo, setGpuInfo] = useState(() => getGPUInfo());

  // Initialize MapLibre
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: MAP_STYLES[mapStyle] || MAP_STYLES.osm_dark,
      center: [77.6142, 13.0038],
      zoom: 16.5,
      minZoom: 13,
      maxZoom: 20,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      canvasContextAttributes: getMapLibreContextAttributes(),
    });

    mapRef.current = map;
    if (typeof window !== 'undefined') window.__sancharMap = map;

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

        const ctx = getOptimal2DContext(canvas) || canvas.getContext('2d');
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const zoom = map.getZoom();
        const mapBearing = map.getBearing();
        const mapPitch = map.getPitch() * Math.PI / 180;
        const mPerPx = getMetersPerPixel(13.0038, zoom);

        // Viewport geographic frustum bounds with safety padding (5% padding prevents pop-in)
        const mapBounds = map.getBounds();
        const lngSpan = mapBounds.getEast() - mapBounds.getWest();
        const latSpan = mapBounds.getNorth() - mapBounds.getSouth();
        const minLng = mapBounds.getWest() - lngSpan * 0.06;
        const maxLng = mapBounds.getEast() + lngSpan * 0.06;
        const minLat = mapBounds.getSouth() - latSpan * 0.06;
        const maxLat = mapBounds.getNorth() + latSpan * 0.06;

        // -------------------------------------------------------------
        // 1. Level of Detail (LOD) for Intersections & Traffic Signals
        // -------------------------------------------------------------
        if (activeEngine.intersections) {
          // Macro Zoom (zoom < 15.2): Clean view — do NOT clutter the city with 304 overlapping rings!
          if (zoom < 15.2) {
            // Only draw the user's selected intersection if active
            if (selectedIntersection) {
              const selInt = activeEngine.intersections.get(selectedIntersection);
              if (selInt && selInt.lng && selInt.lat) {
                const p = map.project([selInt.lng, selInt.lat]);
                ctx.strokeStyle = '#3D9EFF';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
                ctx.stroke();
              }
            }
          } else if (zoom < 16.8) {
            // Medium Zoom (15.2 <= zoom < 16.8): Sleek micro-signal LED dots for visible junctions only
            for (const [, int] of activeEngine.intersections) {
              if (!int.isSignalized || !int.lng || !int.lat) continue;
              if (int.lng < minLng || int.lng > maxLng || int.lat < minLat || int.lat > maxLat) continue;

              const p = map.project([int.lng, int.lat]);
              const isSelected = selectedIntersection === int.id;
              const colorNS = int.getColorNS();
              const hex = colorNS === 'GREEN' ? '#00E87A' : (colorNS === 'YELLOW' ? '#FFB400' : '#FF3B5C');

              ctx.fillStyle = hex;
              ctx.beginPath();
              ctx.arc(p.x, p.y, isSelected ? 5.5 : 2.5, 0, Math.PI * 2);
              ctx.fill();

              if (isSelected) {
                ctx.strokeStyle = '#3D9EFF';
                ctx.lineWidth = 2;
                ctx.stroke();
              }
            }
          } else {
            // Street Level Simulation Zoom (zoom >= 16.8): Full signal heads, dual aspects & AI wave
            for (const [, int] of activeEngine.intersections) {
              if (!int.isSignalized || !int.lng || !int.lat) continue;
              // Viewport Culling: Skip if outside visible screen bounds
              if (int.lng < minLng || int.lng > maxLng || int.lat < minLat || int.lat > maxLat) continue;

              const p = map.project([int.lng, int.lat]);
              if (p.x < -60 || p.x > width + 60 || p.y < -60 || p.y > height + 60) continue;

              const isSelected = selectedIntersection === int.id;
              const colorNS = int.getColorNS();
              const colorEW = int.getColorEW();

              const hexNS = colorNS === 'GREEN' ? '#00E87A' : (colorNS === 'YELLOW' ? '#FFB400' : '#FF3B5C');
              const hexEW = colorEW === 'GREEN' ? '#00E87A' : (colorEW === 'YELLOW' ? '#FFB400' : '#FF3B5C');

              const baseRadius = Math.max(7, Math.min(18, 11 / mPerPx));

              // Semi-transparent junction disc
              ctx.fillStyle = 'rgba(10, 16, 24, 0.80)';
              ctx.beginPath();
              ctx.arc(p.x, p.y, baseRadius, 0, Math.PI * 2);
              ctx.fill();

              // Dual Aspect indicator (NS on top/bottom, EW on left/right)
              ctx.lineWidth = Math.max(2, baseRadius * 0.28);
              
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
              ctx.beginPath();
              ctx.arc(p.x, p.y, baseRadius - 2, -Math.PI * 0.25, Math.PI * 0.25);
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(p.x, p.y, baseRadius - 2, Math.PI * 0.75, Math.PI * 1.25);
              ctx.stroke();

              // AI Decision pulse indicator
              if (int.aiPulseActive || (int.trafficLight && int.trafficLight.isAdaptive)) {
                const now = performance.now() / 1000;
                const pulseR = baseRadius + (Math.sin(now * 4) + 1) * 4;
                ctx.strokeStyle = 'rgba(0, 232, 122, 0.45)';
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

                ctx.font = 'bold 10px monospace';
                ctx.fillStyle = '#3D9EFF';
                ctx.textAlign = 'center';
                ctx.fillText(`#${int.id}`, p.x, p.y - baseRadius - 9);
              }
            }
          }
        }

        // -------------------------------------------------------------
        // 1.5 Ambulance Emergency Priority Corridor & Route Visualization
        // -------------------------------------------------------------
        if (activeEngine.vehicles && activeEngine.graph) {
          const now = performance.now();
          const dashPhase = (now / 22) % 24;
          const strobe = Math.floor(now / 150) % 2 === 0;
          const strokeColor = strobe ? '#FF1744' : '#2979FF';
          const glowColor = strobe ? 'rgba(255, 23, 68, 0.28)' : 'rgba(41, 121, 255, 0.28)';

          for (const v of activeEngine.vehicles) {
            if (!v.alive || v.type !== 'emergency') continue;
            if (!v.lng || !v.lat) continue;

            const vPos = map.project([v.lng, v.lat]);
            const pathPts = [vPos];

            // Build geometric polyline across remaining route
            if (v.route && v.routeIndex !== undefined) {
              for (let i = v.routeIndex; i < v.route.length - 1; i++) {
                const fromId = v.route[i];
                const toId = v.route[i + 1];
                const edge = activeEngine.graph.getEdge(fromId, toId);

                if (edge && edge.geoCoords && edge.geoCoords.length >= 2) {
                  const startSeg = (i === v.routeIndex)
                    ? Math.min(edge.geoCoords.length - 1, Math.floor(v.segmentProgress * (edge.geoCoords.length - 1)))
                    : 0;

                  for (let g = startSeg; g < edge.geoCoords.length; g++) {
                    const coord = edge.geoCoords[g];
                    pathPts.push(map.project([coord[0], coord[1]]));
                  }
                } else {
                  const toNode = activeEngine.graph.nodes.get(toId);
                  if (toNode && toNode.lng && toNode.lat) {
                    pathPts.push(map.project([toNode.lng, toNode.lat]));
                  }
                }
              }
            }

            // Draw glowing pulsating emergency route corridor
            if (pathPts.length >= 2) {
              ctx.save();

              // Wide translucent corridor glow
              ctx.beginPath();
              ctx.moveTo(pathPts[0].x, pathPts[0].y);
              for (let pIdx = 1; pIdx < pathPts.length; pIdx++) {
                ctx.lineTo(pathPts[pIdx].x, pathPts[pIdx].y);
              }
              ctx.strokeStyle = glowColor;
              ctx.lineWidth = Math.max(8, Math.min(22, 10 / mPerPx));
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.stroke();

              // Inner animated marching dashed emergency route
              ctx.beginPath();
              ctx.moveTo(pathPts[0].x, pathPts[0].y);
              for (let pIdx = 1; pIdx < pathPts.length; pIdx++) {
                ctx.lineTo(pathPts[pIdx].x, pathPts[pIdx].y);
              }
              ctx.strokeStyle = strokeColor;
              ctx.lineWidth = Math.max(3.5, Math.min(8.5, 4.5 / mPerPx));
              ctx.setLineDash([14, 10]);
              ctx.lineDashOffset = -dashPhase;
              ctx.shadowColor = strokeColor;
              ctx.shadowBlur = 10;
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.shadowBlur = 0;
              ctx.restore();
            }

            // Destination Hospital Beacon & ETA Pin
            if (v.route && v.route.length > 0) {
              const destNodeId = v.route[v.route.length - 1];
              const destNode = activeEngine.graph.nodes.get(destNodeId);
              if (destNode && destNode.lng && destNode.lat) {
                const destP = map.project([destNode.lng, destNode.lat]);
                ctx.save();

                // Pulsing radar ripple ring
                const pulseR = 12 + ((Math.sin(now / 200) + 1) * 7);
                ctx.strokeStyle = '#FF1744';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(destP.x, destP.y, pulseR, 0, Math.PI * 2);
                ctx.stroke();

                // Hospital circular pin
                ctx.fillStyle = '#FF1744';
                ctx.beginPath();
                ctx.arc(destP.x, destP.y, 11, 0, Math.PI * 2);
                ctx.fill();

                // White cross (+)
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(destP.x - 2, destP.y - 6, 4, 12);
                ctx.fillRect(destP.x - 6, destP.y - 2, 12, 4);

                // ETA Badge
                const distRemainingM = Math.max(50, (v.route.length - 1 - v.routeIndex) * 160 + (1 - v.segmentProgress) * 160);
                const speedMps = Math.max(5, (v.speed / 1.13) || 12);
                const etaSec = Math.round(distRemainingM / speedMps);
                const etaMin = (etaSec / 60).toFixed(1);
                const etaText = `🏥 HOSPITAL ETA: ~${etaMin}m`;

                ctx.font = 'bold 10.5px "DM Mono", monospace';
                const textW = ctx.measureText(etaText).width;
                const pillW = textW + 16;
                const pillH = 22;
                const pillX = destP.x + 16;
                const pillY = destP.y - 11;

                // Glass backdrop
                ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
                ctx.strokeStyle = '#FF1744';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.roundRect(pillX, pillY, pillW, pillH, 5);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(etaText, pillX + 8, pillY + 15);
                ctx.restore();
              }
            }

            // Visible ambulance siren beacon ring around vehicle across all zoom levels
            ctx.save();
            const beaconR = Math.max(9, Math.min(22, 10 / mPerPx)) + ((Math.sin(now / 110) + 1) * 4);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(vPos.x, vPos.y, beaconR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        }

        // -------------------------------------------------------------
        // 2. Level of Detail (LOD) & Viewport Culling for Vehicles
        // -------------------------------------------------------------
        if (activeEngine.vehicles) {
          const now = performance.now();
          const isNight = activeEngine.timeOfDay ? activeEngine.timeOfDay.isNight : false;

          // Macro Zoom (zoom < 15.2): Super-fast batched micro-commuter flow
          if (zoom < 15.2) {
            for (const v of activeEngine.vehicles) {
              if (!v.alive || !v.lng || !v.lat) continue;
              if (v.lng < minLng || v.lng > maxLng || v.lat < minLat || v.lat > maxLat) continue;
              const p = map.project([v.lng, v.lat]);
              if (v.type === 'emergency') {
                const strobe = Math.floor(now / 140) % 2 === 0;
                ctx.fillStyle = strobe ? '#FF1744' : '#2979FF';
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
                ctx.fill();
              } else {
                ctx.fillStyle = isNight ? '#FFE082' : '#3D9EFF';
                ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
              }
            }
          } else if (zoom < 16.8) {
            // Medium Zoom (15.2 <= zoom < 16.8): Streamlined commuter capsules
            for (const v of activeEngine.vehicles) {
              if (!v.alive || !v.lng || !v.lat) continue;
              // Viewport Culling
              if (v.lng < minLng || v.lng > maxLng || v.lat < minLat || v.lat > maxLat) continue;

              const p = map.project([v.lng, v.lat]);
              if (p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20) continue;

              const screenBearing = v.bearingDeg - mapBearing;
              const rotRad = (screenBearing * Math.PI) / 180;
              const lenPx = v.type === 'bus' ? 10 : (v.type === 'motorcycle' ? 4 : (v.type === 'emergency' ? 8.5 : 6.5));
              const widPx = v.type === 'motorcycle' ? 2 : (v.type === 'emergency' ? 4.0 : 3.2);

              ctx.save();
              ctx.translate(p.x, p.y);
              ctx.rotate(rotRad);
              ctx.fillStyle = v.type === 'emergency' ? '#FFFFFF' : (v.color || '#3D9EFF');
              ctx.beginPath();
              ctx.roundRect(-widPx / 2, -lenPx / 2, widPx, lenPx, 1.5);
              ctx.fill();

              if (v.type === 'emergency') {
                const strobe = Math.floor(now / 140) % 2 === 0;
                ctx.fillStyle = strobe ? '#FF1744' : '#2979FF';
                ctx.fillRect(-widPx * 0.4, -1, widPx * 0.8, 2);
              }

              ctx.restore();
            }
          } else {
            // Street Level Simulation Zoom (zoom >= 16.8):
            // FULL REAL-WORLD SIMULATION: Perfectly proportioned vehicles matching OSM lanes
            const cartoMultiplier = zoom >= 18.0 ? 1.55 : 1.40;

            for (const v of activeEngine.vehicles) {
              if (!v.alive || !v.lng || !v.lat) continue;
              // Viewport Culling: 100% of off-screen vehicles skip projection & draw calls
              if (v.lng < minLng || v.lng > maxLng || v.lat < minLat || v.lat > maxLat) continue;

              const p = map.project([v.lng, v.lat]);
              if (p.x < -40 || p.x > width + 40 || p.y < -40 || p.y > height + 40) continue;

              // Exact physical vehicle dimensions mapped to screen pixels
              const lenPx = Math.max(6.5, ((v.lengthM || 4.2) * cartoMultiplier) / mPerPx);
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

              // Indian vehicle details based on vehicle class
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

              ctx.restore();
            }
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

  const trackAmbulance = useCallback(() => {
    if (!mapRef.current || !engine) return;
    let amb = engine.vehicles.find(v => v.alive && v.type === 'emergency');
    if (!amb) {
      if (engine.spawnAmbulance) {
        engine.spawnAmbulance();
      }
      setTimeout(() => {
        amb = engine.vehicles.find(v => v.alive && v.type === 'emergency');
        if (amb && amb.lng && amb.lat) {
          mapRef.current.flyTo({
            center: [amb.lng, amb.lat],
            zoom: 18.2,
            pitch: 35,
            duration: 1500,
            essential: true,
          });
        }
      }, 300);
      return;
    }
    if (amb && amb.lng && amb.lat) {
      mapRef.current.flyTo({
        center: [amb.lng, amb.lat],
        zoom: 18.2,
        pitch: 35,
        duration: 1500,
        essential: true,
      });
    }
  }, [engine]);

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

          <div style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.15)', margin: '0 4px' }} />

          {/* GPU Hardware Acceleration Indicator */}
          <div
            title={`Hardware Acceleration: ${gpuInfo.rendererName}\nBackend: ${gpuInfo.backend}\nWebGL: ${gpuInfo.glVersion}\nDedicated GPU: ${gpuInfo.isDedicated ? 'Yes' : 'Integrated / Hybrid'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 5,
              border: gpuInfo.isHardwareAccelerated ? '1px solid rgba(0, 232, 122, 0.45)' : '1px solid rgba(255, 255, 255, 0.15)',
              background: gpuInfo.isHardwareAccelerated ? 'rgba(0, 232, 122, 0.12)' : 'rgba(255, 255, 255, 0.06)',
              color: gpuInfo.isHardwareAccelerated ? '#00E87A' : '#A0AEC0',
              cursor: 'default',
              userSelect: 'none',
            }}
          >
            <span>⚡</span>
            <span>{gpuInfo.rendererName ? (gpuInfo.rendererName.length > 20 ? gpuInfo.rendererName.slice(0, 18) + '…' : gpuInfo.rendererName) : 'GPU'}</span>
            <span style={{ fontSize: 8.5, opacity: 0.8, background: 'rgba(0, 0, 0, 0.35)', padding: '1px 4px', borderRadius: 3 }}>
              {gpuInfo.backend}
            </span>
          </div>
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

          <div style={{ width: 1, height: 14, background: 'rgba(255, 255, 255, 0.15)', margin: '0 2px' }} />

          <button
            onClick={trackAmbulance}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid rgba(255, 59, 92, 0.45)',
              background: 'rgba(255, 59, 92, 0.15)',
              color: '#FF3B5C',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 59, 92, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 59, 92, 0.15)';
            }}
            title="Focus camera on active emergency ambulance & siren corridor"
          >
            <span>🚑</span>
            <span>Track Ambulance</span>
          </button>
        </div>
      </div>
    </div>
  );
}
