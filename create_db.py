import asyncio
import asyncpg

DB_HOST = "127.0.0.1"
DB_PORT = 5432
DB_USER = "postgres"
DB_PWD  = "postgres"
DB_NAME = "livertransplant"

async def main():
    conn = await asyncpg.connect(
        host=DB_HOST, port=DB_PORT,
        user=DB_USER, password=DB_PWD,
        database="postgres"
    )
    dbs = await conn.fetch(
        "SELECT datname FROM pg_database WHERE datistemplate = false"
    )
    names = [r["datname"] for r in dbs]
    print("existing:" + str(names))
    if DB_NAME not in names:
        await conn.execute(f"CREATE DATABASE {DB_NAME}")
        print("created:" + DB_NAME)
    else:
        print("already_exists:" + DB_NAME)
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
