import { Vector2 } from './Vector2.js';
import { LANE_WIDTH_PX, VEHICLE_DIMS, CANVAS_SCALE } from '../constants.js';
import { interpolateGeoPoint } from '../utils/geoUtils.js';

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
    this.lengthM = dim.length;
    this.widthM = dim.width;
    this.length = dim.length * CANVAS_SCALE;
    this.width = dim.width * CANVAS_SCALE;
    this.lng = 0;
    this.lat = 0;
    this.bearingDeg = undefined;
    
    // Heterogeneous vehicle-specific speed & physics profiles
    this.driverFactor = 0.92 + Math.random() * 0.16; // Natural driver heterogeneity (avoids artificial locking)
    const baseFreeFlowKmh = dim.freeFlowSpeedKmh || 42;
    const baseApproachKmh = dim.approachSpeedKmh || 24;

    this.vFreeFlow = ((baseFreeFlowKmh * 1000) / 3600) * CANVAS_SCALE * this.driverFactor;
    this.vApproach = ((baseApproachKmh * 1000) / 3600) * CANVAS_SCALE * this.driverFactor;
    this.v0 = this.vFreeFlow;

    // Heterogeneous IDM parameters per vehicle class
    this.a = (dim.accel || 2.2) * CANVAS_SCALE;
    this.b = (dim.decel || 3.5) * CANVAS_SCALE;
    this.T = dim.headway || 1.1; // Safe time headway (seconds)
    this.s0 = (dim.minGap || 7.5) * CANVAS_SCALE; // Minimum bumper gap (pixels)

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
    // Spawn already at brisk cruising speed (85% to 100% of free-flow speed)
    this.speed = this.vFreeFlow * (0.85 + Math.random() * 0.15);
    this.state = 'moving';
    this.currentWaitTime = 0;
    this.tripWaitTime = 0;
    this.waitTime = 0;
    this.distanceTravelled = 0;
    this.alive = true;
    this.inViewport = true; // No more macro/micro split
    this.isOccluded = false; // Hidden when passing beneath flyover deck or through underpass tunnel
    this.destinationName = (route && route.destinationName) ? route.destinationName : 'Bengaluru Destination';
    this.originName = (route && route.originName) ? route.originName : 'Bengaluru Origin';
    this.isArriving = false;
    this.arrivalAlpha = 1.0;
    this.hasCompleted = false;
    this.clearingJunction = false;
    this.lastLaneChangeTime = 0;
    this.engine = null;
    
    this.currentEdgeId = null;
    this.subLaneTrack = 0;
    this.numTracks = 2;
    this.laneIndex = 0;
    this.laneOffset = undefined;
    this.lateralJitterM = 0;
    
    this._updatePosition(0);
  }

  get currentEdge() {
    if (this.routeIndex >= this.route.length - 1) return null;
    return this.graph.getEdge(this.route[this.routeIndex], this.route[this.routeIndex + 1]);
  }

  get layer() {
    const edge = this.currentEdge;
    return edge ? (edge.layer || 0) : 0;
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
    if (edge.cardinalDir) return edge.cardinalDir;
    const geom = edge.geometry;
    let dx, dy;
    if (geom && geom.length >= 2) {
      const pEnd = geom[geom.length - 1];
      const pPrev = geom[geom.length - 2];
      dx = pEnd.x - pPrev.x;
      dy = pEnd.y - pPrev.y;
    } else {
      const from = this.graph.nodes.get(edge.from);
      const to = this.graph.nodes.get(edge.to);
      if (!from || !to) return null;
      dx = to.x - from.x;
      dy = to.y - from.y;
    }
    edge.cardinalDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
    return edge.cardinalDir;
  }

  // Authentic Indian Multi-Stream Sub-Lane Track Distribution
  // Dynamically divides physical carriageway into 2, 3, or 4 side-by-side lines of travel
  _calculateTracks(edge) {
    const oppEdge = this.graph ? this.graph.edges.get(`${edge.to}->${edge.from}`) : null;
    const isTwoWay = !!oppEdge;
    const numLanes = edge.lanes || 1;
    const laneWidthM = edge.laneWidthM || 3.1;

    // Available directional carriageway width in meters
    const dirWidthM = numLanes * laneWidthM;

    let numTracks = 2;
    let trackOffsetsM = [];

    if (isTwoWay) {
      // In Left-Hand Traffic (LHT), forward vehicles travel on the LEFT of the centerline (negative offset).
      // Left road curb is at -dirWidthM. Median/centerline is at 0.
      if (dirWidthM >= 6.0) {
        numTracks = 4;
        trackOffsetsM = [
          -(dirWidthM - 0.65), // Track 0 (Left curb: slow traffic, buses, autos)
          -(dirWidthM * 0.68), // Track 1 (Mid-left: cars, autos)
          -(dirWidthM * 0.36), // Track 2 (Mid-right: cars, cabs)
          -0.55,               // Track 3 (Median line: fast cars, filtering two-wheelers)
        ];
      } else if (dirWidthM >= 3.6) {
        numTracks = 3;
        trackOffsetsM = [
          -(dirWidthM - 0.60), // Track 0 (Left curb: autos, buses, scooters)
          -(dirWidthM * 0.50), // Track 1 (Center: cars, autos)
          -0.55,               // Track 2 (Median line: cars, overtaking bikes)
        ];
      } else {
        numTracks = 2;
        trackOffsetsM = [
          -(dirWidthM - 0.50), // Track 0 (Left curb)
          -0.50,               // Track 1 (Right near median)
        ];
      }
    } else {
      // One-way carriageway: vehicles use the entire road from -dirWidthM/2 to +dirWidthM/2
      const halfW = dirWidthM / 2;
      if (dirWidthM >= 6.2) {
        numTracks = 4;
        trackOffsetsM = [
          -(halfW - 0.65),
          -(dirWidthM * 0.18),
          +(dirWidthM * 0.18),
          +(halfW - 0.65),
        ];
      } else if (dirWidthM >= 3.8) {
        numTracks = 3;
        trackOffsetsM = [
          -(halfW - 0.60),
          0.0,
          +(halfW - 0.60),
        ];
      } else {
        numTracks = 2;
        trackOffsetsM = [
          -(halfW - 0.50),
          +(halfW - 0.50),
        ];
      }
    }

    return { isTwoWay, dirWidthM, numTracks, trackOffsetsM };
  }

  _pickSubLaneTrack(type, numTracks) {
    if (numTracks <= 1) return 0;
    
    if (type === 'bus' || type === 'truck') {
      // BMTC buses and freight stick to the left curb track or adjacent track
      return Math.random() < 0.80 ? 0 : 1;
    }
    
    if (type === 'rickshaw') {
      // Auto-rickshaws love hugging the left curb!
      if (numTracks >= 3) {
        const r = Math.random();
        if (r < 0.65) return 0; // Left curb
        if (r < 0.90) return 1; // Center
        return 2; // Overtaking
      }
      return Math.random() < 0.75 ? 0 : 1;
    }
    
    if (type === 'car') {
      // Cars distribute across tracks, favoring center and right
      if (numTracks >= 4) {
        const r = Math.random();
        if (r < 0.15) return 0;
        if (r < 0.45) return 1;
        if (r < 0.80) return 2;
        return 3;
      }
      if (numTracks === 3) {
        const r = Math.random();
        if (r < 0.20) return 0;
        if (r < 0.60) return 1;
        return 2;
      }
      return Math.random() < 0.45 ? 0 : 1;
    }
    
    if (type === 'motorcycle') {
      // Agile two-wheelers distribute everywhere, especially left curb and median
      if (numTracks >= 4) {
        const r = Math.random();
        if (r < 0.35) return 0; // Left curb / gutter filtering
        if (r < 0.65) return numTracks - 1; // Centerline / median filtering
        return Math.floor(Math.random() * numTracks);
      }
      if (numTracks === 3) {
        const r = Math.random();
        if (r < 0.40) return 0;
        if (r < 0.70) return 2;
        return 1;
      }
      return Math.random() < 0.50 ? 0 : 1;
    }
    
    if (type === 'emergency') {
      // Emergency ambulance takes the fast overtaking track
      return numTracks - 1;
    }
    
    return Math.floor(Math.random() * numTracks);
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

    const { isTwoWay, dirWidthM, numTracks, trackOffsetsM } = this._calculateTracks(edge);
    this.numTracks = numTracks;

    if (this.currentEdgeId !== edge.id) {
      this.currentEdgeId = edge.id;
      this.subLaneTrack = this._pickSubLaneTrack(this.type, numTracks);
      this.laneIndex = this.subLaneTrack;

      // Driver personal lateral variation (+/- 0.15m)
      const seed = (this.id.charCodeAt(this.id.length - 1) || 5) % 11;
      this.lateralJitterM = (seed - 5) * 0.03;
    }

    const currentTrack = Math.max(0, Math.min(numTracks - 1, this.subLaneTrack ?? 0));
    const baseOffsetM = trackOffsetsM[currentTrack];
    const targetOffsetM = baseOffsetM + (this.lateralJitterM || 0);
    const targetLaneOffset = targetOffsetM * (CANVAS_SCALE || 1);

    if (this.laneOffset === undefined) this.laneOffset = targetLaneOffset;
    // Fluid lateral shift when changing tracks (~0.5s to 0.7s)
    const laneLerp = dt > 0 ? 1 - Math.pow(0.85, dt * 60) : 1;
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

    // Real-world Geographic GPS coordinates [lng, lat] and bearing for MapLibre rendering
    if (edge.geoCoords && edge.geoCoords.length >= 2) {
      const rawOffsetM = (this.laneOffset || 0) / (CANVAS_SCALE || 1);
      
      // Bound offset strictly within the physical road carriageway (no 1.28m clamp!)
      let laneOffsetM;
      if (isTwoWay) {
        // Forward traffic stays on the left: between -(dirWidthM - 0.25) and -0.25
        const minOffsetM = -(dirWidthM - 0.25);
        const maxOffsetM = -0.25;
        laneOffsetM = Math.max(minOffsetM, Math.min(maxOffsetM, rawOffsetM));
      } else {
        // One-way carriageway: between -(dirWidthM / 2 - 0.25) and +(dirWidthM / 2 - 0.25)
        const maxHalfM = dirWidthM / 2 - 0.25;
        laneOffsetM = Math.max(-maxHalfM, Math.min(maxHalfM, rawOffsetM));
      }

      const geo = interpolateGeoPoint(edge.geoCoords, this.segmentProgress, laneOffsetM);
      this.lng = geo.lng;
      this.lat = geo.lat;

      // Smooth angular interpolation: vehicles turn realistically through junctions and road bends
      const targetBearing = geo.bearing;
      if (this.bearingDeg === undefined) {
        this.bearingDeg = targetBearing;
      } else {
        let diff = (targetBearing - this.bearingDeg) % 360;
        if (diff < -180) diff += 360;
        if (diff > 180) diff -= 360;
        const turnSpeed = dt > 0 ? Math.min(1.0, dt * 14) : 1.0;
        this.bearingDeg = (this.bearingDeg + diff * turnSpeed + 360) % 360;
      }
    } else if (from.lng && to.lng) {
      this.lng = from.lng + (to.lng - from.lng) * this.segmentProgress;
      this.lat = from.lat + (to.lat - from.lat) * this.segmentProgress;
      const targetBearing = (this.heading * 180 / Math.PI + 90 + 360) % 360;
      if (this.bearingDeg === undefined) {
        this.bearingDeg = targetBearing;
      } else {
        let diff = (targetBearing - this.bearingDeg) % 360;
        if (diff < -180) diff += 360;
        if (diff > 180) diff -= 360;
        const turnSpeed = dt > 0 ? Math.min(1.0, dt * 14) : 1.0;
        this.bearingDeg = (this.bearingDeg + diff * turnSpeed + 360) % 360;
      }
    }
  }

  update(dt, intersections, spatialGrid, weatherMult = 1, isNight = false, now = performance.now()) {
    if (!this.alive) return;
    const edge = this.currentEdge;
    if (!edge) { this.alive = false; return; }
    const from = this.graph.nodes.get(edge.from);
    const to = this.graph.nodes.get(edge.to);

    // 1. Spatial Speed Dynamics based on vehicle type and road hierarchy
    // Arterial flyovers/highways allow full cruising speed, while urban collector/cross roads support authentic Bengaluru flow
    let tierSpeedCap = Infinity;
    if (edge.roadTier === 'cross') tierSpeedCap = ((44 * 1000) / 3600) * CANVAS_SCALE;
    else if (edge.roadTier === 'gully') tierSpeedCap = ((32 * 1000) / 3600) * CANVAS_SCALE;
    else if (edge.roadTier === 'collector') tierSpeedCap = ((52 * 1000) / 3600) * CANVAS_SCALE;

    const roadHierarchyMult = edge.roadTier === 'arterial' ? 1.25 : (edge.roadTier === 'main' ? 1.15 : (edge.roadTier === 'collector' ? 1.05 : 1.00));
    const freeFlowTarget = Math.min(this.vFreeFlow * roadHierarchyMult * weatherMult, tierSpeedCap);
    const approachTarget = Math.min(this.vApproach * weatherMult, tierSpeedCap);

    // --- 1. Find Lead Vehicle (Car Following with Sub-Lane Lateral Overlap Detection) ---
    // In multi-stream heterogeneous traffic, vehicles only follow a lead vehicle if their lateral paths overlap!
    // Vehicles in adjacent sub-lane tracks travel side-by-side without artificial braking.
    const queryRadius = Math.max(50, (this.speed * 2.2) + this.length);
    const ahead = spatialGrid.query(this.pos.x, this.pos.y, queryRadius);
    
    let leadVehicle = null;
    let minGap = Infinity;

    const nextEdgeId = (this.routeIndex + 2 < this.route.length)
      ? `${this.route[this.routeIndex + 1]}->${this.route[this.routeIndex + 2]}`
      : null;
    const nextEdge = nextEdgeId ? this.graph?.edges.get(nextEdgeId) : null;
    
    for (const other of ahead) {
      if (other.id === this.id || !other.alive) continue;
      
      // Case A: On the exact same road edge
      if (other.currentEdgeId === this.currentEdgeId) {
        if (other.segmentProgress > this.segmentProgress) {
          // Check lateral clearance between this vehicle and the other vehicle
          const lateralGap = Math.abs(this.laneOffset - other.laneOffset);
          // Heterogeneous Indian traffic lateral filtering:
          // Two-wheelers and auto-rickshaws filter along lateral gaps past stationary queues to the front stop line
          const filterBuffer = (this.type === 'motorcycle' && other.speed < 1.5)
            ? -0.22 * (CANVAS_SCALE || 1)
            : (this.type === 'rickshaw' && other.speed < 1.5)
              ? 0.05 * (CANVAS_SCALE || 1)
              : 0.28 * (CANVAS_SCALE || 1);
          const lateralOverlapThreshold = Math.max(0.45 * (CANVAS_SCALE || 1), ((this.width + other.width) * 0.5) + filterBuffer);
          
          if (lateralGap < lateralOverlapThreshold) {
            // Longitudinal gap between centers minus both half-lengths
            const gap = (other.segmentProgress - this.segmentProgress) * edge.length - (this.length + other.length) / 2;
            if (gap < minGap && gap >= 0) {
              minGap = gap;
              leadVehicle = other;
            }
          }
        }
      }
      // Case B: Cross-edge horizon detection — lead vehicle just entered downstream turn edge
      else if (nextEdge && other.currentEdgeId === nextEdgeId && this.segmentProgress > 0.65) {
        const lateralGap = Math.abs(this.laneOffset - other.laneOffset);
        const lateralOverlapThreshold = ((this.width + other.width) * 0.5) + (0.35 * (CANVAS_SCALE || 1));
        if (lateralGap < lateralOverlapThreshold) {
          const remainingOnCurrent = (1 - this.segmentProgress) * edge.length;
          const enteredOnNext = other.segmentProgress * nextEdge.length;
          const crossEdgeGap = remainingOnCurrent + enteredOnNext - (this.length + other.length) / 2;
          if (crossEdgeGap < minGap && crossEdgeGap >= 0) {
            minGap = crossEdgeGap;
            leadVehicle = other;
          }
        }
      }
    }

    // --- 2. Intersection Control & Green Wave Platoon Discharge ---
    let intersectionGap = Infinity;
    let stopAtIntersection = false;
    let distToIntersection = Infinity;
    let distToStopLine = Infinity;
    let stopLineDist = 15;
    let currentV0 = freeFlowTarget;
    let accelMult = 1.0;
    let headwayTarget = this.T;
    let inGreenDischarge = false;
    
    const nextIntersection = this.nextNode;
    if (nextIntersection) {
      const intObj = intersections.get(this.route[this.routeIndex + 1]);
      // Only signalized at-grade multi-way junctions require traffic light checks!
      // Continuous highways, flyovers, curved bends, and dead-ends are free-flow.
      if (intObj && intObj.isSignalized && intObj.trafficLight) {
        const dir = this._getDirection();
        const lightColor = intObj.getLightColorForEdge
          ? intObj.getLightColorForEdge(edge.id)
          : (dir ? (dir === 'N' || dir === 'S' ? intObj.trafficLight.getColorNS() : intObj.trafficLight.getColorEW()) : 'GREEN');
        
        // Stop line is located right before the junction entrance (IRC standard 3-4m)
        stopLineDist = Math.max(3.5, (intObj.maxLanes || 2) * (edge.laneWidthM || 2.85) * CANVAS_SCALE * 0.38);
        distToIntersection = (1 - this.segmentProgress) * edge.length;
        distToStopLine = distToIntersection - stopLineDist;

        // Spatial speed adaptation at different points:
        if (distToStopLine <= 0) {
          // A vehicle enters the junction legally if light is GREEN (or active emergency siren)
          if (lightColor === 'GREEN' || this.sirenActive) {
            this.clearingJunction = true;
          }
          if (this.clearingJunction) {
            // Inside intersection box: accelerate briskly to clear junction rapidly
            currentV0 = freeFlowTarget * 1.35;
            accelMult = 2.60;
            headwayTarget = 0.22;
            inGreenDischarge = true;
          }
        } else if (distToStopLine < 48 * CANVAS_SCALE) {
          // Approaching / queued within 48m of intersection (shortened from 130m so cruising speed is preserved)
          if (lightColor === 'GREEN' || this.sirenActive) {
            // Green Wave Surge: Eager Bengaluru green discharge
            currentV0 = freeFlowTarget * 1.25;
            accelMult = 2.40;
            headwayTarget = Math.max(0.25, this.T * 0.40);
            inGreenDischarge = true;
          } else {
            // Decelerate toward stop bar on amber/red
            currentV0 = approachTarget;
          }
        }

        // Corner turning slowdown (brisk 28 km/h entry speed into turns)
        if (this.routeIndex + 2 < this.route.length && distToStopLine < 25 * CANVAS_SCALE) {
          const nextNode = this.graph.nodes.get(this.route[this.routeIndex + 1]);
          const afterNode = this.graph.nodes.get(this.route[this.routeIndex + 2]);
          if (from && nextNode && afterNode) {
            const dx1 = nextNode.x - from.x, dy1 = nextNode.y - from.y;
            const dx2 = afterNode.x - nextNode.x, dy2 = afterNode.y - nextNode.y;
            const dot = dx1 * dx2 + dy1 * dy2;
            const m1 = Math.hypot(dx1, dy1), m2 = Math.hypot(dx2, dy2);
            if (m1 > 0 && m2 > 0 && (dot / (m1 * m2)) < 0.7) {
              const turnLimit = ((28 * 1000) / 3600) * CANVAS_SCALE;
              currentV0 = Math.min(currentV0, turnLimit);
            }
          }
        }

        // Strict Red / Yellow Signal Obedience (No bypassing unless active emergency siren)
        const isRedOrYellow = (lightColor !== 'GREEN');
        if (isRedOrYellow && !this.sirenActive && !this.clearingJunction) {
          stopAtIntersection = true;
          intersectionGap = Math.max(0.1, distToStopLine - (this.length / 2));
          // Hold vehicle firmly stopped when front bumper reaches stop line, preventing creeping
          if (distToStopLine <= (this.length / 2) + 0.8 * CANVAS_SCALE) {
            this.speed = 0;
          }
        } else if (!stopAtIntersection && distToStopLine > 0 && distToStopLine < 25 * CANVAS_SCALE) {
          // Yellow Box Rule ("Do Not Block The Box"):
          // Only stop if an intersecting vehicle is ACTUALLY stalled/deadlocked inside the core box
          const myApp = intObj.edgeToApproach ? intObj.edgeToApproach.get(edge.id) : null;
          const myPhase = myApp ? myApp.phaseIndex : (dir === 'N' || dir === 'S' ? 0 : 1);
          const centerOccupants = spatialGrid.query(intObj.x, intObj.y, stopLineDist * 0.55);
          for (const occupant of centerOccupants) {
            if (occupant.id === this.id || !occupant.alive) continue;
            const occApp = (intObj.edgeToApproach && occupant.currentEdge) ? intObj.edgeToApproach.get(occupant.currentEdge.id) : null;
            const occDir = occupant._getDirection();
            const occPhase = occApp ? occApp.phaseIndex : (occDir === 'N' || occDir === 'S' ? 0 : 1);
            if (myPhase !== occPhase && occupant.speed < 1.0 * (CANVAS_SCALE || 1)) {
              stopAtIntersection = true;
              intersectionGap = Math.max(0.5, distToStopLine - (this.length / 2));
              break;
            }
          }
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
    // ONLY applies if the vehicle entered legally on GREEN (clearingJunction && distToStopLine <= 0)
    // and is stuck inside the yellow box due to deadlocked cross-traffic.
    // A vehicle BEFORE the stop line at a RED/YELLOW signal must NEVER run the signal!
    if (this.clearingJunction && distToStopLine <= 0 && this.currentWaitTime > 3.0) {
      effectiveGap = Math.max(effectiveGap, 30 * (CANVAS_SCALE || 1));
      if (this.speed < 4 * (CANVAS_SCALE || 1)) {
        this.speed = Math.max(this.speed, 5 * (CANVAS_SCALE || 1)); // Crawl forward to clear the box
      }
    }

    // --- 3. Intelligent Driver Model (IDM) Physics with Platoon Start-Up Anticipation ---
    let dv_dt = 0;
    
    // Police discharge boost & queue compaction:
    const isUnderPolice = nextIntersection && intersections.get(this.route[this.routeIndex + 1])?.policeActive;
    const accelCurrent = (isUnderPolice ? this.a * 1.6 : this.a) * accelMult;
    const headwayCurrent = isUnderPolice ? 0.4 : headwayTarget;
    let minDistance = this.speed < 2 ? (this.s0 * 0.65) : this.s0;

    if (effectiveGap === Infinity) {
      // Free road term
      dv_dt = accelCurrent * (1 - Math.pow(this.speed / currentV0, 4));
    } else {
      // Interaction term
      let s_star = minDistance + Math.max(0, (this.speed * headwayCurrent) + (this.speed * deltaV) / (2 * Math.sqrt(accelCurrent * this.b)));
      
      // Platoon Green Wave Start-Up Anticipation:
      // When the light is GREEN or in green discharge, eliminate the start-up shockwave
      // As soon as the vehicle ahead starts rolling, trailing vehicles roll forward immediately
      if (!stopAtIntersection && (inGreenDischarge || this.clearingJunction || (leadVehicle && leadVehicle.speed > 0.6))) {
        if (this.speed < 4.0 * (CANVAS_SCALE || 1) && effectiveGap > minDistance * 0.60) {
          s_star = Math.min(s_star, effectiveGap * 0.60);
        }
      }

      dv_dt = accelCurrent * (1 - Math.pow(this.speed / currentV0, 4) - Math.pow(s_star / Math.max(0.1, effectiveGap), 2));
    }

    // Absolute zero-speed enforcement when stopped at a red light
    if (stopAtIntersection && distToStopLine <= 4.0 * (CANVAS_SCALE || 1) && !this.clearingJunction) {
      dv_dt = Math.min(0, dv_dt);
      this.speed = 0;
    } else {
      this.speed += dv_dt * dt;
    }
    this.speed = Math.max(0, this.speed); // No reversing

    // Wait time tracking (distinguishes current intersection wait from cumulative trip wait)
    if (this.speed < 2) {
      this.state = 'stopped';
      this.currentWaitTime += dt;
      this.tripWaitTime += dt;
      this.waitTime = this.currentWaitTime;
    } else {
      this.state = 'moving';
    }

    // --- 4. Sub-Lane Track Changing & Agile Two-Wheeler Filtering ---
    // In Bengaluru, vehicles do not sit passively behind stalled queues — they dynamically shift into open tracks!
    const isBike = (this.type === 'motorcycle');
    const isAuto = (this.type === 'rickshaw');
    const changeThreshold = isBike ? 0.85 : (isAuto ? 0.75 : 0.65);
    const cooldownMs = isBike ? 600 : (isAuto ? 900 : 1500);
    const minSafetyGap = isBike ? (4.0 * CANVAS_SCALE) : (isAuto ? (7.0 * CANVAS_SCALE) : (10.0 * CANVAS_SCALE));

    const numTracks = this.numTracks || 2;
    if (leadVehicle && (this.speed < currentV0 * changeThreshold || this.speed < 2.0) && numTracks > 1) {
      if (!this.lastLaneChangeTime) this.lastLaneChangeTime = 0;
      
      if (now - this.lastLaneChangeTime > cooldownMs) {
        const currentTrack = this.subLaneTrack ?? 0;
        const candidates = [];
        if (currentTrack > 0) candidates.push(currentTrack - 1);
        if (currentTrack < numTracks - 1) candidates.push(currentTrack + 1);
        
        let bestTrack = currentTrack;
        let foundSafeTrack = false;

        const { trackOffsetsM } = this._calculateTracks(edge);

        for (const candidateTrack of candidates) {
          const candidateOffset = trackOffsetsM[candidateTrack] * (CANVAS_SCALE || 1);
          let safe = true;

          const queryBox = spatialGrid.query(this.pos.x, this.pos.y, 45 * (CANVAS_SCALE || 1));
          for (const other of queryBox) {
            if (other.id === this.id || !other.alive) continue;
            if (other.currentEdgeId === this.currentEdgeId) {
              const otherOffset = other.laneOffset;
              const latDist = Math.abs(candidateOffset - otherOffset);
              const overlapThresh = ((this.width + other.width) * 0.5) + (0.28 * (CANVAS_SCALE || 1));
              
              if (latDist < overlapThresh) {
                // In collision zone of candidate track! Check longitudinal gap
                const longDist = (other.segmentProgress - this.segmentProgress) * edge.length;
                const gap = Math.abs(longDist) - (this.length + other.length) / 2;
                if (gap < minSafetyGap) {
                  safe = false;
                  break;
                }
              }
            }
          }

          if (safe) {
            bestTrack = candidateTrack;
            foundSafeTrack = true;
            break;
          }
        }

        if (foundSafeTrack && bestTrack !== currentTrack) {
          this.subLaneTrack = bestTrack;
          this.laneIndex = bestTrack;
          this.lastLaneChangeTime = now;
        }
      }
    }

    // --- 5. Move & Progress ---
    if (this.speed > 0 && edge.length > 0) {
      const advance = (this.speed * dt) / edge.length;
      let nextProgress = this.segmentProgress + advance;

      // Hard Physics Safety Barrier:
      // If stopped/approaching a red/yellow light and not legally clearing, progress CANNOT cross the stop line
      if (stopAtIntersection && !this.clearingJunction && !this.sirenActive) {
        const maxAllowedProgress = Math.max(0, (edge.length - stopLineDist) / edge.length);
        if (nextProgress >= maxAllowedProgress) {
          nextProgress = maxAllowedProgress;
          this.speed = 0;
        }
      }

      this.segmentProgress = nextProgress;
      this.distanceTravelled += this.speed * dt;
      
      if (this.segmentProgress >= 1) {
        this.segmentProgress = 0;
        const dischargeWait = this.currentWaitTime || 0;
        this.currentWaitTime = 0;
        this.waitTime = 0;
        this.clearingJunction = false;
        this.routeIndex++;
        
        // Track throughput across intersections
        const crossedNodeId = this.route[this.routeIndex];
        const crossedInt = intersections.get(crossedNodeId);
        if (crossedInt) {
          crossedInt.vehiclesPassedAccumulatedController = (crossedInt.vehiclesPassedAccumulatedController || 0) + 1;
          crossedInt.vehiclesPassedAccumulatedRL = (crossedInt.vehiclesPassedAccumulatedRL || 0) + 1;
          crossedInt.vehiclesPassedThisGreenPhase = (crossedInt.vehiclesPassedThisGreenPhase || 0) + 1;
        }
        if (this.engine) {
          this.engine.recordIntersectionDischarge(dischargeWait);
        }

        if (this.routeIndex >= this.route.length - 1) {
          this.hasCompleted = true;
          this.alive = false;
          this._recordTripComplete();
          return;
        }
      }
    }
    
    // Check destination arrival & real-life smooth pull-over / disappearance:
    const finalNode = this.route[this.route.length - 1];
    const finalPos = this.graph.nodes.get(finalNode);
    if (finalPos && this.routeIndex >= this.route.length - 2) {
      const dist = Math.hypot(this.pos.x - finalPos.x, this.pos.y - finalPos.y);
      // When approaching destination within ~40px (or on final 20% of edge):
      if (dist < 40 * CANVAS_SCALE || (this.routeIndex === this.route.length - 2 && this.segmentProgress > 0.80)) {
        this.isArriving = true;
        this.state = 'arriving';
        // Smoothly decelerate towards destination parking / curb stop
        this.speed = Math.max(1.8 * CANVAS_SCALE, this.speed * (1.0 - 2.8 * dt));
        // Gently pull over towards curb
        const curbTarget = (this.laneOffset >= 0 ? 3.0 : -3.0) * CANVAS_SCALE;
        this.laneOffset += (curbTarget - this.laneOffset) * 2.5 * dt;
        // Smoothly fade out into destination building / parking
        this.arrivalAlpha = Math.max(0, this.arrivalAlpha - 1.8 * dt);
        
        if (this.arrivalAlpha <= 0.05 || dist < 6 * CANVAS_SCALE || this.segmentProgress >= 0.99) {
          this.hasCompleted = true;
          this.alive = false;
          this._recordTripComplete();
          return;
        }
      }
    }
    
    // Top-down vertical occlusion:
    // If inside an underpass tunnel or crossing beneath an overhead flyover deck,
    // hide the vehicle momentarily until it emerges back into view!
    let occluded = false;
    if (edge.isTunnel || (edge.layer || 0) < 0) {
      if (this.segmentProgress > 0.05 && this.segmentProgress < 0.95) {
        occluded = true;
      }
    }
    if (!occluded && edge.underpasses && edge.underpasses.length > 0) {
      for (let i = 0; i < edge.underpasses.length; i++) {
        const up = edge.underpasses[i];
        if (this.segmentProgress >= up.startProgress && this.segmentProgress <= up.endProgress) {
          occluded = true;
          break;
        }
      }
    }
    this.isOccluded = occluded;

    this._updatePosition(dt);
  }

  _recordTripComplete() {
    if (typeof window !== 'undefined' && (window.__sancharMetrics || window.__trafficOptMetrics)) {
      (window.__sancharMetrics || window.__trafficOptMetrics).recordTripComplete({
        waitTime: this.waitTime,
        travelTime: (performance.now() - (this.spawnTime || 0)) / 1000,
        distance: this.distanceTravelled,
        destination: this.destinationName,
        origin: this.originName,
      });
    }
  }
}

