import { Vector2 } from './Vector2.js';

/**
 * Vehicle — Car/Bus/Truck/Motorcycle/Emergency entity
 * Moves along A* routes between intersections with realistic physics
 */

const VEHICLE_TYPES = {
  car:        { length: 14, width: 7,  maxSpeed: 180, color: null, accel: 120 },
  bus:        { length: 28, width: 10, maxSpeed: 120, color: '#FFB400', accel: 60 },
  truck:      { length: 22, width: 9,  maxSpeed: 100, color: '#8B8F98', accel: 50 },
  motorcycle: { length: 9,  width: 5,  maxSpeed: 220, color: '#E8EAED', accel: 160 },
  emergency:  { length: 18, width: 8,  maxSpeed: 200, color: '#FF3B5C', accel: 140 },
};

const CAR_COLORS = [
  '#3D9EFF','#00E87A','#FFB400','#FF3B5C','#9B6FFF',
  '#E8EAED','#5A8FCC','#CC7A5A','#6FCF97','#BB86FC',
  '#4FC3F7','#FF8A65','#AED581','#F48FB1','#90A4AE',
];

let vehicleIdCounter = 0;

export class Vehicle {
  static _pool = [];

  static create(type, route, graph) {
    if (this._pool.length > 0) {
      const v = this._pool.pop();
      v.init(type, route, graph);
      return v;
    }
    return new Vehicle(type, route, graph);
  }

  static free(v) {
    v.alive = false;
    this._pool.push(v);
  }

  constructor(type, route, graph) {
    this.init(type, route, graph);
  }

  init(type, route, graph) {
    const cfg = VEHICLE_TYPES[type] || VEHICLE_TYPES.car;
    this.id = `v${vehicleIdCounter++}`;
    this.type = type;
    this.length = cfg.length;
    this.width = cfg.width;
    this.maxSpeed = cfg.maxSpeed * (0.85 + Math.random() * 0.3);
    this.accel = cfg.accel;
    this.color = cfg.color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    this.sirenActive = type === 'emergency';
    
    this.route = route;       // array of intersection IDs
    this.routeIndex = 0;      // current segment index
    this.segmentProgress = 0; // 0-1 along current edge
    this.graph = graph;
    
    // Physics
    this.pos = new Vector2(0, 0);
    this.heading = 0;
    this.speed = 0;
    this.state = 'moving'; // moving, braking, stopped, turning
    this.waitTime = 0;
    this.distanceTravelled = 0;
    this.alive = true;
    
    // Lane offset
    this.laneOffset = undefined;
    this.currentEdgeId = null;
    
    // Initialize position
    this._updatePosition();
  }

  get currentEdge() {
    if (this.routeIndex >= this.route.length - 1) return null;
    return this.graph.getEdge(this.route[this.routeIndex], this.route[this.routeIndex + 1]);
  }

  get currentNode() {
    return this.graph.nodes.get(this.route[this.routeIndex]);
  }

  get nextNode() {
    if (this.routeIndex + 1 < this.route.length) {
      return this.graph.nodes.get(this.route[this.routeIndex + 1]);
    }
    return null;
  }

  _getDirection() {
    const edge = this.currentEdge;
    if (!edge) return null;
    const from = this.graph.nodes.get(edge.from);
    const to = this.graph.nodes.get(edge.to);
    if (!from || !to) return null;
    const dx = to.x - from.x, dy = to.y - from.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
    return dy > 0 ? 'S' : 'N';
  }

  _updatePosition() {
    const edge = this.currentEdge;
    if (!edge) {
      this.alive = false;
      return;
    }
    const from = this.graph.nodes.get(edge.from);
    const to = this.graph.nodes.get(edge.to);
    if (!from || !to) return;

    // Assign lane if entering new edge
    if (this.currentEdgeId !== edge.id) {
      this.currentEdgeId = edge.id;
      this.laneIndex = this.type === 'bus' ? edge.lanes - 1 : Math.floor(Math.random() * edge.lanes);
      if (this.sirenActive) this.laneIndex = Math.floor(Math.random() * edge.lanes);
    }
    const LANE_WIDTH = 8;
    const targetLaneOffset = (this.laneIndex - edge.lanes / 2 + 0.5) * LANE_WIDTH;
    
    // Smooth lane keeping
    if (this.laneOffset === undefined) this.laneOffset = targetLaneOffset;
    this.laneOffset += (targetLaneOffset - this.laneOffset) * 0.1;

    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    
    // Direction unit vector
    const dirX = dx / len, dirY = dy / len;
    // Perpendicular (right side of road)
    const perpX = -dirY, perpY = dirX;
    
    const t = this.segmentProgress;
    this.pos.x = from.x + dx * t + perpX * this.laneOffset;
    this.pos.y = from.y + dy * t + perpY * this.laneOffset;
    this.heading = Math.atan2(dy, dx);
  }

