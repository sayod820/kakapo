"""
KAKAPO Backend — подключение к базе данных PostgreSQL
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings


class Base(DeclarativeBase):
    pass


# Render free tier — меньше соединений
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

# v2.1 — новые колонки на уже существующей БД Render
_MIGRATIONS = [
    "ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS reviews_count INTEGER DEFAULT 0",
    "ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS orders_month INTEGER DEFAULT 0",
    "ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS revenue_month DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION DEFAULT 38.325",
    "ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION DEFAULT 69.025",
    "ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) DEFAULT ''",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_ids JSONB DEFAULT '[]'::jsonb",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS distance_km DOUBLE PRECISION",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS duration_min DOUBLE PRECISION",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight_kg DOUBLE PRECISION",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS rest_code VARCHAR(10)",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS rest_name VARCHAR(200)",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_meta JSONB",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS assembler_meta JSONB",
]


async def get_db() -> AsyncSession:
    """Dependency для получения сессии БД"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """Создать таблицы и добавить недостающие колонки"""
    import app.models  # noqa: F401 — регистрация моделей
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for sql in _MIGRATIONS:
            await conn.execute(text(sql))
