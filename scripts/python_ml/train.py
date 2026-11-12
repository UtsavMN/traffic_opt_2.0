"""
Legacy script entry point — forwards to modern sanchar.train module
"""
import sys
import os

# Add workspace root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sanchar.train import train

if __name__ == "__main__":
    train()