  update(dt, intersections, spatialGrid, weatherMult = 1, isNight = false) {
    if (!this.alive) return;
    
    const edge = this.currentEdge;
    if (!edge) { this.alive = false; return; }
    
    const speedLimit = edge.speedLimit * weatherMult;
    let desiredSpeed = Math.min(this.maxSpeed, speedLimit);
    
    // MACRO SIMULATION (Out of Focus Area)
    if (!this.inViewport) {
      const nextIntersection = this.nextNode;
      if (nextIntersection && this.segmentProgress > 0.8) {
        const intObj = intersections.get(this.route[this.routeIndex + 1]);
        if (intObj) {
          const dir = this._getDirection();
          if (dir && !intObj.trafficLight.canPass(dir) && !this.sirenActive) {
            desiredSpeed = 0;
          }
        }
      }
      
      if (this.speed < desiredSpeed) this.speed += this.accel * dt;
      else if (this.speed > desiredSpeed) this.speed -= this.accel * 2 * dt;
      
      this.speed = Math.max(0, Math.min(this.speed, this.maxSpeed));
      
      if (this.speed < 2) {
        this.state = 'stopped';
        this.waitTime += dt;
      } else {
        this.state = 'moving';
        this.waitTime = 0;
      }

      this.distanceTravelled += this.speed * dt;
      this.segmentProgress += (this.speed * dt) / edge.length;

      if (this.segmentProgress >= 1) {
        this.routeIndex++;
        this.segmentProgress = 0;
        this.currentEdgeId = null;
      }

      this._updatePosition();
      return;
    }
    
    // MICRO SIMULATION (Inside Focus Area)
    
    // Check traffic light at next intersection
    const nextIntersection = this.nextNode;
    if (nextIntersection && this.segmentProgress > 0.6) {
      const intObj = intersections.get(this.route[this.routeIndex + 1]);
      if (intObj) {
        const dir = this._getDirection();
        if (dir && !intObj.trafficLight.canPass(dir) && !this.sirenActive) {
          // Need to stop before intersection
          const remainingDist = (1 - this.segmentProgress) * edge.length;
          if (remainingDist < 40) {
            desiredSpeed = 0;
          } else if (remainingDist < 80) {
            desiredSpeed = desiredSpeed * (remainingDist / 80);
          }
        }
      }
    }
    
    // Check vehicles ahead (spatial grid query)
    if (spatialGrid) {
      const lookAhead = new Vector2(Math.cos(this.heading), Math.sin(this.heading));
      const MIN_HEADWAY_SECONDS = 1.8;
      const safeDistance = this.speed * MIN_HEADWAY_SECONDS + this.length;
      const checkDist = Math.max(30, safeDistance * 1.5);
      
      const checkPos = this.pos.add(lookAhead.mult(checkDist * 0.5));
      const nearby = spatialGrid.query(checkPos.x, checkPos.y, checkDist);
      
      for (const other of nearby) {
        if (other === this || !other.pos) continue;
        const toOther = other.pos.sub(this.pos);
        const dist = toOther.mag();
        if (dist < 5 || dist > checkDist) continue;
        
        // Check if other is ahead (dot product with heading)
        const dot = toOther.normalize().dot(lookAhead);
        if (dot > 0.5) {
          // Lateral check (only react if in same lane or close)
          const lateral = Math.abs(toOther.cross(lookAhead));
          if (lateral < 10) {
            const gap = dist - this.length;
            if (gap < safeDistance) {
              desiredSpeed = Math.min(desiredSpeed, (gap / safeDistance) * this.speed * 0.8);
              if (gap < this.length) desiredSpeed = 0;
            }
          }
        }
      }
    }
    
    // Apply acceleration/braking
    if (desiredSpeed > this.speed) {
      this.speed = Math.min(desiredSpeed, this.speed + this.accel * dt);
    } else {
      this.speed = Math.max(desiredSpeed, this.speed - this.accel * 2 * dt);
    }
    
    if (this.speed < 2) {
      this.speed = 0;
      this.state = 'stopped';
      this.waitTime += dt;
    } else {
      this.state = desiredSpeed < this.speed * 0.5 ? 'braking' : 'moving';
    }
    
    // Move along segment
    if (this.speed > 0 && edge.length > 0) {
      const advance = (this.speed * dt) / edge.length;
      this.segmentProgress += advance;
      this.distanceTravelled += this.speed * dt;
      
      // Check if reached next node
      if (this.segmentProgress >= 1) {
        this.segmentProgress = 0;
        this.routeIndex++;
        
        if (this.routeIndex >= this.route.length - 1) {
          this.alive = false;
          return;
        }
        
        const newEdge = this.currentEdge;
        if (!newEdge) { this.alive = false; return; }
      }
    }
    
    this._updatePosition();
  }
}
