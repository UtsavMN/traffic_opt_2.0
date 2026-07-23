import { SpatialGrid } from './SpatialGrid.js';
import { useMetricsStore } from '../store/metricsStore.js';
import { Intersection } from './Intersection.js';
import { VehiclePool } from './VehiclePool.js';
import { Pedestrian } from './Pedestrian.js';
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
    this.vehiclePool = new VehiclePool(500);

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
    this.spawnRate = 0.8; // vehicles/sec base
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

  loadCity(graph) {
    if (!this._pfWorker) return;
    this.graph = graph;
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
      const intersection = new Intersection(id, node.x, node.y, node.zone);
      // Wire up green phase callback (decoupled from React in Intersection.js)
      intersection.onGreenPhaseEnd = (hadVehicles) => {
        if (typeof window !== 'undefined' && window.__trafficOptMetrics) {
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
      if (fromInt) fromInt.maxLanes = Math.max(fromInt.maxLanes || 2, edge.lanes);
      if (toInt) toInt.maxLanes = Math.max(toInt.maxLanes || 2, edge.lanes);
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
    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (dt > 0.1) dt = 0.1; // cap delta

    dt *= this.simSpeed;

    this.completedThisStep = 0;
    // Only run simulation update logic if not paused
    if (!this.paused) {
      this._update(dt);
      this._simTime += dt;
    }
    
    // Always render so panning/zooming remains fluid
    this._render();

    // FPS tracking
    this._fpsFrames++;
    this._fpsTimer += dt / this.simSpeed; // real time
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

    // Spawn pedestrians
    this.pedSpawnTimer += dt;
    if (this.pedSpawnTimer > 2.0) { // every 2s
      this.pedSpawnTimer = 0;
      this._spawnPedestrian();
    }

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

    // Update pedestrians
    for (const p of this.pedestrians) {
      p.update(dt, this.intersections, this.intersectionGrid);
    }

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
    // Find jammed edges to avoid in pathfinding
    const jammed = [];
    if (this.graph) {
      for (const [id, edge] of this.graph.edges) {
        if (edge.isJammed) jammed.push(id);
      }
    }

    if (!this.workerReady) {
      return findPath(this.graph, startId, endId, new Set(), new Set(jammed));
    }
    return new Promise((resolve) => {
      const id = this.nextPathId++;
      this.pathCallbacks.set(id, resolve);
      
      const blocked = this.accidents ? Array.from(this.accidents.getBlockedEdges(this.graph)) : [];
      
      this.pathfinderWorker.postMessage({
        type: 'FIND_PATH',
        id,
        startId,
        endId,
        blocked,
        jammed
      });
    });
  }

  async _spawnTick(dt) {
    this._spawnTimer = (this._spawnTimer || 0) + dt;
    const effectiveRate = (this.spawnRate || 0.8) * this.timeOfDay.spawnMultiplier;
    if (this._spawnTimer < 1.0 / effectiveRate) return;
    this._spawnTimer = 0;
    
    // Calibrated Bengaluru vehicle count limit
    if (this.vehicles.length >= 400) return;

    const nodes = this.graph?.spawnableNodes; // pre-filtered, always connected
    if (!nodes || nodes.length < 2) return;

    // Pick random origin near viewport (70%) or citywide (30%)
    const useViewport = Math.random() < 0.7;
    const bounds = this.renderer.getViewportBounds(200);
    const viewportNodes = useViewport
      ? nodes.filter(n => n.x > bounds.minX && n.x < bounds.maxX
                       && n.y > bounds.minY && n.y < bounds.maxY)
      : nodes;

    const pool = viewportNodes.length >= 2 ? viewportNodes : nodes;
    
    let route = null;
    let origin = null;
    
    // Try to find a valid route and clear origin up to 3 times to prevent spawn failures
    for (let attempt = 0; attempt < 3; attempt++) {
      const originNode = pool[Math.floor(Math.random() * pool.length)];
      const destNode   = nodes[Math.floor(Math.random() * nodes.length)];
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
    if (!v) { console.warn('[Spawn] Pool exhausted'); return; }

    // Position setup
    v.pos.x = origin.x;
    v.pos.y = origin.y;
    
    this.vehicles.push(v);
    this.totalSpawned++;
  }

  _spawnPedestrian() {
    if (this.pedestrians.length >= 250) return;
    const n1 = this.graph.getRandomNode();
    const n2 = this.graph.getRandomNode();
    if (!n1 || !n2 || n1 === n2) return;
    const node1 = this.graph.nodes.get(n1);
    const node2 = this.graph.nodes.get(n2);
    if (!node1 || !node2) return;

    // Offset from road
    const ox = (Math.random() - 0.5) * 20;
    const oy = (Math.random() - 0.5) * 20;
    const p = new Pedestrian(node1.x + ox, node1.y + oy, node2.x + ox, node2.y + oy);
    this.pedestrians.push(p);
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
    // Count stopped/slow vehicles near intersections
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      if (v.routeIndex + 1 >= v.route.length) continue;
      const nextId = v.route[v.routeIndex + 1];
      const int = this.intersections.get(nextId);
      if (!int) continue;
      
      const dir = v._getDirection();
      if (dir) {
        if (v.speed <= 15) {
          int.queues[dir]++;
        }
        int.maxWait = Math.max(int.maxWait, v.waitTime);
        int.totalWaitSeconds += v.waitTime;
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
        // Only count as completed trip if they reached destination (routeIndex at end)
        if (v.routeIndex >= v.route.length - 1) {
          this.completedTrips.push(this._simTime);
          this.completedThisStep++;
        }
        // O(1) removal
        this.vehicles[i] = this.vehicles[this.vehicles.length - 1];
        this.vehicles.pop();
        this.vehiclePool.release(v);
      }
    }
    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      if (!this.pedestrians[i].alive) {
        this.pedestrians[i] = this.pedestrians[this.pedestrians.length - 1];
        this.pedestrians.pop();
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

    // Filter completed trips to last 60 seconds
    const windowStart = this._simTime - 60;
    this.completedTrips = this.completedTrips.filter(t => t >= windowStart);

    let totalImbalance = 0;
    for (const [, int] of this.intersections) {
      totalImbalance += Math.abs(int.getQueueNS() - int.getQueueEW());
    }
    const avgImbalance = this.intersections.size > 0 ? totalImbalance / this.intersections.size : 0;

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

    let totalWait = 0;
    let waitCount = 0;
    let waitingCount = 0;
    for (const v of this.vehicles) {
      if (v.alive) {
        totalWait += v.waitTime;
        waitCount++;
        if (v.speed < 2) waitingCount++;
      }
    }
    const liveAvgWait = waitCount > 0 ? totalWait / waitCount : 0;

    if (this.onMetricsUpdate) {
      this.onMetricsUpdate({
        vehicleCount: waitCount,
        waitingCount: waitingCount,
        pedestrianCount: this.pedestrians.length,
        cyclistCount: this.cyclists.length,
        avgWaitTime: liveAvgWait, // Live active wait time instead of despawned wait time
        throughput: this.completedTrips.length, // Vehicles completed in last 60s
        totalSpawned: this.totalSpawned,
        totalDespawned: this.totalDespawned,
        fps: this.fps,
        timeOfDay: this.timeOfDay.hour,
        weather: this.weather.current,
        simSpeed: this.simSpeed,
        spawnRate: this.spawnRate,
        intersectionCount: this.intersections.size,
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
    // Layer 2: Roads
    this.renderer.drawRoads(this.graph);
    // Layer 2.5: Crosswalks
    this.renderer.drawCrosswalks(this.graph);
    // Layer 3: Heatmap
    this.renderer.drawHeatmap(this.intersections);
    // Layer 3.2: Sensor Cones
    this.renderer.drawSensorCones(this.intersections);
    // Layer 3.5: Ambulance Routes
    this.renderer.drawAmbulanceRoutes(this.vehicles, this.graph);
    // Layer 4: Vehicles
    this.renderer.drawVehicles(this.vehicles, this.timeOfDay.isNight);
    // Layer 5: Pedestrians
    this.renderer.drawPedestrians(this.pedestrians);
    // Layer 6: Cyclists
    this.renderer.drawCyclists(this.cyclists);
    // Layer 6.5: Police
    for (const p of this.policeUnits) p.render(this.renderer.ctx, this.timeOfDay.isNight);
    // Layer 7: Intersections + signals
    this.renderer.drawIntersections(this.intersections);
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
      pedestriansWaiting: int.pedestriansWaiting,
      phaseHistory: [...int.phaseHistory],
      totalQueue: int.getTotalQueue(),
    };
  }

  getSnapshot() {
    return {
      vehicleCount: this.vehicles.length,
      pedestrianCount: this.pedestrians.length,
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
