"""
Sanchar Comprehensive Traffic Simulation & Stress Test Suite
Simulates realistic urban traffic conditions across 6 diverse traffic regimes:
1. Off-Peak Light Traffic (Free Flow)
2. Normal City Traffic (Typical Midday)
3. Peak Rush Hour Surge (High Demand)
4. Asymmetric Arterial Flow (Major Boulevard vs Minor Cross-Street)
5. Over-Capacity Gridlock Stress Test (Arrivals > Capacity)
6. Adverse Weather Conditions (Heavy Rain / Slower Discharge)

Measures:
- Throughput (Total vehicles discharged)
- Queue Dynamics (Mean, Peak, and Final Queues)
- Average Wait Time per Vehicle
- Starvation Frequency (Vehicles waiting > 30s)
- Switching Frequency & Average Green Duration
- Gridlock Resistance / Jam Ratio
"""

import os
import json
from typing import Dict, Any, List
import numpy as np

from sanchar.env.sanchar_env import SancharTrafficEnv
from sanchar.ai.model import SancharMLPQNetwork
from sanchar.ai.controller import AdaptiveController
from sanchar.ai.safety import SafetyComplianceWrapper
from sanchar.config import ACTIONS


SCENARIOS = [
    {
        "name": "1. Off-Peak Light Traffic (Free Flow)",
        "duration": 600,
        "options": {
            "arrival_rate_ns": 0.12,
            "arrival_rate_ew": 0.10,
            "weather_factor": 0.0,
            "saturation_discharge_rate": 0.90,
        },
        "description": "Low arrivals; tests whether controller avoids wasteful switching.",
    },
    {
        "name": "2. Normal City Traffic (Typical Midday)",
        "duration": 600,
        "options": {
            "arrival_rate_ns": 0.25,
            "arrival_rate_ew": 0.25,
            "weather_factor": 0.0,
            "saturation_discharge_rate": 0.85,
        },
        "description": "Standard balanced urban traffic; tests steady queue clearing.",
    },
    {
        "name": "3. Peak Rush Hour Surge (High Demand)",
        "duration": 600,
        "options": {
            "arrival_rate_ns": 0.40,
            "arrival_rate_ew": 0.38,
            "weather_factor": 0.0,
            "saturation_discharge_rate": 0.85,
        },
        "description": "Heavy demand approaching physical saturation capacity.",
    },
    {
        "name": "4. Asymmetric Flow (Major Arterial vs Minor Side-Street)",
        "duration": 600,
        "options": {
            "arrival_rate_ns": 0.48,
            "arrival_rate_ew": 0.10,
            "weather_factor": 0.0,
            "saturation_discharge_rate": 0.85,
        },
        "description": "NS is a major artery, EW is a side street; tests corridor prioritization.",
    },
    {
        "name": "5. Over-Capacity Extreme Stress Test",
        "duration": 600,
        "options": {
            "arrival_rate_ns": 0.55,
            "arrival_rate_ew": 0.50,
            "weather_factor": 0.0,
            "saturation_discharge_rate": 0.80,
        },
        "description": "Arrivals exceed service rate; tests gridlock and anti-starvation resilience.",
    },
    {
        "name": "6. Adverse Weather (Heavy Rain / Slower Discharge)",
        "duration": 600,
        "options": {
            "arrival_rate_ns": 0.32,
            "arrival_rate_ew": 0.30,
            "weather_factor": 0.4,
            "saturation_discharge_rate": 0.65,
        },
        "description": "Low friction, longer braking distances; tests adaptive green extension.",
    },
]


def run_fixed_time(scenario: Dict[str, Any], seed: int = 42, green_duration: int = 30) -> Dict[str, Any]:
    duration = scenario["duration"]
    env = SancharTrafficEnv(episode_length_s=duration, domain_randomize=False)
    state, _ = env.reset(seed=seed, options=scenario["options"])

    done = False
    total_vehicles = 0
    switches = 0
    starvations = 0
    queues_history = []
    total_vehicle_wait_seconds = 0

    while not done:
        can_switch = env._phase() in ["NS_GREEN", "EW_GREEN"] and env.time_in_phase >= green_duration
        action = 1 if can_switch else 0
        if action == 1:
            switches += 1

        next_state, reward, terminated, truncated, info = env.step(action)
        done = terminated or truncated

        q_sum = sum(env.queues.values())
        queues_history.append(q_sum)
        total_vehicle_wait_seconds += q_sum
        total_vehicles += info.get("vehicles_passed", 0)

        if next_state[9] > 0.5:
            starvations += 1

    return {
        "throughput": total_vehicles,
        "switches": switches,
        "starvations": starvations,
        "avg_queue": float(np.mean(queues_history)),
        "peak_queue": int(np.max(queues_history)),
        "final_queue": int(queues_history[-1]),
        "total_delay_s": total_vehicle_wait_seconds,
        "avg_wait_s": float(total_vehicle_wait_seconds / max(1, total_vehicles)),
    }


