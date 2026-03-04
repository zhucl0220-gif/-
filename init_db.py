"""
一次性建表脚本：连接 PostgreSQL，创建全部表
"""
import asyncio
import sys
import os

# 把 backend/ 加入 sys.path
_backend = os.path.join(os.path.dirname(__file__), "backend")
sys.path.insert(0, _backend)
os.chdir(_backend)

# 加载 .env
from dotenv import load_dotenv
load_dotenv(os.path.join(_backend, ".env"))

from sqlalchemy.ext.asyncio import create_async_engine
from app.models.models import Base
from app.config import settings

async def main():
    print("DATABASE_URL =", settings.DATABASE_URL)
    engine = create_async_engine(settings.DATABASE_URL, echo=True)
    async with engine.begin() as conn:
        print("Dropping existing tables (if any)...")
        # await conn.run_sync(Base.metadata.drop_all)   # 危险：会清空数据，注释掉
        print("Creating tables...")
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print("Done. All tables created.")

if __name__ == "__main__":
    asyncio.run(main())
