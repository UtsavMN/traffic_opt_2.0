/**
 * PythonBackendClient — Bridges Sanchar React frontend with the PyTorch FastAPI backend
 * Endpoint: http://localhost:8000
 */

export class PythonBackendClient {
  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
    this.connected = false;
    this.lastCheckTime = 0;
    this.checkInterval = 4000; // Check every 4 seconds
    this._checking = false;
  }

  async checkHealth() {
    if (this._checking) return this.connected;
    this._checking = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${this.baseUrl}/api/status`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        this.connected = (data.status === 'ready');
      } else {
        this.connected = false;
      }
    } catch {
      this.connected = false;
    } finally {
      this._checking = false;
      this.lastCheckTime = performance.now();
    }
    return this.connected;
  }

  async predict(int, engine) {
    if (!this.connected) return null;
    try {
      const tl = int.trafficLight;
      const payload = {
        id: int.id,
        phase: tl ? tl.currentPhase : 'NS_GREEN',
        time_in_phase: tl ? tl.timeInPhase : 0,
        phase_progress: tl ? tl.phaseProgress : 0,
        queues: { ...int.queues },
        pedestrians_waiting: 0,
        emergency_approaching: !!int.emergencyApproaching,
        emergency_dir: int.emergencyDir || null,
        red_duration_ns: tl ? (tl.redDurationNS || 0) : 0,
        red_duration_ew: tl ? (tl.redDurationEW || 0) : 0,
        weather_factor: engine.weather ? (1 - (engine.weather.speedMult || 1)) : 0,
        time_of_day_norm: engine.timeOfDay ? engine.timeOfDay.normalized : 0.5,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600);
      const res = await fetch(`${this.baseUrl}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // Gracefully fall back to local JS model
    }
    return null;
  }
}

export const pythonClient = new PythonBackendClient();