def run_actuated(scenario: Dict[str, Any], seed: int = 42) -> Dict[str, Any]:
    duration = scenario["duration"]
    env = SancharTrafficEnv(episode_length_s=duration, domain_randomize=False)
    state, _ = env.reset(seed=seed, options=scenario["options"])
    controller = AdaptiveController(mode="ADAPTIVE")

    done = False
    total_vehicles = 0
    switches = 0
    starvations = 0
    queues_history = []
    total_vehicle_wait_seconds = 0

    while not done:
        int_data = {
            "phase": env._phase(),
            "time_in_phase": env.time_in_phase,
            "queues": env.queues,
            "pedestrians_waiting": 0,
            "emergency_approaching": env.emergency_approaching,
        }
        dec = controller._evaluate_intersection("int_0", int_data, {"int_0": int_data})
        action = 1 if (dec and "SWITCH" in dec.get("action", "")) else 0
        if action == 1:
            switches += 1

        next_state, reward, terminated, truncated, info = env.step(action)
        done = terminated or truncated

        q_sum = sum(env.queues.values())
        queues_history.append(q_sum)
        total_vehicle_wait_seconds += q_sum
        total_vehicles += info.get("vehicles_passed", 0)

        if next_state[9] > 0.5:
            starvations += 1

    return {
        "throughput": total_vehicles,
        "switches": switches,
        "starvations": starvations,
        "avg_queue": float(np.mean(queues_history)),
        "peak_queue": int(np.max(queues_history)),
        "final_queue": int(queues_history[-1]),
        "total_delay_s": total_vehicle_wait_seconds,
        "avg_wait_s": float(total_vehicle_wait_seconds / max(1, total_vehicles)),
    }


def run_sanchar_rl(scenario: Dict[str, Any], model: SancharMLPQNetwork, seed: int = 42) -> Dict[str, Any]:
    duration = scenario["duration"]
    env = SancharTrafficEnv(episode_length_s=duration, domain_randomize=False)
    state, _ = env.reset(seed=seed, options=scenario["options"])

    done = False
    total_vehicles = 0
    switches = 0
    starvations = 0
    queues_history = []
    total_vehicle_wait_seconds = 0
    action_counts = {a: 0 for a in ACTIONS}

    while not done:
        q_vals = model.predict_numpy(state)
        action = int(np.argmax(q_vals))
        action_counts[ACTIONS[action]] += 1

        if ACTIONS[action] == "SWITCH_PHASE":
            switches += 1

        next_state, reward, terminated, truncated, info = env.step(action)
        done = terminated or truncated
        state = next_state

        q_sum = sum(env.queues.values())
        queues_history.append(q_sum)
        total_vehicle_wait_seconds += q_sum
        total_vehicles += info.get("vehicles_passed", 0)

        if next_state[9] > 0.5:
            starvations += 1

    return {
        "throughput": total_vehicles,
        "switches": switches,
        "starvations": starvations,
        "avg_queue": float(np.mean(queues_history)),
        "peak_queue": int(np.max(queues_history)),
        "final_queue": int(queues_history[-1]),
        "total_delay_s": total_vehicle_wait_seconds,
        "avg_wait_s": float(total_vehicle_wait_seconds / max(1, total_vehicles)),
        "action_distribution": action_counts,
    }


def run_sanchar_rl_safe(scenario: Dict[str, Any], model: SancharMLPQNetwork, seed: int = 42) -> Dict[str, Any]:
    duration = scenario["duration"]
    env = SancharTrafficEnv(episode_length_s=duration, domain_randomize=False)
    state, _ = env.reset(seed=seed, options=scenario["options"])
    safety = SafetyComplianceWrapper(min_green=10.0, max_green=45.0, hysteresis_margin=0.75)

    done = False
    total_vehicles = 0
    switches = 0
    starvations = 0
    queues_history = []
    total_vehicle_wait_seconds = 0
    action_counts = {a: 0 for a in ACTIONS}

    while not done:
        q_vals = model.predict_numpy(state)
        proposed_act = int(np.argmax(q_vals))

        int_data = {
            "phase": env._phase(),
            "time_in_phase": env.time_in_phase,
            "queues": env.queues,
            "pedestrians_waiting": 0,
            "emergency_approaching": env.emergency_approaching,
        }
        final_act, action_name, veto = safety.filter_action(int_data, proposed_act, q_values=list(q_vals))
        action_counts[ACTIONS[final_act]] += 1

        if ACTIONS[final_act] == "SWITCH_PHASE":
            switches += 1

        next_state, reward, terminated, truncated, info = env.step(final_act)
        done = terminated or truncated
        state = next_state

        q_sum = sum(env.queues.values())
        queues_history.append(q_sum)
        total_vehicle_wait_seconds += q_sum
        total_vehicles += info.get("vehicles_passed", 0)

        if next_state[9] > 0.5:
            starvations += 1

    return {
        "throughput": total_vehicles,
        "switches": switches,
        "starvations": starvations,
        "avg_queue": float(np.mean(queues_history)),
        "peak_queue": int(np.max(queues_history)),
        "final_queue": int(queues_history[-1]),
        "total_delay_s": total_vehicle_wait_seconds,
        "avg_wait_s": float(total_vehicle_wait_seconds / max(1, total_vehicles)),
        "action_distribution": action_counts,
    }


