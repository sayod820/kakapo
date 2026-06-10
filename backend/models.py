from sqlalchemy import Boolean, Column, Float, Integer, String, Text

from db import Base, json_dump, json_load


class ProductRow(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True)
    art = Column(String, nullable=False)
    e = Column(String, default="📦")
    name = Column(String, nullable=False)
    price = Column(Float, nullable=False)
    old = Column(Float, nullable=True)
    cat = Column(String, default="")
    cat_id = Column(String, default="")
    unit = Column(String, default="шт")
    stock = Column(Integer, default=0)
    hot = Column(Boolean, default=False)
    organic = Column(Boolean, default=False)
    discount = Column(Integer, default=0)
    photo = Column(String, nullable=True)


class RestaurantRow(Base):
    __tablename__ = "restaurants"
    id = Column(String, primary_key=True)
    data_json = Column(Text, nullable=False)


class OrderRow(Base):
    __tablename__ = "orders"
    id = Column(String, primary_key=True)
    type = Column(String, nullable=False)
    status = Column(String, default="new")
    created_at = Column(String, default="")
    total = Column(Float, default=0)
    delivery_fee = Column(Float, default=0)
    comment = Column(Text, default="")
    priority = Column(String, default="normal")
    rest_id = Column(String, nullable=True)
    rest_name = Column(String, nullable=True)
    client_json = Column(Text, default="{}")
    items_json = Column(Text, default="[]")
    extra_json = Column(Text, default="{}")
    courier_json = Column(Text, nullable=True)
    assembler_json = Column(Text, nullable=True)


class PickupRow(Base):
    __tablename__ = "pickups"
    id = Column(String, primary_key=True)
    data_json = Column(Text, nullable=False)


class SettingRow(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True)
    value_json = Column(Text, nullable=False)


class UserRow(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String, unique=True, nullable=True)
    phone = Column(String, unique=True, nullable=True)
    password = Column(String, default="")
    role = Column(String, default="client")
    name = Column(String, default="")


class CardRow(Base):
    __tablename__ = "cards"
    num = Column(String, primary_key=True)
    data_json = Column(Text, nullable=False)


class ReviewRow(Base):
    __tablename__ = "reviews"
    id = Column(Integer, primary_key=True, autoincrement=True)
    data_json = Column(Text, nullable=False)


class CategoryRow(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    parent_id = Column(Integer, nullable=True)
    slug = Column(String, default="")


def product_to_dict(row: ProductRow) -> dict:
    return {
        "id": row.id,
        "art": row.art,
        "e": row.e,
        "name": row.name,
        "price": row.price,
        "old": row.old,
        "cat": row.cat,
        "catId": row.cat_id,
        "unit": row.unit,
        "stock": row.stock,
        "hot": row.hot,
        "organic": row.organic,
        "discount": row.discount,
        "photo": row.photo,
    }


def order_to_dict(row: OrderRow) -> dict:
    extra = json_load(row.extra_json, {})
    order = {
        "id": row.id,
        "type": row.type,
        "status": row.status,
        "createdAt": row.created_at,
        "total": row.total,
        "deliveryFee": row.delivery_fee,
        "comment": row.comment or "",
        "priority": row.priority or "normal",
        "client": json_load(row.client_json, {"name": "", "phone": "", "addr": ""}),
        "items": json_load(row.items_json, []),
        "restId": row.rest_id,
        "restName": row.rest_name,
    }
    if row.courier_json:
        order["courier"] = json_load(row.courier_json)
    if row.assembler_json:
        order["assembler"] = json_load(row.assembler_json)
    for key in ("pickupIds", "restIds", "marketStatus", "restParts", "distanceKm", "durationMin", "weightKg"):
        if key in extra:
            order[key] = extra[key]
    return order


def order_from_payload(data: dict, order_id: str, created_at: str) -> OrderRow:
    client = data.get("client") or {
        "name": data.get("client_name", ""),
        "phone": data.get("client_phone", ""),
        "addr": data.get("address", ""),
        "lat": data.get("lat", 0),
        "lng": data.get("lng", 0),
    }
    extra = {}
    for key in ("pickupIds", "restIds", "marketStatus", "restParts", "distanceKm", "durationMin", "weightKg"):
        if data.get(key) is not None:
            extra[key] = data[key]
    otype = data.get("type") or "market"
    if otype == "mixed" and not extra.get("marketStatus"):
        extra["marketStatus"] = "new"
    if otype == "mixed" and not extra.get("restParts") and data.get("restIds"):
        extra["restParts"] = {rid: "new" for rid in data["restIds"]}
    return OrderRow(
        id=order_id,
        type=otype,
        status="new",
        created_at=created_at,
        total=float(data.get("total") or 0),
        delivery_fee=float(data.get("deliveryFee") or data.get("delivery_fee") or 0),
        comment=str(data.get("comment") or ""),
        priority=str(data.get("priority") or "normal"),
        rest_id=data.get("restId"),
        rest_name=data.get("restName"),
        client_json=json_dump(client),
        items_json=json_dump(data.get("items") or []),
        extra_json=json_dump(extra),
        courier_json=None,
        assembler_json=None,
    )
