import { SIGNAL_COLORS } from './TrafficLight.js';
import { Camera } from './Camera.js';
import { LANE_WIDTH_PX } from '../constants.js';

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
      sensorCones: false, // Visual overlay for virtual sensors
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
  // Removed unused cacheRoads method to optimize initialization

  drawRoads(graph) {
    const ctx = this.ctx;
    const detail = this.camera.getDetail();
    const bounds = this.getViewportBounds(200);

    // High-contrast slate-grey colors for dark mode readability
    const colors = { 
      highway: '#5A6376',   // Lighter, higher contrast slate grey for highways
      arterial: '#434B5C',  // Medium slate grey for arterial roads
      local: '#2E3442'      // High contrast slate grey for local streets (clearly visible against night background)
    };

    // First Pass: Draw road casing/outline (to merge intersections beautifully)
    for (const [, edge] of graph.edges) {
      if (edge.from > edge.to) continue;
      const from = graph.nodes.get(edge.from);
      const to = graph.nodes.get(edge.to);
      if (!from || !to) continue;

      if (detail === 'overview' && edge.type === 'local') continue; // Skip local roads at overview zoom

      if (!this.isInsideViewport(from.x, from.y, bounds) && !this.isInsideViewport(to.x, to.y, bounds)) {
        continue;
      }

      const s1 = this.worldToScreen(from.x, from.y);
      const s2 = this.worldToScreen(to.x, to.y);

      // Determine physical scaled width
      let baseW = edge.lanes * LANE_WIDTH_PX();
      if (detail === 'overview') {
        baseW = edge.type === 'highway' ? 3 / this.camera.zoom : 1.5 / this.camera.zoom;
      } else if (detail === 'district') {
        baseW = Math.max(baseW, (edge.type === 'local' ? 1.2 : 2.5) / this.camera.zoom);
      }
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

      if (detail === 'overview' && edge.type === 'local') continue;

      if (!this.isInsideViewport(from.x, from.y, bounds) && !this.isInsideViewport(to.x, to.y, bounds)) {
        continue;
      }

      const s1 = this.worldToScreen(from.x, from.y);
      const s2 = this.worldToScreen(to.x, to.y);

      // Determine physical scaled width
      let baseW = edge.lanes * LANE_WIDTH_PX();
      if (detail === 'overview') {
        baseW = edge.type === 'highway' ? 3 / this.camera.zoom : 1.5 / this.camera.zoom;
      } else if (detail === 'district') {
        baseW = Math.max(baseW, (edge.type === 'local' ? 1.2 : 2.5) / this.camera.zoom);
      }
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
        // Center line (solid or double yellow) - scale-invariant width to avoid bloated lines
        ctx.strokeStyle = 'rgba(255,200,0,0.5)';
        ctx.lineWidth = Math.max(1, 0.15 * this.camera.zoom);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
        
        // Lane dividers (dashed white)
        if (edge.lanes > 1) {
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = Math.max(0.5, 0.08 * this.camera.zoom);
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
          ctx.lineWidth = Math.max(1.5, 0.35 * this.camera.zoom);
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
        ctx.lineWidth = 1.5;
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

    // At overview zoom, draw tiny 1.2px dots so vehicles remain visible in map view
    if (detail === 'overview') {
      for (const v of vehicles) {
        if (!v.alive) continue;
        if (!this.isInsideViewport(v.pos.x, v.pos.y, bounds)) continue;
        const s = this.worldToScreen(v.pos.x, v.pos.y);
        ctx.fillStyle = v.type === 'emergency' ? '#FF3B5C' : v.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

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

      // Visual scale factors to make vehicles fit lane widths realistically (e.g. 0.62 for buses/trucks, 0.68 for others)
      const visualScale = v.type === 'bus' || v.type === 'truck' ? 0.62 : 0.68;

      // Neighborhood zoom: scaled rotated rects based on physical vehicle length/width
      if (detail === 'neighborhood') {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(v.heading);
        ctx.fillStyle = v.type === 'emergency' ? '#FF3B5C' : v.color;
        const l = v.length * z * 0.5 * visualScale;
        const w = v.width * z * 0.5 * visualScale;
        ctx.fillRect(-l, -w, l * 2, w * 2);
        ctx.restore();
        continue;
      }

      // Street zoom: full detail (existing code below)

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(v.heading);

      const l = v.length * z * 0.5 * visualScale;
      const w = v.width * z * 0.5 * visualScale;

      // Base body
      ctx.beginPath();
      ctx.roundRect(-l, -w, l * 2, w * 2, Math.max(1, 1.5 * z));
      ctx.fillStyle = v.type === 'emergency' ? '#FFFFFF' : v.color;
      ctx.fill();

      // Vehicle type specific details (completely scale-invariant using fractions of l and w)
      if (v.type === 'car' || v.type === 'truck' || v.type === 'motorcycle') {
        // Windscreen (front 30%)
        ctx.fillStyle = 'rgba(180,220,255,0.6)';
        ctx.fillRect(l * 0.4, -w * 0.8, l * 0.4, w * 1.6);
        // Rear window
        if (v.type !== 'truck') {
          ctx.fillRect(-l * 0.7, -w * 0.8, l * 0.3, w * 1.6);
        }
      } else if (v.type === 'bus') {
        // Bus windows
        ctx.fillStyle = 'rgba(180,220,255,0.6)';
        const winLen = l * 0.15;
        const gap = l * 0.08;
        for (let x = -l + l * 0.2; x < l - l * 0.2; x += winLen + gap) {
          ctx.fillRect(x, -w + w * 0.2, winLen, w * 0.3);
          ctx.fillRect(x, w - w * 0.5, winLen, w * 0.3);
        }
      } else if (v.type === 'emergency') {
        // Red cross on roof - perfectly proportioned relative to vehicle size
        ctx.fillStyle = '#FF3B5C';
        ctx.fillRect(-l * 0.1, -w * 0.5, l * 0.2, w * 1.0);
        ctx.fillRect(-l * 0.25, -w * 0.2, l * 0.5, w * 0.4);
        
        // Alternating red/blue light bar at 4Hz
        const flashPhase = (Date.now() % 500 < 250);
        ctx.fillStyle = flashPhase ? '#FF3B5C' : '#3D9EFF';
        ctx.fillRect(l * 0.7, -w * 0.8, l * 0.15, w * 1.6);

        // Blinking strobe light on rear roof
        ctx.fillStyle = flashPhase ? '#3D9EFF' : '#FF3B5C';
        ctx.fillRect(-l * 0.9, -w * 0.3, l * 0.15, w * 0.6);
      }

      // Brake / Tail lights
      if (v.state === 'braking' || v.state === 'stopped') {
        ctx.fillStyle = 'rgba(255,59,92,0.9)'; // bright red
      } else {
        ctx.fillStyle = 'rgba(255,59,92,0.4)'; // dim red tail lights
      }
      ctx.fillRect(-l, -w, l * 0.15, w * 0.3);
      ctx.fillRect(-l, w - w * 0.3, l * 0.15, w * 0.3);

      // Headlights (at night)
      if (isNight) {
        ctx.fillStyle = 'rgba(255,240,180,0.9)';
        ctx.fillRect(l - l * 0.15, -w, l * 0.15, w * 0.3);
        ctx.fillRect(l - l * 0.15, w - w * 0.3, l * 0.15, w * 0.3);
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
      
      // Dynamic bob and sway animation gated by movement
      let bob = 0;
      let sway = 0;
      if (p.state === 'walking' || p.state === 'crossing' || p.state === 'jaywalking') {
        bob = Math.sin(p.animFrame) * 0.8 * this.camera.zoom;
        sway = Math.cos(p.animFrame * 0.7) * 0.5 * this.camera.zoom;
      }

      ctx.fillStyle = p.state === 'jaywalking' ? '#FF3B5C' : p.color;
      ctx.beginPath();
      ctx.arc(s.x + sway, s.y + bob, r, 0, Math.PI * 2);
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

  // ── Layer 3.2: Sensor Cones ──────────────────────────
  drawSensorCones(intersections) {
    if (!this.overlays.sensorCones) return;
    const ctx = this.ctx;
    const z = this.camera.zoom;
    const bounds = this.getViewportBounds(150);

    ctx.save();
    for (const [, int] of intersections) {
      if (!this.isInsideViewport(int.x, int.y, bounds)) continue;
      const s = this.worldToScreen(int.x, int.y);

      // Define coordinates for approaches
      const approachAngles = {
        N: -Math.PI / 2, // North approach comes from above
        S: Math.PI / 2,  // South approach comes from below
        E: 0,            // East approach comes from right
        W: Math.PI,      // West approach comes from left
      };

      for (const [dir, angle] of Object.entries(approachAngles)) {
        // Draw Camera FOV Cone (120m distance)
        const camRange = 120 * z;
        ctx.fillStyle = 'rgba(0, 232, 122, 0.02)';
        ctx.strokeStyle = 'rgba(0, 232, 122, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.arc(s.x, s.y, camRange, angle - 0.15, angle + 0.15);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw Radar Range Arc (45m distance, narrower beam)
        const radarRange = 45 * z;
        ctx.fillStyle = 'rgba(61, 158, 255, 0.03)';
        ctx.strokeStyle = 'rgba(61, 158, 255, 0.15)';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.arc(s.x, s.y, radarRange, angle - 0.08, angle + 0.08);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

