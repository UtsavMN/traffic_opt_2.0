import { SpatialGrid } from './SpatialGrid.js';
import { useMetricsStore } from '../store/metricsStore.js';
import { Intersection } from './Intersection.js';
import { VehiclePool } from './VehiclePool.js';
import { Cyclist } from './Cyclist.js';
import { WeatherSystem } from './WeatherSystem.js';
import { TimeOfDay } from './TimeOfDay.js';
import { AccidentSystem } from './AccidentSystem.js';
import { Renderer } from './Renderer.js';
import { TrafficPolice } from './TrafficPolice.js';
import { findPath } from '../utils/pathfinding.js';
import { RollingAverage } from '../utils/statistics.js';
import { SensorRealismLayer } from '../ai/SensorRealismLayer.js';
import { CANVAS_SCALE } from '../constants.js';

/**
 * Engine — Main simulation loop. Manages all entities, systems, and rendering.
 */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.spatialGrid = new SpatialGrid(50);
    this.vehiclePool = new VehiclePool(1500);
    this.maxVehicles = 1200;

    // City graph (set by loadCity)
    this.graph = null;
    this.intersections = new Map(); // id -> Intersection
    this.intersectionGrid = null; // SpatialGrid for O(1) intersection lookup

    // Entity pools
    this.vehicles = [];
    this.pedestrians = [];
    this.cyclists = [];
    this.policeUnits = [];

    // Systems
    this.weather = new WeatherSystem();
    this.timeOfDay = new TimeOfDay(8);
    this.accidents = new AccidentSystem();
    this.sensorRealism = new SensorRealismLayer();
    this.sensorTimer = 0;

    // AI Controller (set externally)
    this.aiController = null;
    this.buildingsBitmap = null;

    // Simulation state
    this.running = false;
    this.paused = false;
    this.simSpeed = 1;
    this.spawnRate = 2.0; // vehicles/sec base (calibrated for 1200+ citywide commuter density)
    this.spawnTimer = 0;
    this.pedSpawnTimer = 0;
    this.cyclistSpawnTimer = 0;
    this.densityTimer = 0;

    // Metrics
    this.totalSpawned = 0;
    this.totalDespawned = 0;
    this.totalWaitTime = 0;
    this.vehiclesPassed = 0;
    this.fps = 60;
    this._fpsFrames = 0;
    this._fpsTimer = 0;
    this._lastTime = 0;
    this.avgWait = new RollingAverage(200);
    this.completedTrips = []; // Timestamps of completed trips
    this.intersectionDischarges = []; // Timestamps of intersection crossings
    this._simTime = 0;

    // Callbacks for React state bridge
    this.onMetricsUpdate = null;
    this.onAIDecision = null;

    // Selected intersection
    this.selectedIntersectionId = null;

    // Web Worker for pathfinding (module worker mode required for ES module imports)
    this._pfWorker = new Worker(new URL('../workers/pathfinder.worker.js', import.meta.url), { type: 'module' });
    this._pfCallbacks = new Map();
    this._pfWorker.onmessage = ({ data }) => {
      const cb = this._pfCallbacks.get(data.id);
      if (cb) { cb(data.route); this._pfCallbacks.delete(data.id); }
    };

    // Bind
    this._loop = this._loop.bind(this);
  }

  recordIntersectionDischarge() {
    this.vehiclesPassed++;
    this.intersectionDischarges.push(this._simTime);
  }

  restart() {
    for (const v of this.vehicles) {
      if (v) this.vehiclePool.release(v);
    }
    this.vehicles = [];
    this.cyclists = [];
    if (this.accidents) this.accidents.clearAll(this.graph);
    
    for (const [, int] of this.intersections) {
      int.queues = { N: 0, S: 0, E: 0, W: 0 };
      int.maxWait = 0;
      int.totalWaitSeconds = 0;
      int.vehiclesPassedAccumulatedController = 0;
      int.vehiclesPassedAccumulatedRL = 0;
      int.vehiclesPassedThisGreenPhase = 0;
      int.aiCooldown = 0;
      if (int.trafficLight) {
        int.trafficLight.forcePhase(0); // Reset to standard starting phase
        int.trafficLight.setGreenDuration(18);
      }
    }
    
    this.spatialGrid.clear();
    this.totalSpawned = 0;
    this.totalDespawned = 0;
    this.totalWaitTime = 0;
    this.vehiclesPassed = 0;
    this.completedTrips = [];
    this.intersectionDischarges = [];
    this._simTime = 0;
    this._spawnTimer = 0;
    this.avgWait = new RollingAverage(200);

    if (this.onMetricsUpdate) {
      this.onMetricsUpdate({
        vehicleCount: 0,
        waitingCount: 0,
        pedestrianCount: 0,
        cyclistCount: 0,
        avgWaitTime: 0,
        throughput: 0,
        totalSpawned: 0,
        totalDespawned: 0,
        fps: this.fps,
        timeOfDay: this.timeOfDay.hour,
        timeLocked: this.timeOfDay.isLocked,
        weather: this.weather.current,
        simSpeed: this.simSpeed,
        spawnRate: this.spawnRate,
        intersectionCount: signalizedCount || this.intersections.size,
        policeCount: this.policeUnits.length,
        avgSpeedKmh: 40.0,
        congestionLevel: 0,
        avgImbalance: 0,
      });
    }
  }

  loadCity(graph) {
    if (!this._pfWorker) return;
    this.graph = graph;
    this._indexDistricts(graph);
    this.intersections.clear();
    this.vehicles = [];
    this.pedestrians = [];
    this.cyclists = [];
    this.policeUnits = [];
    this.totalSpawned = 0;
    this.totalDespawned = 0;
    this.totalWaitTime = 0;
    this.vehiclesPassed = 0;

    // Initialize Worker with serialized graph data to prevent DataCloneError
    const serializedGraph = {
      nodes: Array.from(graph.nodes.entries()),
      edges: Array.from(graph.edges.entries()),
      adjacency: Array.from(graph.adjacency.entries()).map(([k, v]) => [k, Array.from(v)]),
    };
    this._pfWorker.postMessage({ type: 'INIT', graph: serializedGraph });

    for (const [id, node] of graph.nodes) {
      const isElevated = (node.layer || 0) > 0 || node.isBridge;
      const neighbors = graph.getNeighbors(id);
      const allNeighbors = new Set(neighbors);
      for (const [, edge] of graph.edges) {
        if (edge.to === id) allNeighbors.add(edge.from);
      }
      
      // True signalized junction criteria:
      // 1. Surface level (never on elevated flyovers, bridges, or underpass troughs)
      // 2. Multi-way crossroads or T-junctions (allNeighbors.size >= 3)
      // Continuous highway corridors, mid-block curves, dead-ends, and flyovers are NOT signalized.
      const isSignalized = !isElevated && allNeighbors.size >= 3;

      const intersection = new Intersection(id, node.x, node.y, node.zone, node.layer || 0, isSignalized);
      // Wire up green phase callback (decoupled from React in Intersection.js)
      intersection.onGreenPhaseEnd = (hadVehicles) => {
        if (typeof window !== 'undefined' && (window.__sancharMetrics || window.__trafficOptMetrics)) {
          useMetricsStore.getState().recordGreenPhase(hadVehicles);
        }
      };
      this.intersections.set(id, intersection);
    }

    // Compute maxLanes for each intersection to dynamically scale junction rendering
    for (const [, int] of this.intersections) {
      int.maxLanes = 2; // default fallback
    }
    for (const [, edge] of graph.edges) {
      const fromInt = this.intersections.get(edge.from);
      const toInt = this.intersections.get(edge.to);
      const oppEdge = graph.edges.get(`${edge.to}->${edge.from}`);
      const roadLanes = oppEdge ? (edge.lanes + oppEdge.lanes) : edge.lanes;
      if (fromInt) fromInt.maxLanes = Math.max(fromInt.maxLanes || 2, roadLanes);
      if (toInt) toInt.maxLanes = Math.max(toInt.maxLanes || 2, roadLanes);
    }

    this.intersectionGrid = new SpatialGrid(80);
    for (const int of this.intersections.values()) {
      this.intersectionGrid.insert({
        pos: { x: int.x, y: int.y },
        intersection: int
      });
    }

    // Auto-center and auto-zoom on the city
    this.renderer.resize();
    let cx = 0, cy = 0, count = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [, n] of graph.nodes) {
      cx += n.x; cy += n.y; count++;
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    if (count > 0) {
      cx /= count; cy /= count;
      const pad = 80;
      const gw = maxX - minX + pad * 2;
      const gh = maxY - minY + pad * 2;
      const zx = (this.renderer.width || 800) / gw;
      const zy = (this.renderer.height || 600) / gh;
      const fitZoom = Math.max(0.08, Math.min(zx, zy, 2));
      this.renderer.camera.centerOn(cx, cy, fitZoom);
      console.log(`[Camera] Centered on (${cx.toFixed(0)}, ${cy.toFixed(0)}) zoom=${fitZoom.toFixed(3)}`);
    }
  }

  _indexDistricts(graph) {
    this.districts = {
      cantonment: { name: 'Cantonment & Shivaji Nagar Hub', nodes: [] },
      benson_town: { name: 'Benson Town & Richards Town Layout', nodes: [] },
      frazer_town: { name: 'Frazer Town & Coles Commercial Belt', nodes: [] },
      lingarajapuram: { name: 'Lingarajapuram Flyover & Hennur Corridor', nodes: [] },
      gateways: { name: 'Bengaluru Outer Arterial Gateway', nodes: [] }
    };
    const spawnable = graph.spawnableNodes || Array.from(graph.nodes.values());
    for (const node of spawnable) {
      if (node.x < 450 || node.x > 3100 || node.y < 800 || node.y > 2800) {
        this.districts.gateways.nodes.push(node);
      } else if (node.x < 1800 && node.y >= 1800) {
        this.districts.cantonment.nodes.push(node);
      } else if (node.x < 1800 && node.y < 1800) {
        this.districts.benson_town.nodes.push(node);
      } else if (node.x >= 1800 && node.y >= 1800) {
        this.districts.frazer_town.nodes.push(node);
      } else {
        this.districts.lingarajapuram.nodes.push(node);
      }
    }
  }

  _autoZoom() {
    if (!this.graph || this.graph.nodes.size === 0) return;
    if (!this.renderer.width || !this.renderer.height) return;
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    for (const [, n] of this.graph.nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const pad = 80;
    const gw = maxX - minX + pad * 2;
    const gh = maxY - minY + pad * 2;
    const zx = this.renderer.width / gw;
    const zy = this.renderer.height / gh;
    this.renderer.camera.zoom = Math.max(0.1, Math.min(zx, zy, 2));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._lastTime = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop() { this.running = false; }

  destroy() {
    this.stop();
    if (this._pfWorker) {
      this._pfWorker.terminate();
      this._pfWorker = null;
    }
    this._pfCallbacks.clear();
  }

  _loop(now) {
    if (!this.running) return;
    let rawDt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (rawDt > 0.1) rawDt = 0.1; // cap frame delta to 100ms

    const totalDt = rawDt * this.simSpeed;

    this.completedThisStep = 0;
    // Only run simulation update logic if not paused
    if (!this.paused) {
      // Sub-step physics so at 2x/4x speed vehicles don't skip stop lines or glitch
      // Ensures each physics sub-step dt is <= 33ms (~30Hz resolution)
      const maxSubStepDt = 0.033;
      const subSteps = Math.max(1, Math.min(6, Math.ceil(totalDt / maxSubStepDt)));
      const subDt = totalDt / subSteps;

      for (let s = 0; s < subSteps; s++) {
        this._update(subDt);
        this._simTime += subDt;
      }
    }
    
    // Always render once per animation frame so panning/zooming remains fluid at 60 FPS
    this._render();

    // FPS tracking
    this._fpsFrames++;
    this._fpsTimer += rawDt; // real elapsed time
    if (this._fpsTimer >= 1) {
      this.fps = Math.round(this._fpsFrames / this._fpsTimer);
      this._fpsFrames = 0;
      this._fpsTimer = 0;
    }

    requestAnimationFrame(this._loop);
  }

  _update(dt) {
    if (!this.graph) return;
    
    // Time of day
    this.timeOfDay.update(dt);

    // Weather
    this.weather.update(dt, this.renderer.width, this.renderer.height);

    // Accidents
    this.accidents.update(dt, this.graph);

    // Intersections
    for (const [, int] of this.intersections) {
      int.update(dt);
    }
    
    // AI Controller
    if (this.aiController) {
      this.aiController.update(dt, this);
    }

    // Spawn vehicles (Async — fire-and-forget with error catch)
    this._spawnTick(dt).catch(e => console.warn('[Spawn] Error:', e));

    // Spawn cyclists
    this.cyclistSpawnTimer += dt;
    if (this.cyclistSpawnTimer > 5.0) { // every 5s
      this.cyclistSpawnTimer = 0;
      this._spawnCyclist();
    }

    // Spatial grid & Viewport bounds
    this.spatialGrid.clear();
    const bounds = this.renderer.getViewportBounds(400); // 400px padding for physics

    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const edge = v.currentEdge;
      if (edge) {
        const fromNode = this.graph.nodes.get(edge.from);
        const toNode = this.graph.nodes.get(edge.to);
        v.inViewport = (fromNode && toNode) && (
          this.renderer.isInsideViewport(fromNode.x, fromNode.y, bounds) ||
          this.renderer.isInsideViewport(toNode.x, toNode.y, bounds)
        );
      } else {
        v.inViewport = this.renderer.isInsideViewport(v.pos.x, v.pos.y, bounds);
      }
      if (v.inViewport) this.spatialGrid.insert(v);
    }

    this.sensorTimer = (this.sensorTimer || 0) + dt;
    if (this.sensorTimer > 0.2) {
      this.sensorTimer = 0;
      this.sensorRealism.updateEstimates(this);
    }

    this.densityTimer += dt;
    if (this.densityTimer > 0.5) {
      this.densityTimer = 0;
      for (const [, edge] of this.graph.edges) edge.density = 0;
      
      const pcuWeights = { car: 1.0, bus: 3.0, truck: 2.5, motorcycle: 0.4, emergency: 1.2, rickshaw: 0.8 };
      for (const v of this.vehicles) {
        if (v.alive && v.currentEdgeId) {
          const e = this.graph.edges.get(v.currentEdgeId);
          if (e) {
            const pcu = pcuWeights[v.type] || 1.0;
            e.density += pcu;
          }
        }
      }
    }

    // Update vehicles and accumulate edge speeds (O(V) optimization)
    const wMult = this.weather.speedMult;
    const isNight = this.timeOfDay.isNight;
    const activeEdges = new Set();
    for (const v of this.vehicles) {
      v.update(dt, this.intersections, this.spatialGrid, wMult, isNight);
      if (v.currentEdge) {
        if (!activeEdges.has(v.currentEdge)) {
          v.currentEdge.currentSpeedSum = 0;
          v.currentEdge.vehicleCount = 0;
          activeEdges.add(v.currentEdge);
        }
        v.currentEdge.currentSpeedSum += v.speed;
        v.currentEdge.vehicleCount++;
      }
    }

    // Jam Detection & Police Assignment (only for active edges)
    for (const edge of activeEdges) {
      const avgSpeed = edge.currentSpeedSum / edge.vehicleCount;
      const speedLimitPxS = (edge.speedLimit * 1000 / 3600) * CANVAS_SCALE;
      if (avgSpeed < speedLimitPxS * 0.1) {
        edge.jamTimer = (edge.jamTimer || 0) + dt;
      } else {
        edge.jamTimer = 0;
      }
      edge.isJammed = edge.jamTimer > 10;
      
      if (edge.jamTimer > 45) {
        this.spawnPolice(edge.to);
        edge.jamTimer = 0; // reset to prevent spamming
      }
    }

    // Update Police
    for (const p of this.policeUnits) {
      p.update(dt, this.intersections.get(p.intersectionId));
    }

    // Update queue counts
    this._updateQueues();

    // Update cyclists
    for (const c of this.cyclists) {
      c.update(dt, this.intersections, wMult);
    }

    // Cleanup dead entities
    this._cleanup();

    // Metrics update (throttled)
    this._updateMetrics(dt);
  }

  findPathAsync(startId, endId) {
    const jammed = [];
    if (this.graph) {
      for (const [id, edge] of this.graph.edges) {
        if (edge.isJammed) jammed.push(id);
      }
    }
    const blocked = this.accidents ? Array.from(this.accidents.getBlockedEdges(this.graph)) : [];
    return Promise.resolve(findPath(this.graph, startId, endId, new Set(blocked), new Set(jammed)));
  }

  async _spawnTick(dt) {
    this._spawnTimer = (this._spawnTimer || 0) + dt;
    const baseRate = this.spawnRate || 2.0;
    const currentCount = this.vehicles.length;
    const maxCapacity = this.maxVehicles || 1200;
    
    // Scale spawn rate dynamically based on current population filling
    const fillRatio = currentCount / maxCapacity;
    const fillBoost = fillRatio < 0.25 ? 4.0 : (fillRatio < 0.60 ? 2.2 : (fillRatio < 0.85 ? 1.4 : 1.0));
    const effectiveRate = baseRate * this.timeOfDay.spawnMultiplier * fillBoost;
    
    if (this._spawnTimer < 1.0 / effectiveRate) return;
    this._spawnTimer = 0;
    
    if (currentCount >= maxCapacity) return;

    // Batch spawn 1 to 3 vehicles depending on current citywide density
    const batchSize = currentCount < 350 ? 3 : (currentCount < 750 ? 2 : 1);
    for (let b = 0; b < batchSize; b++) {
      if (this.vehicles.length >= maxCapacity) break;
      await this._spawnOneVehicle();
    }
  }

  async _spawnOneVehicle() {
    if (!this.graph) return;
    const nodes = this.graph.spawnableNodes;
    if (!nodes || nodes.length < 2) return;

    let route = null;
    let origin = null;
    let originName = 'Bengaluru Origin';
    let destName = 'Bengaluru Destination';

    const districtKeys = this.districts ? Object.keys(this.districts) : [];

    // Try up to 4 attempts to pick origin and destination with a valid route
    for (let attempt = 0; attempt < 4; attempt++) {
      let originNode = null;
      let destNode = null;

      if (districtKeys.length > 0) {
        // 65% inter-district commuter trips, 35% intra-district local layout trips
        const isInterDistrict = Math.random() < 0.65;
        const origKey = districtKeys[Math.floor(Math.random() * districtKeys.length)];
        let destKey = origKey;
        if (isInterDistrict) {
          const others = districtKeys.filter(k => k !== origKey && this.districts[k].nodes.length > 0);
          if (others.length > 0) {
            destKey = others[Math.floor(Math.random() * others.length)];
          }
        }
        const oDistrict = this.districts[origKey];
        const dDistrict = this.districts[destKey];
        if (oDistrict && dDistrict && oDistrict.nodes.length > 0 && dDistrict.nodes.length > 0) {
          originNode = oDistrict.nodes[Math.floor(Math.random() * oDistrict.nodes.length)];
          destNode = dDistrict.nodes[Math.floor(Math.random() * dDistrict.nodes.length)];
          originName = oDistrict.name;
          destName = dDistrict.name;
        }
      }

      // Fallback if districts not initialized or empty
      if (!originNode || !destNode || originNode.id === destNode.id) {
        originNode = nodes[Math.floor(Math.random() * nodes.length)];
        destNode = nodes[Math.floor(Math.random() * nodes.length)];
        originName = 'Bengaluru Hub';
        destName = 'Bengaluru Destination';
      }

      if (originNode && destNode && originNode.id !== destNode.id) {
        const r = await this.findPathAsync(originNode.id, destNode.id);
        if (r && r.length >= 2) {
          const firstEdgeId = `${r[0]}->${r[1]}`;
          let originOccupied = false;
          for (const other of this.vehicles) {
            if (other.alive && other.currentEdgeId === firstEdgeId && other.segmentProgress < 0.08) {
              originOccupied = true;
              break;
            }
          }
          if (!originOccupied) {
            route = r;
            route.originName = originName;
            route.destinationName = destName;
            origin = originNode;
            break;
          }
        }
      }
    }

    if (!route || !origin) return;

    // Pick type based on real-world Bengaluru traffic survey distribution (adjusted for emergency visibility)
    const r = Math.random();
    let type = 'car';
    if (r < 0.70) type = 'motorcycle';     // 70% Two-Wheelers
    else if (r < 0.85) type = 'car';        // 15% Cars
    else if (r < 0.90) type = 'rickshaw';   // 5% Auto-rickshaws
    else if (r < 0.95) type = 'bus';        // 5% Buses
    else if (r < 0.995) type = 'truck';     // 4.5% Trucks
    else type = 'emergency';                // 0.5% Emergency vehicles (Ambulances)

    const v = this.vehiclePool.acquire(type, route, this.graph);
    if (!v) { return; }
    v.engine = this;

    // Position setup
    v.pos.x = origin.x;
    v.pos.y = origin.y;
    
    this.vehicles.push(v);
    this.totalSpawned++;
  }

  _spawnCyclist() {
    if (this.cyclists.length >= 50) return;
    const blocked = this.accidents.getBlockedEdges(this.graph);
    const start = this.graph.getRandomBorderNode();
    const end = this.graph.getRandomBorderNode();
    if (!start || !end || start === end) return;
    const route = findPath(this.graph, start, end, blocked);
    if (!route || route.length < 2) return;
    this.cyclists.push(new Cyclist(route, this.graph));
  }

  _updateQueues() {
    // Reset queues
    for (const [, int] of this.intersections) {
      int.queues.N = 0; int.queues.S = 0;
      int.queues.E = 0; int.queues.W = 0;
      int.maxWait = 0;
      int.totalWaitSeconds = 0;
      int.emergencyApproaching = false;
      int.emergencyDir = null;
    }
    // Count stopped/slow vehicles approaching intersections
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      if (v.routeIndex + 1 >= v.route.length) continue;
      const nextId = v.route[v.routeIndex + 1];
      const int = this.intersections.get(nextId);
      if (!int) continue;
      
      const dir = v._getDirection();
      if (dir) {
        // True queue detection: vehicle is within intersection approach zone (< 110px) and stopped/slow (< 3.0 m/s)
        const distToIntersection = (1 - v.segmentProgress) * (v.currentEdge?.length || 100);
        if (distToIntersection < 110 && v.speed < 3.0) {
          int.queues[dir]++;
        }
        // Localized wait time for THIS intersection approach
        const wait = v.currentWaitTime || 0;
        int.maxWait = Math.max(int.maxWait, wait);
        int.totalWaitSeconds += wait;
        if (v.sirenActive) {
          int.emergencyApproaching = true;
          int.emergencyDir = dir;
        }
      }
    }
  }

  _cleanup() {
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      if (!this.vehicles[i].alive) {
        const v = this.vehicles[i];
        this.totalDespawned++;
        this.totalWaitTime += v.waitTime;
        this.avgWait.push(v.waitTime);
        // Count as completed trip if reached destination or faded out at destination
        if (v.hasCompleted || v.routeIndex >= v.route.length - 2) {
          this.completedTrips.push(this._simTime);
          this.completedThisStep++;
        }
        // O(1) removal
        this.vehicles[i] = this.vehicles[this.vehicles.length - 1];
        this.vehicles.pop();
        this.vehiclePool.release(v);
      }
    }
    for (let i = this.cyclists.length - 1; i >= 0; i--) {
      if (!this.cyclists[i].alive) {
        this.cyclists[i] = this.cyclists[this.cyclists.length - 1];
        this.cyclists.pop();
      }
    }
    for (let i = this.policeUnits.length - 1; i >= 0; i--) {
      if (!this.policeUnits[i].active) {
        this.policeUnits[i] = this.policeUnits[this.policeUnits.length - 1];
        this.policeUnits.pop();
      }
    }
  }

  _metricsThrottle = 0;
  _updateMetrics(dt) {
    this._metricsThrottle += dt;
    if (this._metricsThrottle < 0.1) return; // 10Hz
    this._metricsThrottle = 0;

    // Filter completed trips and intersection crossings to last 60 seconds
    const windowStart = this._simTime - 60;
    this.completedTrips = this.completedTrips.filter(t => t >= windowStart);
    this.intersectionDischarges = this.intersectionDischarges.filter(t => t >= windowStart);

    let totalImbalance = 0;
    let signalizedCount = 0;
    for (const [, int] of this.intersections) {
      if (!int.isSignalized) continue;
      totalImbalance += Math.abs(int.getQueueNS() - int.getQueueEW());
      signalizedCount++;
    }
    const avgImbalance = signalizedCount > 0 ? totalImbalance / signalizedCount : 0;

    // Calculate network average speed & TomTom/BCG Congestion Level (%)
    let totalSpeed = 0;
    let count = 0;
    for (const v of this.vehicles) {
      if (v.alive) {
        totalSpeed += v.speed;
        count++;
      }
    }
    const avgSpeedPxS = count > 0 ? totalSpeed / count : 0;
    const avgSpeedKmh = (avgSpeedPxS / CANVAS_SCALE) * 3.6;
    const freeFlowSpeedKmh = 40.0;
    const congestionLevel = Math.max(0, Math.min(100, (1.0 - (avgSpeedKmh / freeFlowSpeedKmh)) * 100));

    let totalCurrentWait = 0;
    let waitCount = 0;
    let waitingCount = 0;
    for (const v of this.vehicles) {
      if (v.alive) {
        waitCount++;
        if (v.speed < 2) {
          waitingCount++;
          totalCurrentWait += (v.currentWaitTime || 0);
        }
      }
    }
    // Live average wait time of stopped vehicles at their current signal
    const liveAvgWait = waitingCount > 0 ? totalCurrentWait / waitingCount : 0;

    // True City Throughput: completed full trips + normalized intersection crossings in last 60s
    const liveThroughput = Math.round(this.completedTrips.length + (this.intersectionDischarges.length / 8));

    if (this.onMetricsUpdate) {
      this.onMetricsUpdate({
        vehicleCount: waitCount,
        waitingCount: waitingCount,
        pedestrianCount: 0,
        cyclistCount: this.cyclists.length,
        avgWaitTime: liveAvgWait, // Live active wait time instead of despawned wait time
        throughput: liveThroughput, // Citywide vehicle throughput in last 60s
        totalSpawned: this.totalSpawned,
        totalDespawned: this.totalDespawned,
        fps: this.fps,
        timeOfDay: this.timeOfDay.hour,
        timeLocked: this.timeOfDay.isLocked,
        weather: this.weather.current,
        simSpeed: this.simSpeed,
        spawnRate: this.spawnRate,
        intersectionCount: signalizedCount || this.intersections.size,
        policeCount: this.policeUnits.length,
        avgSpeedKmh: avgSpeedKmh,
        congestionLevel: congestionLevel,
        avgImbalance: avgImbalance,
      });
    }
  }

  _render() {
    this.renderer.resize();
    const skyColor = this.timeOfDay.getSkyColor();
    this.renderer.clear(skyColor);

    if (!this.graph) return;

    // Layer 1: Zones
    this.renderer.drawZones(this.graph);
    // Layer 1.5: Buildings
    if (this.buildingsBitmap) {
      this.renderer.drawBuildings(this.buildingsBitmap);
    }
    // Layer 2: Surface Roads & Underpasses (layer <= 0)
    this.renderer.drawRoads(this.graph, 'surface');
    // Layer 3: Heatmap
    this.renderer.drawHeatmap(this.intersections);
    // Layer 3.2: Sensor Cones
    this.renderer.drawSensorCones(this.intersections);
    // Layer 3.5: Ambulance Routes
    this.renderer.drawAmbulanceRoutes(this.vehicles, this.graph);
    // Layer 4: Surface Vehicles (layer <= 0; hidden when passing under flyovers or through underpass tunnels)
    this.renderer.drawVehicles(this.vehicles, this.timeOfDay.isNight, 'surface');
    // Layer 5: Cyclists
    this.renderer.drawCyclists(this.cyclists);
    // Layer 5.5: Surface Intersections & Traffic Signals (layer <= 0)
    this.renderer.drawIntersections(this.intersections, 'surface');
    // Layer 6: Elevated Flyovers & Bridges (layer > 0) with realistic 3D drop shadow, deck asphalt & parapets
    this.renderer.drawRoads(this.graph, 'flyover');
    // Layer 7: Elevated Vehicles (layer > 0) traveling on top of the flyovers
    this.renderer.drawVehicles(this.vehicles, this.timeOfDay.isNight, 'flyover');
    // Layer 7.5: Elevated Intersections (layer > 0)
    this.renderer.drawIntersections(this.intersections, 'flyover');
    // Layer 8: Accidents
    this.accidents.render(this.renderer.ctx);
    // Layer 9: Weather particles
    this.weather.render(this.renderer.ctx, this.renderer.width, this.renderer.height);
    // Layer 9.5: Night ambient overlay
    const ambientLight = this.timeOfDay.getAmbientLight();
    this.renderer.drawNightOverlay(ambientLight);
    // Layer 10: Minimap (screen-space overlay, always visible)
    this.renderer.drawMinimap(this.vehicles, this.graph.bounds.maxX - this.graph.bounds.minX || 4000, this.graph.bounds.maxY - this.graph.bounds.minY || 4000);
  }

  // ── Public API ───────────────────────────────────────
  setSimSpeed(s) { this.simSpeed = s; }
  setSpawnRate(r) { this.spawnRate = r; }
  setWeather(w) { this.weather.setWeather(w); }
  setTimeOfDay(h) { this.timeOfDay.setHour(h); }
  setTimeLocked(locked, h = null) {
    if (locked) this.timeOfDay.lock(h);
    else this.timeOfDay.unlock();
  }
  setOverlay(name, val) { this.renderer.overlays[name] = val; }

  triggerAccident(severity) {
    return this.accidents.spawnAccident(this.graph, null, severity);
  }

  getIntersectionAt(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const searchRadius = 50 / Math.max(0.1, this.renderer.camera.zoom);
    let closest = null, closestDist = searchRadius;
    for (const [id, int] of this.intersections) {
      const d = Math.sqrt((int.x - world.x) ** 2 + (int.y - world.y) ** 2);
      if (d < closestDist) { closestDist = d; closest = id; }
    }
    return closest;
  }
  
  spawnPolice(intersectionId) {
    // Only spawn if not already active there
    if (!this.policeUnits.some(p => p.intersectionId === intersectionId)) {
      this.policeUnits.push(new TrafficPolice(intersectionId, this.graph));
    }
  }

  getIntersectionData(id) {
    const int = this.intersections.get(id);
    if (!int) return null;
    return {
      id: int.id,
      queues: { ...int.queues },
      phase: int.trafficLight.currentPhase,
      phaseProgress: int.trafficLight.phaseProgress,
      remaining: int.trafficLight.remaining,
      timeInPhase: int.trafficLight.timer,
      pedestriansWaiting: 0,
      phaseHistory: [...int.phaseHistory],
      totalQueue: int.getTotalQueue(),
    };
  }

  getSnapshot() {
    return {
      vehicleCount: this.vehicles.length,
      pedestrianCount: 0,
      cyclistCount: this.cyclists.length,
      avgWaitTime: this.avgWait.avg,
      throughput: this.completedTrips.length,
      fps: this.fps,
      timeOfDay: this.timeOfDay.hour,
      weather: this.weather.current,
      simSpeed: this.simSpeed,
      intersectionCount: this.intersections.size,
    };
  }
}

