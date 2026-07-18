import { Vector2 } from './Vector2.js';
import { LANE_WIDTH_PX, VEHICLE_DIMS, CANVAS_SCALE } from '../constants.js';

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
  constructor(type, route, graph) {
    // Support no-arg construction for pool pre-allocation
    if (type && route && graph) {
      this.init(type, route, graph);
    } else {
      // Uninitialized placeholder — will be init()'d by pool.acquire()
      this.alive = false;
      this.pos = new Vector2(0, 0);
      this.route = null;
      this.graph = null;
    }
  }

  init(type, route, graph) {
    const dim = VEHICLE_DIMS[type] || VEHICLE_DIMS.car;
    this.id = `v${vehicleIdCounter++}`;
    this.type = type;
    this.length = dim.length * CANVAS_SCALE;
    this.width = dim.width * CANVAS_SCALE;
    const baseSpeedPxS = (dim.maxSpeed * 1000 / 3600) * CANVAS_SCALE;
    this.maxSpeed = baseSpeedPxS * (0.85 + Math.random() * 0.3);
    this.accel = dim.accel * CANVAS_SCALE; // Accel in pixels/s^2
    this.color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    if (type === 'bus') this.color = '#FFB400';
    if (type === 'truck') this.color = '#8B8F98';
    if (type === 'motorcycle') this.color = '#E8EAED';
    if (type === 'emergency') {
      this.color = '#FF3B5C';
      this.sirenActive = true;
    } else {
      this.sirenActive = false;
    }
    
    this.route = route;       // array of intersection IDs
    this.routeIndex = 0;      // current segment index
    this.segmentProgress = 0; // 0-1 along current edge
    this.graph = graph;
    this.spawnTime = performance.now();
    
    // Physics
    if (!this.pos) this.pos = new Vector2(0, 0);
    this.pos.x = 0;
    this.pos.y = 0;
    this.heading = 0;
    this.speed = 0;
    this.state = 'moving'; // moving, braking, stopped, turning
    this.waitTime = 0;
    this.distanceTravelled = 0;
    this.alive = true;
    this.inViewport = false;
    
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

  _updatePosition(dt = 0.016) {
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
    const targetLaneOffset = (this.laneIndex - edge.lanes / 2 + 0.5) * LANE_WIDTH_PX();
    
    // Smooth lane keeping (frame-rate independent)
    if (this.laneOffset === undefined) this.laneOffset = targetLaneOffset;
    const laneLerp = 1 - Math.pow(0.9, dt * 60);
    this.laneOffset += (targetLaneOffset - this.laneOffset) * laneLerp;

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
    
    const targetHeading = Math.atan2(dy, dx);
    if (this.heading === undefined || this.speed < 0.1) {
      this.heading = targetHeading;
    } else {
      let diff = targetHeading - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const headingLerp = 1 - Math.pow(0.85, dt * 60);
      this.heading += diff * headingLerp;
    }
  }

  update(dt, intersections, spatialGrid, weatherMult = 1, isNight = false) {
    if (!this.alive) return;
    
    const edge = this.currentEdge;
    if (!edge) { this.alive = false; return; }
    
    const speedLimit = ((edge.speedLimit || 40) * 1000 / 3600) * CANVAS_SCALE * weatherMult;
    let desiredSpeed = Math.min(this.maxSpeed, speedLimit);
    
    // MACRO SIMULATION (Out of Focus Area)
    if (!this.inViewport) {
      this._macroUpdate(dt, intersections, edge, desiredSpeed);
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
          // Calculate distance to stop line (usually 15px back from intersection)
          const rem = (1 - this.segmentProgress) * edge.length;
          if (rem < 35) desiredSpeed = 0;
        }
      }
    }
    
    // Car following (IDM-like logic)
    const ahead = spatialGrid.query(this.pos.x, this.pos.y, 45); // Query nearby vehicles
    let minGap = Infinity;
    let leadVehicle = null;
    
    for (const other of ahead) {
      if (other.id === this.id || !other.alive) continue;
      // Must be on the same edge and lane
      if (other.currentEdgeId !== this.currentEdgeId || other.laneIndex !== this.laneIndex) continue;
      
      // Must be in front of us
      if (other.segmentProgress > this.segmentProgress) {
        const gap = (other.segmentProgress - this.segmentProgress) * edge.length - this.length;
        if (gap < minGap && gap > -5) {
          minGap = gap;
          leadVehicle = other;
        }
      }
    }
    
    if (leadVehicle) {
      // Safety distance based on speed (1.8s headway rule)
      const safeDistance = 15 + this.speed * 1.8;
      if (minGap < safeDistance) {
        // Adjust speed to lead vehicle
        desiredSpeed = Math.min(desiredSpeed, leadVehicle.speed * Math.max(0, (minGap - 8) / (safeDistance - 8)));
      }
    }
    
    // Acceleration / Braking
    if (this.speed < desiredSpeed) {
      this.speed += this.accel * dt;
    } else if (this.speed > desiredSpeed) {
      // Hard braking if speed is significantly higher than desired
      const brakeFactor = desiredSpeed === 0 ? 3 : 1.5;
      this.speed -= this.accel * brakeFactor * dt;
    }
    
    this.speed = Math.max(0, Math.min(this.speed, this.maxSpeed));
    
    if (this.speed < 2) {
      this.state = 'stopped';
      this.waitTime += dt;
    } else {
      this.state = 'moving';
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
          this._recordTripComplete();
          this.alive = false;
          return;
        }
        
        const newEdge = this.currentEdge;
        if (!newEdge) { this.alive = false; return; }
      }
    }
    
    const finalNode = this.route[this.route.length - 1];
    const finalPos = this.graph.nodes.get(finalNode);
    if (finalPos && this.routeIndex === this.route.length - 2) {
      const dist = Math.hypot(this.pos.x - finalPos.x, this.pos.y - finalPos.y);
      if (dist < 15) {
        this._recordTripComplete();
        this.alive = false;
        return;
      }
    }
    
    this._updatePosition(dt);
  }

  _recordTripComplete() {
    if (typeof window !== 'undefined' && window.__zenithMetrics) {
      window.__zenithMetrics.recordTripComplete({
        waitTime: this.waitTime,
        travelTime: (performance.now() - (this.spawnTime || 0)) / 1000,
        distance: this.distanceTravelled,
      });
    }
  }

  _macroUpdate(dt, intersections, edge, desiredSpeed) {
    const nextIntersection = this.nextNode;
    // Base speed on edge density
    if (edge.density !== undefined && edge.lanes) {
      // 100 vehicles per km per lane is typical jam density
      // Length is in pixels. Let's convert density per 100 meters
      const lengthM = edge.length / CANVAS_SCALE;
      const densityPer100m = (edge.density / (lengthM / 100)) / edge.lanes;
      if (densityPer100m > 5) desiredSpeed *= Math.max(0.1, 1 - (densityPer100m / 20));
    }

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
    }

    if (this.speed > 0 && edge.length > 0) {
      this.distanceTravelled += this.speed * dt;
      this.segmentProgress += (this.speed * dt) / edge.length;

      if (this.segmentProgress >= 1) {
        this.routeIndex++;
        this.segmentProgress = 0;
        this.currentEdgeId = null;
        if (this.routeIndex >= this.route.length - 1) {
          this._recordTripComplete();
          this.alive = false;
          return;
        }
      }
    }

    this._updatePosition();
  }
}
