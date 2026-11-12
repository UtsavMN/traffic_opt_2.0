"""
Sanchar Objective-Driven Reward Function — Python Implementation
Formulation:
  R = w1 * (Pressure Reduction)
    + w2 * (Throughput)
    - w3 * (Switching Cost)
    - w4 * (Waiting & Delay Penalty)

Core Principle:
Reward the agent strictly for improving global traffic conditions (clearing queues,
maximizing throughput, and preventing excessive delay), NOT merely for choosing
a particular action.
"""

from typing import Optional, Dict
import numpy as np


def compute_reward(
    prev_state: Optional[np.ndarray],
    curr_state: np.ndarray,
    action: int,
    vehicles_passed_this_step: int = 0,
    action_name: str = "KEEP_PHASE",
    emergency_approaching: bool = False,
    queues: Optional[Dict[str, int]] = None,
    red_duration_ns: float = 0.0,
    red_duration_ew: float = 0.0,
    w1: float = 12.0,   # Weight on Pressure Reduction
    w2: float = 2.0,    # Weight on Throughput (per vehicle passed)
    w3: float = 1.0,    # Weight on Switching Cost (clearance loss penalty)
    w4: float = 1.0,    # Weight on Waiting / Delay Penalty
) -> float:
    """
    Computes a balanced, objective-driven reward bounded in [-15.0, +15.0].
    
    R = w1 * PressureReduction + w2 * Throughput - w3 * SwitchCost - w4 * WaitPenalty
    
    Components:
    1. Throughput (+2.0 per vehicle): Direct reward for physical work completed.
    2. Pressure Reduction (+12.0 * Delta Pressure): Lyapunov energy minimization
       across all intersection approaches.
    3. Switching Cost (-1.0): Represents the lost intersection capacity during the
       mandatory 3-second yellow clearance interval.
    4. Waiting & Starvation Penalty (-1.0 * (Queue Delay + Starvation Escalation)):
       Riemann sum of waiting queues plus progressive penalty for red times > 30s.
    5. Emergency Delay Penalty (-3.0): Urgent penalty when an ambulance is blocked.
    """
    # 1. Throughput: Steady incentive to discharge vehicles
    r_throughput = w2 * float(vehicles_passed_this_step)

    # 2. Pressure Reduction (Lyapunov energy reduction across all approaches)
    # Active & opposing normalized pressures from state vector
    curr_active = float(curr_state[0])
    curr_opposing = float(curr_state[1])
    curr_pressure = (curr_active ** 2) + (curr_opposing ** 2)

    if prev_state is not None:
        prev_active = float(prev_state[0])
        prev_opposing = float(prev_state[1])
        prev_pressure = (prev_active ** 2) + (prev_opposing ** 2)
        # Positive if pressure dropped (improvement), negative if pressure grew
        delta_pressure = prev_pressure - curr_pressure
    else:
        delta_pressure = -0.5 * curr_pressure

    r_pressure = w1 * delta_pressure

    # 3. Switching Cost (Lost physical capacity during 3s yellow clearance)
    is_switch = (action == 1 or action_name == "SWITCH_PHASE")
    r_switch = -w3 if is_switch else 0.0

    # 4. Waiting / Delay Penalty
    # A: Total queue delay (Riemann sum of queue length -> total vehicle wait time)
    queue_delay = curr_active + curr_opposing  # Normalized sum of queues in system

    # B: Starvation penalty (Non-linear escalation for approaches waiting past 30s)
    max_red = max(red_duration_ns, red_duration_ew)
    if max_red > 30.0:
        starvation_delay = min(2.0, ((max_red - 30.0) / 20.0) ** 1.5)
    elif curr_state[9] > 0.5:
        starvation_delay = 1.0
    else:
        starvation_delay = 0.0

    r_wait = -w4 * (queue_delay + starvation_delay)

    # 5. Emergency Vehicle Priority (Penalty while emergency vehicle is blocked)
    r_emergency = 0.0
    if emergency_approaching or curr_state[6] > 0.5:
        r_emergency = -3.0

    total_reward = r_pressure + r_throughput + r_switch + r_wait + r_emergency

    # Bound reward to prevent gradient explosion
    return float(np.clip(total_reward, -15.0, 15.0))


def compute_max_pressure_reward(
    active_queue: float,
    opposing_queue: float,
    discharged: int,
    action_name: str,
) -> float:
    """
    Canonical MaxPressure formulation (Varaiya 2013).
    R = - (q_in - q_out)^2 + throughput_bonus - switch_cost
    """
    pressure = (active_queue - opposing_queue)
    throughput_bonus = discharged * 2.0
    switch_cost = -1.0 if action_name == "SWITCH_PHASE" else 0.0
    return float(-0.1 * (pressure ** 2) + throughput_bonus + switch_cost)
