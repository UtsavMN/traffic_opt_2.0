import { Vector2 } from './Vector2.js';
import { LANE_WIDTH_PX, VEHICLE_DIMS, CANVAS_SCALE } from '../constants.js';

/**
 * Vehicle — Car/Bus/Truck/Motorcycle/Emergency entity
 * Moves along A* routes between intersections with realistic physics
 */

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
    
    // Phase 1 Safety Enforcer: Vehicle width must not exceed 80% of lane width
    if (this.width > 0.8 * LANE_WIDTH_PX()) {
      console.warn(`[Physics] Vehicle ${type} width (${this.width.toFixed(1)}px) exceeds 80% of lane width (${(0.8 * LANE_WIDTH_PX()).toFixed(1)}px)!`);
    }

    const baseSpeedPxS = (dim.maxSpeed * 1000 / 3600) * CANVAS_SCALE;
    this.maxSpeed = baseSpeedPxS * (0.85 + Math.random() * 0.3);
    this.accel = dim.accel * CANVAS_SCALE; // Accel in pixels/s^2
    this.color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    if (type === 'bus') this.color = '#FFB400';
    if (type === 'truck') this.color = '#8B8F98';
    if (type === 'motorcycle') this.color = '#E8EAED';
    if (type === 'rickshaw') this.color = '#00B0FF'; // Bright blue-green for auto rickshaws
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
      
      // Calibrated sub-lane offset for motorcycles (sub-lane filtering)
      this.subLaneIndex = this.type === 'motorcycle' ? (Math.random() * 0.6 - 0.3) : 0;
    }
    const subOffset = this.type === 'motorcycle' ? (this.subLaneIndex || 0) * LANE_WIDTH_PX() : 0;
    const targetLaneOffset = (this.laneIndex - edge.lanes / 2 + 0.5) * LANE_WIDTH_PX() + subOffset;
    
    // Smooth lane keeping (frame-rate independent)
    if (this.laneOffset === undefined) this.laneOffset = targetLaneOffset;
    const laneLerp = 1 - Math.pow(0.9, dt * 60);
    this.laneOffset += (targetLaneOffset - this.laneOffset) * laneLerp;

    const geom = edge.geometry;
    let x = from.x, y = from.y;
    let headingDx = to.x - from.x, headingDy = to.y - from.y;
    let dirX = 0, dirY = 0;
    
    if (geom && geom.length >= 2) {
      const targetDist = this.segmentProgress * edge.length;
      let accDist = 0;
      let found = false;
      
      for (let i = 0; i < geom.length - 1; i++) {
        const p1 = geom[i], p2 = geom[i+1];
        const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        
        if (targetDist <= accDist + segLen + 0.001) {
          const u = segLen > 0 ? (targetDist - accDist) / segLen : 0;
          x = p1.x + (p2.x - p1.x) * u;
          y = p1.y + (p2.y - p1.y) * u;
          headingDx = p2.x - p1.x;
          headingDy = p2.y - p1.y;
          found = true;
          break;
        }
        accDist += segLen;
      }
      
      if (!found) {
        const last = geom[geom.length - 1];
        const prev = geom[geom.length - 2];
        x = last.x;
        y = last.y;
        headingDx = last.x - prev.x;
        headingDy = last.y - prev.y;
      }
    } else {
      const dx = to.x - from.x, dy = to.y - from.y;
      x = from.x + dx * this.segmentProgress;
      y = from.y + dy * this.segmentProgress;
    }
    
    const hLen = Math.hypot(headingDx, headingDy) || 1;
    dirX = headingDx / hLen;
    dirY = headingDy / hLen;
    
    const perpX = -dirY, perpY = dirX;
    
    this.pos.x = x + perpX * this.laneOffset;
    this.pos.y = y + perpY * this.laneOffset;
    
    const targetHeading = Math.atan2(headingDy, headingDx);
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

    // Apply Greenshields density scaling to desiredSpeed (prevents micro/macro boundary speed discontinuity)
    desiredSpeed *= this._getDensitySpeedMultiplier(edge);
    
    // MACRO SIMULATION (Out of Focus Area)
    if (!this.inViewport) {
      this._macroUpdate(dt, intersections, edge, desiredSpeed);
      return;
    }

    // Dynamic Lane Changing check
    if (edge.lanes > 1 && this.segmentProgress > 0.15 && this.segmentProgress < 0.85 && Math.random() < 0.05) {
      this._checkDynamicLaneChange(edge, spatialGrid);
    }
    
    // MICRO SIMULATION (Inside Focus Area)
    
    // Check traffic light at next intersection
    const nextIntersection = this.nextNode;
    if (nextIntersection && this.segmentProgress > 0.6) {
      const intObj = intersections.get(this.route[this.routeIndex + 1]);
      if (intObj) {
        const dir = this._getDirection();
        const lightColor = dir ? (dir === 'N' || dir === 'S' ? intObj.trafficLight.getColorNS() : intObj.trafficLight.getColorEW()) : 'GREEN';
        
        let lightCanPass = (lightColor === 'GREEN');
        if (lightColor === 'YELLOW') {
          const rem = (1 - this.segmentProgress) * edge.length;
          // If we are close enough to clear, we can pass; otherwise, we must stop!
          lightCanPass = (rem < 20 * CANVAS_SCALE);
        }

        // Even if light is green, if there is a vehicle currently in the intersection center, we must stop to prevent T-bone collisions!
        let intersectionBlocked = false;
        if (this.segmentProgress > 0.8) {
          intersectionBlocked = this._isIntersectionCenterOccupied(intObj, spatialGrid);
        }

        const shouldStop = (!lightCanPass && !this.sirenActive) || intersectionBlocked;

        if (shouldStop) {
          // Calculate distance to stop line (usually 15px back from intersection)
          const rem = (1 - this.segmentProgress) * edge.length;
          const stopMargin = 15 * CANVAS_SCALE;
          if (rem < stopMargin + 20) {
            // Smooth braking before the stop line, clamping to 0 if at stop line
            const interp = Math.max(0, (rem - stopMargin) / 20);
            desiredSpeed = Math.min(desiredSpeed, desiredSpeed * interp);
            if (rem < stopMargin) desiredSpeed = 0;
          }
        }
      }
    }
    
    // Turning deceleration: check turn angle to next segment when approaching intersection
    if (this.routeIndex + 2 < this.route.length && this.segmentProgress > 0.8) {
      const nextEdge = this.graph.getEdge(this.route[this.routeIndex + 1], this.route[this.routeIndex + 2]);
      if (nextEdge) {
        const from1 = this.graph.nodes.get(edge.from);
        const to1 = this.graph.nodes.get(edge.to);
        const from2 = this.graph.nodes.get(nextEdge.from);
        const to2 = this.graph.nodes.get(nextEdge.to);
        if (from1 && to1 && from2 && to2) {
          const heading1 = Math.atan2(to1.y - from1.y, to1.x - from1.x);
          const heading2 = Math.atan2(to2.y - from2.y, to2.x - from2.x);
          let angleDiff = Math.abs(heading2 - heading1);
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          angleDiff = Math.abs(angleDiff);

          // If turn is sharp (> 10 degrees), decelerate proportionally
          if (angleDiff > 0.15) {
            desiredSpeed *= Math.max(0.3, 1 - (angleDiff / Math.PI) * 0.7);
          }
        }
      }
    }
    
    // Car following (IDM-like logic) with speed-adaptive spatial query radius
    const queryRadius = Math.max(45, (this.speed * 2.0) + this.length);
    const ahead = spatialGrid.query(this.pos.x, this.pos.y, queryRadius);
    let minGap = Infinity;
    let leadVehicle = null;
    
    for (const other of ahead) {
      if (other.id === this.id || !other.alive) continue;
      // Must be on the same edge and lane
      if (other.currentEdgeId !== this.currentEdgeId || other.laneIndex !== this.laneIndex) continue;
      
      // Sub-lane filtering bypass: if motorcycles are side-by-side laterally, do not trigger car-following brake!
      if (this.type === 'motorcycle' && other.type === 'motorcycle') {
        if (Math.abs((other.laneOffset || 0) - (this.laneOffset || 0)) > 6) continue;
      }
      
      // Must be in front of us
      if (other.segmentProgress > this.segmentProgress) {
        const gap = (other.segmentProgress - this.segmentProgress) * edge.length - this.length;
        if (gap < minGap && gap > -10) {
          minGap = gap;
          leadVehicle = other;
        }
      }
    }
    
    if (leadVehicle) {
      // Safety distance based on speed (1.8s headway rule) scaled by weather friction lag
      const weatherBrakeMult = Math.min(3.0, 1.0 / (weatherMult * weatherMult));
      const safeDistance = (15 * CANVAS_SCALE + this.speed * 1.8) * weatherBrakeMult;
      const minSafetyGap = 3.0 * CANVAS_SCALE * weatherBrakeMult; // larger gap when wet/slippery
      
      if (minGap < minSafetyGap) {
        desiredSpeed = 0; // Hard emergency override: stop completely to prevent collision/overlap!
      } else if (minGap < safeDistance) {
        // Adjust speed smoothly using IDM safety interpolation
        const interp = Math.max(0, (minGap - minSafetyGap) / (safeDistance - minSafetyGap));
        desiredSpeed = Math.min(desiredSpeed, leadVehicle.speed * interp);
      }
    }

    // Overtaking & Lane changing physics
    if (this.inViewport && leadVehicle && leadVehicle.speed < desiredSpeed * 0.75) {
      const now = performance.now();
      if (!this.lastLaneChangeTime) this.lastLaneChangeTime = 0;
      if (now - this.lastLaneChangeTime > 3000) {
        const possibleLanes = [];
        if (this.laneIndex - 1 >= 0) possibleLanes.push(this.laneIndex - 1);
        if (this.laneIndex + 1 < edge.lanes) possibleLanes.push(this.laneIndex + 1);

        let laneChangePossible = false;
        let targetLane = this.laneIndex;

        for (const tLane of possibleLanes) {
          let gapAhead = Infinity;
          let gapBehind = Infinity;

          // Query spatial grid for safety check in the target lane
          const targetLaneAhead = spatialGrid.query(this.pos.x, this.pos.y, 50);
          for (const other of targetLaneAhead) {
            if (other.id === this.id || !other.alive) continue;
            if (other.currentEdgeId !== this.currentEdgeId || other.laneIndex !== tLane) continue;

            const dist = (other.segmentProgress - this.segmentProgress) * edge.length;
            if (dist > 0) {
              const gap = dist - other.length;
              if (gap < gapAhead) gapAhead = gap;
            } else {
              const gap = -dist - this.length;
              if (gap < gapBehind) gapBehind = gap;
            }
          }

          // Safety gap check: 35px ahead and 25px behind
          if (gapAhead > 35 && gapBehind > 25) {
            targetLane = tLane;
            laneChangePossible = true;
            break;
          }
        }

        if (laneChangePossible) {
          this.laneIndex = targetLane;
          this.lastLaneChangeTime = now;
        }
      }
    }
    
    // Acceleration / Braking
    if (this.speed < desiredSpeed) {
      this.speed += this.accel * dt;
      this.state = 'moving';
    } else if (this.speed > desiredSpeed) {
      // Hard braking if speed is significantly higher than desired
      const brakeFactor = desiredSpeed === 0 ? 3 : 1.5;
      this.speed -= this.accel * brakeFactor * dt;
      this.state = desiredSpeed < this.speed * 0.75 ? 'braking' : 'moving';
    }
    
    this.speed = Math.max(0, Math.min(this.speed, this.maxSpeed));
    
    if (this.speed < 2) {
      this.state = 'stopped';
      this.waitTime += dt;
    } else if (this.state !== 'braking') {
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
    // Note: desiredSpeed is already pre-scaled by Greenshields density in update() before delegate call

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

    this._updatePosition(dt);
  }

  _getDensitySpeedMultiplier(edge) {
    if (!edge || edge.density === undefined || !edge.lanes) return 1.0;
    const lengthKm = edge.length / (CANVAS_SCALE * 1000);
    if (lengthKm <= 0) return 1.0;
    const densityK = (edge.density / lengthKm) / edge.lanes; // PCU per km per lane
    const jamDensity = 130; // standard jam density threshold
    return Math.max(0.05, 1 - Math.min(1, densityK / jamDensity));
  }

  _isIntersectionCenterOccupied(intersection, spatialGrid) {
    // Query vehicles within 25px of the intersection center
    const nearby = spatialGrid.query(intersection.x, intersection.y, 25);
    for (const other of nearby) {
      if (other.id === this.id || !other.alive) continue;
      // If the other vehicle is extremely close to the center and not on our same edge/lane (cross-traffic)
      const dx = other.pos.x - intersection.x;
      const dy = other.pos.y - intersection.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 20 && other.currentEdgeId !== this.currentEdgeId) {
        return true;
      }
    }
    return false;
  }

  _checkDynamicLaneChange(edge, spatialGrid) {
    const candidates = [];
    if (this.laneIndex > 0) candidates.push(this.laneIndex - 1);
    if (this.laneIndex < edge.lanes - 1) candidates.push(this.laneIndex + 1);
    
    if (candidates.length === 0) return;
    
    const queryRadius = Math.max(30, this.length * 2);
    const nearby = spatialGrid.query(this.pos.x, this.pos.y, queryRadius);
    
    const blockedLanes = new Set();
    for (const other of nearby) {
      if (other.id === this.id || !other.alive || other.currentEdgeId !== this.currentEdgeId) continue;
      
      if (other.laneIndex !== this.laneIndex) {
        const progressDiff = Math.abs(other.segmentProgress - this.segmentProgress) * edge.length;
        if (progressDiff < this.length + 5) {
          blockedLanes.add(other.laneIndex);
        }
      }
    }
    
    const freeLanes = candidates.filter(l => !blockedLanes.has(l));
    if (freeLanes.length > 0) {
      this.laneIndex = freeLanes[Math.floor(Math.random() * freeLanes.length)];
    }
  }
}
