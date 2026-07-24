import numpy as np
import gymnasium as gym
from gymnasium import spaces

ACTIONS = ["KEEP_PHASE", "SWITCH_PHASE", "EXTEND_PHASE", "PEDESTRIAN_SCRAMBLE"]

PHASES = ["NS_GREEN", "NS_YELLOW", "ALL_RED_1", "EW_GREEN", "EW_YELLOW", "ALL_RED_2"]
PHASE_DURATIONS = {"NS_YELLOW": 3.0, "ALL_RED_1": 2.0, "EW_YELLOW": 3.0, "ALL_RED_2": 2.0}
GREEN_PHASES = {"NS_GREEN", "EW_GREEN"}

MIN_GREEN_S = 5.0
MAX_GREEN_S = 60.0
DT = 1.0


class SancharTrafficEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, episode_length_s=300, domain_randomize=True):
        super().__init__()
        self.episode_length_s = episode_length_s
        self.domain_randomize = domain_randomize

        self.observation_space = spaces.Box(low=0.0, high=1.0, shape=(10,), dtype=np.float32)
        self.action_space = spaces.Discrete(len(ACTIONS))

        self.max_q_norm = 40.0 # 20 (max_q) * 2
        self.jam_capacity = 25

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        rng = self.np_random

        if self.domain_randomize:
            self.arrival_rate_ns = rng.uniform(0.05, 0.45)
            self.arrival_rate_ew = rng.uniform(0.05, 0.45)
            self.time_of_day_norm = rng.uniform(0.0, 1.0)
            self.weather_factor = rng.choice([0.0, 0.0, 0.0, 0.4])
        else:
            self.arrival_rate_ns = 0.2
            self.arrival_rate_ew = 0.2
            self.time_of_day_norm = 0.33
            self.weather_factor = 0.0

        self.queues = {"N": 0, "S": 0, "E": 0, "W": 0}
        self.pedestrians_waiting = 0
        self.emergency_approaching = False
        self.phase_idx = 0
        self.time_in_phase = 0.0
        self.sim_time = 0.0
        self.red_duration_ns = 0.0
        self.red_duration_ew = 0.0
        self.vehicles_passed_this_step = 0

        return self._encode_state(), {}

    def _phase(self):
        return PHASES[self.phase_idx]

    def _is_ns_green(self):
        return self._phase() == "NS_GREEN"

    def _is_ew_green(self):
        return self._phase() == "EW_GREEN"

    def _phase_progress(self):
        phase = self._phase()
        denom = MAX_GREEN_S if phase in GREEN_PHASES else PHASE_DURATIONS.get(phase, MAX_GREEN_S)
        return min(1.0, self.time_in_phase / denom)

    def _starvation_flag(self):
        return 1.0 if (self.red_duration_ns > 30.0 or self.red_duration_ew > 30.0) else 0.0

    def _encode_state(self):
        avg_downstream = 0.0 # Isolated intersection for now
        
        pN = max(0, self.queues["N"] - avg_downstream)
        pS = max(0, self.queues["S"] - avg_downstream)
        pE = max(0, self.queues["E"] - avg_downstream)
        pW = max(0, self.queues["W"] - avg_downstream)

        is_ns = self._phase() in ["NS_GREEN", "NS_YELLOW"]
        active_pressure = (pN + pS) if is_ns else (pE + pW)
        opposing_pressure = (pE + pW) if is_ns else (pN + pS)
        
        normActive = min(1.0, active_pressure / self.max_q_norm)
        normOpposing = min(1.0, opposing_pressure / self.max_q_norm)
        
        # V10 Invariant mapping
        return np.array([
            normActive, 
            normOpposing, 
            self._phase_progress(), 
            0.0, # avgNeighborActive
            0.0, # avgNeighborOpposing
            1.0 if self.pedestrians_waiting > 0 else 0.0, 
            1.0 if self.emergency_approaching else 0.0,
            self.weather_factor,
            self.time_of_day_norm, 
            self._starvation_flag(),
        ], dtype=np.float32)

    def _force_transition_to_yellow(self):
        if self._is_ns_green():
            self.phase_idx = PHASES.index("NS_YELLOW")
            self.time_in_phase = 0.0
        elif self._is_ew_green():
            self.phase_idx = PHASES.index("EW_YELLOW")
            self.time_in_phase = 0.0

    def _force_transition_to_all_red(self):
        target = "ALL_RED_1" if self._is_ns_green() else "ALL_RED_2"
        if self._phase() in GREEN_PHASES:
            self.phase_idx = PHASES.index(target)
            self.time_in_phase = 0.0

    def step(self, action):
        action_name = ACTIONS[action]
        prev_state = self._encode_state()
        self.vehicles_passed_this_step = 0

        can_act_now = self._phase() in GREEN_PHASES and self.time_in_phase >= MIN_GREEN_S
        if can_act_now:
            if action_name == "SWITCH_PHASE":
                self._force_transition_to_yellow()
            elif action_name == "PEDESTRIAN_SCRAMBLE":
                self._force_transition_to_all_red()
            elif action_name == "EXTEND_PHASE":
                self.time_in_phase = max(0.0, self.time_in_phase - 5.0)

        if self._phase() in GREEN_PHASES and self.time_in_phase >= MAX_GREEN_S:
            self._force_transition_to_yellow()

        self.time_in_phase += DT
        phase = self._phase()
        if phase in PHASE_DURATIONS and self.time_in_phase >= PHASE_DURATIONS[phase]:
            self.phase_idx = (self.phase_idx + 1) % len(PHASES)
            self.time_in_phase = 0.0

        rng = self.np_random
        for d, rate in (("N", self.arrival_rate_ns), ("S", self.arrival_rate_ns),
                        ("E", self.arrival_rate_ew), ("W", self.arrival_rate_ew)):
            if rng.random() < rate:
                self.queues[d] = min(self.jam_capacity, self.queues[d] + 1)

        SERVICE_RATE = 0.5
        if self._is_ns_green():
            for d in ("N", "S"):
                if self.queues[d] > 0 and rng.random() < SERVICE_RATE:
                    self.queues[d] -= 1
                    self.vehicles_passed_this_step += 1
        elif self._is_ew_green():
            for d in ("E", "W"):
                if self.queues[d] > 0 and rng.random() < SERVICE_RATE:
                    self.queues[d] -= 1
                    self.vehicles_passed_this_step += 1

        if self._is_ns_green():
            self.red_duration_ns = 0.0
            self.red_duration_ew += DT
        elif self._is_ew_green():
            self.red_duration_ew = 0.0
            self.red_duration_ns += DT
        else:
            self.red_duration_ns += DT
            self.red_duration_ew += DT

        if rng.random() < 0.02:
            self.pedestrians_waiting = min(10, self.pedestrians_waiting + 1)
        if self._phase() in GREEN_PHASES:
            self.pedestrians_waiting = max(0, self.pedestrians_waiting - 1) if rng.random() < 0.3 else self.pedestrians_waiting
        if not self.emergency_approaching and rng.random() < 0.005:
            self.emergency_approaching = True
        elif self.emergency_approaching and rng.random() < 0.3:
            self.emergency_approaching = False

        state = self._encode_state()
        reward = compute_reward(prev_state, state, action, self.vehicles_passed_this_step)

        self.sim_time += DT
        truncated = self.sim_time >= self.episode_length_s
        return state, reward, False, truncated, {"action": action_name}


def compute_reward(prev_state, state, action, vehicles_passed_this_step):
    reward = 0.0
    reward += vehicles_passed_this_step * 20.0

    if action == 1: reward -= 1.0   
    if action == 2: reward -= 0.5   
    if action == 3: reward -= 2.0  

    prev_pressure = prev_state[0] + prev_state[1]
    curr_pressure = state[0] + state[1]
    if curr_pressure < prev_pressure:
        reward += 15.0
    elif curr_pressure > prev_pressure:
        reward -= 10.0

    if state[9] > 0.0:
        reward -= 50.0

    if state[6] > 0.0 and action == 1:
        reward += 30.0

    return float(max(-100.0, min(100.0, reward)))
