"""
Sanchar FastAPI Backend Server
High-performance REST API and WebSocket streaming service for Sanchar Traffic Intelligence.
Serves AI inferences, coordinates network traffic, and streams real-time telemetry.
"""

import os
import json
import time
from typing import Dict, Any, List, Optional
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from sanchar.config import ACTIONS, STATE_DIM, ACTION_DIM
from sanchar.ai.model import SancharMLPQNetwork
from sanchar.ai.safety import SafetyComplianceWrapper
from sanchar.ai.state_encoder import StateEncoder

app = FastAPI(
    title="Sanchar Traffic Intelligence API",
    description="Backend AI & Traffic Optimization Engine for the Sanchar Digital Twin",
    version="2.0.0",
)

# Enable CORS for frontend Vite development server (localhost:5173, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model state
WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), "..", "public", "weights", "gnn_policy.json")
encoder = StateEncoder()
safety_wrapper = SafetyComplianceWrapper()
model: Optional[SancharMLPQNetwork] = None


def get_model() -> SancharMLPQNetwork:
    global model
    if model is None:
        if os.path.exists(WEIGHTS_PATH):
            with open(WEIGHTS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            model = SancharMLPQNetwork.from_dict(data)
            print(f"[Sanchar Backend] Loaded model from {WEIGHTS_PATH}")
        else:
            model = SancharMLPQNetwork(STATE_DIM, ACTION_DIM)
            print("[Sanchar Backend] Initialized new SancharMLPQNetwork")
    return model


class IntersectionStateInput(BaseModel):
    id: str = "node_0"
    phase: str = "NS_GREEN"
    time_in_phase: float = 12.0
    phase_progress: float = 0.2
    queues: Dict[str, int] = Field(default_factory=lambda: {"N": 4, "S": 3, "E": 2, "W": 1})
    pedestrians_waiting: int = 0
    emergency_approaching: bool = False
    emergency_dir: Optional[str] = None
    red_duration_ns: float = 0.0
    red_duration_ew: float = 12.0
    neighbors: Optional[List[Dict[str, Any]]] = None
    weather_factor: float = 0.0
    time_of_day_norm: float = 0.5


class BatchPredictInput(BaseModel):
    intersections: List[IntersectionStateInput]


@app.get("/")
def read_root():
    return {
        "system": "Sanchar Traffic Intelligence",
        "status": "online",
        "version": "2.0.0",
        "docs": "/docs",
    }


@app.get("/api/status")
def get_status():
    m = get_model()
    return {
        "status": "ready",
        "model_architecture": "3-Layer MLP Deep Q-Network (Double-DQN)",
        "state_dim": STATE_DIM,
        "action_dim": ACTION_DIM,
        "actions": ACTIONS,
        "weights_loaded": os.path.exists(WEIGHTS_PATH),
    }


@app.post("/api/predict")
def predict_action(int_state: IntersectionStateInput):
    m = get_model()
    raw_dict = int_state.model_dump()
    state_vec = encoder.encode(
        raw_dict,
        neighbors=raw_dict.get("neighbors"),
        weather_factor=raw_dict.get("weather_factor", 0.0),
        time_of_day_norm=raw_dict.get("time_of_day_norm", 0.5),
    )

    q_vals = m.predict_numpy(state_vec)
    proposed_act = int(np.argmax(q_vals))

    final_act, action_name, veto_reason = safety_wrapper.filter_action(
        raw_dict, proposed_act, q_values=list(q_vals)
    )

    return {
        "intersection_id": int_state.id,
        "action_idx": final_act,
        "action_name": action_name,
        "veto_reason": veto_reason,
        "q_values": [float(x) for x in q_vals],
        "state_vector": [float(x) for x in state_vec],
        "timestamp": time.time(),
    }


@app.post("/api/predict_batch")
def predict_batch(batch: BatchPredictInput):
    results = []
    for int_state in batch.intersections:
        results.append(predict_action(int_state))
    return {"predictions": results}


@app.get("/api/weights")
def get_weights():
    if not os.path.exists(WEIGHTS_PATH):
        raise HTTPException(status_code=404, detail="Weights file not found")
    with open(WEIGHTS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@app.websocket("/ws/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    m = get_model()
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            int_data = payload.get("intersection", {})
            state_vec = encoder.encode(int_data)
            q_vals = m.predict_numpy(state_vec)
            proposed_act = int(np.argmax(q_vals))

            final_act, action_name, veto_reason = safety_wrapper.filter_action(
                int_data, proposed_act, q_values=list(q_vals)
            )

            response = {
                "intersection_id": int_data.get("id"),
                "action": action_name,
                "q_values": [float(x) for x in q_vals],
                "veto_reason": veto_reason,
                "timestamp": time.time(),
            }
            await websocket.send_text(json.dumps(response))
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("sanchar.server:app", host="0.0.0.0", port=8000, reload=True)
