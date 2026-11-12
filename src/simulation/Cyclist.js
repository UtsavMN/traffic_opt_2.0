import { Vector2 } from './Vector2.js';
import { LANE_WIDTH_PX, CANVAS_SCALE } from '../constants.js';

/**
 * Cyclist — Bike lane entity, follows roads on the left shoulder (LHT)
 */
let cyclistIdCounter = 0;

export class Cyclist {
  constructor(route, graph) {
    this.id = `c${cyclistIdCounter++}`;
    this.route = route;
    this.graph = graph;
    this.routeIndex = 0;
    this.segmentProgress = 0;
    this.pos = new Vector2(0, 0);
    this.heading = 0;
    this.speed = 0;
    this.maxSpeed = 50 + Math.random() * 30; // slower than cars
    this.accel = 40;
    this.alive = true;
    this.waitTime = 0;
    this.state = 'moving';
    this.laneOffset = 9; // bike lane offset (further from center)
    this.color = '#6FCF97';
    this.length = 8;
    this.width = 3;
    this._updatePosition();
  }

  get currentEdge() {
    if (this.routeIndex >= this.route.length - 1) return null;
    return this.graph.getEdge(this.route[this.routeIndex], this.route[this.routeIndex + 1]);
  }

  _getDirection() {
    const edge = this.currentEdge;
    if (!edge) return null;
    const from = this.graph.nodes.get(edge.from);
    const to = this.graph.nodes.get(edge.to);
    const dx = to.x - from.x, dy = to.y - from.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
    return dy > 0 ? 'S' : 'N';
  }

  _updatePosition() {
    const edge = this.currentEdge;
    if (!edge) { this.alive = false; return; }
    const from = this.graph.nodes.get(edge.from);
    const to = this.graph.nodes.get(edge.to);
    if (!from || !to) return;
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const dirX = dx / len, dirY = dy / len;
    const perpX = -dirY, perpY = dirX; // points to the RIGHT
    const t = this.segmentProgress;

    // Cyclists ride on the outer left road shoulder in Left-Hand Traffic
    const oppEdge = this.graph.edges.get(`${edge.to}->${edge.from}`);
    const isTwoWay = !!oppEdge;
    const numLanes = edge.lanes || 1;
    const lw = LANE_WIDTH_PX();
    const bikeOffset = isTwoWay
      ? -(numLanes * lw + 1.2 * CANVAS_SCALE)
      : -(numLanes * 0.5 * lw + 1.2 * CANVAS_SCALE);

    this.pos.x = from.x + dx * t + perpX * bikeOffset;
    this.pos.y = from.y + dy * t + perpY * bikeOffset;
    this.heading = Math.atan2(dy, dx);
  }

  update(dt, intersections, weatherMult = 1) {
    if (!this.alive) return;
    const edge = this.currentEdge;
    if (!edge) { this.alive = false; return; }

    let desiredSpeed = Math.min(this.maxSpeed, edge.speedLimit * 0.5) * weatherMult;

    // Traffic light check
    if (this.segmentProgress > 0.7) {
      const intObj = intersections.get(this.route[this.routeIndex + 1]);
      if (intObj) {
        const dir = this._getDirection();
        if (dir && !intObj.trafficLight.canPass(dir)) {
          const rem = (1 - this.segmentProgress) * edge.length;
          if (rem < 30) desiredSpeed = 0;
        }
      }
    }

    if (this.speed < desiredSpeed) {
      this.speed = Math.min(desiredSpeed, this.speed + this.accel * dt);
    } else if (this.speed > desiredSpeed) {
      this.speed = Math.max(desiredSpeed, this.speed - this.accel * 2 * dt);
    }

    if (this.speed < 1) { this.speed = 0; this.state = 'stopped'; this.waitTime += dt; }
    else { this.state = 'moving'; }

    if (this.speed > 0 && edge.length > 0) {
      this.segmentProgress += (this.speed * dt) / edge.length;
      if (this.segmentProgress >= 1) {
        this.segmentProgress = 0;
        this.routeIndex++;
        if (this.routeIndex >= this.route.length - 1) { this.alive = false; return; }
      }
    }
    this._updatePosition();
  }
}
