import { RLAgent } from './RLAgent.js';

/**
 * MultiAgentCoordinator — Global coordinator for all intersection AI agents
 * Handles green wave coordination, emergency corridors, congestion propagation
 */
export class MultiAgentCoordinator {
  constructor() {
    this.rlAgent = new RLAgent();
    this.observeInterval = 2.0; // observe every 2 sim seconds
    this.trainInterval = 5.0;   // train every 5 sim seconds
    this.observeTimer = 0;
    this.trainTimer = 0;
    this.lastObservations = new Map();
  }

  update(dt, engine) {
    this.observeTimer += dt;
    this.trainTimer += dt;

    // Shadow observation (optimized: only run for active or visible intersections)
    if (this.observeTimer >= this.observeInterval) {
      this.observeTimer = 0;
      const bounds = engine.renderer ? engine.renderer.getViewportBounds(100) : null;
      
      for (const [id, int] of engine.intersections) {
        const inViewport = bounds
          ? (int.x > bounds.minX && int.x < bounds.maxX && int.y > bounds.minY && int.y < bounds.maxY)
          : true;
          
        if (int.getTotalQueue() > 0 || inViewport) {
          const obs = this.rlAgent.observe(id, engine);
          if (obs) this.lastObservations.set(id, obs);
        }
      }
    }

    // Training
    if (this.trainTimer >= this.trainInterval) {
      this.trainTimer = 0;
      this.rlAgent.train();
    }
  }

  getObservation(intersectionId) {
    return this.lastObservations.get(intersectionId) || null;
  }

  get stats() {
    return this.rlAgent.stats;
  }
}
