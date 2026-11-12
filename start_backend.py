"""
Sanchar Backend Server Launcher
Run with: python start_backend.py
"""

import sys
import uvicorn

if __name__ == "__main__":
    print("[Sanchar] Starting Python AI & Traffic Intelligence Backend on http://localhost:8000 ...")
    uvicorn.run("sanchar.server:app", host="0.0.0.0", port=8000, reload=False)
