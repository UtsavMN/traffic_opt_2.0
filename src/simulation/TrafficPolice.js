import { Vector2 } from './Vector2.js';
import { CANVAS_SCALE } from '../constants.js';

export class TrafficPolice {
  constructor(intersectionId, graph) {
    this.intersectionId = intersectionId;
    this.graph = graph;
    
    const intNode = graph.nodes.get(intersectionId);
    this.pos = new Vector2(intNode.x, intNode.y);
    
    this.active = true;
    this.timer = 0;
    this.maxDuration = 30; // 30 seconds of override
  }

  update(dt, intersection) {
    if (!this.active) return;
    this.timer += dt;
    
    if (intersection) {
      // If the intersection has cleared the queue or timed out, deactivate the unit
      if (this.timer > dt && !intersection.policeActive) {
        this.active = false;
        return;
      }
      
      intersection.policeActive = true;
      const nsQ = intersection.getQueueNS();
      const ewQ = intersection.getQueueEW();
      intersection.policeDirection = nsQ > ewQ ? 'N' : 'E';
    }

    if (this.timer > this.maxDuration) {
      this.active = false;
      if (intersection) intersection.policeActive = false;
    }
  }

  render(ctx, isNight) {
    if (!this.active) return;
    
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    
    // Pulse ring
    const pulse = (Math.sin(performance.now() * 0.005) + 1) / 2;
    const r = (10 + pulse * 10) * CANVAS_SCALE;
    
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 102, 255, ${0.3 * (1 - pulse)})`;
    ctx.fill();
    
    // Police icon/dot
    ctx.beginPath();
    ctx.arc(0, 0, 5 * CANVAS_SCALE, 0, Math.PI * 2);
    ctx.fillStyle = '#0066FF';
    ctx.fill();
    
    // Siren flashes
    if (Math.floor(performance.now() / 150) % 2 === 0) {
      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.arc(-3 * CANVAS_SCALE, 0, 3 * CANVAS_SCALE, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#0000FF';
      ctx.beginPath();
      ctx.arc(3 * CANVAS_SCALE, 0, 3 * CANVAS_SCALE, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
