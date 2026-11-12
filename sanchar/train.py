"""
Sanchar Offline Training Pipeline — PyTorch Implementation
Trains the Double-DQN Agent on the domain-randomized SancharTrafficEnv.
Validates generalization against fixed held-out seeds and exports production weights.
"""

import os
import json
import random
from typing import List, Tuple
import numpy as np
import torch

from sanchar.config import (
    STATE_DIM,
    ACTION_DIM,
    LR,
    BATCH_SIZE,
    REPLAY_CAPACITY,
    EPS_START,
    EPS_MIN,
    EPS_DECAY,
    TARGET_UPDATE_FREQ,
)
from sanchar.ai.agent import DQNAgent
from sanchar.env.sanchar_env import SancharTrafficEnv

VAL_SEEDS = [80001, 80002, 80003, 80004, 80005]


def run_episode(env: SancharTrafficEnv, agent: DQNAgent, epsilon: float, seed: int = 0, train: bool = True) -> Tuple[float, int]:
    state, _ = env.reset(seed=seed)
    total_reward = 0.0
    total_vehicles = 0
    done = False

    while not done:
        action = agent.select_action(state, deterministic=(epsilon == 0.0))
        next_state, reward, terminated, truncated, info = env.step(action)
        done = terminated or truncated

        if train:
            agent.replay.push(state, action, reward, next_state, done)

        state = next_state
        total_reward += reward
        total_vehicles += info.get("vehicles_passed", 0)

    return total_reward, total_vehicles


def validate(env: SancharTrafficEnv, agent: DQNAgent) -> Tuple[float, float, float]:
    rewards = []
    vehicles = []
    for s in VAL_SEEDS:
        r, v = run_episode(env, agent, epsilon=0.0, seed=s, train=False)
        rewards.append(r)
        vehicles.append(v)
    return float(np.mean(rewards)), float(np.std(rewards)), float(np.mean(vehicles))


def train(
    num_episodes: int = 400,
    val_every: int = 25,
    export_path: str = "public/weights/gnn_policy.json",
    seed: int = 42,
):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    print("=================================================================")
    print("      SANCHAR AI — Deep Q-Network Training & Optimization       ")
    print("=================================================================")
    print(f"Episodes: {num_episodes} | Batch: {BATCH_SIZE} | Learning Rate: {LR}")
    print(f"State Dim: {STATE_DIM} | Actions: {ACTION_DIM} | Replay: {REPLAY_CAPACITY}")

    train_env = SancharTrafficEnv(episode_length_s=300, domain_randomize=True)
    val_env = SancharTrafficEnv(episode_length_s=300, domain_randomize=True)

    agent = DQNAgent(
        state_dim=STATE_DIM,
        action_dim=ACTION_DIM,
        lr=LR,
        epsilon=EPS_START,
        epsilon_min=EPS_MIN,
        epsilon_decay=EPS_DECAY,
    )

    train_rewards = []
    val_history = []
    total_grad_steps = 0

    for ep in range(1, num_episodes + 1):
        # Run training episode
        ep_seed = 100000 + ep
        r, v = run_episode(train_env, agent, agent.epsilon, seed=ep_seed, train=True)
        train_rewards.append(r)

        # Gradient steps
        if len(agent.replay) >= BATCH_SIZE:
            for _ in range(25):
                loss = agent.train_step(BATCH_SIZE)
                if loss is not None:
                    total_grad_steps += 1

        # Synchronize target network
        if ep % TARGET_UPDATE_FREQ == 0:
            agent.update_target_network()

        # Validation
        if ep % val_every == 0:
            val_mean, val_std, val_veh = validate(val_env, agent)
            val_history.append((ep, val_mean, val_std, val_veh))
            recent_train = np.mean(train_rewards[-val_every:])
            print(
                f"Ep {ep:3d}/{num_episodes} | Train R: {recent_train:7.1f} | "
                f"Val R: {val_mean:7.1f} (+/-{val_std:4.1f}) | "
                f"Val Thru: {val_veh:4.0f} veh | Eps: {agent.epsilon:.3f} | Steps: {total_grad_steps}"
            )

    print("\n--- Training Complete ---")
    val_mean, val_std, val_veh = validate(val_env, agent)
    print(f"Final Validation Reward: {val_mean:.2f} (Throughput: {val_veh:.1f} vehicles)")

    # Export weights for frontend
    os.makedirs(os.path.dirname(export_path), exist_ok=True)
    agent.policy_net.save_json(export_path, training_steps=total_grad_steps)

    # Also save in local sanchar weights directory
    os.makedirs("sanchar/weights", exist_ok=True)
    agent.policy_net.save_json("sanchar/weights/policy.json", training_steps=total_grad_steps)

    return agent, train_rewards, val_history


if __name__ == "__main__":
    train()
