from datetime import datetime

from sqlalchemy.orm import Session

from db import json_dump
from models import (
    CardRow,
    CategoryRow,
    OrderRow,
    PickupRow,
    ProductRow,
    RestaurantRow,
    ReviewRow,
    SettingRow,
    UserRow,
    order_from_payload,
)

PRODUCTS = [
    {"id": 1, "art": "KAK-0001", "e": "🥦", "name": "Брокколи свежая", "price": 5.50, "old": 7.20, "cat": "Овощи", "catId": "veg", "unit": "500 гр", "stock": 8, "hot": True, "organic": True, "discount": 24},
    {"id": 2, "art": "KAK-0002", "e": "🍅", "name": "Томаты черри", "price": 7.90, "old": None, "cat": "Овощи", "catId": "veg", "unit": "400 гр", "stock": 3, "hot": False, "organic": False, "discount": 0},
    {"id": 3, "art": "KAK-0003", "e": "🍊", "name": "Апельсины Навел", "price": 6.50, "old": 8.90, "cat": "Фрукты", "catId": "veg", "unit": "1 кг", "stock": 15, "hot": True, "organic": False, "discount": 27},
    {"id": 4, "art": "KAK-0004", "e": "🥩", "name": "Говядина вырезка", "price": 38.0, "old": 47.0, "cat": "Мясо", "catId": "meat", "unit": "500 гр", "stock": 5, "hot": True, "organic": False, "discount": 19},
    {"id": 5, "art": "KAK-0005", "e": "🍗", "name": "Куриное филе", "price": 16.5, "old": None, "cat": "Мясо", "catId": "meat", "unit": "1 кг", "stock": 12, "hot": True, "organic": False, "discount": 0},
    {"id": 6, "art": "KAK-0006", "e": "🥛", "name": "Молоко 3.2%", "price": 4.90, "old": None, "cat": "Молочное", "catId": "dairy", "unit": "1 л", "stock": 0, "hot": False, "organic": False, "discount": 0},
    {"id": 7, "art": "KAK-0007", "e": "🧀", "name": "Сыр Российский", "price": 18.5, "old": None, "cat": "Молочное", "catId": "dairy", "unit": "250 гр", "stock": 7, "hot": True, "organic": False, "discount": 0},
    {"id": 8, "art": "KAK-0008", "e": "🥐", "name": "Круассан с шоколадом", "price": 2.50, "old": None, "cat": "Выпечка", "catId": "bread", "unit": "1 шт", "stock": 2, "hot": True, "organic": False, "discount": 0},
    {"id": 9, "art": "KAK-0009", "e": "🥚", "name": "Яйца С1", "price": 8.90, "old": None, "cat": "Молочное", "catId": "dairy", "unit": "10 шт", "stock": 15, "hot": True, "organic": False, "discount": 0},
    {"id": 10, "art": "KAK-0010", "e": "☕", "name": "Кофе Nescafé Gold", "price": 28.0, "old": 34.0, "cat": "Напитки", "catId": "drinks", "unit": "190 гр", "stock": 7, "hot": True, "organic": False, "discount": 18},
    {"id": 11, "art": "KAK-0011", "e": "🧃", "name": "Сок апельсиновый", "price": 6.80, "old": None, "cat": "Напитки", "catId": "drinks", "unit": "1 л", "stock": 18, "hot": False, "organic": False, "discount": 0},
    {"id": 12, "art": "KAK-0012", "e": "🍫", "name": "Шоколад Milka", "price": 6.50, "old": 8.0, "cat": "Сладости", "catId": "sweets", "unit": "90 гр", "stock": 10, "hot": True, "organic": False, "discount": 19},
]

