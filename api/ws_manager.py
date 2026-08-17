"""WebSocket connection manager for live budget updates — connections are
scoped per user_id so one account's updates never reach another's browser."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, ws: WebSocket, user_id: str):
        await ws.accept()
        self.active[user_id].append(ws)

    def disconnect(self, ws: WebSocket, user_id: str):
        if ws in self.active.get(user_id, []):
            self.active[user_id].remove(ws)

    async def broadcast(self, user_id: str, event_type: str, data: dict[str, Any]):
        msg = json.dumps({"type": event_type, "data": data})
        dead = []
        for ws in self.active.get(user_id, []):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, user_id)

    async def broadcast_budget_update(self, added: int, new_transactions: list, user_id: str):
        await self.broadcast(user_id, "budget.update", {
            "added": added,
            "new_transactions": new_transactions[:10],
            "synced_at": datetime.utcnow().isoformat() + "Z",
        })


ws_manager = ConnectionManager()