def main():
    weights_path = "public/weights/gnn_policy.json"
    if not os.path.exists(weights_path):
        print(f"Error: weights not found at {weights_path}")
        return

    with open(weights_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    model = SancharMLPQNetwork.from_dict(data)
    model.eval()

    print("==========================================================================================")
    print("           SANCHAR TRAFFIC OPTIMIZATION — MULTI-REGIME STRESS SIMULATION                  ")
    print("==========================================================================================")
    print(f"Model: 3-Layer Deep Q-Network | Training Steps: {data.get('trainingSteps', 'N/A')}")
    print(f"Testing 6 real-world traffic regimes for 600s (10 simulated minutes) each...\n")

    summary_results = []

    for sc in SCENARIOS:
        print(f"\n▶ Running: {sc['name']}")
        print(f"  Description: {sc['description']}")

        # 3 runs per scenario with different seeds to measure consistency
        seeds = [101, 202, 303]
        fixed_runs = [run_fixed_time(sc, seed=s) for s in seeds]
        actuated_runs = [run_actuated(sc, seed=s) for s in seeds]
        rl_safe_runs = [run_sanchar_rl_safe(sc, model, seed=s) for s in seeds]

        def avg_metric(runs, key):
            return float(np.mean([r[key] for r in runs]))

        f_thru = avg_metric(fixed_runs, "throughput")
        f_wait = avg_metric(fixed_runs, "avg_wait_s")
        f_starv = avg_metric(fixed_runs, "starvations")
        f_peak = int(np.mean([r["peak_queue"] for r in fixed_runs]))

        a_thru = avg_metric(actuated_runs, "throughput")
        a_wait = avg_metric(actuated_runs, "avg_wait_s")
        a_starv = avg_metric(actuated_runs, "starvations")
        a_peak = int(np.mean([r["peak_queue"] for r in actuated_runs]))

        rs_thru = avg_metric(rl_safe_runs, "throughput")
        rs_wait = avg_metric(rl_safe_runs, "avg_wait_s")
        rs_starv = avg_metric(rl_safe_runs, "starvations")
        rs_peak = int(np.mean([r["peak_queue"] for r in rl_safe_runs]))
        rs_sw = avg_metric(rl_safe_runs, "switches")

        print(f"  ┌─ Fixed-Time (30s):       Throughput: {f_thru:5.1f} veh | Avg Wait: {f_wait:5.1f}s | Starvations: {f_starv:4.1f} | Peak Q: {f_peak:2d}")
        print(f"  ├─ Actuated (Rule):       Throughput: {a_thru:5.1f} veh | Avg Wait: {a_wait:5.1f}s | Starvations: {a_starv:4.1f} | Peak Q: {a_peak:2d}")
        print(f"  └─ Sanchar RL (Protected): Throughput: {rs_thru:5.1f} veh | Avg Wait: {rs_wait:5.1f}s | Starvations: {rs_starv:4.1f} | Peak Q: {rs_peak:2d} (Switches: {rs_sw:.1f})")

        wait_diff = ((rs_wait - f_wait) / max(1e-5, f_wait)) * 100
        starv_diff = ((rs_starv - f_starv) / max(1e-5, f_starv)) * 100
        print(f"     ➔ Sanchar vs Fixed: Wait Time: {wait_diff:+.1f}% | Starvation: {starv_diff:+.1f}%")

        summary_results.append({
            "scenario": sc["name"],
            "fixed": {"thru": f_thru, "wait": f_wait, "starv": f_starv, "peak": f_peak},
            "actuated": {"thru": a_thru, "wait": a_wait, "starv": a_starv, "peak": a_peak},
            "rl": {"thru": rs_thru, "wait": rs_wait, "starv": rs_starv, "peak": rs_peak, "switches": rs_sw},
        })

    print("\n==========================================================================================")
    print("                                STRESS SIMULATION SUMMARY                                  ")
    print("==========================================================================================")
    for res in summary_results:
        print(f"{res['scenario']:<55} | Thru: {res['rl']['thru']:5.1f} | Wait: {res['rl']['wait']:4.1f}s | Starv: {res['rl']['starv']:4.1f}")

    print("\n==========================================================================================")
    print("                                STRESS SIMULATION SUMMARY                                  ")
    print("==========================================================================================")
    for res in summary_results:
        print(f"{res['scenario']:<55} | RL Thru: {res['rl']['thru']:5.1f} | RL Wait: {res['rl']['wait']:4.1f}s | RL Starv: {res['rl']['starv']:4.1f}")


if __name__ == "__main__":
    main()
