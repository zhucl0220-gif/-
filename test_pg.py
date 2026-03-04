import asyncio, sys

passwords = ["admin", "postgres", "123456", "root", ""]

async def test(pwd):
    try:
        import asyncpg
        conn = await asyncpg.connect(
            host="127.0.0.1", port=5432,
            user="postgres", password=pwd, database="postgres"
        )
        ver = await conn.fetchval("SELECT version()")
        await conn.close()
        return True, ver
    except Exception as e:
        return False, str(e)

async def main():
    for pwd in passwords:
        ok, msg = await test(pwd)
        if ok:
            print("SUCCESS pwd=" + repr(pwd))
            print("VER=" + str(msg)[:80])
            return pwd
        else:
            print("FAIL pwd=" + repr(pwd) + " err=" + str(msg)[:100])
    return None

if __name__ == "__main__":
    result = asyncio.run(main())
    if result is None:
        print("ALL_FAILED")
        sys.exit(1)
    else:
        print("CORRECT_PASSWORD=" + str(result))
