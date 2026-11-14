/**
 * SpatialGrid — O(1) proximity queries via cell-based partitioning
 */
export class SpatialGrid {
  constructor(cellSize = 50) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  _key(cx, cy) { 
    // Bitwise integer key instead of string allocation
    return (cx << 16) | (cy & 0xFFFF); 
  }

  clear() {
    // Zero-allocation clear: reuse pre-allocated cell arrays to avoid GC pressure
    for (const cell of this.cells.values()) {
      cell.length = 0;
    }
  }

  insert(entity) {
    const cx = Math.floor(entity.pos.x / this.cellSize);
    const cy = Math.floor(entity.pos.y / this.cellSize);
    const key = (cx << 16) | (cy & 0xFFFF);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(entity);
  }

  query(x, y, radius) {
    const results = [];
    const r2 = radius * radius;
    const minCX = Math.floor((x - radius) / this.cellSize);
    const maxCX = Math.floor((x + radius) / this.cellSize);
    const minCY = Math.floor((y - radius) / this.cellSize);
    const maxCY = Math.floor((y + radius) / this.cellSize);

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const cell = this.cells.get((cx << 16) | (cy & 0xFFFF));
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            const e = cell[i];
            const dx = e.pos.x - x, dy = e.pos.y - y;
            if (dx * dx + dy * dy <= r2) results.push(e);
          }
        }
      }
    }
    return results;
  }

  queryRect(x, y, w, h) {
    const results = [];
    const minCX = Math.floor(x / this.cellSize);
    const maxCX = Math.floor((x + w) / this.cellSize);
    const minCY = Math.floor(y / this.cellSize);
    const maxCY = Math.floor((y + h) / this.cellSize);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const cell = this.cells.get(this._key(cx, cy));
        if (cell) {
          for (const e of cell) {
            if (e.pos.x >= x && e.pos.x <= x+w && e.pos.y >= y && e.pos.y <= y+h) {
              results.push(e);
            }
          }
        }
      }
    }
    return results;
  }
}
