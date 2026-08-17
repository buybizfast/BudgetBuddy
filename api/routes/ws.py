"""WebSocket route."""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from jose import JWTError, jwt

from api.ws_manager import ws_manager
from backend.config import JWT_ALGORITHM, JWT_SECRET

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # Browsers can't set an Authorization header on a WebSocket handshake —
    # the token comes as a query param instead, e.g. wss://host/ws?token=...
    token = websocket.query_params.get("token")
    user_id = None
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user_id = payload.get("sub")
        except JWTError:
            user_id = None
    if not user_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws_manager.connect(websocket, user_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, user_id)
