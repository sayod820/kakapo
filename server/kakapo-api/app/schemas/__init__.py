"""
KAKAPO Backend — Pydantic схемы (валидация запросов/ответов)
"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Any


# ════════════════════════════════════════════════
# АВТОРИЗАЦИЯ
# ════════════════════════════════════════════════
class OTPRequest(BaseModel):
    phone: str = Field(..., examples=["+992934567890"])


class OTPVerify(BaseModel):
    phone: str
    code: str = Field(..., min_length=4, max_length=6)


class LoginRequest(BaseModel):
    email: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: int
    name: str = ""


# ════════════════════════════════════════════════
# ПОЛЬЗОВАТЕЛЬ
# ════════════════════════════════════════════════
class UserOut(BaseModel):
    id: int
    phone: str
    name: str
    role: str
    email: str
    class Config: from_attributes = True


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None


# ════════════════════════════════════════════════
# КАТЕГОРИИ
# ════════════════════════════════════════════════
class CategoryIn(BaseModel):
    slug: str
    name: str
    emoji: str = "📦"
    description: str = ""
    parent_id: int | None = None
    sort_order: int = 0


class CategoryOut(BaseModel):
    id: int
    slug: str
    name: str
    emoji: str
    description: str
    parent_id: int | None
    sort_order: int
    is_active: bool
    class Config: from_attributes = True


# ════════════════════════════════════════════════
# ТОВАРЫ
# ════════════════════════════════════════════════
class ProductIn(BaseModel):
    article: str | None = None
    art: str | None = None
    name: str
    emoji: str = "📦"
    e: str | None = None
    price: float
    old_price: float | None = None
    old: float | None = None
    unit: str = "шт"
    stock: int = 0
    category_id: int | None = None
    is_hot: bool = False
    hot: bool | None = None
    is_organic: bool = False
    organic: bool | None = None
    photo: str | None = None
    image_url: str | None = None


class ProductOut(BaseModel):
    id: int
    article: str
    name: str
    emoji: str
    image_url: str
    price: float
    old_price: float | None
    unit: str
    stock: int
    category_id: int | None
    is_hot: bool
    is_organic: bool
    is_active: bool
    class Config: from_attributes = True


class ProductUpdate(BaseModel):
    name: str | None = None
    price: float | None = None
    old_price: float | None = None
    old: float | None = None
    stock: int | None = None
    category_id: int | None = None
    is_hot: bool | None = None
    hot: bool | None = None
    is_organic: bool | None = None
    organic: bool | None = None
    is_active: bool | None = None
    photo: str | None = None
    image_url: str | None = None


# ════════════════════════════════════════════════
# ЗАКАЗЫ
# ════════════════════════════════════════════════
class OrderItemIn(BaseModel):
    product_id: int | None = None
    article: str | None = None
    name: str
    emoji: str = "📦"
    price: float
    qty: int
    unit: str = "шт"


class OrderCreate(BaseModel):
    type: str = "market"
    items: list[OrderItemIn]
    client_name: str
    client_phone: str
    address: str
    lat: float = 0
    lng: float = 0
    comment: str = ""
    payment_method: str = "cash"
    restaurant_id: int | None = None


class OrderOut(BaseModel):
    id: int
    code: str
    type: str
    status: str
    client_name: str
    client_phone: str
    address: str
    items: list[Any]
    subtotal: float
    delivery_fee: float
    total: float
    comment: str
    priority: str
    created_at: datetime
    class Config: from_attributes = True


class OrderStatusUpdate(BaseModel):
    status: str


# ════════════════════════════════════════════════
# РЕСТОРАНЫ
# ════════════════════════════════════════════════
class MenuItemOut(BaseModel):
    id: int
    category: str
    emoji: str
    name: str
    description: str
    price: float
    in_stock: bool
    is_popular: bool
    class Config: from_attributes = True


class RestaurantOut(BaseModel):
    id: int
    code: str
    name: str
    emoji: str
    cuisine: str
    address: str
    phone: str
    commission: float
    is_open: bool
    rating: float
    image: str
    menu: list[MenuItemOut] = []
    class Config: from_attributes = True


# ════════════════════════════════════════════════
# КАРТЫ
# ════════════════════════════════════════════════
class CardOut(BaseModel):
    id: int
    number: str
    level: str
    bonus: int
    debt_limit: float
    debt: float
    is_blocked: bool
    class Config: from_attributes = True


# ════════════════════════════════════════════════
# ОТЗЫВЫ
# ════════════════════════════════════════════════
class ReviewIn(BaseModel):
    restaurant_id: int | None = None
    order_id: int | None = None
    rating: int = Field(..., ge=1, le=5)
    text: str = ""


class ReviewOut(BaseModel):
    id: int
    restaurant_id: int | None
    client_name: str
    rating: int
    text: str
    is_read: bool
    created_at: datetime
    class Config: from_attributes = True
