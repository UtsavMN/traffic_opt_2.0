"""
Legacy script entry point — forwards to modern sanchar.env.sanchar_env
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sanchar.env.sanchar_env import SancharTrafficEnv, ACTIONS, PHASES, compute_reward

__all__ = ["SancharTrafficEnv", "ACTIONS", "PHASES", "compute_reward"]
