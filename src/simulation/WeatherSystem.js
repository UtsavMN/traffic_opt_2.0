/**
 * WeatherSystem — Environmental effects on simulation + particle rendering
 */

export const WEATHER_CONFIGS = {
  clear:      { speedMult: 1.0,  spawnMult: 1.0, brakeDistMult: 1.0, visibility: 1.0,  particles: 0 },
  light_rain: { speedMult: 0.85, spawnMult: 0.9, brakeDistMult: 1.3, visibility: 0.85, particles: 80 },
  heavy_rain: { speedMult: 0.65, spawnMult: 0.7, brakeDistMult: 1.8, visibility: 0.55, particles: 200 },
  fog:        { speedMult: 0.5,  spawnMult: 0.75,brakeDistMult: 2.0, visibility: 0.3,  particles: 0 },
  ice:        { speedMult: 0.6,  spawnMult: 0.8, brakeDistMult: 2.5, visibility: 0.9,  particles: 40 },
  storm:      { speedMult: 0.4,  spawnMult: 0.5, brakeDistMult: 3.0, visibility: 0.25, particles: 300 },
};

export class WeatherSystem {
  constructor() {
    this.current = 'clear';
    this.target = 'clear';
    this.transition = 1; // 0-1 blend
    this.transitionSpeed = 0.5; // 2s transition
    this.particles = [];
    this.maxParticles = 0;
    this._config = { ...WEATHER_CONFIGS.clear };
  }

  get config() { return this._config; }
  get speedMult() { return this._config.speedMult; }
  get spawnMult() { return this._config.spawnMult; }
  get visibility() { return this._config.visibility; }

  setWeather(type) {
    if (type === this.current && this.transition >= 1) return;
    this.target = type;
    this.transition = 0;
  }

  update(dt, canvasWidth, canvasHeight) {
    // Blend transition
    if (this.transition < 1) {
      this.transition = Math.min(1, this.transition + dt * this.transitionSpeed);
      const from = WEATHER_CONFIGS[this.current];
      const to = WEATHER_CONFIGS[this.target];
      const t = this.transition;
      this._config.speedMult = from.speedMult + (to.speedMult - from.speedMult) * t;
      this._config.spawnMult = from.spawnMult + (to.spawnMult - from.spawnMult) * t;
      this._config.brakeDistMult = from.brakeDistMult + (to.brakeDistMult - from.brakeDistMult) * t;
      this._config.visibility = from.visibility + (to.visibility - from.visibility) * t;
      this.maxParticles = Math.floor(from.particles + (to.particles - from.particles) * t);

      if (this.transition >= 1) this.current = this.target;
    }

    // Update particles
    this._updateParticles(dt, canvasWidth, canvasHeight);
  }

  _updateParticles(dt, w, h) {
    // Spawn new particles
    while (this.particles.length < this.maxParticles) {
      this.particles.push(this._spawnParticle(w, h));
    }
    // Remove excess
    while (this.particles.length > this.maxParticles) {
      this.particles.pop();
    }
    // Update positions
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.y > h + 10 || p.life <= 0) {
        // Reset particle
        p.x = Math.random() * w;
        p.y = -10;
        p.life = 1 + Math.random() * 2;
      }
    }
  }

  _spawnParticle(w, h) {
    const isRain = this.target !== 'ice';
    return {
      x: Math.random() * w,
      y: Math.random() * h * -0.5,
      vx: isRain ? -20 + Math.random() * 10 : (Math.random() - 0.5) * 30,
      vy: isRain ? 300 + Math.random() * 200 : 40 + Math.random() * 30,
      length: isRain ? 8 + Math.random() * 12 : 0,
      size: isRain ? 1 : 2 + Math.random() * 2,
      life: 1 + Math.random() * 2,
      opacity: 0.2 + Math.random() * 0.4,
    };
  }

  render(ctx, w, h) {
    // Fog overlay
    if (this.current === 'fog' || this.target === 'fog') {
      const fogAlpha = (1 - this._config.visibility) * 0.6;
      ctx.fillStyle = `rgba(180,190,200,${fogAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Rain / snow particles
    for (const p of this.particles) {
      ctx.globalAlpha = p.opacity;
      if (p.length > 0) {
        // Rain streak
        ctx.strokeStyle = 'rgba(180,200,255,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 0.02, p.y + p.length);
        ctx.stroke();
      } else {
        // Snow/ice crystal
        ctx.fillStyle = 'rgba(220,230,255,0.8)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Wet road tint
    if (this._config.speedMult < 0.9) {
      ctx.fillStyle = `rgba(100,120,180,${(1 - this._config.speedMult) * 0.08})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
