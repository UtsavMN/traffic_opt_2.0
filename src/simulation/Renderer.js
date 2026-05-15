import { SIGNAL_COLORS } from './TrafficLight.js';

/**
 * Renderer — All canvas draw calls, layered back-to-front
 */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.overlays = {
      heatmap: false,
      aiDecisions: true,
      vehicleRoutes: false,
      pedestrianPaths: false,
      zoneColors: true,
    };
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
    return {
      x: (wx - this.camera.x) * this.camera.zoom + this.width / 2,
      y: (wy - this.camera.y) * this.camera.zoom + this.height / 2,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.width / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.height / 2) / this.camera.zoom + this.camera.y,
    };
  }

  getViewportBounds(margin = 0) {
    const w2 = this.width / 2;
    const h2 = this.height / 2;
    const z = this.camera.zoom;
    return {
      minX: this.camera.x - w2 / z - margin,
      maxX: this.camera.x + w2 / z + margin,
      minY: this.camera.y - h2 / z - margin,
      maxY: this.camera.y + h2 / z + margin,
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
  drawRoads(graph) {
    const ctx = this.ctx;
    const widths = { highway: 32, arterial: 20, local: 12 };
    const colors = { highway: '#2A2E38', arterial: '#1E2228', local: '#171B21' };
    const bounds = this.getViewportBounds(200); // Generous margin for long roads

    for (const [, edge] of graph.edges) {
      // Only draw one direction for the physical road
      if (edge.from > edge.to) continue;
      const from = graph.nodes.get(edge.from);
      const to = graph.nodes.get(edge.to);
      if (!from || !to) continue;

      if (!this.isInsideViewport(from.x, from.y, bounds) && !this.isInsideViewport(to.x, to.y, bounds)) {
        continue;
      }

      const s1 = this.worldToScreen(from.x, from.y);
      const s2 = this.worldToScreen(to.x, to.y);
      const w = (widths[edge.type] || 12) * this.camera.zoom;

      // Road fill
      ctx.strokeStyle = colors[edge.type] || colors.local;
      ctx.lineWidth = w;
      ctx.lineCap = 'butt'; // better for intersections than round
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();

      // Center line (dashed)
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1 * this.camera.zoom;
      ctx.setLineDash([6 * this.camera.zoom, 8 * this.camera.zoom]);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Stop lines at both ends (since we only iterate one direction, we do both)
      const dx = s2.x - s1.x;
      const dy = s2.y - s1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 30 * this.camera.zoom) {
        const dirX = dx / len;
        const dirY = dy / len;
        const perpX = -dirY;
        const perpY = dirX;
        
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 3 * this.camera.zoom;
        const offset = 15 * this.camera.zoom;
        
        // Stop line at 's2' (approaching to)
        ctx.beginPath();
        ctx.moveTo(s2.x - dirX * offset + perpX * (w/2), s2.y - dirY * offset + perpY * (w/2));
        ctx.lineTo(s2.x - dirX * offset, s2.y - dirY * offset); // Only draw halfway for the right lane
        ctx.stroke();

        // Stop line at 's1' (approaching from)
        ctx.beginPath();
        ctx.moveTo(s1.x + dirX * offset - perpX * (w/2), s1.y + dirY * offset - perpY * (w/2));
        ctx.lineTo(s1.x + dirX * offset, s1.y + dirY * offset);
        ctx.stroke();
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
      const r = 6 * this.camera.zoom;

      // Intersection pad
      ctx.fillStyle = '#1A1E26';
      ctx.fillRect(s.x - r * 1.5, s.y - r * 1.5, r * 3, r * 3);

      // Traffic lights — 4 signal heads + crosswalks
      const tl = int.trafficLight;
      const offset = 18 * this.camera.zoom; // Push out past crosswalk
      const isNight = this.camera.zoom > 0; // Quick way to pass night mode? We'll just pass false for now, or use world time later

      ctx.save();
      ctx.translate(s.x, s.y);

      // Draw crosswalks (4 approaches)
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2 * this.camera.zoom;
      ctx.setLineDash([3 * this.camera.zoom, 3 * this.camera.zoom]);
      const cwOffset = 12 * this.camera.zoom;
      const cwWidth = 16 * this.camera.zoom;
      // N crosswalk
      ctx.beginPath(); ctx.moveTo(-cwWidth/2, -cwOffset); ctx.lineTo(cwWidth/2, -cwOffset); ctx.stroke();
      // S crosswalk
      ctx.beginPath(); ctx.moveTo(-cwWidth/2, cwOffset); ctx.lineTo(cwWidth/2, cwOffset); ctx.stroke();
      // E crosswalk
      ctx.beginPath(); ctx.moveTo(cwOffset, -cwWidth/2); ctx.lineTo(cwOffset, cwWidth/2); ctx.stroke();
      // W crosswalk
      ctx.beginPath(); ctx.moveTo(-cwOffset, -cwWidth/2); ctx.lineTo(-cwOffset, cwWidth/2); ctx.stroke();
      ctx.setLineDash([]);

      // North signal (faces north traffic)
      this._drawSignalHead(ctx, -offset, offset, tl.getColorNS(), 0);
      // South signal
      this._drawSignalHead(ctx, offset, -offset, tl.getColorNS(), Math.PI);
      // East signal
      this._drawSignalHead(ctx, -offset, -offset, tl.getColorEW(), Math.PI/2);
      // West signal
      this._drawSignalHead(ctx, offset, offset, tl.getColorEW(), -Math.PI/2);

      // Traffic Police
      if (int.policeActive) {
        ctx.fillStyle = '#3D9EFF'; // Police blue
        ctx.beginPath();
        ctx.arc(0, 0, 4 * this.camera.zoom, 0, Math.PI * 2);
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
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 18 * this.camera.zoom, 0, Math.PI * 2);
        ctx.stroke();

        // Inner glow
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 20 * this.camera.zoom);
        grad.addColorStop(0, `rgba(155,111,255,${alpha * 0.2})`);
        grad.addColorStop(1, 'rgba(155,111,255,0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }
  }

  _drawSignalHead(ctx, x, y, colorName, angle) {
    const z = this.camera.zoom;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Housing: 8x20px
    const w = 8 * z;
    const h = 20 * z;
    
    ctx.fillStyle = '#1A1E26'; // dark gray
    ctx.beginPath();
    ctx.roundRect(-w/2, -h/2, w, h, 2 * z);
    ctx.fill();

    // Night rim light
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1 * z;
    ctx.stroke();

    const drawBulb = (yPos, cName, hexColor) => {
      const active = colorName === cName;
      ctx.fillStyle = active ? hexColor : 'rgba(20,20,20,0.8)';
      ctx.beginPath();
      ctx.arc(0, yPos, 2.5 * z, 0, Math.PI * 2);
      ctx.fill();
      
      if (active) {
        ctx.fillStyle = hexColor.replace(')', ',0.3)').replace('rgb', 'rgba').replace('#FF3B5C', 'rgba(255,59,92,0.3)').replace('#FFB400', 'rgba(255,180,0,0.3)').replace('#00E87A', 'rgba(0,232,122,0.3)');
        ctx.beginPath();
        ctx.arc(0, yPos, 4.5 * z, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    drawBulb(-h/2 + 3.5*z, 'RED', '#FF3B5C');
    drawBulb(0, 'YELLOW', '#FFB400');
    drawBulb(h/2 - 3.5*z, 'GREEN', '#00E87A');

    ctx.restore();
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

    for (const v of vehicles) {
      if (!v.alive) continue;
      if (!this.isInsideViewport(v.pos.x, v.pos.y, bounds)) continue;

      const s = this.worldToScreen(v.pos.x, v.pos.y);
      const z = this.camera.zoom;

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
        ctx.arc(0, 0, 20 * z, 0, Math.PI * 2);
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
    const ctx = this.ctx;
    for (const [, node] of graph.nodes) {
      const s = this.worldToScreen(node.x, node.y);
      const z = this.camera.zoom;
      const size = 10 * z;

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1.5 * z;
      // Draw crosswalk stripes around intersection
      for (let i = -3; i <= 3; i++) {
        const offset = i * 2.5 * z;
        // Horizontal crosswalks (north and south)
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
}
