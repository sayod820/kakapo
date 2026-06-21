"""
KAKAPO Backend — модели базы данных
Все таблицы: пользователи, заказы, товары, категории, рестораны,
курьеры, сборщики, карты лояльности, отзывы
"""
from datetime import datetime, timezone
from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, ForeignKey, Text, Enum as SAEnum, JSON
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


def now() -> datetime:
    return datetime.now(timezone.utc)


# ════════════════════════════════════════════════
# ENUMS
# ════════════════════════════════════════════════
class UserRole(str, enum.Enum):
    client = "client"
    courier = "courier"
    assembler = "assembler"
    restaurant = "restaurant"
    admin = "admin"


class OrderStatus(str, enum.Enum):
    new = "new"                    # новый
    assembling = "assembling"      # собирается
    assembler_done = "assembler_done"  # собран
    cooking = "cooking"            # готовится (ресторан)
    ready = "ready"                # готов
    courier_picked = "courier_picked"  # курьер забрал
    delivering = "delivering"      # в пути
    delivered = "delivered"        # доставлен
    cancelled = "cancelled"        # отменён


class OrderType(str, enum.Enum):
    market = "market"
    restaurant = "restaurant"


class CardLevel(str, enum.Enum):
    bronze = "bronze"
    silver = "silver"
    gold = "gold"
    platinum = "platinum"


# ════════════════════════════════════════════════
# ПОЛЬЗОВАТЕЛИ
# ════════════════════════════════════════════════
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), default=UserRole.client)
    password_hash: Mapped[str] = mapped_column(String(255), default="")  # для админа/ресторана
    email: Mapped[str] = mapped_column(String(120), default="", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    # связи
    addresses: Mapped[list["Address"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    orders: Mapped[list["Order"]] = relationship(back_populates="client", foreign_keys="Order.client_id")
    card: Mapped["LoyaltyCard"] = relationship(back_populates="user", uselist=False)


class Address(Base):
    __tablename__ = "addresses"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(80), default="Дом")
    address: Mapped[str] = mapped_column(String(255))
    lat: Mapped[float] = mapped_column(Float, default=0)
    lng: Mapped[float] = mapped_column(Float, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped["User"] = relationship(back_populates="addresses")


# ════════════════════════════════════════════════
# КАТЕГОРИИ (с родительским контролем)
# ════════════════════════════════════════════════
class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    emoji: Mapped[str] = mapped_column(String(10), default="📦")
    description: Mapped[str] = mapped_column(String(255), default="")
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    parent: Mapped["Category"] = relationship(remote_side=[id], backref="children")
    products: Mapped[list["Product"]] = relationship(back_populates="category")


# ════════════════════════════════════════════════
# ТОВАРЫ
# ════════════════════════════════════════════════
class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    article: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # KAK-XXXX
    name: Mapped[str] = mapped_column(String(200), index=True)
    emoji: Mapped[str] = mapped_column(String(10), default="📦")
    image_url: Mapped[str] = mapped_column(String(500), default="")
    price: Mapped[float] = mapped_column(Float)
    old_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(40), default="шт")
    stock: Mapped[int] = mapped_column(Integer, default=0)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    is_hot: Mapped[bool] = mapped_column(Boolean, default=False)
    is_organic: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    woo_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # WooCommerce ID
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    category: Mapped["Category"] = relationship(back_populates="products")


# ════════════════════════════════════════════════
# РЕСТОРАНЫ
# ════════════════════════════════════════════════
class Restaurant(Base):
    __tablename__ = "restaurants"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)  # R-01
    name: Mapped[str] = mapped_column(String(200))
    emoji: Mapped[str] = mapped_column(String(10), default="🍽")
    cuisine: Mapped[str] = mapped_column(String(120), default="")
    address: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(20), default="")
    email: Mapped[str] = mapped_column(String(120), default="", index=True)
    password_hash: Mapped[str] = mapped_column(String(255), default="")
    commission: Mapped[float] = mapped_column(Float, default=15.0)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    rating: Mapped[float] = mapped_column(Float, default=5.0)
    reviews_count: Mapped[int] = mapped_column(Integer, default=0)
    orders_month: Mapped[int] = mapped_column(Integer, default=0)
    revenue_month: Mapped[float] = mapped_column(Float, default=0.0)
    lat: Mapped[float] = mapped_column(Float, default=38.3250)
    lng: Mapped[float] = mapped_column(Float, default=69.0250)
    image: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    menu: Mapped[list["MenuItem"]] = relationship(back_populates="restaurant", cascade="all, delete-orphan")


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id"))
    category: Mapped[str] = mapped_column(String(80), default="")
    emoji: Mapped[str] = mapped_column(String(10), default="🍽")
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(255), default="")
    price: Mapped[float] = mapped_column(Float)
    in_stock: Mapped[bool] = mapped_column(Boolean, default=True)
    is_popular: Mapped[bool] = mapped_column(Boolean, default=False)
    image_url: Mapped[str] = mapped_column(String(500), default="")

    restaurant: Mapped["Restaurant"] = relationship(back_populates="menu")


