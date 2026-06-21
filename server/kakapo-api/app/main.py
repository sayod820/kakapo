"""
KAKAPO Backend — главный файл приложения
Супермаркет + Маркетплейс · г. Яван, Таджикистан
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.core.database import init_db
from app.routers import auth, products, orders, restaurants, misc, pickups, settings_router
from app.seed import seed_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
        await seed_database()
        print("KAKAPO Backend started")
    except Exception as e:
        # не падаем при старте — иначе Render exit code 3
        print(f"WARNING: startup init failed: {e}")
    yield
    print("KAKAPO Backend stopped")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="API для экосистемы KAKAPO — супермаркет, рестораны, доставка",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# роутеры
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(orders.router)
app.include_router(restaurants.router)
app.include_router(pickups.router)
app.include_router(settings_router.router)
app.include_router(misc.router)


@app.get("/", tags=["Система"])
async def root():
    return {
        "name": "KAKAPO API",
        "version": settings.APP_VERSION,
        "city": "г. Яван, Таджикистан",
        "docs": "/docs",
        "status": "online",
    }


@app.get("/health", tags=["Система"])
async def health():
    return {"status": "healthy"}
