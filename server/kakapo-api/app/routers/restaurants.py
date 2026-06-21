"""
KAKAPO Backend — рестораны (формат фронтенда)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import require_admin, get_current_user
from app.models import Restaurant, MenuItem, User
from app.serializers import restaurant_to_frontend

router = APIRouter(prefix="/restaurants", tags=["Рестораны"])


async def _get_restaurant(db: AsyncSession, rest_id: str) -> Restaurant | None:
    if rest_id.isdigit():
        result = await db.execute(
            select(Restaurant).options(selectinload(Restaurant.menu)).where(Restaurant.id == int(rest_id))
        )
        r = result.scalar_one_or_none()
        if r:
            return r
    result = await db.execute(
        select(Restaurant).options(selectinload(Restaurant.menu)).where(Restaurant.code == rest_id)
    )
    return result.scalar_one_or_none()


@router.get("")
async def list_restaurants(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Restaurant).options(selectinload(Restaurant.menu)))
    return [restaurant_to_frontend(r) for r in result.scalars().all()]


@router.get("/{rest_id}")
async def get_restaurant(rest_id: str, db: AsyncSession = Depends(get_db)):
    r = await _get_restaurant(db, rest_id)
    if not r:
        raise HTTPException(404, "Ресторан не найден")
    return restaurant_to_frontend(r)


@router.patch("/{rest_id}/toggle")
async def toggle_open(rest_id: str, db: AsyncSession = Depends(get_db)):
    r = await _get_restaurant(db, rest_id)
    if not r:
        raise HTTPException(404, "Ресторан не найден")
    r.is_open = not r.is_open
    await db.flush()
    return {"ok": True, "open": r.is_open}


@router.patch("/{rest_id}/commission")
async def set_commission(rest_id: str, commission: float, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    r = await _get_restaurant(db, rest_id)
    if not r:
        raise HTTPException(404, "Ресторан не найден")
    r.commission = commission
    await db.flush()
    return {"ok": True, "commission": r.commission}


@router.patch("/menu/{item_id}/stock")
async def toggle_menu_stock(item_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MenuItem).where(MenuItem.id == item_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Блюдо не найдено")
    m.in_stock = not m.in_stock
    await db.flush()
    return {"ok": True, "inStock": m.in_stock}
