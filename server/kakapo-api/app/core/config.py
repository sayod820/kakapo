"""
KAKAPO Backend — настройки приложения
г. Яван, Таджикистан
"""
from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache


class Settings(BaseSettings):
    # ── Приложение ──
    APP_NAME: str = "KAKAPO API"
    APP_VERSION: str = "2.1.0"
    DEBUG: bool = False

    # ── База данных ──
    DATABASE_URL: str = "postgresql+asyncpg://kakapo:kakapo@localhost:5432/kakapo"

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_db_url(cls, v: str) -> str:
        """Render/Heroku выдают URL вида postgres:// или postgresql:// —
        приводим к драйверу asyncpg, который требует FastAPI/SQLAlchemy."""
        if not v:
            return v
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://"):]
        # asyncpg не понимает параметр sslmode в URL — убираем
        if "+asyncpg" in v and "sslmode=" in v:
            import re
            v = re.sub(r"[?&]sslmode=[^&]+", "", v)
        return v

    # ── JWT авторизация ──
    SECRET_KEY: str = "CHANGE_THIS_SECRET_KEY_IN_PRODUCTION_min_32_chars"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 дней

    # ── Первый администратор (создаётся при первом старте) ──
    ADMIN_EMAIL: str = "admin@kakapo.tj"
    ADMIN_PASSWORD: str = ""           # ОБЯЗАТЕЛЬНО задать в проде, иначе админ не создаётся
    ADMIN_NAME: str = "Администратор"
    ADMIN_PHONE: str = "+992000000000"

    # ── Пароль по умолчанию для ресторанов-партнёров ──
    RESTAURANT_DEFAULT_PASSWORD: str = ""  # задаётся в env; пусто = рестораны не сидируются с паролем

    # ── SMS (SmsPro.tj) ──
    SMS_PROVIDER: str = "smspro"
    SMS_API_KEY: str = ""
    SMS_SENDER: str = "KAKAPO"
    SMS_DEMO_MODE: bool = False  # True = код всегда 1234 (только для локальной разработки)

    # ── WooCommerce (kakapo.tj) ──
    WOOCOMMERCE_URL: str = "https://kakapo.tj"
    WOOCOMMERCE_KEY: str = ""
    WOOCOMMERCE_SECRET: str = ""

    # ── GBS Market ──
    GBS_HOST: str = "http://192.168.1.100"
    GBS_PORT: int = 8419
    GBS_USER: str = "admin"
    GBS_PASSWORD: str = ""
    GBS_ENABLED: bool = False

    # ── Доставка ──
    DELIVERY_BASE_PRICE: float = 5.0       # базовая цена ЅМ
    DELIVERY_FREE_FROM: float = 30.0       # бесплатно от ЅМ
    DELIVERY_PER_KM: float = 1.5           # за км после радиуса
    DELIVERY_FREE_RADIUS_KM: float = 2.0   # бесплатный радиус
    STORE_LAT: float = 38.3250             # KAKAPO Магазин, ул. Ленина 42
    STORE_LNG: float = 69.0250

    # ── CORS ──
    # Список разрешённых доменов фронтенда через запятую.
    # В проде добавь сюда адрес Vercel, напр.: "https://kakapo.vercel.app,https://kakapo.tj"
    CORS_ORIGINS: str = "http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
