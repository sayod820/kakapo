"""
KAKAPO Backend — настройки (тариф доставки)
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import require_admin
from app.models import AppSetting, User

router = APIRouter(prefix="/settings", tags=["Настройки"])

DEFAULT_PRICING = {
    "base": 10,
    "baseDist": 2.5,
    "perKm": 3,
    "heavyKg": 50,
    "heavyExtra": 10,
    "freeFrom": 0,
}


class PricingPatch(BaseModel):
    base: float | None = None
    baseDist: float | None = None
    perKm: float | None = None
    heavyKg: float | None = None
    heavyExtra: float | None = None
    freeFrom: float | None = None


async def _get_pricing(db: AsyncSession) -> dict:
    result = await db.execute(select(AppSetting).where(AppSetting.key == "pricing"))
    row = result.scalar_one_or_none()
    if not row or not row.value:
        return dict(DEFAULT_PRICING)
    return {**DEFAULT_PRICING, **row.value}


@router.get("/pricing")
async def get_pricing(db: AsyncSession = Depends(get_db)):
    return await _get_pricing(db)


@router.patch("/pricing")
async def patch_pricing(
    data: PricingPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    current = await _get_pricing(db)
    patch = data.model_dump(exclude_none=True)
    current.update(patch)
    result = await db.execute(select(AppSetting).where(AppSetting.key == "pricing"))
    row = result.scalar_one_or_none()
    if row:
        row.value = current
    else:
        db.add(AppSetting(key="pricing", value=current))
    await db.flush()
    return current
