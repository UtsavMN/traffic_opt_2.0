/**
 * Camera — Google Maps style zoom/pan controller.
 * Scroll = zoom toward cursor, drag = pan.
 */
export class Camera {
  constructor(canvas) {
    this._canvas = canvas;
    this.x = 2000;
    this.y = 2000;
    this.zoom = 0.18;
    this.minZoom = 0.08;
    this.maxZoom = 14.0;
    this._drag = false;
    this._lx = 0;
    this._ly = 0;
    this._bind();
  }

  get _w() { return this._canvas.getBoundingClientRect().width || this._canvas.width; }
  get _h() { return this._canvas.getBoundingClientRect().height || this._canvas.height; }

  worldBounds() {
    const hw = (this._w / 2) / this.zoom;
    const hh = (this._h / 2) / this.zoom;
    return {
      minX: this.x - hw,
      maxX: this.x + hw,
      minY: this.y - hh,
      maxY: this.y + hh,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this._w / 2) / this.zoom + this.x,
      y: (sy - this._h / 2) / this.zoom + this.y,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this._w / 2,
      y: (wy - this.y) * this.zoom + this._h / 2,
    };
  }

  centerOn(x, y, zoom) {
    this.x = x;
    this.y = y;
    if (zoom !== undefined) this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
  }

  getDetail() {
    if (this.zoom < 0.3)  return 'overview';
    if (this.zoom < 0.8)  return 'district';
    if (this.zoom < 2.5)  return 'neighborhood';
    return 'street';
  }

  _bind() {
    // Zoom toward cursor
    this._canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      const before = this.screenToWorld(e.offsetX, e.offsetY);
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
      const after = this.screenToWorld(e.offsetX, e.offsetY);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
    }, { passive: false });

    // Pan
    this._canvas.addEventListener('mousedown', e => {
      if (e.button === 0) {
        this._drag = true;
        this._lx = e.clientX;
        this._ly = e.clientY;
      }
    });

    window.addEventListener('mousemove', e => {
      if (!this._drag) return;
      this.x -= (e.clientX - this._lx) / this.zoom;
      this.y -= (e.clientY - this._ly) / this.zoom;
      this._lx = e.clientX;
      this._ly = e.clientY;
    });

    window.addEventListener('mouseup', () => { this._drag = false; });
  }

  destroy() {
    // Cleanup listeners would go here in production
  }
}
