"""
Sanchar Configuration & Hyperparameters
Consolidated parameters for traffic simulation, safety envelopes, and RL models.
"""

from typing import List, Dict

# Action Definitions (Pure Vehicular Control)
# 0: KEEP_PHASE — Maintain current green phase
# 1: SWITCH_PHASE — Transition safely to next phase via yellow clearance
ACTIONS: List[str] = [
    "KEEP_PHASE",
    "SWITCH_PHASE",
]

# Signal Phases (4 Pure Vehicular Phases)
PHASES: List[str] = [
    "NS_GREEN",
    "NS_YELLOW",
    "EW_GREEN",
    "EW_YELLOW",
]

GREEN_PHASES = {"NS_GREEN", "EW_GREEN"}
YELLOW_PHASES = {"NS_YELLOW", "EW_YELLOW"}
ALL_RED_PHASES = set()

# Clearance & Safety Constraints (NEMA TS 2 compliant)
MIN_GREEN_S: float = 10.0   # Minimum green duration to prevent rapid flapping
MAX_GREEN_S: float = 60.0   # Maximum green duration to prevent starvation
YELLOW_DURATION_S: float = 3.0
ALL_RED_DURATION_S: float = 0.0

# Anti-Flapping & Actuated Timing
HYSTERESIS_MARGIN: float = 0.75  # Q-margin required for SWITCH over KEEP to prevent boundary jitter
AI_COOLDOWN_S: float = 3.0       # Seconds of mandatory cooldown after a phase switch

# Queue & Sensor Normalization
MAX_QUEUE_NORMALIZATION: float = 40.0  # (20 max queue per lane * 2 lanes)
STARVATION_THRESHOLD_S: float = 30.0   # Red duration after which starvation penalty activates

# Neural Network Architecture
STATE_DIM: int = 10
ACTION_DIM: int = len(ACTIONS)
HIDDEN_DIM_1: int = 64
HIDDEN_DIM_2: int = 32

# RL Hyperparameters
GAMMA: float = 0.95
LR: float = 0.001
BATCH_SIZE: int = 64
REPLAY_CAPACITY: int = 50_000
EPS_START: float = 1.0
EPS_MIN: float = 0.05
EPS_DECAY: float = 0.9992
TARGET_UPDATE_FREQ: int = 10   # Episodes between target network sync
