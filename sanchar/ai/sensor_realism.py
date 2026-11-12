"""
Sanchar Sensor Realism Layer — Python Implementation
Simulates real-world detector noise, camera occlusions, and estimation filtering (EMA).
Ensures the AI policy is robust to noisy physical inputs.
"""

from typing import Dict, Any
import numpy as np


class SensorRealismLayer:
    """
    Applies realistic sensor noise, camera packet drops, and temporal filtering.
    """

    def __init__(self, noise_std: float = 0.5, occlusion_prob: float = 0.02, alpha: float = 0.7):
        self.noise_std = noise_std
        self.occlusion_prob = occlusion_prob
        self.alpha = alpha  # EMA smoothing factor
        self.estimates: Dict[str, Dict[str, float]] = {}

    def get_estimated_queues(self, intersection_id: str, ground_truth: Dict[str, int]) -> Dict[str, float]:
        if intersection_id not in self.estimates:
            self.estimates[intersection_id] = {k: float(v) for k, v in ground_truth.items()}

        prev = self.estimates[intersection_id]
        filtered = {}

        for dir_key, count in ground_truth.items():
            # Camera occlusion or detector fault (drops to 0 or freezes)
            if np.random.random() < self.occlusion_prob:
                raw_reading = prev.get(dir_key, float(count))
            else:
                noise = np.random.normal(0, self.noise_std)
                raw_reading = max(0.0, float(count) + noise)

            # Exponential Moving Average filter
            smoothed = self.alpha * raw_reading + (1.0 - self.alpha) * prev.get(dir_key, float(count))
            filtered[dir_key] = max(0.0, smoothed)

        self.estimates[intersection_id] = filtered
        return filtered