# ════════════════════════════════════════════════
# ЗАКАЗЫ
# ════════════════════════════════════════════════
class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # K-4832
    type: Mapped[OrderType] = mapped_column(SAEnum(OrderType), default=OrderType.market)
    status: Mapped[OrderStatus] = mapped_column(SAEnum(OrderStatus), default=OrderStatus.new)

    client_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    courier_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    assembler_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    restaurant_id: Mapped[int | None] = mapped_column(ForeignKey("restaurants.id"), nullable=True)

    client_name: Mapped[str] = mapped_column(String(120), default="")
    client_phone: Mapped[str] = mapped_column(String(20), default="")
    address: Mapped[str] = mapped_column(String(255), default="")
    lat: Mapped[float] = mapped_column(Float, default=0)
    lng: Mapped[float] = mapped_column(Float, default=0)

    items: Mapped[list] = mapped_column(JSON, default=list)  # список товаров JSON
    subtotal: Mapped[float] = mapped_column(Float, default=0)
    delivery_fee: Mapped[float] = mapped_column(Float, default=0)
    total: Mapped[float] = mapped_column(Float, default=0)
    comment: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[str] = mapped_column(String(20), default="normal")
    payment_method: Mapped[str] = mapped_column(String(40), default="cash")
    pickup_ids: Mapped[list] = mapped_column(JSON, default=list)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    rest_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    rest_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    courier_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    assembler_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    client: Mapped["User"] = relationship(back_populates="orders", foreign_keys=[client_id])


# ════════════════════════════════════════════════
# ТОЧКИ ЗАБОРА
# ════════════════════════════════════════════════
class PickupPoint(Base):
    __tablename__ = "pickup_points"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # store, rest1…
    type: Mapped[str] = mapped_column(String(10), default="store")  # store | rest
    emoji: Mapped[str] = mapped_column(String(10), default="🏪")
    color: Mapped[str] = mapped_column(String(20), default="#1FD760")
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    lat: Mapped[float] = mapped_column(Float, default=38.3250)
    lng: Mapped[float] = mapped_column(Float, default=69.0250)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    restaurant_code: Mapped[str | None] = mapped_column(String(10), nullable=True)


# ════════════════════════════════════════════════
# НАСТРОЙКИ (JSON)
# ════════════════════════════════════════════════
class AppSetting(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)


# ════════════════════════════════════════════════
# КАРТЫ ЛОЯЛЬНОСТИ
# ════════════════════════════════════════════════
class LoyaltyCard(Base):
    __tablename__ = "loyalty_cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # KAKAPO-XXXX
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    level: Mapped[CardLevel] = mapped_column(SAEnum(CardLevel), default=CardLevel.bronze)
    bonus: Mapped[int] = mapped_column(Integer, default=0)
    debt_limit: Mapped[float] = mapped_column(Float, default=0)
    debt: Mapped[float] = mapped_column(Float, default=0)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    user: Mapped["User"] = relationship(back_populates="card")


# ════════════════════════════════════════════════
# ОТЗЫВЫ
# ════════════════════════════════════════════════
class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int | None] = mapped_column(ForeignKey("restaurants.id"), nullable=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    client_name: Mapped[str] = mapped_column(String(120), default="")
    rating: Mapped[int] = mapped_column(Integer, default=5)
    text: Mapped[str] = mapped_column(Text, default="")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ════════════════════════════════════════════════
# OTP КОДЫ
# ════════════════════════════════════════════════
class OTPCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), index=True)
    code: Mapped[str] = mapped_column(String(6))
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
