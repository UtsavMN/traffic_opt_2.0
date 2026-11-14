"""
Sanchar Adaptive Controller — Python Implementation
Unifies actuated queue-proportional heuristics and active reinforcement learning.
Integrates safety compliance and debounced decision scheduling.
"""

from typing import Dict, Any, Optional, List, Callable
import time
from sanchar.config import MIN_GREEN_S, MAX_GREEN_S, AI_COOLDOWN_S, ACTIONS
from sanchar.ai.safety import SafetyComplianceWrapper
from sanchar.ai.state_encoder import StateEncoder
from sanchar.ai.reward import compute_reward


class AdaptiveController:
    """
    Manages traffic signal phase transitions across intersections.
    """

    def __init__(
        self,
        mode: str = "RL_ACTIVE",
        min_green: float = MIN_GREEN_S,
        max_green: float = MAX_GREEN_S,
        cooldown: float = AI_COOLDOWN_S,
    ):
        self.mode = mode
        self.min_green = min_green
        self.max_green = max_green
        self.cooldown = cooldown

        self.safety_wrapper = SafetyComplianceWrapper(min_green=min_green, max_green=max_green)
        self.encoder = StateEncoder()

        self.cooldowns: Dict[str, float] = {}
        self.decisions: List[Dict[str, Any]] = []
        self.total_decisions: int = 0
        self.reward_history: List[float] = []

        self.on_decision_callback: Optional[Callable[[Dict[str, Any]], None]] = None

    def update(
        self,
        dt: float,
        intersections: Dict[str, Dict[str, Any]],
        rl_agent: Optional[Any] = None,
        network_neighbors: Optional[Dict[str, List[str]]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Steps controller forward by dt and evaluates signal phases.
        """
        # Decrement cooldowns
        for int_id in list(self.cooldowns.keys()):
            if self.cooldowns[int_id] > 0:
                self.cooldowns[int_id] = max(0.0, self.cooldowns[int_id] - dt)

        dispatched_decisions = []

        for int_id, int_data in intersections.items():
            # Skip non-signalized uninterrupted through corridors and flyovers
            if not int_data.get("is_signalized", True):
                continue

            if self.cooldowns.get(int_id, 0.0) > 0.0:
                continue

            decision = self._evaluate_intersection(
                int_id,
                int_data,
                intersections,
                rl_agent,
                network_neighbors,
            )

            if decision is not None:
                self.cooldowns[int_id] = self.cooldown
                self.total_decisions += 1
                self.decisions.append(decision)
                if len(self.decisions) > 50:
                    self.decisions.pop(0)

                dispatched_decisions.append(decision)
                if self.on_decision_callback:
                    self.on_decision_callback(decision)

        return dispatched_decisions

    def _evaluate_intersection(
        self,
        int_id: str,
        int_data: Dict[str, Any],
        all_intersections: Dict[str, Dict[str, Any]],
        rl_agent: Optional[Any] = None,
        network_neighbors: Optional[Dict[str, List[str]]] = None,
    ) -> Optional[Dict[str, Any]]:
        phase = int_data.get("phase", "NS_GREEN")
        time_in_phase = float(int_data.get("time_in_phase", 0.0))
        queues = int_data.get("queues", {"N": 0, "S": 0, "E": 0, "W": 0})
        emergency = bool(int_data.get("emergency_approaching", False))

        # 1. Emergency Preemption (Highest priority)
        if emergency:
            emergency_dir = int_data.get("emergency_dir", "N")
            target_phase_group = "NS" if emergency_dir in ["N", "S"] else "EW"
            return {
                "intersection_id": int_id,
                "action": "EMRG_PREEMPT",
                "phase_override": target_phase_group,
                "reason": f"Emergency vehicle approaching from {emergency_dir}",
                "timestamp": time.time(),
            }

        # 2. Only evaluate during GREEN phases (clearance phases run uninterrupted)
        if phase not in ["NS_GREEN", "EW_GREEN"]:
            return None

        # 3. Minimum green safety floor
        if time_in_phase < self.min_green:
            return None

        current_is_ns = "NS" in phase
        active_q = (queues.get("N", 0) + queues.get("S", 0)) if current_is_ns else (queues.get("E", 0) + queues.get("W", 0))
        opposing_q = (queues.get("E", 0) + queues.get("W", 0)) if current_is_ns else (queues.get("N", 0) + queues.get("S", 0))

        # Actuated Zero-Demand Hold: If opposing is empty, keep current green!
        if opposing_q == 0 and time_in_phase < self.max_green:
            return None

        # RL Active Evaluation Path
        if self.mode == "RL_ACTIVE" and rl_agent is not None:
            # Build neighbor objects
            neighbor_list = []
            if network_neighbors and int_id in network_neighbors:
                for n_id in network_neighbors[int_id]:
                    if n_id in all_intersections:
                        neighbor_list.append(all_intersections[n_id])

            state = self.encoder.encode(int_data, neighbors=neighbor_list)
            q_values = rl_agent.get_q_values(state)
            proposed_act = int(rl_agent.select_action(state, deterministic=True))

            final_act, action_name, veto_reason = self.safety_wrapper.filter_action(
                int_data, proposed_act, q_values=list(q_values)
            )

            if action_name == "SWITCH_PHASE":
                return {
                    "intersection_id": int_id,
                    "action": "SWITCH_TO_EW" if current_is_ns else "SWITCH_TO_NS",
                    "action_name": "SWITCH_PHASE",
                    "reason": veto_reason if veto_reason else f"DQN Policy (Q_sw={q_values[1]:.2f} vs Q_kp={q_values[0]:.2f})",
                    "timestamp": time.time(),
                    "state": state.tolist(),
                    "q_values": [float(x) for x in q_values],
                }
            return None

        # Actuated Heuristic Fallback (ADAPTIVE Mode)
        # Rule 1: Current empty, opposing has demand -> Switch immediately
        if active_q == 0 and opposing_q > 0:
            return {
                "intersection_id": int_id,
                "action": "SWITCH_TO_EW" if current_is_ns else "SWITCH_TO_NS",
                "reason": f"Active direction empty, opposing has {opposing_q}",
                "timestamp": time.time(),
            }

        # Rule 2: Max green ceiling reached -> Switch to avoid starvation
        if time_in_phase >= self.max_green:
            return {
                "intersection_id": int_id,
                "action": "SWITCH_TO_EW" if current_is_ns else "SWITCH_TO_NS",
                "reason": f"Max green ({self.max_green}s) ceiling reached",
                "timestamp": time.time(),
            }

        # Rule 3: Significant imbalance
        if opposing_q > (active_q * 1.5 + 4.0):
            return {
                "intersection_id": int_id,
                "action": "SWITCH_TO_EW" if current_is_ns else "SWITCH_TO_NS",
                "reason": f"Queue imbalance trigger (Opposing={opposing_q} vs Active={active_q})",
                "timestamp": time.time(),
            }

        return None