RESTAURANTS = [
    {"id": "R-01", "name": "Чайхона Оромгох", "emoji": "🍖", "cuisine": "Таджикская", "address": "ул. Рудаки, 15", "phone": "+992 93 111 22 33", "email": "chaihona@kakapo.tj", "commission": 15, "open": True, "rating": 4.8, "reviews": 312, "ordersMonth": 187, "revenueMonth": 8450, "img": "linear-gradient(135deg,#2A1506,#4A2A0C)", "menu": [
        {"id": 1, "cat": "Горячее", "e": "🍚", "name": "Плов узбекский", "desc": "Рис, мясо, морковь", "price": 18, "inStock": True, "popular": True},
        {"id": 2, "cat": "Шашлык", "e": "🥩", "name": "Шашлык говяжий", "desc": "Говядина на углях", "price": 22, "inStock": True, "popular": True},
        {"id": 3, "cat": "Супы", "e": "🍲", "name": "Шурпо", "desc": "Суп из баранины", "price": 12, "inStock": True, "popular": True},
        {"id": 5, "cat": "Горячее", "e": "🥟", "name": "Манты", "desc": "6 шт", "price": 16, "inStock": True, "popular": True},
    ]},
    {"id": "R-02", "name": "Пицца Яван", "emoji": "🍕", "cuisine": "Итальянская", "address": "ул. Ленина, 28", "phone": "+992 90 222 33 44", "email": "pizza@kakapo.tj", "commission": 18, "open": True, "rating": 4.6, "reviews": 187, "ordersMonth": 143, "revenueMonth": 6240, "img": "linear-gradient(135deg,#1A0808,#3A1010)", "menu": [
        {"id": 1, "cat": "Пицца", "e": "🍕", "name": "Маргарита", "price": 28, "inStock": True, "popular": True},
        {"id": 2, "cat": "Пицца", "e": "🍕", "name": "Пепперони", "price": 32, "inStock": True, "popular": True},
    ]},
    {"id": "R-03", "name": "Суши Яван", "emoji": "🍣", "cuisine": "Японская", "address": "ул. Сомони, 8", "phone": "+992 91 333 44 55", "email": "sushi@kakapo.tj", "commission": 20, "open": True, "rating": 4.9, "reviews": 94, "ordersMonth": 98, "revenueMonth": 5390, "img": "linear-gradient(135deg,#0A0A1A,#1A1A3A)", "menu": [
        {"id": 1, "cat": "Роллы", "e": "🌯", "name": "Филадельфия", "price": 32, "inStock": True, "popular": True},
    ]},
    {"id": "R-04", "name": "Фаст-фуд 24/7", "emoji": "🍟", "cuisine": "Фаст-фуд", "address": "Центральный рынок", "phone": "+992 88 444 55 66", "email": "fastfood@kakapo.tj", "commission": 12, "open": False, "rating": 4.3, "reviews": 521, "ordersMonth": 312, "revenueMonth": 4120, "img": "linear-gradient(135deg,#1A1000,#3A2200)", "menu": [
        {"id": 1, "cat": "Бургеры", "e": "🍔", "name": "Двойной бургер", "price": 16, "inStock": True, "popular": True},
    ]},
]

PICKUPS = [
    {"id": "store", "type": "store", "e": "🏪", "color": "#1FD760", "name": "КАКАПО Магазин", "addr": "ул. Ленина, 42", "phone": "+992 11 855-97-97", "lat": 38.3250, "lng": 69.0250, "active": True},
    {"id": "rest1", "type": "rest", "e": "🍖", "color": "#FF8C00", "name": "Чайхона Оромгох", "addr": "ул. Рудаки, 15", "phone": "+992 93 111-22-33", "lat": 38.3320, "lng": 69.0150, "active": True},
    {"id": "rest2", "type": "rest", "e": "🍕", "color": "#FF4545", "name": "Пицца Яван", "addr": "ул. Ленина, 28", "phone": "+992 90 222-33-44", "lat": 38.3230, "lng": 69.0300, "active": True},
    {"id": "rest3", "type": "rest", "e": "🍣", "color": "#3B8EF0", "name": "Суши Яван", "addr": "ул. Сомони, 8", "phone": "+992 91 333-44-55", "lat": 38.3150, "lng": 69.0320, "active": True},
    {"id": "rest4", "type": "rest", "e": "🍟", "color": "#FFB800", "name": "Фаст-фуд 24/7", "addr": "Центральный рынок", "phone": "+992 88 444-55-66", "lat": 38.3280, "lng": 69.0200, "active": False},
]

