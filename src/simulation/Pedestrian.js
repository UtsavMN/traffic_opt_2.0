import { Vector2 } from './Vector2.js';

/**
 * Pedestrian — Walking/Waiting/Crossing/Jaywalking entity
 */
let pedIdCounter = 0;

export class Pedestrian {
  constructor(x, y, destX, destY) {
    this.id = `p${pedIdCounter++}`;
    this.pos = new Vector2(x, y);
    this.destination = new Vector2(destX, destY);
    this.walkSpeed = 30 + Math.random() * 20; // px/s
    this.state = 'walking'; // walking, waiting_at_crossing, crossing, jaywalking
    this.compliance = 0.6 + Math.random() * 0.4; // 0.6-1.0
    this.waitPatience = 8 + Math.random() * 12; // 8-20 seconds
    this.waitTime = 0;
    this.alive = true;
    this.nearIntersection = null;
    this.crossingProgress = 0;
    this.animFrame = Math.random() * Math.PI * 2;
    this.color = `hsl(${30 + Math.random() * 30}, ${50 + Math.random() * 30}%, ${60 + Math.random() * 20}%)`;
    this.radius = 3;
  }

  update(dt, intersections, intersectionGrid) {
    if (!this.alive) return;
    this.animFrame += dt * 8;

    const toDestDist = this.pos.dist(this.destination);
    if (toDestDist < 10) { this.alive = false; return; }

    if (this.state === 'walking') {
      // Move toward destination
      const dir = this.destination.sub(this.pos).normalize();
      this.pos = this.pos.add(dir.mult(this.walkSpeed * dt));

      // Check if near an intersection (need to cross)
      if (intersectionGrid) {
        const nearby = intersectionGrid.query(this.pos.x, this.pos.y, 30);
        for (const entry of nearby) {
          const int = entry.intersection;
          const dist = Math.sqrt((this.pos.x - int.x) ** 2 + (this.pos.y - int.y) ** 2);
          if (dist < 30 && dist > 5) {
            this.nearIntersection = int;
            const dir2 = this._getCrossingDirection(int);
            if (dir2 && !int.trafficLight.canPass(dir2)) {
              this.state = 'waiting_at_crossing';
              int.pedestriansWaiting++;
            } else {
              this.state = 'crossing';
              this.crossingProgress = 0;
            }
            break;
          }
        }
      } else if (intersections) {
        for (const [, int] of intersections) {
          const dist = Math.sqrt((this.pos.x - int.x) ** 2 + (this.pos.y - int.y) ** 2);
          if (dist < 30 && dist > 5) {
            this.nearIntersection = int;
            const dir2 = this._getCrossingDirection(int);
            if (dir2 && !int.trafficLight.canPass(dir2)) {
              this.state = 'waiting_at_crossing';
              int.pedestriansWaiting++;
            } else {
              this.state = 'crossing';
              this.crossingProgress = 0;
            }
            break;
          }
        }
      }
    } else if (this.state === 'waiting_at_crossing') {
      this.waitTime += dt;
      const int = this.nearIntersection;
      if (!int) { this.state = 'walking'; return; }

      const dir2 = this._getCrossingDirection(int);
      if (dir2 && int.trafficLight.canPass(dir2)) {
        this.state = 'crossing';
        this.crossingProgress = 0;
        int.pedestriansWaiting = Math.max(0, int.pedestriansWaiting - 1);
      } else if (this.waitTime > this.waitPatience * this.compliance) {
        // Jaywalk!
        this.state = 'jaywalking';
        this.crossingProgress = 0;
        int.pedestriansWaiting = Math.max(0, int.pedestriansWaiting - 1);
      }
    } else if (this.state === 'crossing' || this.state === 'jaywalking') {
      this.crossingProgress += dt * 0.8;
      const dir = this.destination.sub(this.pos).normalize();
      this.pos = this.pos.add(dir.mult(this.walkSpeed * 0.7 * dt));
      
      if (this.crossingProgress >= 1) {
        this.state = 'walking';
        this.nearIntersection = null;
        this.waitTime = 0;
      }
    }
  }

  _getCrossingDirection(int) {
    const dx = this.destination.x - int.x;
    const dy = this.destination.y - int.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'E' : 'W';
    }
    return dy > 0 ? 'S' : 'N';
  }
}
