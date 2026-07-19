/**
 * AccidentSystem — Spawn/clear traffic incidents with rerouting support
 */
let accidentIdCounter = 0;

export class AccidentSystem {
  constructor() {
    this.accidents = new Map();
    this.autoSpawn = false;
    this.autoSpawnInterval = 180; // seconds
    this.autoSpawnTimer = 60;
  }

  spawnAccident(graph, edgeId = null, severity = null) {
    if (!edgeId) {
      // Pick random edge
      const edges = Array.from(graph.edges.values());
      const edge = edges[Math.floor(Math.random() * edges.length)];
      edgeId = edge.id;
    }
    const edge = graph.edges.get(edgeId);
    if (!edge) return null;

    const sev = severity || ['minor', 'major', 'critical'][Math.floor(Math.random() * 3)];
    const durations = { minor: 30, major: 60, critical: 120 };
    const lanesBlocked = sev === 'minor' ? 1 : sev === 'major' ? Math.min(2, edge.lanes) : edge.lanes;

    const from = graph.nodes.get(edge.from);
    const to = graph.nodes.get(edge.to);
    const t = 0.3 + Math.random() * 0.4;

    const accident = {
      id: `acc${accidentIdCounter++}`,
      edgeId,
      edgeIdReverse: `${edge.to}->${edge.from}`,
      pos: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      severity: sev,
      lanesBlocked,
      duration: durations[sev],
      remaining: durations[sev],
      flashTimer: 0,
      flashOn: true,
    };

    this.accidents.set(accident.id, accident);
    // Mark edge as blocked
    edge.blocked = lanesBlocked;
    const rev = graph.edges.get(accident.edgeIdReverse);
    if (rev) rev.blocked = lanesBlocked;

    return accident;
  }

  clearAccident(id, graph) {
    const acc = this.accidents.get(id);
    if (!acc) return;
    const edge = graph.edges.get(acc.edgeId);
    if (edge) edge.blocked = 0;
    const rev = graph.edges.get(acc.edgeIdReverse);
    if (rev) rev.blocked = 0;
    this.accidents.delete(id);
  }

  getBlockedEdges(graph = null) {
    const blocked = new Set();
    for (const acc of this.accidents.values()) {
      if (graph) {
        const edge = graph.edges.get(acc.edgeId);
        if (edge && acc.lanesBlocked < edge.lanes) {
          continue; // partial blockage, still passable
        }
      }
      blocked.add(acc.edgeId);
      blocked.add(acc.edgeIdReverse);
    }
    return blocked;
  }

  update(dt, graph) {
    // Update existing accidents
    for (const [id, acc] of this.accidents) {
      acc.remaining -= dt;
      acc.flashTimer += dt;
      if (acc.flashTimer > 0.5) {
        acc.flashTimer = 0;
        acc.flashOn = !acc.flashOn;
      }
      if (acc.remaining <= 0) {
        this.clearAccident(id, graph);
      }
    }

    // Auto-spawn
    if (this.autoSpawn) {
      this.autoSpawnTimer -= dt;
      if (this.autoSpawnTimer <= 0) {
        this.autoSpawnTimer = this.autoSpawnInterval;
        this.spawnAccident(graph);
      }
    }
  }

  render(ctx) {
    for (const acc of this.accidents.values()) {
      if (!acc.flashOn) continue;
      const { x, y } = acc.pos;
      // Flashing amber triangle
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-8, 6);
      ctx.lineTo(8, 6);
      ctx.closePath();
      ctx.fillStyle = '#FFB400';
      ctx.fill();
      ctx.strokeStyle = '#0A0C0F';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Exclamation
      ctx.fillStyle = '#0A0C0F';
      ctx.font = 'bold 9px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, 4);
      ctx.restore();

      // Glow
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 25);
      grad.addColorStop(0, 'rgba(255,180,0,0.15)');
      grad.addColorStop(1, 'rgba(255,180,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, 25, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
