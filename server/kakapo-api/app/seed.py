"""
KAKAPO Backend — начальные данные (синхрон с фронтендом lib/data.ts + lib/pickups.ts)
"""
from sqlalchemy import select, func
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.core.config import settings
from app.models import (
    User, UserRole, Restaurant, MenuItem, Category, Product,
    PickupPoint, AppSetting, Order, OrderStatus, OrderType,
)
from app.routers.settings_router import DEFAULT_PRICING


async def seed_database():
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(func.count(User.id)))
            if (result.scalar() or 0) > 0:
                return

            if not settings.ADMIN_PASSWORD:
                print("WARNING: ADMIN_PASSWORD not set — admin skipped")
                return

            admin = User(
                phone=settings.ADMIN_PHONE, name=settings.ADMIN_NAME, email=settings.ADMIN_EMAIL,
                role=UserRole.admin, password_hash=hash_password(settings.ADMIN_PASSWORD),
            )
            db.add(admin)

            cats_data = [
                ("veg", "Овощи и фрукты", "🥦", 1),
                ("meat", "Мясо и птица", "🥩", 2),
                ("dairy", "Молочное", "🥛", 3),
                ("bread", "Выпечка и хлеб", "🥐", 4),
                ("drinks", "Напитки", "🧃", 5),
                ("sweets", "Сладости", "🍫", 6),
            ]
            cat_map: dict[str, int] = {}
            for slug, name, emoji, order in cats_data:
                c = Category(slug=slug, name=name, emoji=emoji, sort_order=order)
                db.add(c)
                await db.flush()
                cat_map[slug] = c.id

            subcats = [
                ("veg_ov", "Овощи", "🥕", "veg"),
                ("veg_fr", "Фрукты", "🍊", "veg"),
                ("meat_b", "Говядина", "🥩", "meat"),
                ("meat_p", "Птица", "🍗", "meat"),
                ("dairy_m", "Молоко", "🥛", "dairy"),
                ("dairy_s", "Сыры", "🧀", "dairy"),
                ("dairy_e", "Яйцо", "🥚", "dairy"),
            ]
            for slug, name, emoji, parent_slug in subcats:
                c = Category(slug=slug, name=name, emoji=emoji, parent_id=cat_map[parent_slug])
                db.add(c)
                await db.flush()
                cat_map[slug] = c.id

            products = [
                ("KAK-0001", "🥦", "Брокколи свежая", 5.50, 7.20, "500 гр", 8, "veg_ov", True, True),
                ("KAK-0002", "🍅", "Томаты черри", 7.90, None, "400 гр", 3, "veg_ov", False, False),
                ("KAK-0003", "🍊", "Апельсины Навел", 6.50, 8.90, "1 кг", 15, "veg_fr", True, False),
                ("KAK-0004", "🥩", "Говядина вырезка", 38.0, 47.0, "500 гр", 5, "meat_b", True, False),
                ("KAK-0005", "🍗", "Куриное филе", 16.5, None, "1 кг", 12, "meat_p", True, False),
                ("KAK-0006", "🥛", "Молоко 3.2%", 4.90, None, "1 л", 0, "dairy_m", False, False),
                ("KAK-0007", "🧀", "Сыр Российский", 18.5, None, "250 гр", 7, "dairy_s", True, False),
                ("KAK-0008", "🥐", "Круассан с шоколадом", 2.50, None, "1 шт", 2, "bread", True, False),
                ("KAK-0009", "🥚", "Яйца С1", 8.90, None, "10 шт", 15, "dairy_e", True, False),
                ("KAK-0010", "☕", "Кофе Nescafé Gold", 28.0, 34.0, "190 гр", 7, "drinks", True, False),
                ("KAK-0011", "🧃", "Сок апельсиновый", 6.80, None, "1 л", 18, "drinks", False, False),
                ("KAK-0012", "🍫", "Шоколад Milka", 6.50, 8.0, "90 гр", 10, "sweets", True, False),
            ]
            for art, emoji, name, price, old, unit, stock, cat_slug, hot, organic in products:
                db.add(Product(
                    article=art, name=name, emoji=emoji, price=price, old_price=old,
                    unit=unit, stock=stock, category_id=cat_map.get(cat_slug),
                    is_hot=hot, is_organic=organic,
                ))

            rests = [
                ("R-01", "Чайхона Оромгох", "🍖", "Таджикская", "ул. Рудаки, 15",
                 "+992 93 111 22 33", "chaihona@kakapo.tj", 15, 4.8, 312, 187, 8450,
                 38.3320, 69.0150, "linear-gradient(135deg,#2A1506,#4A2A0C)", [
                     ("Горячее", "🍚", "Плов узбекский", "Рис, мясо, морковь", 18, True, True),
                     ("Шашлык", "🥩", "Шашлык говяжий", "Говядина на углях", 22, True, True),
                     ("Супы", "🍲", "Шурпо", "Суп из баранины", 12, True, True),
                     ("Супы", "🍜", "Лагман", "Лапша с мясом", 14, False, True),
                     ("Горячее", "🥟", "Манты", "6 шт, говядина+лук", 16, True, True),
                 ]),
                ("R-02", "Пицца Яван", "🍕", "Итальянская", "ул. Ленина, 28",
                 "+992 90 222 33 44", "pizza@kakapo.tj", 18, 4.6, 187, 143, 6240,
                 38.3230, 69.0300, "linear-gradient(135deg,#1A0808,#3A1010)", [
                     ("Пицца", "🍕", "Маргарита", "Томат, моцарелла", 28, True, True),
                     ("Пицца", "🍕", "Пепперони", "Томат, пепперони", 32, True, True),
                     ("Бургеры", "🍔", "Классик бургер", "Котлета 150г", 22, True, False),
                 ]),
                ("R-03", "Суши Яван", "🍣", "Японская", "ул. Сомони, 8",
                 "+992 91 333 44 55", "sushi@kakapo.tj", 20, 4.9, 94, 98, 5390,
                 38.3150, 69.0320, "linear-gradient(135deg,#0A0A1A,#1A1A3A)", [
                     ("Роллы", "🌯", "Филадельфия", "Лосось, авокадо", 32, True, True),
                     ("Роллы", "🌯", "Дракон", "Угорь, авокадо", 36, True, True),
                 ]),
                ("R-04", "Фаст-фуд 24/7", "🍟", "Фаст-фуд", "Центральный рынок",
                 "+992 88 444 55 66", "fastfood@kakapo.tj", 12, 4.3, 521, 312, 4120,
                 38.3280, 69.0200, "linear-gradient(135deg,#1A1000,#3A2200)", [
                     ("Бургеры", "🍔", "Двойной бургер", "2 котлеты, сыр", 16, True, True),
                     ("Хот-доги", "🌭", "Хот-дог", "Сосиска, горчица", 8, True, True),
                 ]),
            ]
            rest_pass_hash = (
                hash_password(settings.RESTAURANT_DEFAULT_PASSWORD)
                if settings.RESTAURANT_DEFAULT_PASSWORD else None
            )
            for code, name, emoji, cuisine, addr, phone, email, comm, rating, reviews, orders_m, rev_m, lat, lng, img, menu in rests:
                r = Restaurant(
                    code=code, name=name, emoji=emoji, cuisine=cuisine, address=addr,
                    phone=phone, email=email, commission=comm, rating=rating,
                    reviews_count=reviews, orders_month=orders_m, revenue_month=rev_m,
                    lat=lat, lng=lng, image=img, is_open=code != "R-04",
                    password_hash=rest_pass_hash,
                )
                db.add(r)
                await db.flush()
                for cat, e, mname, desc, price, in_stock, popular in menu:
                    db.add(MenuItem(
                        restaurant_id=r.id, category=cat, emoji=e, name=mname,
                        description=desc, price=price, in_stock=in_stock, is_popular=popular,
                    ))

            pickups = [
                ("store", "store", "🏪", "#1FD760", "KAKAPO Магазин", "ул. Ленина, 42", "+992 11 855-97-97", 38.3250, 69.0250, True, 0, None),
                ("rest1", "rest", "🍖", "#FF8C00", "Чайхона Оромгох", "ул. Рудаки, 15", "+992 93 111-22-33", 38.3320, 69.0150, True, 1, "R-01"),
                ("rest2", "rest", "🍕", "#FF4545", "Пицца Яван", "ул. Ленина, 28", "+992 90 222-33-44", 38.3230, 69.0300, True, 2, "R-02"),
                ("rest3", "rest", "🍣", "#3B8EF0", "Суши Яван", "ул. Сомони, 8", "+992 91 333-44-55", 38.3150, 69.0320, True, 3, "R-03"),
                ("rest4", "rest", "🍟", "#FFB800", "Фаст-фуд 24/7", "Центральный рынок", "+992 88 444-55-66", 38.3280, 69.0200, False, 4, "R-04"),
            ]
            for code, ptype, emoji, color, name, addr, phone, lat, lng, active, sort, rest_code in pickups:
                db.add(PickupPoint(
                    code=code, type=ptype, emoji=emoji, color=color, name=name,
                    address=addr, phone=phone, lat=lat, lng=lng, is_active=active,
                    sort_order=sort, restaurant_code=rest_code,
                ))

            db.add(AppSetting(key="pricing", value=dict(DEFAULT_PRICING)))

            demo_orders = [
                Order(
                    code="K-4832", type=OrderType.market, status=OrderStatus.assembling,
                    client_name="Диловар Рахимов", client_phone="+992 93 456 78 90",
                    address="ул. Ленина, 42, кв. 15", priority="urgent",
                    courier_meta={"name": "Фирдавс Назаров", "phone": "+992 93 111 22 33"},
                    assembler_meta={"name": "Камола Юсупова"},
                    pickup_ids=["store"],
                    items=[
                        {"id": 1, "art": "KAK-0001", "e": "🥦", "name": "Брокколи свежая", "qty": 2, "unit": "500 гр", "price": 5.50, "done": False},
                        {"id": 2, "art": "KAK-0006", "e": "🥛", "name": "Молоко 3.2%", "qty": 3, "unit": "1 л", "price": 4.90, "done": False},
                        {"id": 3, "art": "KAK-0007", "e": "🧀", "name": "Сыр Российский", "qty": 1, "unit": "250 гр", "price": 18.5, "done": False},
                    ],
                    subtotal=64.30, delivery_fee=0, total=64.30,
                ),
                Order(
                    code="K-4831", type=OrderType.restaurant, status=OrderStatus.cooking,
                    client_name="Нилуфар Хасанова", client_phone="+992 90 123 45 67",
                    address="ул. Сомони, 12", rest_code="R-01", rest_name="Чайхона Оромгох",
                    pickup_ids=["rest1"],
                    courier_meta={"name": "Рустам Холов", "phone": "+992 91 333 44 55"},
                    items=[
                        {"id": 1, "e": "🍜", "name": "Лагман", "qty": 1, "unit": "порция", "price": 14},
                        {"id": 2, "e": "🥗", "name": "Ачик-чучук", "qty": 1, "unit": "порция", "price": 8},
                    ],
                    subtotal=22, delivery_fee=0, total=22,
                ),
            ]
            for o in demo_orders:
                db.add(o)

            await db.commit()
            print("Database seeded")
    except Exception as e:
        print(f"WARNING: seed failed: {e}")
