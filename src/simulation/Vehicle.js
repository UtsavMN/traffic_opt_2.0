import { Vector2 } from './Vector2.js';
import { LANE_WIDTH_PX, VEHICLE_DIMS, CANVAS_SCALE } from '../constants.js';

const CAR_COLORS = [
  '#3D9EFF','#00E87A','#FFB400','#FF3B5C','#9B6FFF',
  '#E8EAED','#5A8FCC','#CC7A5A','#6FCF97','#BB86FC',
  '#4FC3F7','#FF8A65','#AED581','#F48FB1','#90A4AE',
];

let vehicleIdCounter = 0;

export class Vehicle {
  constructor(type, route, graph) {
    if (type && route && graph) {
      this.init(type, route, graph);
    } else {
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
    
    // Physics parameters for IDM
    const baseSpeedPxS = (dim.maxSpeed * 1000 / 3600) * CANVAS_SCALE;
    this.v0 = baseSpeedPxS * (0.85 + Math.random() * 0.3); // Desired speed
    this.a = dim.accel * CANVAS_SCALE; // Max acceleration
    this.b = dim.accel * 1.5 * CANVAS_SCALE; // Comfortable deceleration
    this.T = 1.2; // Safe time headway (seconds)
    this.s0 = 10 * CANVAS_SCALE; // Minimum bumper-to-bumper distance (pixels)

    this.color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    if (type === 'bus') this.color = '#FFB400';
    if (type === 'truck') this.color = '#8B8F98';
    if (type === 'motorcycle') this.color = '#E8EAED';
    if (type === 'rickshaw') this.color = '#2E7D32';
    if (type === 'emergency') {
      this.color = '#FF3B5C';
      this.sirenActive = true;
    } else {
      this.sirenActive = false;
    }
    
    this.route = route;
    this.routeIndex = 0;
    this.segmentProgress = 0;
    this.graph = graph;
    this.spawnTime = performance.now();
    
    // State
    if (!this.pos) this.pos = new Vector2(0, 0);
    this.pos.x = 0;
    this.pos.y = 0;
    this.heading = 0;
    this.speed = 0;
    this.state = 'moving';
    this.waitTime = 0;
    this.distanceTravelled = 0;
    this.alive = true;
    this.inViewport = true; // No more macro/micro split
    
    this.currentEdgeId = null;
    this.laneIndex = undefined;
    this.laneOffset = undefined;
    
    this._updatePosition(0);
  }

  get currentEdge() {
    if (this.routeIndex >= this.route.length - 1) return null;
    return this.graph.getEdge(this.route[this.routeIndex], this.route[this.routeIndex + 1]);
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

  _updatePosition(dt) {
    const edge = this.currentEdge;
    if (!edge) {
      this.alive = false;
      return;
    }
    const from = this.graph.nodes.get(edge.from);
    const to = this.graph.nodes.get(edge.to);
    if (!from || !to) return;

    if (this.currentEdgeId !== edge.id) {
      this.currentEdgeId = edge.id;
      const numLanes = edge.lanes || 1;

      // Real Indian Road Lane Distribution:
      // - Lane 0 = Leftmost curb lane (buses, trucks, auto-rickshaws, slow movers)
      // - Higher lanes = Faster overtaking lanes towards the center dividing line
      if (numLanes <= 1) {
        this.laneIndex = 0;
      } else if (this.type === 'bus' || this.type === 'truck' || this.type === 'rickshaw') {
        this.laneIndex = 0; // Heavy/slow traffic sticks to the left curb lane
      } else if (this.sirenActive) {
        this.laneIndex = numLanes - 1; // Emergency vehicles take the fast lane
      } else if (this.type === 'car') {
        // Cars distribute across lanes (preferring lane 1 on multi-lane highways)
        this.laneIndex = (numLanes >= 3)
          ? (Math.random() < 0.65 ? 1 : (Math.random() < 0.5 ? 2 : 0))
          : (Math.random() < 0.65 ? 1 : 0);
      } else {
        // Motorcycles distribute freely
        this.laneIndex = Math.floor(Math.random() * numLanes);
      }
      this.laneIndex = Math.max(0, Math.min(numLanes - 1, this.laneIndex));
    }
    
    // Indian Left-Hand Traffic (LHT) Lateral Offset:
    // When an opposing edge exists, the road carries traffic in both directions along the same centerline.
    // perpX, perpY points to the RIGHT of the vehicle's heading.
    // In India (LHT), forward vehicles travel on the LEFT side of the centerline (negative offset).
    const oppEdge = this.graph ? this.graph.edges.get(`${edge.to}->${edge.from}`) : null;
    const isTwoWay = !!oppEdge;
    const numLanes = edge.lanes || 1;
    const lw = LANE_WIDTH_PX();

    let baseOffset = 0;
    if (isTwoWay) {
      // Innermost fast lane (numLanes - 1) is adjacent to yellow median line: -0.5 * lw
      // Outermost curb lane (0) is adjacent to left road shoulder: -(numLanes - 0.5) * lw
      baseOffset = -((numLanes - 1 - this.laneIndex) + 0.5) * lw;
    } else {
      // One-way carriageway: distributed symmetrically about the centerline
      baseOffset = (this.laneIndex - (numLanes - 1) / 2) * lw;
    }

    // Intra-lane lateral staggering (Indian multi-vehicle filtering):
    // Narrow 2-wheelers (0.8m) stagger left/right so 2 motorcycles can ride abreast in 1 lane.
    let intraLaneOffset = 0;
    if (this.type === 'motorcycle') {
      const charCode = this.id.charCodeAt(this.id.length - 1) || 0;
      const stagger = (charCode % 2 === 0 ? 0.22 : -0.22);
      intraLaneOffset = stagger * lw;
    } else if (this.type === 'rickshaw') {
      intraLaneOffset = -0.10 * lw; // Auto-rickshaws hug the left curb
    }

    const targetLaneOffset = baseOffset + intraLaneOffset;
    
    if (this.laneOffset === undefined) this.laneOffset = targetLaneOffset;
    // Smooth lane transition
    const laneLerp = dt > 0 ? 1 - Math.pow(0.9, dt * 60) : 1;
    this.laneOffset += (targetLaneOffset - this.laneOffset) * laneLerp;

    const geom = edge.geometry;
    let x = from.x, y = from.y;
    let headingDx = to.x - from.x, headingDy = to.y - from.y;
    
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
    
    this.heading = Math.atan2(headingDy, headingDx);
    const perpX = -Math.sin(this.heading);
    const perpY = Math.cos(this.heading);
    
    this.pos.x = x + perpX * this.laneOffset;
    this.pos.y = y + perpY * this.laneOffset;
  }

  update(dt, intersections, spatialGrid, weatherMult = 1, isNight = false) {
    if (!this.alive) return;
    const edge = this.currentEdge;
    if (!edge) { this.alive = false; return; }

    const speedLimit = ((edge.speedLimit || 40) * 1000 / 3600) * CANVAS_SCALE * weatherMult;
    const currentV0 = Math.min(this.v0, speedLimit);
    
    // --- 1. Find Lead Vehicle (Car Following) ---
    const queryRadius = Math.max(45, (this.speed * 2.0) + this.length);
    const ahead = spatialGrid.query(this.pos.x, this.pos.y, queryRadius);
    
    let leadVehicle = null;
    let minGap = Infinity;
    
    for (const other of ahead) {
      if (other.id === this.id || !other.alive) continue;
      if (other.currentEdgeId !== this.currentEdgeId || other.laneIndex !== this.laneIndex) continue;
      
      if (other.segmentProgress > this.segmentProgress) {
        // Gap is distance between centers minus both half-lengths
        const gap = (other.segmentProgress - this.segmentProgress) * edge.length - (this.length + other.length) / 2;
        if (gap < minGap && gap >= 0) {
          minGap = gap;
          leadVehicle = other;
        }
      }
    }

    // --- 2. Intersection Control & Yellow Box Junction Clearance ---
    let intersectionGap = Infinity;
    let stopAtIntersection = false;
    let distToIntersection = Infinity;
    let stopLineDist = 15;
    
    const nextIntersection = this.nextNode;
    if (nextIntersection) {
      const intObj = intersections.get(this.route[this.routeIndex + 1]);
      if (intObj) {
        const dir = this._getDirection();
        const lightColor = dir ? (dir === 'N' || dir === 'S' ? intObj.trafficLight.getColorNS() : intObj.trafficLight.getColorEW()) : 'GREEN';
        
        // Stop line is located before the junction center
        stopLineDist = Math.max(14, (intObj.maxLanes || 2) * LANE_WIDTH_PX() * 0.65);
        distToIntersection = (1 - this.segmentProgress) * edge.length;
        const distToStopLine = distToIntersection - stopLineDist;

        // RULE 1: Only vehicles BEFORE the stop line (distToStopLine > 0) can stop.
        // Once a vehicle has crossed the stop line (distToStopLine <= 0), it has entered
        // the intersection box and MUST NEVER STOP — it has right-of-way to clear the junction!
        if (distToStopLine > 0) {
          // Check Traffic Signal: Stop for RED or YELLOW unless ambulance with active siren
          if (lightColor !== 'GREEN' && !this.sirenActive) {
            stopAtIntersection = true;
          }

          // RULE 2: Yellow Box Rule ("Do Not Block The Box"):
          // If light is GREEN, check if an intersecting cross-traffic vehicle is clearing the box.
          // Arriving vehicles wait BEHIND THE STOP LINE (not inside the intersection).
          if (!stopAtIntersection && distToStopLine < 30 * CANVAS_SCALE) {
            const isMyPhaseNS = (dir === 'N' || dir === 'S');
            const centerOccupants = spatialGrid.query(intObj.x, intObj.y, stopLineDist * 0.85);
            for (const occupant of centerOccupants) {
              if (occupant.id === this.id || !occupant.alive) continue;
              // Opposing traffic on the same corridor (NS or EW) is NOT cross-traffic!
              const occDir = occupant._getDirection();
              const isOccPhaseNS = (occDir === 'N' || occDir === 'S');
              // Only hold if an actual cross-phase vehicle is clearing or blocking the box
              if (isMyPhaseNS !== isOccPhaseNS && occupant.speed < 4.0) {
                stopAtIntersection = true;
                break;
              }
            }
          }

          if (stopAtIntersection) {
            // Vehicle smoothly comes to rest behind the stop line
            intersectionGap = Math.max(0.5, distToStopLine - (this.length / 2));
          }
        } else {
          // Vehicle is INSIDE the intersection past the stop line.
          // NEVER STOP! Accelerate through with right-of-way to clear the box.
          stopAtIntersection = false;
        }
      }
    }

    // Combine actual lead vehicle and virtual intersection stop line
    let effectiveGap = Infinity;
    let deltaV = 0; // Relative speed (v - v_lead)

    if (leadVehicle && minGap < intersectionGap) {
      effectiveGap = minGap;
      deltaV = this.speed - leadVehicle.speed;
    } else if (stopAtIntersection && intersectionGap < Infinity) {
      effectiveGap = intersectionGap;
      deltaV = this.speed - 0; // Virtual vehicle at stop line
    }

    // --- 2.1 Anti-Gridlock Watchdog ---
    // In real Bangalore traffic, congestion occurs on approaches, not 4-way deadlocks in empty junctions.
    // If any vehicle is in or near an intersection and has been delayed > 2.0s,
    // force clearance right-of-way to prevent cascading gridlock!
    if (distToIntersection < stopLineDist * 1.8 && this.waitTime > 2.0) {
      effectiveGap = Infinity;
      if (this.speed < 5 * CANVAS_SCALE) {
        this.speed = Math.max(this.speed, 6 * CANVAS_SCALE); // Crawl forward to clear the box
      }
    }

    // --- 3. Intelligent Driver Model (IDM) Physics ---
    let dv_dt = 0;
    
    if (effectiveGap === Infinity) {
      // Free road term
      dv_dt = this.a * (1 - Math.pow(this.speed / currentV0, 4));
    } else {
      // Interaction term
      const s_star = this.s0 + Math.max(0, (this.speed * this.T) + (this.speed * deltaV) / (2 * Math.sqrt(this.a * this.b)));
      dv_dt = this.a * (1 - Math.pow(this.speed / currentV0, 4) - Math.pow(s_star / Math.max(0.1, effectiveGap), 2));
    }

    // Update speed
    this.speed += dv_dt * dt;
    this.speed = Math.max(0, this.speed); // No reversing

    // Wait time tracking
    if (this.speed < 2) {
      this.state = 'stopped';
      this.waitTime += dt;
    } else {
      this.state = 'moving';
    }

    // --- 4. Simple Lane Changing (Overtaking) ---
    // Only attempt to change lanes if significantly slowed down by a vehicle
    if (leadVehicle && this.speed < currentV0 * 0.7 && edge.lanes > 1) {
      const now = performance.now();
      if (!this.lastLaneChangeTime) this.lastLaneChangeTime = 0;
      
      if (now - this.lastLaneChangeTime > 2000) { // 2 second cooldown
        const candidates = [];
        if (this.laneIndex > 0) candidates.push(this.laneIndex - 1);
        if (this.laneIndex < edge.lanes - 1) candidates.push(this.laneIndex + 1);
        
        let bestLane = this.laneIndex;
        let foundSafeLane = false;

        for (const tLane of candidates) {
          let safe = true;
          const targetAhead = spatialGrid.query(this.pos.x, this.pos.y, 50);
          for (const other of targetAhead) {
            if (other.id === this.id || !other.alive) continue;
            if (other.currentEdgeId === this.currentEdgeId && other.laneIndex === tLane) {
               const dist = (other.segmentProgress - this.segmentProgress) * edge.length;
               const gap = Math.abs(dist) - (this.length + other.length) / 2;
               if (gap < 20 * CANVAS_SCALE) {
                 safe = false; // Too close!
                 break;
               }
            }
          }
          if (safe) {
            bestLane = tLane;
            foundSafeLane = true;
            break;
          }
        }

        if (foundSafeLane) {
          this.laneIndex = bestLane;
          this.lastLaneChangeTime = now;
        }
      }
    }

    // --- 5. Move & Progress ---
    if (this.speed > 0 && edge.length > 0) {
      const advance = (this.speed * dt) / edge.length;
      this.segmentProgress += advance;
      this.distanceTravelled += this.speed * dt;
      
      if (this.segmentProgress >= 1) {
        this.segmentProgress = 0;
        this.routeIndex++;
        
        // Track throughput
        const crossedNodeId = this.route[this.routeIndex];
        const crossedInt = intersections.get(crossedNodeId);
        if (crossedInt) {
          crossedInt.vehiclesPassedAccumulatedController = (crossedInt.vehiclesPassedAccumulatedController || 0) + 1;
        }

        if (this.routeIndex >= this.route.length - 1) {
          this._recordTripComplete();
          this.alive = false;
          return;
        }
      }
    }
    
    // Check destination arrival
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
    if (typeof window !== 'undefined' && (window.__sancharMetrics || window.__trafficOptMetrics)) {
      (window.__sancharMetrics || window.__trafficOptMetrics).recordTripComplete({
        waitTime: this.waitTime,
        travelTime: (performance.now() - (this.spawnTime || 0)) / 1000,
        distance: this.distanceTravelled,
      });
    }
  }
}

