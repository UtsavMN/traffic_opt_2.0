import { Vehicle } from './Vehicle.js';

/**
 * VehiclePool — Pre-allocated pool of reusable Vehicle instances.
 * Each Engine instance creates its own pool, avoiding shared module state.
 */
export class VehiclePool {
  constructor(capacity = 500) {
    this._pool = [];
    this._capacity = capacity;
    this._totalCreated = 0;

    // Pre-allocate
    for (let i = 0; i < capacity; i++) {
      this._pool.push(new Vehicle());
      this._totalCreated++;
    }
    console.log(`[Pool] Initialized with ${this._pool.length} slots`);
  }

  get totalSize() { return this._totalCreated; }
  get available() { return this._pool.length; }

  /**
   * Acquire a vehicle from the pool. Returns null if exhausted.
   */
  acquire(type, route, graph) {
    let v;
    if (this._pool.length > 0) {
      v = this._pool.pop();
    } else {
      // Pool exhausted — grow by one
      v = new Vehicle();
      this._totalCreated++;
    }
    v.init(type, route, graph);
    return v;
  }

  /**
   * Release a vehicle back to the pool for reuse.
   */
  release(v) {
    v.alive = false;
    v.route = null;
    v.graph = null;
    this._pool.push(v);
  }
}
