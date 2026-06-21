"""
KAKAPO Backend — сервисы (доставка, SMS, WooCommerce)
"""
import math
import random
import httpx
from datetime import datetime, timedelta, timezone
from app.core.config import settings


# ════════════════════════════════════════════════
# РАСЧЁТ ДОСТАВКИ (Haversine)
# ════════════════════════════════════════════════
def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Расстояние между двумя точками в км"""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def calc_delivery_fee(subtotal: float, lat: float, lng: float) -> float:
    """Расчёт стоимости доставки от магазина до клиента"""
    if subtotal >= settings.DELIVERY_FREE_FROM:
        return 0.0

    fee = settings.DELIVERY_BASE_PRICE

    if lat and lng:
        dist = haversine_km(settings.STORE_LAT, settings.STORE_LNG, lat, lng)
        if dist > settings.DELIVERY_FREE_RADIUS_KM:
            fee += (dist - settings.DELIVERY_FREE_RADIUS_KM) * settings.DELIVERY_PER_KM

    # часы пик
    hour = datetime.now(timezone.utc).hour + 5  # UTC+5 Таджикистан
    if 12 <= hour < 14:
        fee *= 1.3
    elif 17 <= hour < 20:
        fee *= 1.5

    return round(fee, 2)


# ════════════════════════════════════════════════
# SMS (SmsPro.tj)
# ════════════════════════════════════════════════
def generate_otp() -> str:
    if settings.SMS_DEMO_MODE:
        return "1234"
    return str(random.randint(1000, 9999))


async def send_sms(phone: str, text: str) -> bool:
    """Отправить SMS через SmsPro.tj"""
    if settings.SMS_DEMO_MODE or not settings.SMS_API_KEY:
        print(f"[SMS DEMO] → {phone}: {text}")
        return True

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://smspro.tj/api/v1/sms/send",
                headers={"Authorization": f"Bearer {settings.SMS_API_KEY}"},
                json={"sender": settings.SMS_SENDER, "recipient": phone, "text": text},
            )
            return resp.status_code == 200
    except Exception as e:
        print(f"[SMS ERROR] {e}")
        return False


async def send_otp(phone: str, code: str) -> bool:
    return await send_sms(phone, f"KAKAPO: ваш код {code}. Никому не сообщайте.")


# ════════════════════════════════════════════════
# WOOCOMMERCE (kakapo.tj)
# ════════════════════════════════════════════════
async def woo_get_products(page: int = 1, per_page: int = 100) -> list[dict]:
    """Получить товары из WooCommerce"""
    if not settings.WOOCOMMERCE_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{settings.WOOCOMMERCE_URL}/wp-json/wc/v3/products",
                params={"page": page, "per_page": per_page},
                auth=(settings.WOOCOMMERCE_KEY, settings.WOOCOMMERCE_SECRET),
            )
            return resp.json() if resp.status_code == 200 else []
    except Exception as e:
        print(f"[WOO ERROR] {e}")
        return []


async def woo_get_categories() -> list[dict]:
    """Получить категории из WooCommerce"""
    if not settings.WOOCOMMERCE_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{settings.WOOCOMMERCE_URL}/wp-json/wc/v3/products/categories",
                params={"per_page": 100},
                auth=(settings.WOOCOMMERCE_KEY, settings.WOOCOMMERCE_SECRET),
            )
            return resp.json() if resp.status_code == 200 else []
    except Exception as e:
        print(f"[WOO ERROR] {e}")
        return []


# ════════════════════════════════════════════════
# GBS MARKET
# ════════════════════════════════════════════════
async def gbs_sync_products() -> dict:
    """Синхронизация товаров с кассой GBS Market"""
    if not settings.GBS_ENABLED:
        return {"ok": False, "reason": "GBS отключён"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{settings.GBS_HOST}:{settings.GBS_PORT}/api/products",
                auth=(settings.GBS_USER, settings.GBS_PASSWORD),
            )
            return {"ok": resp.status_code == 200, "data": resp.json() if resp.status_code == 200 else None}
    except Exception as e:
        return {"ok": False, "reason": str(e)}


# ════════════════════════════════════════════════
# ГЕНЕРАТОР КОДОВ ЗАКАЗОВ
# ════════════════════════════════════════════════
_order_counter = 4833

def next_order_code() -> str:
    global _order_counter
    _order_counter += 1
    return f"K-{_order_counter}"
