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
    // Traffic police kiosk is rendered with proper screen-space camera transforms
    // and placed at the roadside corner curb in Renderer.drawIntersections
    // to guarantee 100% visibility of intersection signals, stop lines, and traffic.
  }
}
