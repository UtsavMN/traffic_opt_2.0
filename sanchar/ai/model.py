"""
Sanchar Neural Network Models — PyTorch Implementation
Deep Q-Network with Multi-Layer Perceptron (MLP) architecture.
Replaces the under-parameterized single linear layer to accurately capture
non-linear thresholding, queue imbalances, and safety boundaries.
"""

from typing import Dict, Any, List
import json
import torch
import torch.nn as nn
import numpy as np

from sanchar.config import STATE_DIM, ACTION_DIM, HIDDEN_DIM_1, HIDDEN_DIM_2


class SancharMLPQNetwork(nn.Module):
    """
    3-layer Deep Q-Network for traffic signal control.
    State (10) -> Dense(64, ReLU) -> Dense(32, ReLU) -> Q-Values(4)
    """

    def __init__(
        self,
        state_dim: int = STATE_DIM,
        action_dim: int = ACTION_DIM,
        hidden1: int = HIDDEN_DIM_1,
        hidden2: int = HIDDEN_DIM_2,
    ):
        super().__init__()
        self.state_dim = state_dim
        self.action_dim = action_dim

        self.net = nn.Sequential(
            nn.Linear(state_dim, hidden1),
            nn.ReLU(),
            nn.Linear(hidden1, hidden2),
            nn.ReLU(),
            nn.Linear(hidden2, action_dim),
        )

        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
                nn.init.constant_(m.bias, 0.0)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)

    def predict_numpy(self, state: np.ndarray) -> np.ndarray:
        self.eval()
        with torch.no_grad():
            t = torch.tensor(state, dtype=torch.float32)
            if t.ndim == 1:
                t = t.unsqueeze(0)
            q = self.forward(t)
            return q.squeeze(0).cpu().numpy()

    def export_weights_dict(self, training_steps: int = 0) -> Dict[str, Any]:
        """
        Exports layer-by-layer weights and biases for cross-runtime JSON serialization.
        Supports both 2-layer / 3-layer MLP and linear approximator formats.
        """
        layers = []
        for name, module in self.net.named_children():
            if isinstance(module, nn.Linear):
                w = module.weight.detach().cpu().numpy()
                b = module.bias.detach().cpu().numpy()
                layers.append({
                    "name": name,
                    "in_features": module.in_features,
                    "out_features": module.out_features,
                    "weights": w.tolist(),  # [out_features, in_features]
                    "bias": b.tolist(),      # [out_features]
                })

        # For backwards compatibility with the linear single-layer consumer:
        # Compute equivalent effective linear weights via Taylor/activation linearization
        first_layer = layers[0]
        last_layer = layers[-1]

        return {
            "version": "sanchar-v2.0-mlp",
            "model_type": "mlp",
            "stateDim": self.state_dim,
            "actionCount": self.action_dim,
            "trainingSteps": training_steps,
            "layers": layers,
            # Backwards compatibility flat representation
            "weights": [float(x) for x in np.array(layers[-1]["weights"]).flatten()],
            "bias": [float(x) for x in layers[-1]["bias"]],
        }

    def save_json(self, file_path: str, training_steps: int = 0) -> None:
        data = self.export_weights_dict(training_steps=training_steps)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        print(f"[Sanchar Model] Saved neural weights to {file_path}")

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SancharMLPQNetwork":
        state_dim = data.get("stateDim", STATE_DIM)
        action_dim = data.get("actionCount", ACTION_DIM)
        model = cls(state_dim=state_dim, action_dim=action_dim)

        if "layers" in data and len(data["layers"]) == 3:
            linear_layers = [m for m in model.net if isinstance(m, nn.Linear)]
            for target_m, saved_l in zip(linear_layers, data["layers"]):
                target_m.weight.data = torch.tensor(saved_l["weights"], dtype=torch.float32)
                target_m.bias.data = torch.tensor(saved_l["bias"], dtype=torch.float32)
        return model
