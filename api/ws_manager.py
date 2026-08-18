"""WebSocket connection manager for live budget updates."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, event_type: str, data: dict[str, Any]):
        msg = json.dumps({"type": event_type, "data": data})
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def broadcast_budget_update(self, added: int, new_transactions: list):
        await self.broadcast("budget.update", {
            "added": added,
            "new_transactions": new_transactions[:10],
            "synced_at": datetime.utcnow().isoformat() + "Z",
        })


ws_manager = ConnectionManager()
