"""
KAKAPO Backend — точки забора (магазин + рестораны)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import require_admin
from app.models import PickupPoint, User
from app.serializers import pickup_to_frontend

router = APIRouter(prefix="/pickups", tags=["Точки забора"])


class PickupPatch(BaseModel):
    name: str | None = None
    addr: str | None = None
    phone: str | None = None
    lat: float | None = None
    lng: float | None = None
    active: bool | None = None
    e: str | None = None
    color: str | None = None


@router.get("")
async def list_pickups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PickupPoint).order_by(PickupPoint.sort_order))
    return [pickup_to_frontend(p) for p in result.scalars().all()]


@router.patch("/{pickup_id}")
async def update_pickup(
    pickup_id: str,
    data: PickupPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(PickupPoint).where(PickupPoint.code == pickup_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Точка забора не найдена")
    if data.name is not None:
        p.name = data.name
    if data.addr is not None:
        p.address = data.addr
    if data.phone is not None:
        p.phone = data.phone
    if data.lat is not None:
        p.lat = data.lat
    if data.lng is not None:
        p.lng = data.lng
    if data.active is not None:
        p.is_active = data.active
    if data.e is not None:
        p.emoji = data.e
    if data.color is not None:
        p.color = data.color
    await db.flush()
    return pickup_to_frontend(p)
