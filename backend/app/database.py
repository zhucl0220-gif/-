"""
数据库连接模块
使用 SQLAlchemy 2.x 异步引擎
  PostgreSQL  → asyncpg 驱动（生产）
  SQLite      → aiosqlite 驱动（预览 / 开发）
"""
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# ── 引擎参数：SQLite 不支持连接池配置 ────────────────────────────────────────
_is_sqlite = settings.DATABASE_URL.startswith("sqlite")
_engine_kwargs = (
    {"connect_args": {"check_same_thread": False}}
    if _is_sqlite
    else {"pool_size": 10, "max_overflow": 20, "pool_pre_ping": True}
)

# ── 异步引擎 ────────────────────────────────────────────────────────────────
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    **_engine_kwargs,
)

# ── Session 工厂 ────────────────────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,      # 提交后模型实例仍可访问属性
    autocommit=False,
    autoflush=False,
)


# ── ORM Base ────────────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    """所有 ORM 模型的基类"""
    pass


# ── FastAPI 依赖注入 ─────────────────────────────────────────────────────────
async def get_db() -> AsyncSession:
    """
    Yield 一个数据库 Session，请求结束后自动关闭。
    在 FastAPI 路由中使用:  db: AsyncSession = Depends(get_db)
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
