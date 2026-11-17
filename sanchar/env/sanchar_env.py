"""
Sanchar Traffic Environment — Gymnasium Implementation
Simulates a physical signalized intersection with realistic traffic arrivals,
queue discharges, pedestrian calls, emergency vehicles, and NEMA TS 2 phase transitions.
"""

from typing import Tuple, Dict, Any, Optional
import numpy as np
import gymnasium as gym
from gymnasium import spaces

from sanchar.config import (
    ACTIONS,
    PHASES,
    GREEN_PHASES,
    YELLOW_PHASES,
    ALL_RED_PHASES,
    MIN_GREEN_S,
    MAX_GREEN_S,
    YELLOW_DURATION_S,
    ALL_RED_DURATION_S,
    MAX_QUEUE_NORMALIZATION,
    STATE_DIM,
)
from sanchar.ai.reward import compute_reward

PHASE_DURATIONS = {
    "NS_YELLOW": YELLOW_DURATION_S,
    "EW_YELLOW": YELLOW_DURATION_S,
}


class SancharTrafficEnv(gym.Env):
    """
    Standard Gymnasium environment for training Sanchar signal controllers.
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        episode_length_s: int = 300,
        domain_randomize: bool = True,
        jam_capacity: int = 30,
    ):
        super().__init__()
        self.episode_length_s = episode_length_s
        self.domain_randomize = domain_randomize
        self.jam_capacity = jam_capacity

        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(STATE_DIM,), dtype=np.float32
        )
        self.action_space = spaces.Discrete(len(ACTIONS))

        # Simulation state
        self.queues = {"N": 0, "S": 0, "E": 0, "W": 0}
        self.phase_idx = 0
        self.time_in_phase = 0.0
        self.sim_time = 0.0
        self.red_duration_ns = 0.0
        self.red_duration_ew = 0.0
        self.pedestrians_waiting = 0
        self.emergency_approaching = False
        self.emergency_dir = "N"

        # Dynamic neighbor correlation states
        self.neighbor_active_norm = 0.0
        self.neighbor_opposing_norm = 0.0

        # Domain randomization rates
        self.arrival_rate_ns = 0.25
        self.arrival_rate_ew = 0.25
        self.weather_factor = 0.0
        self.time_of_day_norm = 0.5
        self.saturation_discharge_rate = 0.85  # veh/sec

    def reset(
        self,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        super().reset(seed=seed)
        rng = self.np_random

        if self.domain_randomize:
            # 1. Multi-regime domain randomization across diverse traffic patterns
            regime = rng.choice([
                "symmetric_light",
                "symmetric_moderate",
                "symmetric_heavy",
                "asymmetric_ns_arterial",
                "asymmetric_ew_arterial",
                "rush_surge",
                "gridlock_recovery",
                "shockwave_surge",
            ])
            if regime == "symmetric_light":
                self.arrival_rate_ns = float(rng.uniform(0.05, 0.14))
                self.arrival_rate_ew = float(rng.uniform(0.05, 0.14))
            elif regime == "symmetric_moderate":
                self.arrival_rate_ns = float(rng.uniform(0.18, 0.32))
                self.arrival_rate_ew = float(rng.uniform(0.18, 0.32))
            elif regime == "symmetric_heavy":
                self.arrival_rate_ns = float(rng.uniform(0.35, 0.52))
                self.arrival_rate_ew = float(rng.uniform(0.35, 0.52))
            elif regime == "asymmetric_ns_arterial":
                self.arrival_rate_ns = float(rng.uniform(0.45, 0.68))
                self.arrival_rate_ew = float(rng.uniform(0.05, 0.15))
            elif regime == "asymmetric_ew_arterial":
                self.arrival_rate_ns = float(rng.uniform(0.05, 0.15))
                self.arrival_rate_ew = float(rng.uniform(0.45, 0.68))
            elif regime == "gridlock_recovery":
                self.arrival_rate_ns = float(rng.uniform(0.30, 0.45))
                self.arrival_rate_ew = float(rng.uniform(0.30, 0.45))
            elif regime == "shockwave_surge":
                self.arrival_rate_ns = float(rng.uniform(0.20, 0.55))
                self.arrival_rate_ew = float(rng.uniform(0.20, 0.55))
            else:  # rush_surge
                self.arrival_rate_ns = float(rng.uniform(0.25, 0.50))
                self.arrival_rate_ew = float(rng.uniform(0.25, 0.50))

            self.time_of_day_norm = float(rng.uniform(0.0, 1.0))
            self.weather_factor = float(rng.choice([0.0, 0.0, 0.15, 0.35]))
            self.saturation_discharge_rate = float(rng.uniform(0.75, 1.05))

            # Initial queue state randomization
            if regime == "gridlock_recovery":
                # High initial queues (15 to 26 vehicles per leg)
                self.queues = {
                    d: int(rng.integers(15, 27)) for d in ("N", "S", "E", "W")
                }
            elif rng.random() < 0.50:
                self.queues = {
                    d: int(rng.integers(0, 14)) for d in ("N", "S", "E", "W")
                }
            else:
                self.queues = {"N": 0, "S": 0, "E": 0, "W": 0}
        else:
            self.arrival_rate_ns = 0.25
            self.arrival_rate_ew = 0.25
            self.time_of_day_norm = 0.5
            self.weather_factor = 0.0
            self.saturation_discharge_rate = 0.85
            self.queues = {"N": 0, "S": 0, "E": 0, "W": 0}

        if options:
            if "arrival_rate_ns" in options:
                self.arrival_rate_ns = float(options["arrival_rate_ns"])
            if "arrival_rate_ew" in options:
                self.arrival_rate_ew = float(options["arrival_rate_ew"])
            if "weather_factor" in options:
                self.weather_factor = float(options["weather_factor"])
            if "saturation_discharge_rate" in options:
                self.saturation_discharge_rate = float(options["saturation_discharge_rate"])
            if "queues" in options:
                self.queues = dict(options["queues"])
        self.phase_idx = 0  # Start with NS_GREEN
        self.time_in_phase = 0.0
        self.sim_time = 0.0
        self.red_duration_ns = 0.0
        self.red_duration_ew = 0.0
        self.pedestrians_waiting = 0
        self.emergency_approaching = False
        self.platoon_wave_active = False
        self.platoon_wave_timer = 0.0

        state = self._encode_state()
        return state, {}

    def _phase(self) -> str:
        return PHASES[self.phase_idx]

    def _is_ns_green(self) -> bool:
        return self._phase() == "NS_GREEN"

    def _is_ew_green(self) -> bool:
        return self._phase() == "EW_GREEN"

    def _phase_progress(self) -> float:
        phase = self._phase()
        denom = MAX_GREEN_S if phase in GREEN_PHASES else PHASE_DURATIONS.get(phase, MAX_GREEN_S)
        return float(min(1.0, self.time_in_phase / denom))

    def _starvation_flag(self) -> float:
        return 1.0 if (self.red_duration_ns > 30.0 or self.red_duration_ew > 30.0) else 0.0

    def _encode_state(self) -> np.ndarray:
        pN = float(self.queues["N"])
        pS = float(self.queues["S"])
        pE = float(self.queues["E"])
        pW = float(self.queues["W"])

        is_ns = self._phase() in ["NS_GREEN", "NS_YELLOW"]
        active_p = (pN + pS) if is_ns else (pE + pW)
        opposing_p = (pE + pW) if is_ns else (pN + pS)

        norm_active = min(1.0, active_p / MAX_QUEUE_NORMALIZATION)
        norm_opposing = min(1.0, opposing_p / MAX_QUEUE_NORMALIZATION)

        # Dynamic neighbor pressure simulation (represents upstream arterial feed & downstream backpressure)
        neighbor_active = min(1.0, max(0.0, 0.70 * norm_active + float(self.np_random.uniform(0.0, 0.35))))
        neighbor_opposing = min(1.0, max(0.0, 0.70 * norm_opposing + float(self.np_random.uniform(0.0, 0.35))))

        platoon_wave = 1.0 if (self.platoon_wave_active and is_ns) else (0.5 if self.platoon_wave_active else 0.0)

        # Realistic sensor noise during training prevents overfitting to sharp integer states
        if self.domain_randomize:
            noise_act = float(self.np_random.normal(0.0, 0.015))
            noise_opp = float(self.np_random.normal(0.0, 0.015))
            norm_active = min(1.0, max(0.0, norm_active + noise_act))
            norm_opposing = min(1.0, max(0.0, norm_opposing + noise_opp))

        return np.array(
            [
                norm_active,
                norm_opposing,
                self._phase_progress(),
                neighbor_active,
                neighbor_opposing,
                platoon_wave,  # Arterial Green Wave Platoon Indicator
                1.0 if self.emergency_approaching else 0.0,
                self.weather_factor,
                self.time_of_day_norm,
                self._starvation_flag(),
            ],
            dtype=np.float32,
        )

    def _transition_to_yellow(self):
        if self._is_ns_green():
            self.phase_idx = PHASES.index("NS_YELLOW")
            self.time_in_phase = 0.0
        elif self._is_ew_green():
            self.phase_idx = PHASES.index("EW_YELLOW")
            self.time_in_phase = 0.0

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        action_name = ACTIONS[action]
        prev_state = self._encode_state()
        vehicles_passed = 0
        dt = 1.0

        phase = self._phase()
        can_act = phase in GREEN_PHASES and self.time_in_phase >= MIN_GREEN_S

        # Action Execution with strict safety enforcement
        if can_act:
            if action_name == "SWITCH_PHASE":
                self._transition_to_yellow()
            elif action_name == "KEEP_PHASE":
                # Clean hold: phase continues
                pass

        # Automatic Max-Green forced transition (anti-starvation guarantee)
        if self._phase() in GREEN_PHASES and self.time_in_phase >= MAX_GREEN_S:
            self._transition_to_yellow()

        # Advance internal phase timer
        self.time_in_phase += dt
        phase = self._phase()

        # Phase cycle progression
        if phase in PHASE_DURATIONS and self.time_in_phase >= PHASE_DURATIONS[phase]:
            self.phase_idx = (self.phase_idx + 1) % len(PHASES)
            self.time_in_phase = 0.0

        # Physical Poisson Arrivals
        rng = self.np_random
        for d, rate in (
            ("N", self.arrival_rate_ns),
            ("S", self.arrival_rate_ns),
            ("E", self.arrival_rate_ew),
            ("W", self.arrival_rate_ew),
        ):
            if rng.random() < rate:
                self.queues[d] = min(self.jam_capacity, self.queues[d] + 1)

        # Platoon surge bursts (simulates bursty vehicle waves arriving from upstream signals)
        if self.platoon_wave_timer > 0:
            self.platoon_wave_timer -= dt
            if self.platoon_wave_timer <= 0:
                self.platoon_wave_active = False

        if self.domain_randomize and rng.random() < 0.035:
            burst_corridor = rng.choice(["NS", "EW"])
            burst_count = int(rng.integers(2, 6))
            self.platoon_wave_active = True
            self.platoon_wave_timer = 5.0
            if burst_corridor == "NS":
                target_d = rng.choice(["N", "S"])
                self.queues[target_d] = min(self.jam_capacity, self.queues[target_d] + burst_count)
            else:
                target_d = rng.choice(["E", "W"])
                self.queues[target_d] = min(self.jam_capacity, self.queues[target_d] + burst_count)

        # Vehicle Departures during Green Phases
        service_prob = self.saturation_discharge_rate * (1.0 - 0.25 * self.weather_factor)
        if self._is_ns_green():
            for d in ("N", "S"):
                if self.queues[d] > 0 and rng.random() < service_prob:
                    self.queues[d] -= 1
                    vehicles_passed += 1
        elif self._is_ew_green():
            for d in ("E", "W"):
                if self.queues[d] > 0 and rng.random() < service_prob:
                    self.queues[d] -= 1
                    vehicles_passed += 1

        # Red Duration & Starvation Tracking
        if self._is_ns_green():
            self.red_duration_ns = 0.0
            self.red_duration_ew += dt
        elif self._is_ew_green():
            self.red_duration_ew = 0.0
            self.red_duration_ns += dt
        else:
            self.red_duration_ns += dt
            self.red_duration_ew += dt

        # Emergency Events (Ambulance corridor priority)
        if not self.emergency_approaching and rng.random() < 0.004:
            self.emergency_approaching = True
            self.emergency_dir = rng.choice(["N", "S", "E", "W"])
        elif self.emergency_approaching and rng.random() < 0.25:
            self.emergency_approaching = False

        state = self._encode_state()
        reward = compute_reward(
            prev_state,
            state,
            action,
            vehicles_passed_this_step=vehicles_passed,
            action_name=action_name,
            emergency_approaching=self.emergency_approaching,
            red_duration_ns=self.red_duration_ns,
            red_duration_ew=self.red_duration_ew,
        )

        self.sim_time += dt
        terminated = False
        truncated = self.sim_time >= self.episode_length_s

        info = {
            "vehicles_passed": vehicles_passed,
            "total_queue": sum(self.queues.values()),
            "phase": self._phase(),
            "time_in_phase": self.time_in_phase,
            "action": action_name,
        }

        return state, reward, terminated, truncated, info
