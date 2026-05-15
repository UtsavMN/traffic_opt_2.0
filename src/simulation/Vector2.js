export class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(v) { return new Vector2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vector2(this.x - v.x, this.y - v.y); }
  mult(n) { return new Vector2(this.x * n, this.y * n); }
  div(n) { return n !== 0 ? new Vector2(this.x / n, this.y / n) : new Vector2(0, 0); }
  mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  magSq() { return this.x * this.x + this.y * this.y; }
  normalize() { const m = this.mag(); return m > 0.0001 ? this.div(m) : new Vector2(0, 0); }
  limit(max) { return this.magSq() > max * max ? this.normalize().mult(max) : this.copy(); }
  dist(v) { return this.sub(v).mag(); }
  distSq(v) { return this.sub(v).magSq(); }
  dot(v) { return this.x * v.x + this.y * v.y; }
  cross(v) { return this.x * v.y - this.y * v.x; }
  rotate(a) { const c=Math.cos(a),s=Math.sin(a); return new Vector2(this.x*c-this.y*s,this.x*s+this.y*c); }
  heading() { return Math.atan2(this.y, this.x); }
  perpRight() { return new Vector2(-this.y, this.x); }
  lerp(v, t) { return new Vector2(this.x+(v.x-this.x)*t, this.y+(v.y-this.y)*t); }
  copy() { return new Vector2(this.x, this.y); }
  equals(v, e=0.001) { return Math.abs(this.x-v.x)<e && Math.abs(this.y-v.y)<e; }
  static fromAngle(a, l=1) { return new Vector2(Math.cos(a)*l, Math.sin(a)*l); }
  static dist(a, b) { return a.dist(b); }
}
