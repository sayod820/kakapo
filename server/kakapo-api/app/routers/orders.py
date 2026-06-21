"""
KAKAPO Backend — заказы (формат фронтенда)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from pydantic import BaseModel, Field
from typing import Any

from app.core.database import get_db
from app.models import Order, OrderStatus, OrderType, Restaurant
from app.serializers import order_to_frontend
from app.services import calc_delivery_fee, next_order_code
from app.services.websocket import manager

router = APIRouter(prefix="/orders", tags=["Заказы"])


class OrderItemIn(BaseModel):
    id: int | None = None
    product_id: int | None = None
    art: str | None = None
    article: str | None = None
    name: str
    e: str | None = None
    emoji: str | None = "📦"
    price: float
    qty: int
    unit: str = "шт"
    done: bool = False


class ClientIn(BaseModel):
    name: str = ""
    phone: str = ""
    addr: str = ""
    lat: float | None = None
    lng: float | None = None


class OrderCreate(BaseModel):
    type: str = "market"
    items: list[OrderItemIn]
    # старый формат
    client_name: str | None = None
    client_phone: str | None = None
    address: str | None = None
    lat: float = 0
    lng: float = 0
    # новый формат (фронт)
    client: ClientIn | None = None
    comment: str = ""
    payment_method: str = "cash"
    restaurant_id: int | None = None
    restId: str | None = None
    restName: str | None = None
    pickupIds: list[str] = Field(default_factory=list)
    deliveryFee: float | None = None
    distanceKm: float | None = None
    durationMin: float | None = None
    weightKg: float | None = None
    total: float | None = None
    priority: str = "normal"


class OrderStatusUpdate(BaseModel):
    status: str


def _normalize_items(items: list[OrderItemIn]) -> list[dict[str, Any]]:
    out = []
    for i, item in enumerate(items):
        out.append({
            "id": item.id or i + 1,
            "art": item.art or item.article,
            "e": item.e or item.emoji or "📦",
            "name": item.name,
            "qty": item.qty,
            "unit": item.unit,
            "price": item.price,
            "done": item.done,
        })
    return out


async def _find_order(db: AsyncSession, order_id: str) -> Order | None:
    if order_id.isdigit():
        result = await db.execute(select(Order).where(Order.id == int(order_id)))
        o = result.scalar_one_or_none()
        if o:
            return o
    result = await db.execute(select(Order).where(Order.code == order_id))
    return result.scalar_one_or_none()


@router.post("")
async def create_order(data: OrderCreate, db: AsyncSession = Depends(get_db)):
    client_name = data.client_name or (data.client.name if data.client else "")
    client_phone = data.client_phone or (data.client.phone if data.client else "")
    address = data.address or (data.client.addr if data.client else "")
    lat = data.lat or (data.client.lat if data.client and data.client.lat else 0) or 0
    lng = data.lng or (data.client.lng if data.client and data.client.lng else 0) or 0

    items = _normalize_items(data.items)
    subtotal = sum(i["price"] * i["qty"] for i in items)
    delivery = data.deliveryFee if data.deliveryFee is not None else calc_delivery_fee(subtotal, lat, lng)
    total = data.total if data.total is not None else subtotal + delivery

    rest_code = data.restId
    rest_name = data.restName
    restaurant_id = data.restaurant_id
    if rest_code and not restaurant_id:
        result = await db.execute(select(Restaurant).where(Restaurant.code == rest_code))
        rest = result.scalar_one_or_none()
        if rest:
            restaurant_id = rest.id
            rest_name = rest_name or rest.name

    pickup_ids = data.pickupIds or (["store"] if data.type == "market" else [])

    order = Order(
        code=next_order_code(),
        type=OrderType(data.type),
        status=OrderStatus.new,
        client_name=client_name,
        client_phone=client_phone,
        address=address,
        lat=lat,
        lng=lng,
        items=items,
        subtotal=subtotal,
        delivery_fee=delivery,
        total=total,
        comment=data.comment,
        payment_method=data.payment_method,
        restaurant_id=restaurant_id,
        rest_code=rest_code,
        rest_name=rest_name,
        pickup_ids=pickup_ids,
        distance_km=data.distanceKm,
        duration_min=data.durationMin,
        weight_kg=data.weightKg,
        priority=data.priority,
    )
    db.add(order)
    await db.flush()
    payload = order_to_frontend(order)
    await manager.notify_new_order(payload)
    return payload


@router.get("")
async def list_orders(
    status: str | None = Query(None),
    type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(Order).order_by(Order.created_at.desc())
    if status:
        q = q.where(Order.status == OrderStatus(status))
    if type:
        q = q.where(Order.type == OrderType(type))
    result = await db.execute(q)
    return [order_to_frontend(o) for o in result.scalars().all()]


@router.get("/assembler")
async def assembler_orders(db: AsyncSession = Depends(get_db)):
    q = select(Order).where(
        Order.type == OrderType.market,
        Order.status.in_([OrderStatus.new, OrderStatus.assembling]),
    ).order_by(Order.created_at)
    result = await db.execute(q)
    return [order_to_frontend(o) for o in result.scalars().all()]


@router.get("/courier")
async def courier_orders(db: AsyncSession = Depends(get_db)):
    q = select(Order).where(
        Order.status.in_([
            OrderStatus.assembler_done, OrderStatus.ready,
            OrderStatus.courier_picked, OrderStatus.delivering,
        ]),
    ).order_by(Order.created_at)
    result = await db.execute(q)
    return [order_to_frontend(o) for o in result.scalars().all()]


@router.get("/{order_id}")
async def get_order(order_id: str, db: AsyncSession = Depends(get_db)):
    o = await _find_order(db, order_id)
    if not o:
        raise HTTPException(404, "Заказ не найден")
    return order_to_frontend(o)


@router.patch("/{order_id}/status")
async def update_status(order_id: str, data: OrderStatusUpdate, db: AsyncSession = Depends(get_db)):
    o = await _find_order(db, order_id)
    if not o:
        raise HTTPException(404, "Заказ не найден")
    o.status = OrderStatus(data.status)
    await db.flush()
    payload = order_to_frontend(o)
    await manager.broadcast_order_update(payload)
    return payload
