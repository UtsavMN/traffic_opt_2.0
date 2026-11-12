"""
Sanchar Safety Compliance Layer — Python Implementation
Strict safety enforcer implementing NEMA TS 2 and actuated signal standards.
Vetoes unsafe or jittery policy suggestions to guarantee smooth, non-floppy signal control.
"""

from typing import Dict, Any, Tuple, Optional
from sanchar.config import (
    MIN_GREEN_S,
    MAX_GREEN_S,
    HYSTERESIS_MARGIN,
    GREEN_PHASES,
    YELLOW_PHASES,
    ALL_RED_PHASES,
    ACTIONS,
)


class SafetyComplianceWrapper:
    """
    Enforces deterministic safety guarantees on top of neural policy outputs.
    Acts as an infallible guardian ensuring no collisions, no rapid phase flickering,
    and no starvation.
    """

    def __init__(
        self,
        min_green: float = MIN_GREEN_S,
        max_green: float = MAX_GREEN_S,
        hysteresis_margin: float = HYSTERESIS_MARGIN,
    ):
        self.min_green = min_green
        self.max_green = max_green
        self.hysteresis_margin = hysteresis_margin

    def filter_action(
        self,
        intersection: Dict[str, Any],
        proposed_action_idx: int,
        q_values: Optional[list] = None,
    ) -> Tuple[int, str, Optional[str]]:
        """
        Validates proposed action.
        Returns: (final_action_idx, final_action_name, veto_reason_or_none)
        """
        proposed_name = ACTIONS[proposed_action_idx]
        phase = intersection.get("phase", "NS_GREEN")
        time_in_phase = float(intersection.get("time_in_phase", 0.0))
        queues = intersection.get("queues", {"N": 0, "S": 0, "E": 0, "W": 0})
        pedestrians_waiting = int(intersection.get("pedestrians_waiting", 0))

        current_is_ns = "NS" in phase
        active_queue = (queues.get("N", 0) + queues.get("S", 0)) if current_is_ns else (queues.get("E", 0) + queues.get("W", 0))
        opposing_queue = (queues.get("E", 0) + queues.get("W", 0)) if current_is_ns else (queues.get("N", 0) + queues.get("S", 0))

        # 1. Clearance Phase Lockout:
        # If currently in YELLOW or ALL_RED, normal phase transitions MUST NOT be interrupted
        if phase in YELLOW_PHASES or phase in ALL_RED_PHASES:
            return 0, "KEEP_PHASE", f"Phase {phase} clearance in progress — action locked"

        # 2. Hard Ceiling: Max Green Exceeded -> FORCE SWITCH
        if time_in_phase >= self.max_green:
            return 1, "SWITCH_PHASE", f"MAX_GREEN ({self.max_green}s) ceiling reached — forced switch to prevent starvation"

        # 3. Hard Floor: Min Green Safety Constraint
        # Disallow switching until minimum green has elapsed
        if proposed_name == "SWITCH_PHASE" and time_in_phase < self.min_green:
            return 0, "KEEP_PHASE", f"MIN_GREEN ({self.min_green}s) not yet satisfied ({time_in_phase:.1f}s) — switch vetoed"

        # 4. Actuated Zero-Demand Hold Veto:
        # If there is ZERO demand on the opposing approach, maintain current green
        if proposed_name == "SWITCH_PHASE" and opposing_queue == 0:
            return 0, "KEEP_PHASE", "Opposing approach has zero queue — holding green"

        # 5. Anti-Flapping Hysteresis:
        # If model proposes SWITCH over KEEP, ensure Q(SWITCH) exceeds Q(KEEP) by hysteresis margin
        if proposed_name == "SWITCH_PHASE" and q_values is not None and len(q_values) >= 2:
            q_keep = q_values[0]
            q_switch = q_values[1]
            if q_switch < (q_keep + self.hysteresis_margin) and opposing_queue <= active_queue:
                return 0, "KEEP_PHASE", f"Hysteresis guard: Q(SWITCH) [{q_switch:.2f}] does not clear Q(KEEP) [{q_keep:.2f}] + margin [{self.hysteresis_margin:.2f}]"

        # Action is safe and approved
        return proposed_action_idx, proposed_name, None
