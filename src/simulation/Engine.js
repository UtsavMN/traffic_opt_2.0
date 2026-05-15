import { SpatialGrid } from './SpatialGrid.js';
import { Intersection } from './Intersection.js';
import { Vehicle } from './Vehicle.js';
import { Pedestrian } from './Pedestrian.js';
import { Cyclist } from './Cyclist.js';
import { WeatherSystem } from './WeatherSystem.js';
import { TimeOfDay } from './TimeOfDay.js';
import { AccidentSystem } from './AccidentSystem.js';
import { Renderer } from './Renderer.js';
import { findPath } from '../utils/pathfinding.js';
import { RollingAverage } from '../utils/statistics.js';

/**
 * Engine — Main simulation loop. Manages all entities, systems, and rendering.
 */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.spatialGrid = new SpatialGrid(50);

    // City graph (set by loadCity)
    this.graph = null;
    this.intersections = new Map(); // id -> Intersection

    // Entity pools
    this.vehicles = [];
    this.pedestrians = [];
    this.cyclists = [];

    // Systems
    this.weather = new WeatherSystem();
    this.timeOfDay = new TimeOfDay(8);
    this.accidents = new AccidentSystem();

    // AI Controller (set externally)
    this.aiController = null;

    // Simulation state
    this.running = false;
    this.simSpeed = 1;
    this.spawnRate = 0.8; // vehicles/sec base
    this.spawnTimer = 0;
    this.pedSpawnTimer = 0;
    this.cyclistSpawnTimer = 0;

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

    // Bind
    this._loop = this._loop.bind(this);
  }

  loadCity(graph) {
    this.graph = graph;
    this.intersections.clear();
    this.vehicles = [];
    this.pedestrians = [];
    this.cyclists = [];
    this.totalSpawned = 0;
    this.totalDespawned = 0;
    this.totalWaitTime = 0;
    this.vehiclesPassed = 0;

    for (const [id, node] of graph.nodes) {
      this.intersections.set(id, new Intersection(id, node.x, node.y, node.zone));
    }

    // Center camera on city
    let cx = 0, cy = 0, count = 0;
    for (const [, n] of graph.nodes) { cx += n.x; cy += n.y; count++; }
    if (count > 0) {
      this.renderer.camera.x = cx / count;
      this.renderer.camera.y = cy / count;
    }
    // Ensure canvas is sized before auto-zoom
    this.renderer.resize();
    this._autoZoom();
    this._needsAutoZoom = true;
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

  _loop(now) {
    if (!this.running) return;
    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (dt > 0.1) dt = 0.1; // cap delta

    dt *= this.simSpeed;

    this.completedThisStep = 0;
    this._update(dt);
    this._render();
    
    this._simTime += dt;

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

    // Spawn vehicles
    this._spawnEntities(dt);

    // Spatial grid & Viewport bounds
    this.spatialGrid.clear();
    const bounds = this.renderer.getViewportBounds(400); // 400px padding for physics

    for (const v of this.vehicles) {
      if (!v.alive) continue;
      v.inViewport = this.renderer.isInsideViewport(v.pos.x, v.pos.y, bounds);
      if (v.inViewport) this.spatialGrid.insert(v);
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
      if (avgSpeed < edge.speedLimit * 0.1) {
        edge.jamTimer = (edge.jamTimer || 0) + dt;
      } else {
        edge.jamTimer = 0;
      }
      edge.isJammed = edge.jamTimer > 10;

      // Police assignment on jammed approaches
      if (edge.isJammed) {
        const intTo = this.intersections.get(edge.to);
        if (intTo && !intTo.policeActive) {
          intTo.policeActive = true;
          const angle = edge.direction;
          let dir = 'S';
          if (angle > -Math.PI/4 && angle <= Math.PI/4) dir = 'E';
          else if (angle > Math.PI/4 && angle <= 3*Math.PI/4) dir = 'S';
          else if (angle > 3*Math.PI/4 || angle <= -3*Math.PI/4) dir = 'W';
          else dir = 'N';
          intTo.policeDirection = dir;
        }
      }
    }

    // Update queue counts
    this._updateQueues();

    // Update pedestrians
    for (const p of this.pedestrians) {
      p.update(dt, this.intersections);
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

  _spawnEntities(dt) {
    if (!this.graph) return;
    const todMult = this.timeOfDay.spawnMultiplier;
    const wMult = this.weather.spawnMult;
    const effectiveRate = this.spawnRate * todMult * wMult;

    // Vehicles
    this.spawnTimer += dt;
    const vInterval = 1 / Math.max(0.1, effectiveRate);
    while (this.spawnTimer >= vInterval) {
      this.spawnTimer -= vInterval;
      this._spawnVehicle();
    }

    // Pedestrians (lower rate)
    this.pedSpawnTimer += dt;
    if (this.pedSpawnTimer >= 2 / Math.max(0.1, effectiveRate * 0.3)) {
      this.pedSpawnTimer = 0;
      this._spawnPedestrian();
    }

    // Cyclists (lowest rate)
    this.cyclistSpawnTimer += dt;
    if (this.cyclistSpawnTimer >= 4 / Math.max(0.1, effectiveRate * 0.15)) {
      this.cyclistSpawnTimer = 0;
      this._spawnCyclist();
    }
  }

  _spawnVehicle() {
    if (this.vehicles.length >= 400) return; // Cap active vehicles
    
    const blocked = this.accidents.getBlockedEdges();
    const start = this.graph.getRandomBorderNode();
    
    // Pick type
    const r = Math.random();
    let type = 'car';
    if (r < 0.05) type = 'emergency';
    else if (r < 0.12) type = 'bus';
    else if (r < 0.2) type = 'truck';
    else if (r < 0.3) type = 'motorcycle';

    let end;
    if (type === 'emergency' && this.hospitals && this.hospitals.length > 0) {
      const h = this.hospitals[Math.floor(Math.random() * this.hospitals.length)];
      let minD = Infinity;
      for (const [id, node] of this.graph.nodes) {
        const d = (node.x - h.x)**2 + (node.y - h.y)**2;
        if (d < minD) { minD = d; end = id; }
      }
    } else {
      end = this.graph.getRandomBorderNode();
    }

    if (!start || !end || start === end) return;

    const route = findPath(this.graph, start, end, blocked);
    if (!route || route.length < 2) return;

    const v = Vehicle.create(type, route, this.graph);

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
    const blocked = this.accidents.getBlockedEdges();
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
        if (v.speed <= 15) int.queues[dir]++;
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
        this.vehicles.splice(i, 1);
        Vehicle.free(v);
      }
    }
    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      if (!this.pedestrians[i].alive) this.pedestrians.splice(i, 1);
    }
    for (let i = this.cyclists.length - 1; i >= 0; i--) {
      if (!this.cyclists[i].alive) this.cyclists.splice(i, 1);
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

    if (this.onMetricsUpdate) {
      this.onMetricsUpdate({
        vehicleCount: this.vehicles.length,
        pedestrianCount: this.pedestrians.length,
        cyclistCount: this.cyclists.length,
        avgWaitTime: this.avgWait.avg,
        throughput: this.completedTrips.length, // Vehicles completed in last 60s
        totalSpawned: this.totalSpawned,
        totalDespawned: this.totalDespawned,
        fps: this.fps,
        timeOfDay: this.timeOfDay.hour,
        weather: this.weather.current,
        simSpeed: this.simSpeed,
        intersectionCount: this.intersections.size,
      });
    }
  }

  _render() {
    this.renderer.resize();
    // Re-autoZoom on first proper render (when canvas has dimensions)
    if (this._needsAutoZoom && this.renderer.width > 0) {
      this._autoZoom();
      this._needsAutoZoom = false;
    }
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
    // Layer 3.5: Ambulance Routes
    this.renderer.drawAmbulanceRoutes(this.vehicles, this.graph);
    // Layer 4: Vehicles
    this.renderer.drawVehicles(this.vehicles, this.timeOfDay.isNight);
    // Layer 5: Pedestrians
    this.renderer.drawPedestrians(this.pedestrians);
    // Layer 6: Cyclists
    this.renderer.drawCyclists(this.cyclists);
    // Layer 7: Intersections + signals
    this.renderer.drawIntersections(this.intersections);
    // Layer 8: Accidents
    this.accidents.render(this.renderer.ctx);
    // Layer 9: Weather particles
    this.weather.render(this.renderer.ctx, this.renderer.width, this.renderer.height);
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

  getIntersectionData(id) {
    const int = this.intersections.get(id);
    if (!int) return null;
    return {
      id: int.id,
      queues: { ...int.queues },
      phase: int.trafficLight.currentPhase,
      phaseProgress: int.trafficLight.phaseProgress,
      remaining: int.trafficLight.remaining,
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
      throughput: this.throughputHistory.avg * 10 * 60,
      fps: this.fps,
      timeOfDay: this.timeOfDay.hour,
      weather: this.weather.current,
      simSpeed: this.simSpeed,
      intersectionCount: this.intersections.size,
    };
  }
}
