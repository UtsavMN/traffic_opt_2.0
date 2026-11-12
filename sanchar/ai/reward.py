"""
Sanchar Reward Function — Python Implementation
Balanced, mathematically grounded MaxPressure and multi-objective traffic signal reward.
Solves the floppy/oscillating behavior by eliminating short-sighted clearance penalties
and providing smooth, well-conditioned gradient signals.
"""

from typing import Optional
import numpy as np


def compute_reward(
    prev_state: Optional[np.ndarray],
    curr_state: np.ndarray,
    action: int,
    vehicles_passed_this_step: int = 0,
    action_name: str = "KEEP_PHASE",
    pedestrians_waiting: int = 0,
    emergency_approaching: bool = False,
) -> float:
    """
    Computes a balanced reward bounded in [-25.0, +25.0].
    
    Components:
    1. Throughput bonus: rewards vehicle departures (+2.5 per vehicle).
    2. Queue Pressure minimization: penalizes sum of squared queue pressures.
    3. Hysteresis switch penalty: mild penalty on phase switches (-0.8) to deter chatter.
    4. Anti-Starvation: smooth penalty when starvation flag is active.
    5. Emergency clearance: bonus (+8.0) when granting passage to active ambulance/fire.
    """
    reward = 0.0

    # 1. Throughput: steady incentive to discharge vehicles
    reward += float(vehicles_passed_this_step) * 2.5

    # 2. Pressure & Queue Dynamics
    norm_active = float(curr_state[0])
    norm_opposing = float(curr_state[1])
    current_pressure = (norm_active ** 2) + (norm_opposing ** 2)

    if prev_state is not None:
        prev_active = float(prev_state[0])
        prev_opposing = float(prev_state[1])
        prev_pressure = (prev_active ** 2) + (prev_opposing ** 2)

        # Reward net pressure reduction; penalize pressure inflation
        delta_pressure = prev_pressure - current_pressure
        reward += float(delta_pressure) * 12.0
    else:
        reward -= current_pressure * 6.0

    # 3. Action-Specific Costs & Hysteresis
    if action == 1 or action_name == "SWITCH_PHASE":
        # Mild switch cost: prevents rapid flapping unless delta pressure justifies it
        reward -= 0.8
        # If opposing pressure is substantially higher than active, reward the timely switch!
        if norm_opposing > norm_active + 0.15:
            reward += 4.0
    elif action == 0 or action_name == "KEEP_PHASE":
        # Reward holding green when active approach dominates
        if norm_active > norm_opposing + 0.10:
            reward += 0.5

    # 4. Starvation Prevention (state[9] is starvation flag)
    if curr_state[9] > 0.5:
        # Opposing direction is starving — penalize keeping current phase!
        if action == 0 or action_name == "KEEP_PHASE":
            reward -= 10.0
        elif action == 1 or action_name == "SWITCH_PHASE":
            reward += 6.0

    # 5. Emergency Vehicle Priority (state[6] is emergency flag)
    if curr_state[6] > 0.5:
        if action == 1 or action_name == "SWITCH_PHASE":
            reward += 8.0

    # Clamp reward to prevent gradient explosion
    return float(np.clip(reward, -25.0, 25.0))


def compute_max_pressure_reward(
    active_queue: float,
    opposing_queue: float,
    discharged: int,
    action_name: str,
) -> float:
    """
    Canonical MaxPressure formulation (Varaiya 2013).
    R = - (q_in - q_out)^2 + throughput_bonus
    """
    pressure = (active_queue - opposing_queue)
    throughput_bonus = discharged * 2.0
    switch_cost = -0.5 if action_name == "SWITCH_PHASE" else 0.0
    return float(-0.1 * (pressure ** 2) + throughput_bonus + switch_cost)
