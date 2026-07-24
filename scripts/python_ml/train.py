import json
import random
from collections import deque

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

from sanchar_env import SancharTrafficEnv, ACTIONS, compute_reward


STATE_DIM = 10
ACTION_DIM = len(ACTIONS)
GAMMA = 0.95
LR = 0.01
BATCH_SIZE = 32
REPLAY_CAPACITY = 50_000
EPS_START, EPS_MIN, EPS_DECAY = 1.0, 0.05, 0.9995

# Fixed, held-out seeds — never used for training episodes, always drawn
# from the same domain-randomized distribution for a fair comparison.
VAL_SEEDS = [90001, 90002, 90003, 90004, 90005]


class LinearQ(nn.Module):
    def __init__(self, state_dim, action_dim):
        super().__init__()
        self.linear = nn.Linear(state_dim, action_dim)

    def forward(self, x):
        return self.linear(x)


class ReplayBuffer:
    def __init__(self, capacity):
        self.buf = deque(maxlen=capacity)

    def push(self, *transition):
        self.buf.append(transition)

    def sample(self, batch_size):
        batch = random.sample(self.buf, batch_size)
        s, a, r, s2, done = zip(*batch)
        return (
            torch.tensor(np.array(s), dtype=torch.float32),
            torch.tensor(a, dtype=torch.int64),
            torch.tensor(r, dtype=torch.float32),
            torch.tensor(np.array(s2), dtype=torch.float32),
            torch.tensor(done, dtype=torch.float32),
        )

    def __len__(self):
        return len(self.buf)


def select_action(model, state, epsilon):
    if random.random() < epsilon:
        return random.randrange(ACTION_DIM)
    with torch.no_grad():
        q = model(torch.tensor(state, dtype=torch.float32).unsqueeze(0))
        return int(torch.argmax(q, dim=1).item())


def run_episode(env, model, epsilon, seed=None, train_buffer=None):
    state, _ = env.reset(seed=seed)
    total_reward = 0.0
    done = False
    while not done:
        action = select_action(model, state, epsilon)
        next_state, reward, terminated, truncated, _ = env.step(action)
        done = terminated or truncated
        if train_buffer is not None:
            train_buffer.push(state, action, reward, next_state, float(done))
        state = next_state
        total_reward += reward
    return total_reward


def train_step(model, target_model, optimizer, buffer):
    if len(buffer) < BATCH_SIZE:
        return None
    s, a, r, s2, done = buffer.sample(BATCH_SIZE)
    q_values = model(s).gather(1, a.unsqueeze(1)).squeeze(1)
    with torch.no_grad():
        max_next_q = target_model(s2).max(dim=1).values
        target = r + GAMMA * max_next_q * (1 - done)
    loss = nn.functional.mse_loss(q_values, target)
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
    return loss.item()


def validate(env, model):
    """Average reward across fixed held-out seeds, same distribution as
    training. Greedy (epsilon=0) — we want to know what the policy has
    actually learned, not exploration noise."""
    rewards = [run_episode(env, model, epsilon=0.0, seed=s) for s in VAL_SEEDS]
    return float(np.mean(rewards)), float(np.std(rewards))


def main(num_episodes=400, val_every=25, seed=0, training_offset=100000):
    torch.manual_seed(seed)
    random.seed(seed)

    train_env = SancharTrafficEnv(episode_length_s=300, domain_randomize=True)
    val_env = SancharTrafficEnv(episode_length_s=300, domain_randomize=True)

    model = LinearQ(STATE_DIM, ACTION_DIM)
    target_model = LinearQ(STATE_DIM, ACTION_DIM)
    target_model.load_state_dict(model.state_dict())
    optimizer = optim.Adam(model.parameters(), lr=LR)
    buffer = ReplayBuffer(REPLAY_CAPACITY)

    epsilon = EPS_START
    train_rewards, val_history = [], []
    total_grad_steps = 0

    for ep in range(1, num_episodes + 1):
        # training_offset keeps training seeds well clear of VAL_SEEDS
        r = run_episode(train_env, model, epsilon, seed=training_offset + ep, train_buffer=buffer)
        train_rewards.append(r)

        for _ in range(20):
            train_step(model, target_model, optimizer, buffer)
            total_grad_steps += 1
            epsilon = max(EPS_MIN, epsilon * EPS_DECAY)

        if ep % 10 == 0:
            target_model.load_state_dict(model.state_dict())

        if ep % val_every == 0:
            val_mean, val_std = validate(val_env, model)
            val_history.append((ep, val_mean, val_std))
            recent_train = np.mean(train_rewards[-val_every:])
            print(f"ep {ep:4d} | train_reward(avg{val_every}) {recent_train:8.1f} "
                  f"| val_reward {val_mean:8.1f} (+/-{val_std:5.1f}) | eps {epsilon:.3f}")

    early_val = np.mean([v for _, v, _ in val_history[:3]])
    late_val = np.mean([v for _, v, _ in val_history[-3:]])
    late_train = np.mean(train_rewards[-val_every * 3:])
    print("\n--- Generalization check (same-distribution held-out seeds) ---")
    print(f"Held-out val reward: early {early_val:.1f} -> late {late_val:.1f}")
    print(f"Final train reward (avg): {late_train:.1f}")
    gap = late_train - late_val
    if late_val < early_val - 10:
        print("WARNING: validation reward declined over training — real overfitting signal.")
    elif abs(gap) > 15:
        print(f"NOTE: train/val gap = {gap:.1f} — worth more domain-randomization diversity.")
    else:
        print("Train and validation reward tracking closely on the same distribution — "
              "no strong overfitting signal.")

    export_weights(model, training_steps=total_grad_steps)
    return model, train_rewards, val_history


def export_weights(model, path="../../public/weights/gnn_policy.json", training_steps=0):
    """Matches the provided spec's export format exactly, plus a real
    trainingSteps count instead of a placeholder."""
    w = model.linear.weight.detach().numpy()
    b = model.linear.bias.detach().numpy()
    payload = {
        "stateDim": STATE_DIM,
        "actionCount": ACTION_DIM,
        "weights": w.flatten().tolist(),
        "bias": b.tolist(),
        "trainingSteps": training_steps,
        "version": "v12-python-dqn",
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\nExported weights to {path} ({len(payload['weights'])} weights, "
          f"{len(payload['bias'])} bias, trainingSteps={training_steps}).")


if __name__ == "__main__":
    main()
