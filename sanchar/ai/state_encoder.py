"""
Sanchar State Encoder — Python Implementation
Translates intersection topology, physical traffic queues, and environmental sensors
into a normalized, permutation-invariant 10-dimensional feature vector.
"""

from typing import Dict, Any, List, Optional
import numpy as np

from sanchar.config import MAX_QUEUE_NORMALIZATION, STARVATION_THRESHOLD_S, STATE_DIM


class StateEncoder:
    """
    Extracts and normalizes features for the Sanchar reinforcement learning policy.
    Maintains graph-structure invariance and pressure-based representation.
    """

    def __init__(self, max_q_norm: float = MAX_QUEUE_NORMALIZATION):
        self.max_q_norm = max_q_norm
        self.input_size = STATE_DIM

    def encode(
        self,
        intersection: Dict[str, Any],
        neighbors: Optional[List[Dict[str, Any]]] = None,
        weather_factor: float = 0.0,
        time_of_day_norm: float = 0.5,
    ) -> np.ndarray:
        """
        Encodes an intersection into a 10-D float32 array:
        [
          0: normActive,
          1: normOpposing,
          2: phaseProgress,
          3: avgNeighborActive,
          4: avgNeighborOpposing,
          5: pedWaiting (0 or 1),
          6: emergency (0 or 1),
          7: weatherFactor (0 to 1),
          8: timeOfDayNorm (0 to 1),
          9: starvationFlag (0 or 1)
        ]
        """
        queues = intersection.get("queues", {"N": 0, "S": 0, "E": 0, "W": 0})
        qN = queues.get("N", 0)
        qS = queues.get("S", 0)
        qE = queues.get("E", 0)
        qW = queues.get("W", 0)

        # Average downstream queue per lane for pressure calculation
        avg_downstream = 0.0
        if neighbors and len(neighbors) > 0:
            total_down = sum(
                sum(n.get("queues", {}).values()) for n in neighbors
            )
            avg_downstream = (total_down / len(neighbors)) / 4.0

        pN = max(0.0, qN - avg_downstream)
        pS = max(0.0, qS - avg_downstream)
        pE = max(0.0, qE - avg_downstream)
        pW = max(0.0, qW - avg_downstream)

        phase = intersection.get("phase", "NS_GREEN")
        is_ns = "NS" in phase
        active_pressure = (pN + pS) if is_ns else (pE + pW)
        opposing_pressure = (pE + pW) if is_ns else (pN + pS)

        norm_active = float(min(1.0, active_pressure / self.max_q_norm))
        norm_opposing = float(min(1.0, opposing_pressure / self.max_q_norm))

        phase_progress = float(intersection.get("phase_progress", 0.0))

        # Neighbor pressure features
        avg_neighbor_active = 0.0
        avg_neighbor_opposing = 0.0
        if neighbors and len(neighbors) > 0:
            sum_n_active = 0.0
            sum_n_opposing = 0.0
            for n in neighbors:
                n_q = n.get("queues", {"N": 0, "S": 0, "E": 0, "W": 0})
                n_is_ns = "NS" in n.get("phase", "NS_GREEN")
                n_q_ns = max(0.0, n_q.get("N", 0) + n_q.get("S", 0) - avg_downstream)
                n_q_ew = max(0.0, n_q.get("E", 0) + n_q.get("W", 0) - avg_downstream)
                n_act = n_q_ns if n_is_ns else n_q_ew
                n_opp = n_q_ew if n_is_ns else n_q_ns
                sum_n_active += min(1.0, n_act / self.max_q_norm)
                sum_n_opposing += min(1.0, n_opp / self.max_q_norm)
            avg_neighbor_active = float(sum_n_active / len(neighbors))
            avg_neighbor_opposing = float(sum_n_opposing / len(neighbors))

        ped_waiting = 0.0  # Pure vehicular control - pedestrians removed
        emergency = 1.0 if intersection.get("emergency_approaching", False) else 0.0

        red_duration_ns = intersection.get("red_duration_ns", 0.0)
        red_duration_ew = intersection.get("red_duration_ew", 0.0)
        starvation_flag = (
            1.0
            if (
                red_duration_ns > STARVATION_THRESHOLD_S
                or red_duration_ew > STARVATION_THRESHOLD_S
            )
            else 0.0
        )

        return np.array(
            [
                norm_active,
                norm_opposing,
                phase_progress,
                avg_neighbor_active,
                avg_neighbor_opposing,
                ped_waiting,
                emergency,
                float(weather_factor),
                float(time_of_day_norm),
                starvation_flag,
            ],
            dtype=np.float32,
        )
