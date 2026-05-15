/**
 * SpatialGrid — O(1) proximity queries via cell-based partitioning
 */
export class SpatialGrid {
  constructor(cellSize = 50) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  _key(cx, cy) { return `${cx},${cy}`; }

  _cellCoords(x, y) {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  clear() { this.cells.clear(); }

  insert(entity) {
    const [cx, cy] = this._cellCoords(entity.pos.x, entity.pos.y);
    const key = this._key(cx, cy);
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(entity);
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
        const cell = this.cells.get(this._key(cx, cy));
        if (cell) {
          for (const e of cell) {
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
