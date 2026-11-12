"""
Sanchar Evaluation & Benchmarking Suite — Python Implementation
Compares the trained Double-DQN Policy against Actuated Heuristic and Fixed-Time Signal Control.
Measures throughput, queue wait times, starvation frequency, and flapping/chatter index.
"""

import json
from typing import Dict, Any, List
import numpy as np

from sanchar.env.sanchar_env import SancharTrafficEnv
from sanchar.ai.model import SancharMLPQNetwork
from sanchar.ai.agent import DQNAgent
from sanchar.ai.controller import AdaptiveController
from sanchar.config import ACTIONS

BENCH_SEEDS = [70001, 70002, 70003, 70004, 70005, 70006, 70007, 70008, 70009, 70010]


def evaluate_fixed_time(seeds: List[int], green_duration: int = 30) -> Dict[str, float]:
    env = SancharTrafficEnv(episode_length_s=300, domain_randomize=True)
    all_throughput = []
    all_switches = []
    all_starvations = []

    for s in seeds:
        state, _ = env.reset(seed=s)
        done = False
        switches = 0
        starvations = 0
        total_vehicles = 0

        while not done:
            # Fixed time: switch when time_in_phase >= green_duration
            can_switch = env._phase() in ["NS_GREEN", "EW_GREEN"] and env.time_in_phase >= green_duration
            action = 1 if can_switch else 0
            if action == 1:
                switches += 1

            next_state, reward, terminated, truncated, info = env.step(action)
            done = terminated or truncated
            total_vehicles += info.get("vehicles_passed", 0)
            if next_state[9] > 0.5:
                starvations += 1

        all_throughput.append(total_vehicles)
        all_switches.append(switches)
        all_starvations.append(starvations)

    return {
        "throughput": float(np.mean(all_throughput)),
        "switches": float(np.mean(all_switches)),
        "starvations": float(np.mean(all_starvations)),
    }


def evaluate_actuated(seeds: List[int]) -> Dict[str, float]:
    env = SancharTrafficEnv(episode_length_s=300, domain_randomize=True)
    controller = AdaptiveController(mode="ADAPTIVE")
    all_throughput = []
    all_switches = []
    all_starvations = []

    for s in seeds:
        state, _ = env.reset(seed=s)
        done = False
        switches = 0
        starvations = 0
        total_vehicles = 0

        while not done:
            int_data = {
                "phase": env._phase(),
                "time_in_phase": env.time_in_phase,
                "queues": env.queues,
                "pedestrians_waiting": env.pedestrians_waiting,
                "emergency_approaching": env.emergency_approaching,
            }
            dec = controller._evaluate_intersection("int_0", int_data, {"int_0": int_data})
            action = 1 if (dec and "SWITCH" in dec.get("action", "")) else 0
            if action == 1:
                switches += 1

            next_state, reward, terminated, truncated, info = env.step(action)
            done = terminated or truncated
            total_vehicles += info.get("vehicles_passed", 0)
            if next_state[9] > 0.5:
                starvations += 1

        all_throughput.append(total_vehicles)
        all_switches.append(switches)
        all_starvations.append(starvations)

    return {
        "throughput": float(np.mean(all_throughput)),
        "switches": float(np.mean(all_switches)),
        "starvations": float(np.mean(all_starvations)),
    }


def evaluate_rl(weights_path: str, seeds: List[int]) -> Dict[str, float]:
    env = SancharTrafficEnv(episode_length_s=300, domain_randomize=True)
    with open(weights_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    model = SancharMLPQNetwork.from_dict(data)
    model.eval()

    all_throughput = []
    all_switches = []
    all_starvations = []
    action_counts = {a: 0 for a in ACTIONS}

    for s in seeds:
        state, _ = env.reset(seed=s)
        done = False
        switches = 0
        starvations = 0
        total_vehicles = 0

        while not done:
            q_vals = model.predict_numpy(state)
            action = int(np.argmax(q_vals))
            action_counts[ACTIONS[action]] += 1

            if ACTIONS[action] == "SWITCH_PHASE":
                switches += 1

            next_state, reward, terminated, truncated, info = env.step(action)
            done = terminated or truncated
            state = next_state
            total_vehicles += info.get("vehicles_passed", 0)
            if next_state[9] > 0.5:
                starvations += 1

        all_throughput.append(total_vehicles)
        all_switches.append(switches)
        all_starvations.append(starvations)

    return {
        "throughput": float(np.mean(all_throughput)),
        "switches": float(np.mean(all_switches)),
        "starvations": float(np.mean(all_starvations)),
        "action_distribution": action_counts,
    }


def main():
    print("=================================================================")
    print("        SANCHAR BENCHMARK — Cross-Controller Evaluation         ")
    print("=================================================================")
    print(f"Testing {len(BENCH_SEEDS)} unseen held-out domain-randomized seeds...\n")

    fixed = evaluate_fixed_time(BENCH_SEEDS)
    print(f"[1. Fixed-Time (30s)]:  Throughput: {fixed['throughput']:.1f} veh | Switches: {fixed['switches']:.1f} | Starvations: {fixed['starvations']:.1f}")

    actuated = evaluate_actuated(BENCH_SEEDS)
    print(f"[2. Actuated (Rule)]:  Throughput: {actuated['throughput']:.1f} veh | Switches: {actuated['switches']:.1f} | Starvations: {actuated['starvations']:.1f}")

    rl = evaluate_rl("public/weights/gnn_policy.json", BENCH_SEEDS)
    print(f"[3. Sanchar RL (DQN)]: Throughput: {rl['throughput']:.1f} veh | Switches: {rl['switches']:.1f} | Starvations: {rl['starvations']:.1f}")
    print(f"    Action distribution: {rl['action_distribution']}")


if __name__ == "__main__":
    main()
