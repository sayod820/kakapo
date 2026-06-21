"""
KAKAPO Backend — авторизация (OTP для клиентов/курьеров, пароль для админа/ресторанов)
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta, timezone
from app.core.database import get_db
from app.core.security import create_access_token, verify_password
from app.core.config import settings
from app.models import User, UserRole, Restaurant, OTPCode, LoyaltyCard
from app.schemas import OTPRequest, OTPVerify, LoginRequest, Token
from app.services import generate_otp, send_otp

router = APIRouter(prefix="/auth", tags=["Авторизация"])


# ── ОТПРАВИТЬ OTP ───────────────────────────────
@router.post("/otp/send")
async def otp_send(data: OTPRequest, db: AsyncSession = Depends(get_db)):
    code = generate_otp()
    otp = OTPCode(
        phone=data.phone,
        code=code,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    db.add(otp)
    await db.flush()
    await send_otp(data.phone, code)
    return {"ok": True, "message": "Код отправлен", "demo": settings.SMS_DEMO_MODE}


# ── ПРОВЕРИТЬ OTP ───────────────────────────────
@router.post("/otp/verify", response_model=Token)
async def otp_verify(data: OTPVerify, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(OTPCode)
        .where(OTPCode.phone == data.phone, OTPCode.code == data.code, OTPCode.is_used == False)
        .order_by(OTPCode.created_at.desc())
    )
    otp = result.scalars().first()

    if not otp:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неверный код")
    if otp.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Код истёк")

    otp.is_used = True

    # найти или создать пользователя
    result = await db.execute(select(User).where(User.phone == data.phone))
    user = result.scalar_one_or_none()
    if not user:
        user = User(phone=data.phone, role=UserRole.client, name="")
        db.add(user)
        await db.flush()
        # выдать карту лояльности
        card = LoyaltyCard(number=f"KAKAPO-{user.id:04d}", user_id=user.id, bonus=100)
        db.add(card)

    await db.flush()
    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return Token(access_token=token, role=user.role.value, user_id=user.id, name=user.name)


# ── ВХОД ПО ПАРОЛЮ (админ / ресторан) ───────────
@router.post("/login", response_model=Token)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    # сначала проверяем админа
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if user and user.password_hash and verify_password(data.password, user.password_hash):
        token = create_access_token({"sub": str(user.id), "role": user.role.value})
        return Token(access_token=token, role=user.role.value, user_id=user.id, name=user.name)

    # проверяем ресторан
    result = await db.execute(select(Restaurant).where(Restaurant.email == data.email))
    rest = result.scalar_one_or_none()
    if rest and rest.password_hash and verify_password(data.password, rest.password_hash):
        token = create_access_token({"sub": f"rest_{rest.id}", "role": "restaurant", "rest_id": rest.id})
        return Token(access_token=token, role="restaurant", user_id=rest.id, name=rest.name)

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
