import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from db import Base, engine, get_db, json_dump, json_load
from models import (
    CardRow,
    CategoryRow,
    OrderRow,
    PickupRow,
    ProductRow,
    RestaurantRow,
    ReviewRow,
    SettingRow,
    UserRow,
    order_from_payload,
    order_to_dict,
    product_to_dict,
)
from orders_logic import apply_status_patch, is_assembler_order, is_courier_ready, is_courier_sync
from seed import next_order_id, seed_if_empty


class WSManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, event: str, order: dict):
        msg = json.dumps({"event": event, "order": order}, ensure_ascii=False)
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


ws_manager = WSManager()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = next(get_db())
    try:
        seed_if_empty(db)
    finally:
        db.close()
    yield


app = FastAPI(title="КАКАПО API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now_time() -> str:
    return datetime.now().strftime("%H:%M")


def _save_order_row(row: OrderRow, order_dict: dict) -> OrderRow:
    row.status = order_dict.get("status", row.status)
    row.type = order_dict.get("type", row.type)
    if "client" in order_dict:
        row.client_json = json_dump(order_dict["client"])
    if "items" in order_dict:
        row.items_json = json_dump(order_dict["items"])
    if "courier" in order_dict:
        row.courier_json = json_dump(order_dict["courier"]) if order_dict["courier"] else None
    if "assembler" in order_dict:
        row.assembler_json = json_dump(order_dict["assembler"]) if order_dict["assembler"] else None
    extra = json_load(row.extra_json, {})
    for key in ("pickupIds", "restIds", "marketStatus", "restParts", "distanceKm", "durationMin", "weightKg", "pickedUpIds", "courierRoute", "deliveredAt"):
        if key in order_dict:
            extra[key] = order_dict[key]
    row.extra_json = json_dump(extra)
    return row


def _row_to_order(row: OrderRow) -> dict:
    return order_to_dict(row)


# ── Health ──────────────────────────────────────────
@app.get("/health")
def health():
    return {"ok": True, "service": "kakapo-api", "local": True}


# ── Auth ────────────────────────────────────────────
@app.post("/auth/otp/send")
def otp_send(body: dict):
    return {"ok": True, "demo": True}


@app.post("/auth/otp/verify")
def otp_verify(body: dict):
    code = str(body.get("code", ""))
    if code != "1234":
        raise HTTPException(400, "Неверный код · Демо: 1234")
    return {"access_token": "demo-client-token", "role": "client", "user_id": 1, "name": "Клиент"}


@app.post("/auth/login")
def login(body: dict, db: Session = Depends(get_db)):
    email = (body.get("email") or "").lower().strip()
    password = body.get("password") or ""
    user = db.query(UserRow).filter(UserRow.email == email).first()
    if not user or user.password != password:
        raise HTTPException(401, "Неверный email или пароль")
    return {
        "access_token": f"token-{user.role}-{user.id}",
        "role": user.role,
        "user_id": user.id,
        "name": user.name,
    }


# ── Products ────────────────────────────────────────
@app.get("/products")
def list_products(db: Session = Depends(get_db)):
    return [product_to_dict(r) for r in db.query(ProductRow).order_by(ProductRow.id).all()]


@app.post("/products")
def create_product(body: dict, db: Session = Depends(get_db)):
    max_id = db.query(ProductRow.id).order_by(ProductRow.id.desc()).first()
    pid = (max_id[0] if max_id else 0) + 1
    row = ProductRow(
        id=pid,
        art=body.get("art") or f"KAK-{pid:04d}",
        e=body.get("e") or "📦",
        name=body["name"],
        price=float(body.get("price") or 0),
        cat=body.get("cat") or "",
        cat_id=body.get("catId") or body.get("cat_id") or "",
        unit=body.get("unit") or "шт",
        stock=int(body.get("stock") or 0),
        hot=bool(body.get("hot")),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return product_to_dict(row)


@app.patch("/products/{product_id}")
def patch_product(product_id: int, body: dict, db: Session = Depends(get_db)):
    row = db.get(ProductRow, product_id)
    if not row:
        raise HTTPException(404, "Товар не найден")
    for key, attr in [("name", "name"), ("price", "price"), ("stock", "stock"), ("hot", "hot"), ("e", "e")]:
        if key in body:
            setattr(row, attr, body[key])
    db.commit()
    return product_to_dict(row)


@app.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    row = db.get(ProductRow, product_id)
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


# ── Categories ──────────────────────────────────────
@app.get("/categories")
def list_categories(parent_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(CategoryRow)
    if parent_id is not None:
        q = q.filter(CategoryRow.parent_id == parent_id)
    return [{"id": r.id, "name": r.name, "slug": r.slug, "parent_id": r.parent_id} for r in q.all()]


@app.get("/categories/tree")
def categories_tree(db: Session = Depends(get_db)):
    rows = db.query(CategoryRow).all()
    return [{"id": r.id, "name": r.name, "slug": r.slug, "children": []} for r in rows]


@app.post("/categories")
def create_category(body: dict, db: Session = Depends(get_db)):
    max_id = db.query(CategoryRow.id).order_by(CategoryRow.id.desc()).first()
    cid = (max_id[0] if max_id else 0) + 1
    row = CategoryRow(id=cid, name=body["name"], slug=body.get("slug", ""), parent_id=body.get("parent_id"))
    db.add(row)
    db.commit()
    return {"id": cid, "name": row.name}


@app.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    row = db.get(CategoryRow, cat_id)
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


# ── Orders ──────────────────────────────────────────
@app.get("/orders")
def list_orders(status: str | None = None, type: str | None = None, db: Session = Depends(get_db)):
    rows = db.query(OrderRow).order_by(OrderRow.id.desc()).all()
    orders = [_row_to_order(r) for r in rows]
    if status:
        orders = [o for o in orders if o["status"] == status]
    if type:
        orders = [o for o in orders if o["type"] == type]
    return orders


@app.get("/orders/assembler")
def assembler_orders(db: Session = Depends(get_db)):
    orders = [_row_to_order(r) for r in db.query(OrderRow).all()]
    return [o for o in orders if is_assembler_order(o)]


@app.get("/orders/courier")
def courier_orders(db: Session = Depends(get_db)):
    orders = [_row_to_order(r) for r in db.query(OrderRow).all()]
    return [o for o in orders if is_courier_sync(o)]


@app.get("/orders/{order_id}")
def get_order(order_id: str, db: Session = Depends(get_db)):
    row = db.get(OrderRow, order_id)
    if not row:
        raise HTTPException(404, "Заказ не найден")
    return _row_to_order(row)


@app.post("/orders")
async def create_order(body: dict, db: Session = Depends(get_db)):
    oid = next_order_id(db)
    row = order_from_payload(body, oid, _now_time())
    db.add(row)
    db.commit()
    order = _row_to_order(row)
    await ws_manager.broadcast("new_order", order)
    return order


@app.patch("/orders/{order_id}/status")
async def patch_order_status(order_id: str, body: dict, db: Session = Depends(get_db)):
    row = db.get(OrderRow, order_id)
    if not row:
        raise HTTPException(404, "Заказ не найден")
    order = apply_status_patch(_row_to_order(row), body)
    _save_order_row(row, order)
    db.commit()
    db.refresh(row)
    result = _row_to_order(row)
    await ws_manager.broadcast("order_update", result)
    return result


# ── Restaurants ─────────────────────────────────────
@app.get("/restaurants")
def list_restaurants(db: Session = Depends(get_db)):
    return [json_load(r.data_json) for r in db.query(RestaurantRow).all()]


@app.get("/restaurants/{rest_id}")
def get_restaurant(rest_id: str, db: Session = Depends(get_db)):
    row = db.get(RestaurantRow, rest_id)
    if not row:
        raise HTTPException(404, "Ресторан не найден")
    return json_load(row.data_json)


@app.patch("/restaurants/{rest_id}/toggle")
def toggle_restaurant(rest_id: str, db: Session = Depends(get_db)):
    row = db.get(RestaurantRow, rest_id)
    if not row:
        raise HTTPException(404)
    data = json_load(row.data_json)
    data["open"] = not data.get("open", True)
    row.data_json = json_dump(data)
    db.commit()
    return data


@app.patch("/restaurants/{rest_id}/commission")
def set_commission(rest_id: str, commission: float, db: Session = Depends(get_db)):
    row = db.get(RestaurantRow, rest_id)
    if not row:
        raise HTTPException(404)
    data = json_load(row.data_json)
    data["commission"] = commission
    row.data_json = json_dump(data)
    db.commit()
    return data


@app.patch("/restaurants/menu/{item_id}/stock")
def toggle_menu_stock(item_id: int, db: Session = Depends(get_db)):
    for row in db.query(RestaurantRow).all():
        data = json_load(row.data_json)
        for item in data.get("menu", []):
            if item.get("id") == item_id:
                item["inStock"] = not item.get("inStock", True)
                row.data_json = json_dump(data)
                db.commit()
                return item
    raise HTTPException(404, "Блюдо не найдено")


# ── Pickups & pricing ───────────────────────────────
@app.get("/pickups")
def list_pickups(db: Session = Depends(get_db)):
    return [json_load(r.data_json) for r in db.query(PickupRow).all()]


@app.patch("/pickups/{pickup_id}")
def patch_pickup(pickup_id: str, body: dict, db: Session = Depends(get_db)):
    row = db.get(PickupRow, pickup_id)
    if not row:
        raise HTTPException(404)
    data = {**json_load(row.data_json), **body}
    row.data_json = json_dump(data)
    db.commit()
    return data


@app.get("/settings/pricing")
def get_pricing(db: Session = Depends(get_db)):
    row = db.get(SettingRow, "pricing")
    return json_load(row.value_json) if row else {}


@app.patch("/settings/pricing")
def patch_pricing(body: dict, db: Session = Depends(get_db)):
    row = db.get(SettingRow, "pricing")
    if not row:
        row = SettingRow(key="pricing", value_json=json_dump(body))
        db.add(row)
    else:
        data = {**json_load(row.value_json), **body}
        row.value_json = json_dump(data)
    db.commit()
    return json_load(row.value_json)


# ── Cards, reviews, admin ───────────────────────────
@app.get("/cards")
def list_cards(db: Session = Depends(get_db)):
    return [json_load(r.data_json) for r in db.query(CardRow).all()]


@app.post("/cards/generate")
def generate_cards(count: int = 1, db: Session = Depends(get_db)):
    return {"ok": True, "count": count}


@app.get("/reviews")
def list_reviews(db: Session = Depends(get_db)):
    return [json_load(r.data_json) for r in db.query(ReviewRow).all()]


@app.post("/reviews")
def create_review(body: dict, db: Session = Depends(get_db)):
    row = ReviewRow(data_json=json_dump(body))
    db.add(row)
    db.commit()
    return body


@app.get("/admin/dashboard")
def admin_dashboard(db: Session = Depends(get_db)):
    orders = db.query(OrderRow).all()
    return {
        "ordersToday": len(orders),
        "revenueToday": sum(o.total for o in orders),
        "activeCouriers": 2,
        "activeRestaurants": db.query(RestaurantRow).count(),
    }


@app.post("/sync/woocommerce")
def sync_woo():
    return {"ok": True, "synced": 0}


@app.post("/sync/gbs")
def sync_gbs():
    return {"ok": True, "synced": 0}


# ── WebSocket ───────────────────────────────────────
@app.websocket("/ws/{role}")
async def websocket_endpoint(websocket: WebSocket, role: str):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
