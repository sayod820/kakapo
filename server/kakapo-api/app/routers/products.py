"""
KAKAPO Backend — товары и категории (формат фронтенда)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import require_admin
from app.models import Product, Category, User
from app.schemas import ProductIn, ProductUpdate, CategoryIn
from app.serializers import product_to_frontend

router = APIRouter(tags=["Товары"])


@router.get("/products")
async def list_products(
    category_id: int | None = Query(None),
    search: str | None = Query(None),
    hot: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(Product).options(
        selectinload(Product.category).selectinload(Category.parent)
    ).where(Product.is_active == True)
    if category_id:
        sub = await db.execute(select(Category.id).where(Category.parent_id == category_id))
        sub_ids = [r[0] for r in sub.all()]
        ids = [category_id] + sub_ids
        q = q.where(Product.category_id.in_(ids))
    if search:
        q = q.where(Product.name.ilike(f"%{search}%"))
    if hot is not None:
        q = q.where(Product.is_hot == hot)
    result = await db.execute(q)
    return [product_to_frontend(p) for p in result.scalars().all()]


@router.get("/products/{product_id}")
async def get_product(product_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Product).options(
            selectinload(Product.category).selectinload(Category.parent)
        ).where(Product.id == product_id)
    )
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Товар не найден")
    return product_to_frontend(p)


@router.post("/products")
async def create_product(data: ProductIn, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    article = data.article or data.art
    if not article:
        raise HTTPException(400, "Артикул обязателен")
    p = Product(
        article=article,
        name=data.name,
        emoji=data.e or data.emoji,
        price=data.price,
        old_price=data.old_price if data.old_price is not None else data.old,
        unit=data.unit,
        stock=data.stock,
        category_id=data.category_id,
        is_hot=data.hot if data.hot is not None else data.is_hot,
        is_organic=data.organic if data.organic is not None else data.is_organic,
        image_url=data.photo or data.image_url or "",
    )
    db.add(p)
    await db.flush()
    result = await db.execute(
        select(Product).options(selectinload(Product.category).selectinload(Category.parent)).where(Product.id == p.id)
    )
    p = result.scalar_one()
    return product_to_frontend(p)


@router.patch("/products/{product_id}")
async def update_product(product_id: int, data: ProductUpdate, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(Product).where(Product.id == product_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Товар не найден")
    patch = data.model_dump(exclude_none=True)
    if patch.get("photo"):
        patch["image_url"] = patch.pop("photo")
    for k, v in patch.items():
        setattr(p, k, v)
    await db.flush()
    await db.refresh(p, ["category"])
    return product_to_frontend(p)


@router.delete("/products/{product_id}")
async def delete_product(product_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(Product).where(Product.id == product_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Товар не найден")
    p.is_active = False
    await db.flush()
    return {"ok": True}


@router.get("/categories")
async def list_categories(parent_id: int | None = Query(None), db: AsyncSession = Depends(get_db)):
    q = select(Category).where(Category.is_active == True).order_by(Category.sort_order)
    if parent_id is not None:
        q = q.where(Category.parent_id == parent_id)
    result = await db.execute(q)
    cats = result.scalars().all()
    return [{"id": c.id, "slug": c.slug, "name": c.name, "emoji": c.emoji, "parent_id": c.parent_id} for c in cats]


@router.get("/categories/tree")
async def categories_tree(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Category).where(Category.is_active == True).order_by(Category.sort_order))
    cats = result.scalars().all()
    parents = [c for c in cats if c.parent_id is None]
    tree = []
    for p in parents:
        children = [
            {"id": c.id, "slug": c.slug, "name": c.name, "emoji": c.emoji}
            for c in cats if c.parent_id == p.id
        ]
        tree.append({
            "id": p.id, "slug": p.slug, "name": p.name, "emoji": p.emoji,
            "children": children,
        })
    return tree


@router.post("/categories")
async def create_category(data: CategoryIn, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    c = Category(**data.model_dump())
    db.add(c)
    await db.flush()
    return {"id": c.id, "slug": c.slug, "name": c.name, "emoji": c.emoji}


@router.delete("/categories/{category_id}")
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    result = await db.execute(select(Category).where(Category.id == category_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Категория не найдена")
    children = await db.execute(select(Category).where(Category.parent_id == category_id))
    for child in children.scalars().all():
        child.is_active = False
    c.is_active = False
    await db.flush()
    return {"ok": True}