PRICING = {"base": 10, "baseDist": 2.5, "perKm": 3, "heavyKg": 50, "heavyExtra": 10, "freeFrom": 0}

INITIAL_ORDERS = [
    {"id": "K-4832", "type": "market", "status": "assembling", "createdAt": "14:23", "priority": "urgent", "client": {"name": "Диловар Рахимов", "phone": "+992 93 456 78 90", "addr": "ул. Ленина, 42"}, "courier": {"name": "Фирдавс Назаров", "phone": "+992 93 111 22 33"}, "assembler": {"name": "Камола Юсупова"}, "total": 64.30, "comment": "Побыстрее", "items": [{"id": 1, "art": "KAK-0001", "e": "🥦", "name": "Брокколи", "qty": 2, "unit": "500 гр", "price": 5.50, "source": "market"}]},
    {"id": "K-4831", "type": "restaurant", "status": "cooking", "createdAt": "14:10", "restId": "R-01", "restName": "Чайхона Оромгох", "client": {"name": "Нилуфар", "phone": "+992 90 123 45 67", "addr": "ул. Сомони, 12"}, "total": 22, "items": [{"id": 1, "e": "🍜", "name": "Лагман", "qty": 1, "unit": "порция", "price": 14, "source": "restaurant", "restId": "R-01"}]},
]


def seed_if_empty(db: Session) -> None:
    if db.query(ProductRow).count() > 0:
        return

    for p in PRODUCTS:
        db.add(ProductRow(
            id=p["id"], art=p["art"], e=p["e"], name=p["name"], price=p["price"],
            old=p.get("old"), cat=p["cat"], cat_id=p["catId"], unit=p["unit"],
            stock=p["stock"], hot=p["hot"], organic=p.get("organic", False), discount=p.get("discount", 0),
        ))

    for r in RESTAURANTS:
        db.add(RestaurantRow(id=r["id"], data_json=json_dump(r)))

    for p in PICKUPS:
        db.add(PickupRow(id=p["id"], data_json=json_dump(p)))

    db.add(SettingRow(key="pricing", value_json=json_dump(PRICING)))

    users = [
        UserRow(email="admin@kakapo.tj", password="admin123", role="admin", name="Админ КАКАПО"),
        UserRow(email="chaihona@kakapo.tj", password="rest123", role="restaurant", name="Чайхона"),
        UserRow(email="pizza@kakapo.tj", password="rest123", role="restaurant", name="Пицца Яван"),
        UserRow(phone="+992900000000", password="", role="client", name="Клиент"),
        UserRow(phone="+992910000000", password="", role="courier", name="Курьер"),
    ]
    db.add_all(users)

    cats = [
        CategoryRow(id=1, name="Овощи и фрукты", slug="veg", parent_id=None),
        CategoryRow(id=2, name="Мясо", slug="meat", parent_id=None),
        CategoryRow(id=3, name="Молочное", slug="dairy", parent_id=None),
    ]
    db.add_all(cats)

    cards = [
        {"num": "КАКАПО-0001", "client": "Диловар Рахимов", "status": "active", "level": "platinum", "bonus": 4850},
        {"num": "КАКАПО-0042", "client": "Нилуфар Хасанова", "status": "active", "level": "gold", "bonus": 1240},
    ]
    for c in cards:
        db.add(CardRow(num=c["num"], data_json=json_dump(c)))

    now = datetime.now().strftime("%H:%M")
    for o in INITIAL_ORDERS:
        row = order_from_payload(o, o["id"], o.get("createdAt") or now)
        row.status = o.get("status", "new")
        if o.get("courier"):
            row.courier_json = json_dump(o["courier"])
        if o.get("assembler"):
            row.assembler_json = json_dump(o["assembler"])
        db.add(row)

    db.commit()


def next_order_id(db: Session) -> str:
    rows = db.query(OrderRow.id).all()
    nums = []
    for (oid,) in rows:
        if oid.startswith("K-"):
            try:
                nums.append(int(oid.replace("K-", "")))
            except ValueError:
                pass
    n = max(nums) + 1 if nums else 4833
    return f"K-{n}"
