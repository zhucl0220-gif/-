"""
start.py — 后端启动入口（解决 cwd 路径问题）
运行方式：python start.py
"""
import sys
import os

# 确保 backend 目录在 sys.path 最前面
_backend_dir = os.path.dirname(os.path.abspath(__file__))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

os.chdir(_backend_dir)   # 将工作目录切换到 backend/

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=[_backend_dir],
        log_level="info",
    )
