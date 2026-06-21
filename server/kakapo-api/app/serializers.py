"""
KAKAPO Backend — ответы в формате фронтенда (Next.js lib/types.ts)
"""
from datetime import datetime
from typing import Any

from app.models import Order, Product, Restaurant, MenuItem, Category, PickupPoint


def _discount(price: float, old: float | None) -> int:
    if old and old > price:
        return round((1 - price / old) * 100)
    return 0


def product_to_frontend(p: Product, cat: Category | None = None) -> dict[str, Any]:
    c = cat or getattr(p, "category", None)
    cat_id = "misc"
    cat_name = "Прочее"
    if c:
        parent = getattr(c, "parent", None)
        if c.parent_id and parent:
            cat_id = parent.slug
            cat_name = c.name
        else:
            cat_id = c.slug
            cat_name = c.name
    return {
        "id": p.id,
        "art": p.article,
        "e": p.emoji,
        "name": p.name,
        "price": p.price,
        "old": p.old_price,
        "cat": cat_name,
        "catId": cat_id,
        "unit": p.unit,
        "stock": p.stock,
        "hot": p.is_hot,
        "organic": p.is_organic,
        "discount": _discount(p.price, p.old_price),
        "photo": p.image_url or None,
    }


def menu_item_to_frontend(m: MenuItem) -> dict[str, Any]:
    return {
        "id": m.id,
        "cat": m.category,
        "e": m.emoji,
        "name": m.name,
        "desc": m.description or "",
        "price": m.price,
        "inStock": m.in_stock,
        "popular": m.is_popular,
        "photo": m.image_url or None,
    }


def restaurant_to_frontend(r: Restaurant) -> dict[str, Any]:
    return {
        "id": r.code,
        "name": r.name,
        "emoji": r.emoji,
        "cuisine": r.cuisine,
        "address": r.address,
        "phone": r.phone,
        "email": r.email,
        "commission": r.commission,
        "open": r.is_open,
        "rating": r.rating,
        "reviews": r.reviews_count,
        "ordersMonth": r.orders_month,
        "revenueMonth": r.revenue_month,
        "img": r.image or f"linear-gradient(135deg,#1A1A1A,#2A2A2A)",
        "lat": r.lat,
        "lng": r.lng,
        "menu": [menu_item_to_frontend(m) for m in r.menu],
    }


def _format_created_at(dt: datetime | None) -> str:
    if not dt:
        return ""
    return dt.astimezone().strftime("%H:%M") if dt.tzinfo else dt.strftime("%H:%M")


def order_to_frontend(o: Order) -> dict[str, Any]:
    items = []
    for i, raw in enumerate(o.items or []):
        if isinstance(raw, dict):
            items.append({
                "id": raw.get("id", i + 1),
                "art": raw.get("art") or raw.get("article"),
                "e": raw.get("e") or raw.get("emoji", "📦"),
                "name": raw.get("name", ""),
                "qty": raw.get("qty", 1),
                "unit": raw.get("unit", "шт"),
                "price": raw.get("price", 0),
                "done": raw.get("done", False),
            })
    return {
        "id": o.code,
        "type": o.type.value if hasattr(o.type, "value") else o.type,
        "status": o.status.value if hasattr(o.status, "value") else o.status,
        "createdAt": _format_created_at(o.created_at),
        "client": {
            "name": o.client_name,
            "phone": o.client_phone,
            "addr": o.address,
            "lat": o.lat or None,
            "lng": o.lng or None,
        },
        "courier": o.courier_meta,
        "assembler": o.assembler_meta,
        "items": items,
        "total": o.total,
        "comment": o.comment or "",
        "priority": o.priority or "normal",
        "restId": o.rest_code,
        "restName": o.rest_name,
        "pickupIds": o.pickup_ids or [],
        "distanceKm": o.distance_km,
        "deliveryFee": o.delivery_fee,
        "durationMin": o.duration_min,
        "weightKg": o.weight_kg,
    }


def pickup_to_frontend(p: PickupPoint) -> dict[str, Any]:
    return {
        "id": p.code,
        "type": p.type,
        "e": p.emoji,
        "color": p.color,
        "name": p.name,
        "addr": p.address,
        "phone": p.phone,
        "lat": p.lat,
        "lng": p.lng,
        "active": p.is_active,
    }
