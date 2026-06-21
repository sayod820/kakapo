"""
KAKAPO Backend — WebSocket менеджер для real-time обновлений заказов
"""
from fastapi import WebSocket
import json


class ConnectionManager:
    """Управляет WebSocket подключениями по ролям"""

    def __init__(self):
        # роль → список подключений
        self.connections: dict[str, list[WebSocket]] = {
            "client": [],
            "courier": [],
            "assembler": [],
            "restaurant": [],
            "admin": [],
        }

    async def connect(self, ws: WebSocket, role: str):
        await ws.accept()
        if role not in self.connections:
            self.connections[role] = []
        self.connections[role].append(ws)

    def disconnect(self, ws: WebSocket, role: str):
        if role in self.connections and ws in self.connections[role]:
            self.connections[role].remove(ws)

    async def broadcast_to_role(self, role: str, message: dict):
        """Отправить всем в роли"""
        dead = []
        for ws in self.connections.get(role, []):
            try:
                await ws.send_text(json.dumps(message, ensure_ascii=False, default=str))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, role)

    async def broadcast_order_update(self, order: dict):
        """Уведомить все роли об изменении заказа"""
        message = {"event": "order_update", "order": order}
        # админ видит всё
        await self.broadcast_to_role("admin", message)
        # сборщик видит новые market-заказы
        if order.get("type") == "market":
            await self.broadcast_to_role("assembler", message)
        # ресторан видит свои заказы
        if order.get("type") == "restaurant":
            await self.broadcast_to_role("restaurant", message)
        # курьер видит готовые к доставке
        if order.get("status") in ("assembler_done", "ready", "courier_picked", "delivering"):
            await self.broadcast_to_role("courier", message)
        # клиент следит за своим заказом
        await self.broadcast_to_role("client", message)

    async def notify_new_order(self, order: dict):
        message = {"event": "new_order", "order": order}
        await self.broadcast_to_role("admin", message)
        if order.get("type") == "market":
            await self.broadcast_to_role("assembler", message)
        else:
            await self.broadcast_to_role("restaurant", message)


manager = ConnectionManager()
