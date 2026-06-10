import json
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DB_PATH = Path(__file__).resolve().parent / "kakapo.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def json_load(raw: str | None, default=None):
    if not raw:
        return default if default is not None else {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default if default is not None else {}


def json_dump(data) -> str:
    return json.dumps(data, ensure_ascii=False)
