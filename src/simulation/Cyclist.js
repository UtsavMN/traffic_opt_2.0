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

  update(dt, intersections, weatherMult = 1, spatialGrid = null) {
    if (!this.alive) return;
    const edge = this.currentEdge;
    if (!edge) { this.alive = false; return; }

    const scale = (typeof CANVAS_SCALE !== 'undefined' ? CANVAS_SCALE : 1) || 1;
    const speedLimitPxS = (edge.speedLimit * 1000 / 3600) * scale;
    let desiredSpeed = Math.min(this.maxSpeed, speedLimitPxS * 0.55) * weatherMult;

    // Proximity gap check (avoid overlapping lead entities on the shoulder)
    if (spatialGrid) {
      const nearby = spatialGrid.query(this.pos.x, this.pos.y, 25 * scale);
      for (const other of nearby) {
        if (other.id === this.id || !other.alive) continue;
        if (other.currentEdge?.id === edge.id && other.segmentProgress > this.segmentProgress) {
          const gap = (other.segmentProgress - this.segmentProgress) * edge.length;
          if (gap < 14 * scale) {
            desiredSpeed = Math.min(desiredSpeed, other.speed || 0);
            if (gap < 6 * scale) desiredSpeed = 0;
            break;
          }
        }
      }
    }

    // Traffic light check
    let stopAtLight = false;
    let stopDist = 14;
    const intObj = intersections.get(this.route[this.routeIndex + 1]);
    if (intObj && intObj.isSignalized && intObj.trafficLight) {
      const dir = this._getDirection();
      const canPass = intObj.canEdgePass ? intObj.canEdgePass(edge.id) : (dir && intObj.trafficLight.canPass(dir));
      if (!canPass) {
        stopDist = Math.max(12, (intObj.maxLanes || 2) * 2.85 * (typeof CANVAS_SCALE !== 'undefined' ? CANVAS_SCALE : 1) * 0.65);
        const rem = (1 - this.segmentProgress) * edge.length - stopDist;
        if (rem < 35) {
          desiredSpeed = 0;
          stopAtLight = true;
          if (rem <= 2) this.speed = 0;
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
      const advance = (this.speed * dt) / edge.length;
      let nextProgress = this.segmentProgress + advance;
      if (stopAtLight) {
        const maxProg = Math.max(0, (edge.length - stopDist) / edge.length);
        if (nextProgress >= maxProg) {
          nextProgress = maxProg;
          this.speed = 0;
        }
      }
      this.segmentProgress = nextProgress;
      if (this.segmentProgress >= 1) {
        this.segmentProgress = 0;
        this.routeIndex++;
        if (this.routeIndex >= this.route.length - 1) { this.alive = false; return; }
      }
    }
    this._updatePosition();
  }
}
