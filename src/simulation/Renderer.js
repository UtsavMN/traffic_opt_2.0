import { SIGNAL_COLORS } from './TrafficLight.js';
import { Camera } from './Camera.js';

/**
 * Renderer — All canvas draw calls, layered back-to-front
 */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = new Camera(canvas);
    this.overlays = {
      heatmap: false,
      aiDecisions: true,
      vehicleRoutes: false,
      pedestrianPaths: false,
      zoneColors: false,
    };
    this.roadCaches = new Map();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const newW = rect.width;
    const newH = rect.height;
    // Only resize if dimensions changed
    if (newW === this._lastW && newH === this._lastH) return;
    this._lastW = newW;
    this._lastH = newH;
    this.canvas.width = newW * dpr;
    this.canvas.height = newH * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = newW;
    this.height = newH;
  }

  clear(skyColor) {
    this.ctx.fillStyle = skyColor || '#0A0C0F';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  worldToScreen(wx, wy) {
    return this.camera.worldToScreen(wx, wy);
  }

  screenToWorld(sx, sy) {
    return this.camera.screenToWorld(sx, sy);
  }

  getViewportBounds(margin = 0) {
    const b = this.camera.worldBounds();
    return {
      minX: b.minX - margin,
      maxX: b.maxX + margin,
      minY: b.minY - margin,
      maxY: b.maxY + margin,
    };
  }

  isInsideViewport(wx, wy, bounds) {
    return wx >= bounds.minX && wx <= bounds.maxX && wy >= bounds.minY && wy <= bounds.maxY;
  }

  // ── Layer 1: Zone Tints ──────────────────────────────
  drawZones(graph) {
    if (!this.overlays.zoneColors) return;
    const ctx = this.ctx;
    const zoneColors = {
      residential: 'rgba(61,158,255,0.04)',
      commercial: 'rgba(255,180,0,0.04)',
      industrial: 'rgba(255,59,92,0.04)',
    };

    const bounds = this.getViewportBounds(100);

    for (const [, node] of graph.nodes) {
      if (node.type !== 'destination') continue;
      if (!this.isInsideViewport(node.x, node.y, bounds)) continue;
      const s = this.worldToScreen(node.x, node.y);
      const r = 80 * this.camera.zoom;
      const color = zoneColors[node.zone] || zoneColors.residential;
      ctx.fillStyle = color;
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }
  }

  // ── Layer 1.5: Buildings ─────────────────────────────
  drawBuildings(bitmap) {
    if (!bitmap) return;
    const ctx = this.ctx;
    const z = this.camera.zoom;
    
    const bounds = this.getViewportBounds();
    
    // Source rect (clamped to bitmap size)
    const sx = Math.max(0, Math.floor(bounds.minX));
    const sy = Math.max(0, Math.floor(bounds.minY));
    const sw = Math.min(bitmap.width - sx, Math.ceil(bounds.maxX - sx));
    const sh = Math.min(bitmap.height - sy, Math.ceil(bounds.maxY - sy));
    
    if (sw <= 0 || sh <= 0) return;

    const s = this.worldToScreen(sx, sy);
    ctx.drawImage(bitmap, sx, sy, sw, sh, s.x, s.y, sw * z, sh * z);
  }

  // ── Layer 2: Roads ───────────────────────────────────
  // ── Layer 2: Roads ───────────────────────────────────
  cacheRoads(graph) {
    if (!graph) return;
    this.roadCaches = new Map();

    const minX = graph.bounds.minX;
    const minY = graph.bounds.minY;
    const maxX = graph.bounds.maxX;
    const maxY = graph.bounds.maxY;
    const width = Math.ceil(maxX - minX) || 4000;
    const height = Math.ceil(maxY - minY) || 4000;

    const lods = ['overview', 'district', 'neighborhood', 'street'];
    const lodWidths = {
      overview:      { highway: 3,  arterial: 1.5, local: 0 },
      district:      { highway: 4,  arterial: 2.5, local: 1 },
      neighborhood:  { highway: 8,  arterial: 5,   local: 3 },
      street:        { highway: 16, arterial: 10,  local: 6 },
    };
    const colors = { highway: '#2A2E38', arterial: '#1E2228', local: '#171B21' };

    for (const lod of lods) {
      const cacheCanvas = document.createElement('canvas');
      cacheCanvas.width = width;
      cacheCanvas.height = height;
      const ctx = cacheCanvas.getContext('2d');

      const widths = lodWidths[lod];

      for (const [, edge] of graph.edges) {
        if (edge.from > edge.to) continue;
        const from = graph.nodes.get(edge.from);
        const to = graph.nodes.get(edge.to);
        if (!from || !to) continue;

        const baseW = widths[edge.type] || widths.local;
        if (baseW === 0) continue;

        const x1 = from.x - minX;
        const y1 = from.y - minY;
        const x2 = to.x - minX;
        const y2 = to.y - minY;

        // Road fill
        ctx.strokeStyle = colors[edge.type] || colors.local;
        ctx.lineWidth = baseW;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Center line and Lane Markings (LOD)
        if (lod === 'street') {
          // Center line (solid yellow)
          ctx.strokeStyle = 'rgba(255,200,0,0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          // Lane dividers (dashed white)
          if (edge.lanes > 1) {
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([6, 8]);

            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.hypot(dx, dy);
            if (len > 0) {
              const px = -dy / len, py = dx / len;
              for (let dir = -1; dir <= 1; dir += 2) {
                for (let l = 1; l < edge.lanes; l++) {
                  const offset = (l * (baseW / 2 / edge.lanes)) * dir;
                  ctx.beginPath();
                  ctx.moveTo(x1 + px * offset, y1 + py * offset);
                  ctx.lineTo(x2 + px * offset, y2 + py * offset);
                  ctx.stroke();
                }
              }
            }
            ctx.setLineDash([]);
          }

          // Stop lines
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 30) {
            const dirX = dx / len, dirY = dy / len;
            const perpX = -dirY, perpY = dirX;

            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = 3;
            const offset = 15;

            ctx.beginPath();
            ctx.moveTo(x2 - dirX * offset + perpX * (baseW/2), y2 - dirY * offset + perpY * (baseW/2));
            ctx.lineTo(x2 - dirX * offset, y2 - dirY * offset);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(x1 + dirX * offset - perpX * (baseW/2), y1 + dirY * offset - perpY * (baseW/2));
            ctx.lineTo(x1 + dirX * offset, y1 + dirY * offset);
            ctx.stroke();
          }
        }
      }
      this.roadCaches.set(lod, cacheCanvas);
    }
  }

  drawRoads(graph) {
    const ctx = this.ctx;
    const detail = this.camera.getDetail();
    const bounds = this.getViewportBounds(200);

    // LOD-dependent widths
    const lodWidths = {
      overview:      { highway: 3,  arterial: 1.5, local: 0 },
      district:      { highway: 4,  arterial: 2.5, local: 1 },
      neighborhood:  { highway: 8,  arterial: 5,   local: 3 },
      street:        { highway: 16, arterial: 10,  local: 6 },
    };
    const widths = lodWidths[detail] || lodWidths.neighborhood;
    
    // High-contrast slate-grey colors for dark mode readability
    const colors = { 
      highway: '#3D4452',   // Lighter slate grey for highways
      arterial: '#2F3540',  // Medium slate grey for arterial roads
      local: '#22262E'      // Dark slate grey for local streets (clearly visible against #0A0C0F background)
    };

    // First Pass: Draw road casing/outline (to merge intersections beautifully)
    for (const [, edge] of graph.edges) {
      if (edge.from > edge.to) continue;
      const from = graph.nodes.get(edge.from);
      const to = graph.nodes.get(edge.to);
      if (!from || !to) continue;

      const baseW = widths[edge.type] || widths.local;
      if (baseW === 0) continue;

      if (!this.isInsideViewport(from.x, from.y, bounds) && !this.isInsideViewport(to.x, to.y, bounds)) {
        continue;
      }

      const s1 = this.worldToScreen(from.x, from.y);
      const s2 = this.worldToScreen(to.x, to.y);
      const w = baseW * this.camera.zoom;

      ctx.strokeStyle = '#0B0C0E'; // Match background/outline
      ctx.lineWidth = w + 2 * Math.max(1, this.camera.zoom * 0.4);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
    }

    // Second Pass: Draw road fill and detailed markings
    for (const [, edge] of graph.edges) {
      if (edge.from > edge.to) continue;
      const from = graph.nodes.get(edge.from);
      const to = graph.nodes.get(edge.to);
      if (!from || !to) continue;

      const baseW = widths[edge.type] || widths.local;
      if (baseW === 0) continue; 

      if (!this.isInsideViewport(from.x, from.y, bounds) && !this.isInsideViewport(to.x, to.y, bounds)) {
        continue;
      }

      const s1 = this.worldToScreen(from.x, from.y);
      const s2 = this.worldToScreen(to.x, to.y);
      const w = baseW * this.camera.zoom;

      // Road fill
      ctx.strokeStyle = colors[edge.type] || colors.local;
      ctx.lineWidth = w;
      ctx.lineCap = 'round'; // round makes overlapping intersections look continuous
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();

      // Center line and Lane Markings (LOD)
      if (this.camera.zoom > 2.5) {
        // Center line (solid or double yellow)
        ctx.strokeStyle = 'rgba(255,200,0,0.5)';
        ctx.lineWidth = 1 * this.camera.zoom;
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
        
        // Lane dividers (dashed white)
        if (edge.lanes > 1) {
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 0.5 * this.camera.zoom;
          ctx.setLineDash([6 * this.camera.zoom, 8 * this.camera.zoom]);
          
          const dx = s2.x - s1.x, dy = s2.y - s1.y;
          const len = Math.hypot(dx, dy);
          if (len > 0) {
            const px = -dy / len, py = dx / len;
            for (let dir = -1; dir <= 1; dir += 2) {
              for (let l = 1; l < edge.lanes; l++) {
                const offset = (l * (w / 2 / edge.lanes)) * dir;
                ctx.beginPath();
                ctx.moveTo(s1.x + px * offset, s1.y + py * offset);
                ctx.lineTo(s2.x + px * offset, s2.y + py * offset);
                ctx.stroke();
              }
            }
          }
          ctx.setLineDash([]);
        }
        
        // Stop lines
        const dx = s2.x - s1.x;
        const dy = s2.y - s1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 30 * this.camera.zoom) {
          const dirX = dx / len, dirY = dy / len;
          const perpX = -dirY, perpY = dirX;
          
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 3 * this.camera.zoom;
          const offset = 15 * this.camera.zoom;
          
          ctx.beginPath();
          ctx.moveTo(s2.x - dirX * offset + perpX * (w/2), s2.y - dirY * offset + perpY * (w/2));
          ctx.lineTo(s2.x - dirX * offset, s2.y - dirY * offset);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(s1.x + dirX * offset - perpX * (w/2), s1.y + dirY * offset - perpY * (w/2));
          ctx.lineTo(s1.x + dirX * offset, s1.y + dirY * offset);
          ctx.stroke();
        }
      }

      // Blocked indicator
      if (edge.blocked > 0) {
        ctx.strokeStyle = 'rgba(255,180,0,0.3)';
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
      }
    }
  }

  // ── Layer 3: Intersections + Traffic Lights ──────────
  drawIntersections(intersections) {
    const ctx = this.ctx;
    const bounds = this.getViewportBounds(50);

    for (const [, int] of intersections) {
      if (!this.isInsideViewport(int.x, int.y, bounds)) continue;
      const s = this.worldToScreen(int.x, int.y);

      // Traffic lights — 4 signal heads
      const tl = int.trafficLight;
      
      ctx.save();
      ctx.translate(s.x, s.y);

      // Determine the active color of the intersection
      const isGreen = tl.currentPhase.includes('GREEN');
      const isYellow = tl.currentPhase.includes('YELLOW');
      const hexColor = isGreen ? '#00E87A' : (isYellow ? '#FFB400' : '#FF3B5C');

      if (this.camera.zoom > 2.5) {
        // Draw 4 signal heads facing approaches (offset from center so road remains fully visible)
        const z = this.camera.zoom;
        const dist = 12 * z;
        
        const drawSignal = (color, angle) => {
          ctx.save();
          ctx.rotate(angle);
          ctx.translate(0, -dist);
          
          // Signal box
          ctx.fillStyle = '#1A1A1A';
          ctx.fillRect(-2 * z, -5 * z, 4 * z, 10 * z);
          
          // Lights
          ctx.fillStyle = color === 'RED' ? '#FF3B5C' : '#330000';
          ctx.beginPath(); ctx.arc(0, -3 * z, 1.2 * z, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = color === 'YELLOW' ? '#FFB400' : '#333300';
          ctx.beginPath(); ctx.arc(0, 0, 1.2 * z, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = color === 'GREEN' ? '#00E87A' : '#003300';
          ctx.beginPath(); ctx.arc(0, 3 * z, 1.2 * z, 0, Math.PI*2); ctx.fill();
          
          ctx.restore();
        };

        const cNS = tl.getColorNS();
        const cEW = tl.getColorEW();
        
        drawSignal(cNS, 0); // North facing
        drawSignal(cNS, Math.PI); // South facing
        drawSignal(cEW, Math.PI/2); // East facing
        drawSignal(cEW, -Math.PI/2); // West facing
      } else {
        // Draw a clean, hollow ring for the intersection so it doesn't block the road view
        ctx.strokeStyle = hexColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 2.5 * this.camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Traffic Police
      if (int.policeActive) {
        ctx.fillStyle = '#3D9EFF'; // Police blue
        ctx.beginPath();
        ctx.arc(0, 0, 5 * this.camera.zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5 * this.camera.zoom;
        ctx.stroke();
      }

      ctx.restore();

      // AI Decision Pulse
      if (int.aiPulseActive && this.overlays.aiDecisions) {
        const t = int.aiPulseTimer;
        let alpha;
        if (t > 0.8) { alpha = (1.1 - t) / 0.3; } // fade in 300ms
        else { alpha = t / 0.8; } // fade out 800ms
        alpha = Math.max(0, Math.min(1, alpha)) * 0.6;

        ctx.strokeStyle = `rgba(155,111,255,${alpha})`;
        ctx.lineWidth = 1 * this.camera.zoom;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 8 * this.camera.zoom, 0, Math.PI * 2);
        ctx.stroke();

        // Inner glow
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 10 * this.camera.zoom);
        grad.addColorStop(0, `rgba(155,111,255,${alpha * 0.2})`);
        grad.addColorStop(1, 'rgba(155,111,255,0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }
  }



  // ── Layer 3.5: Ambulance Routes ──────────────────────
  drawAmbulanceRoutes(vehicles, graph) {
    const ctx = this.ctx;
    ctx.lineWidth = 4 * this.camera.zoom;
    const dashPhase = (Date.now() / 20) % 20;
    const bounds = this.getViewportBounds(50);

    for (const v of vehicles) {
      if (v.type === 'emergency' && v.alive) {
        if (!this.isInsideViewport(v.pos.x, v.pos.y, bounds)) continue;
        
        ctx.strokeStyle = (Date.now() % 500 < 250) ? 'rgba(255, 59, 92, 0.8)' : 'rgba(61, 158, 255, 0.8)';
        ctx.setLineDash([10 * this.camera.zoom, 10 * this.camera.zoom]);
        ctx.lineDashOffset = -dashPhase * this.camera.zoom;

        ctx.beginPath();
        const sPos = this.worldToScreen(v.pos.x, v.pos.y);
        ctx.moveTo(sPos.x, sPos.y);
        
        for (let i = v.routeIndex + 1; i < v.route.length; i++) {
          const node = graph.nodes.get(v.route[i]);
          if (node) {
            const sn = this.worldToScreen(node.x, node.y);
            ctx.lineTo(sn.x, sn.y);
          }
        }
        ctx.stroke();
        
        // Draw ETA text at destination
        if (v.route.length > 0) {
          const destNode = graph.nodes.get(v.route[v.route.length - 1]);
          if (destNode) {
            const sDest = this.worldToScreen(destNode.x, destNode.y);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `${12 * Math.max(1, this.camera.zoom)}px "DM Mono"`;
            ctx.fillText('HOSPITAL ETA', sDest.x + 10, sDest.y);
          }
        }
      }
    }
    ctx.setLineDash([]);
  }

  // ── Layer 4: Vehicles ────────────────────────────────
  drawVehicles(vehicles, isNight) {
    const ctx = this.ctx;
    const bounds = this.getViewportBounds(50);
    const detail = this.camera.getDetail();

    // At overview zoom, skip vehicles entirely — too small to see
    if (detail === 'overview') return;

    for (const v of vehicles) {
      if (!v.alive) continue;
      if (!this.isInsideViewport(v.pos.x, v.pos.y, bounds)) continue;

      const s = this.worldToScreen(v.pos.x, v.pos.y);
      const z = this.camera.zoom;

      // District zoom: simple 2px colored dots
      if (detail === 'district') {
        ctx.fillStyle = v.type === 'emergency' ? '#FF3B5C' : v.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      // Neighborhood zoom: small 6×3px rotated rects
      if (detail === 'neighborhood') {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(v.heading);
        ctx.fillStyle = v.type === 'emergency' ? '#FF3B5C' : v.color;
        ctx.fillRect(-3, -1.5, 6, 3);
        ctx.restore();
        continue;
      }

      // Street zoom: full detail (existing code below)

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(v.heading);

      const l = v.length * z * 0.5;
      const w = v.width * z * 0.5;

      // Base body
      ctx.beginPath();
      ctx.roundRect(-l, -w, l * 2, w * 2, 2 * z);
      ctx.fillStyle = v.type === 'emergency' ? '#FFFFFF' : v.color;
      ctx.fill();

      // Vehicle type specific details
      if (v.type === 'car' || v.type === 'truck' || v.type === 'motorcycle') {
        // Windscreen (front 30%)
        ctx.fillStyle = 'rgba(180,220,255,0.6)';
        ctx.fillRect(l - (v.length * z * 0.3), -w + 1*z, v.length * z * 0.2, w * 2 - 2*z);
        // Rear window
        if (v.type !== 'truck') {
          ctx.fillRect(-l + (v.length * z * 0.1), -w + 1*z, v.length * z * 0.15, w * 2 - 2*z);
        }
      } else if (v.type === 'bus') {
        // Bus windows
        ctx.fillStyle = 'rgba(180,220,255,0.6)';
        const winLen = 2 * z;
        const gap = 1 * z;
        for (let x = -l + 3*z; x < l - 3*z; x += winLen + gap) {
          ctx.fillRect(x, -w + 0.5*z, winLen, 1.5*z);
          ctx.fillRect(x, w - 2*z, winLen, 1.5*z);
        }
      } else if (v.type === 'emergency') {
        // Red cross on roof
        ctx.fillStyle = '#FF3B5C';
        ctx.fillRect(-2*z, -4*z, 4*z, 8*z);
        ctx.fillRect(-4*z, -2*z, 8*z, 4*z);
        
        // Light bar
        const blinkPhase = (Date.now() % 250) < 125;
        ctx.fillStyle = blinkPhase ? '#FF3B5C' : '#3D9EFF';
        ctx.fillRect(l - 3*z, -w + 1*z, 2*z, w * 2 - 2*z);
      }

      // Brake / Tail lights
      if (v.state === 'braking' || v.state === 'stopped') {
        ctx.fillStyle = 'rgba(255,59,92,0.9)'; // bright red
      } else {
        ctx.fillStyle = 'rgba(255,59,92,0.4)'; // dim red tail lights
      }
      ctx.fillRect(-l, -w + 0.5*z, 2 * z, 1.5 * z);
      ctx.fillRect(-l, w - 2*z, 2 * z, 1.5 * z);

      // Headlights (at night)
      if (isNight) {
        ctx.fillStyle = 'rgba(255,240,180,0.9)';
        ctx.fillRect(l - 2 * z, -w + 0.5*z, 2 * z, 2 * z);
        ctx.fillRect(l - 2 * z, w - 2.5*z, 2 * z, 2 * z);
        // Headlight beam
        ctx.fillStyle = 'rgba(255,240,180,0.04)';
        ctx.beginPath();
        ctx.moveTo(l, -w + 1*z);
        ctx.lineTo(l + 40 * z, -w * 4);
        ctx.lineTo(l + 40 * z, w * 4);
        ctx.lineTo(l, w - 1*z);
        ctx.fill();
      }

      // Emergency siren glow
      if (v.sirenActive) {
        ctx.fillStyle = Date.now() % 400 < 200
          ? 'rgba(255,59,92,0.15)' : 'rgba(61,158,255,0.15)';
        ctx.beginPath();
        const sirenRadius = Math.min(30, 20 * z);
        ctx.arc(0, 0, sirenRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Forward cone for siren
        ctx.fillStyle = 'rgba(255,240,180,0.1)';
        ctx.beginPath();
        ctx.moveTo(l, 0);
        ctx.lineTo(l + 60*z, -30*z);
        ctx.lineTo(l + 60*z, 30*z);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // ── Layer 5: Pedestrians ─────────────────────────────
  drawPedestrians(pedestrians) {
    const ctx = this.ctx;
    const bounds = this.getViewportBounds(50);
    
    for (const p of pedestrians) {
      if (!p.alive) continue;
      if (!this.isInsideViewport(p.pos.x, p.pos.y, bounds)) continue;
      
      const s = this.worldToScreen(p.pos.x, p.pos.y);
      const r = p.radius * this.camera.zoom;
      const bobble = Math.sin(p.animFrame) * 0.5;

      ctx.fillStyle = p.state === 'jaywalking' ? '#FF3B5C' : p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y + bobble, r, 0, Math.PI * 2);
      ctx.fill();

      if (p.state === 'waiting_at_crossing') {
        ctx.strokeStyle = 'rgba(255,180,0,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // ── Layer 6: Cyclists ────────────────────────────────
  drawCyclists(cyclists) {
    const ctx = this.ctx;
    const bounds = this.getViewportBounds(50);

    for (const c of cyclists) {
      if (!c.alive) continue;
      if (!this.isInsideViewport(c.pos.x, c.pos.y, bounds)) continue;

      const s = this.worldToScreen(c.pos.x, c.pos.y);
      const z = this.camera.zoom;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(c.heading);
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.roundRect(-c.length * z * 0.5, -c.width * z * 0.5,
                     c.length * z, c.width * z, 1);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Layer 7: Heatmap ─────────────────────────────────
  drawHeatmap(intersections) {
    if (!this.overlays.heatmap) return;
    const ctx = this.ctx;
    for (const [, int] of intersections) {
      const q = int.getTotalQueue();
      if (q === 0) continue;
      const s = this.worldToScreen(int.x, int.y);
      const intensity = Math.min(1, q / 20);
      const r = (30 + intensity * 30) * this.camera.zoom;
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      const red = Math.floor(255 * intensity);
      const green = Math.floor(255 * (1 - intensity));
      grad.addColorStop(0, `rgba(${red},${green},0,0.25)`);
      grad.addColorStop(1, `rgba(${red},${green},0,0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Crosswalk Markings ───────────────────────────────
  drawCrosswalks(graph) {
    // Only render crosswalks at street zoom
    if (this.camera.getDetail() !== 'street') return;

    const ctx = this.ctx;
    const bounds = this.getViewportBounds(50);

    for (const [, node] of graph.nodes) {
      if (!this.isInsideViewport(node.x, node.y, bounds)) continue;
      const s = this.worldToScreen(node.x, node.y);
      const z = this.camera.zoom;
      const size = 10 * z;

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1.5 * z;
      for (let i = -3; i <= 3; i++) {
        const offset = i * 2.5 * z;
        ctx.beginPath();
        ctx.moveTo(s.x + offset, s.y - size);
        ctx.lineTo(s.x + offset, s.y - size - 4 * z);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x + offset, s.y + size);
        ctx.lineTo(s.x + offset, s.y + size + 4 * z);
        ctx.stroke();
      }
    }
  }

  // ── Minimap ─────────────────────────────────────────
  drawMinimap(vehicles, worldW, worldH) {
    const ctx = this.ctx;
    const M = { x: this.width - 175, y: this.height - 120, w: 155, h: 105 };
    const sx = M.w / worldW, sy = M.h / worldH;

    // Background
    ctx.fillStyle = 'rgba(10,12,15,0.88)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(M.x - 2, M.y - 2, M.w + 4, M.h + 4, 6);
    ctx.fill();
    ctx.stroke();

    // Vehicle dots
    for (const v of vehicles) {
      if (!v.alive) continue;
      ctx.fillStyle = v.type === 'emergency' ? '#FF3B5C' : '#3D9EFF';
      ctx.beginPath();
      ctx.arc(M.x + v.pos.x * sx, M.y + v.pos.y * sy, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Camera viewport rectangle
    const b = this.camera.worldBounds();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      M.x + b.minX * sx,
      M.y + b.minY * sy,
      (b.maxX - b.minX) * sx,
      (b.maxY - b.minY) * sy
    );

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px monospace';
    ctx.fillText('MINIMAP', M.x + 4, M.y + 10);
  }

  // ── Layer 9.5: Night Overlay ──────────────────────────
  drawNightOverlay(ambientLight) {
    if (ambientLight >= 0.95) return; // Full daylight — skip

    const ctx = this.ctx;
    const darkness = 1 - ambientLight;

    // Dark blue-tinted overlay
    ctx.save();
    ctx.globalAlpha = darkness * 0.55; // Max 55% opacity at full darkness
    ctx.fillStyle = '#050815';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();

    // Subtle vignette at very dark hours
    if (darkness > 0.6) {
      const grd = ctx.createRadialGradient(
        this.width / 2, this.height / 2, this.width * 0.25,
        this.width / 2, this.height / 2, this.width * 0.75
      );
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, `rgba(0,0,0,${(darkness - 0.6) * 0.4})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }
}

