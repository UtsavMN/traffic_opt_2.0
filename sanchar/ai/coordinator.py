"""
Sanchar Multi-Agent Coordinator — Python Implementation
Orchestrates network-wide intersection policies, green wave corridors, and training loops.
"""

from typing import Dict, Any, List, Optional
import numpy as np

from sanchar.ai.agent import DQNAgent
from sanchar.ai.controller import AdaptiveController
from sanchar.ai.state_encoder import StateEncoder
from sanchar.config import ACTIONS


class MultiAgentCoordinator:
    """
    Coordinates distributed intersection agents across a city traffic network.
    """

    def __init__(self, agent: Optional[DQNAgent] = None):
        self.agent = agent if agent else DQNAgent()
        self.controller = AdaptiveController(mode="RL_ACTIVE")
        self.encoder = StateEncoder()

        self.observe_interval = 2.0  # seconds
        self.train_interval = 1.0    # seconds
        self.observe_timer = 0.0
        self.train_timer = 0.0

        self.last_observations: Dict[str, Dict[str, Any]] = {}
        self.last_states: Dict[str, np.ndarray] = {}
        self.last_actions: Dict[str, int] = {}

    def update(
        self,
        dt: float,
        intersections: Dict[str, Dict[str, Any]],
        network_neighbors: Optional[Dict[str, List[str]]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Advances coordination timers and runs training and observation steps.
        """
        self.observe_timer += dt
        self.train_timer += dt

        # Evaluate controller decisions
        decisions = self.controller.update(
            dt,
            intersections,
            rl_agent=self.agent,
            network_neighbors=network_neighbors,
        )

        # Observation tracking for experience replay
        if self.observe_timer >= self.observe_interval:
            self.observe_timer = 0.0
            for int_id, int_data in intersections.items():
                neighbor_list = []
                if network_neighbors and int_id in network_neighbors:
                    for n_id in network_neighbors[int_id]:
                        if n_id in intersections:
                            neighbor_list.append(intersections[n_id])

                state = self.encoder.encode(int_data, neighbors=neighbor_list)
                q_vals = self.agent.get_q_values(state)
                action = int(np.argmax(q_vals))

                self.last_observations[int_id] = {
                    "action": ACTIONS[action],
                    "qValues": [float(x) for x in q_vals],
                }

        # Training step
        if self.train_timer >= self.train_interval and not self.agent.shadow_mode:
            self.train_timer = 0.0
            self.agent.train_step()

        return decisions

    def get_stats(self) -> Dict[str, Any]:
        return self.agent.get_stats()
