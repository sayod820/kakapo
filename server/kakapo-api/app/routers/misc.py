"""
KAKAPO Backend — WebSocket, карты, отзывы, синхронизация
"""
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db
from app.core.deps import require_admin
from app.core.security import decode_token
from app.models import LoyaltyCard, Review, Order, Product, Restaurant, User
from app.schemas import CardOut, ReviewIn, ReviewOut
from app.services.websocket import manager
from app.services import woo_get_products, gbs_sync_products

router = APIRouter()


# ════════════════════════════════════════════════
# WEBSOCKET — real-time заказы
# ════════════════════════════════════════════════
@router.websocket("/ws/{role}")
async def websocket_endpoint(ws: WebSocket, role: str, token: str = ""):
    """
    Подключение: ws://host/ws/{role}?token=JWT
    role: client | courier | assembler | restaurant | admin
    """
    await manager.connect(ws, role)
    try:
        while True:
            # держим соединение, отвечаем pong на ping
            msg = await ws.receive_text()
            if msg == "ping":
                try:
                    await ws.send_text("pong")
                except Exception:
                    break
    except WebSocketDisconnect:
        manager.disconnect(ws, role)
    except Exception:
        manager.disconnect(ws, role)


# ════════════════════════════════════════════════
# КАРТЫ ЛОЯЛЬНОСТИ
# ════════════════════════════════════════════════
@router.get("/cards", response_model=list[CardOut], tags=["Карты"])
async def list_cards(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(LoyaltyCard))
    return result.scalars().all()


@router.post("/cards/generate", tags=["Карты"])
async def generate_cards(count: int = 10, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(func.count(LoyaltyCard.id)))
    start = result.scalar() or 0
    created = []
    for i in range(count):
        num = f"KAKAPO-{start + i + 1:04d}"
        card = LoyaltyCard(number=num)
        db.add(card)
        created.append(num)
    await db.flush()
    return {"ok": True, "created": created}


# ════════════════════════════════════════════════
# ОТЗЫВЫ
# ════════════════════════════════════════════════
@router.get("/reviews", response_model=list[ReviewOut], tags=["Отзывы"])
async def list_reviews(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Review).order_by(Review.created_at.desc()))
    return result.scalars().all()


@router.post("/reviews", response_model=ReviewOut, tags=["Отзывы"])
async def create_review(data: ReviewIn, client_name: str = "Клиент", db: AsyncSession = Depends(get_db)):
    r = Review(**data.model_dump(), client_name=client_name)
    db.add(r)
    await db.flush()
    return r


# ════════════════════════════════════════════════
# АДМИН — СТАТИСТИКА
# ════════════════════════════════════════════════
@router.get("/admin/dashboard", tags=["Админ"])
async def admin_dashboard(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    orders_count = (await db.execute(select(func.count(Order.id)))).scalar()
    products_count = (await db.execute(select(func.count(Product.id)))).scalar()
    rest_count = (await db.execute(select(func.count(Restaurant.id)))).scalar()
    revenue = (await db.execute(select(func.sum(Order.total)))).scalar() or 0
    return {
        "orders": orders_count,
        "products": products_count,
        "restaurants": rest_count,
        "revenue": round(revenue, 2),
    }


# ════════════════════════════════════════════════
# СИНХРОНИЗАЦИЯ
# ════════════════════════════════════════════════
@router.post("/sync/woocommerce", tags=["Синхронизация"])
async def sync_woo(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    """Импорт товаров из WooCommerce kakapo.tj"""
    products = await woo_get_products()
    imported = 0
    for wp in products:
        # проверяем есть ли уже
        result = await db.execute(select(Product).where(Product.woo_id == wp["id"]))
        if result.scalar_one_or_none():
            continue
        p = Product(
            article=f"KAK-{wp['id']:04d}",
            name=wp.get("name", ""),
            price=float(wp.get("price") or 0),
            stock=wp.get("stock_quantity") or 0,
            image_url=wp["images"][0]["src"] if wp.get("images") else "",
            woo_id=wp["id"],
        )
        db.add(p)
        imported += 1
    await db.flush()
    return {"ok": True, "imported": imported, "total_found": len(products)}


@router.post("/sync/gbs", tags=["Синхронизация"])
async def sync_gbs(_: User = Depends(require_admin)):
    """Синхронизация с кассой GBS Market"""
    return await gbs_sync_products()
