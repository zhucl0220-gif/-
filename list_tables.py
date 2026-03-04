import asyncio
import asyncpg

async def main():
    conn = await asyncpg.connect(
        host="127.0.0.1", port=5432,
        user="postgres", password="postgres",
        database="livertransplant"
    )
    rows = await conn.fetch(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    )
    print("Tables in livertransplant:")
    for r in rows:
        print(" -", r["tablename"])
    await conn.close()

asyncio.run(main())
