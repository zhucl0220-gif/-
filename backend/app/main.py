"""
肝移植患者营养全流程管理系统 — FastAPI 应用入口
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
启动命令：
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import engine, Base

# ── 路由（待后续模块实现时逐步注册）──────────────────────────────────────────
# from app.routers import patients, lab_results, nutrition, agent, consent, diet

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# 生命周期：启动 & 关闭
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    应用启动时：
      1. 自动建表（仅开发环境，生产环境改用 Alembic migrate）
      2. 检查数据库连接
    应用关闭时：
      1. 释放数据库连接池
    """
    # ── 启动阶段 ──────────────────────────────────────────────────────────────
    logger.info("🚀 应用启动中...")

    if settings.DEBUG:
        # 开发模式：自动同步模型到数据库（等价于 CREATE TABLE IF NOT EXISTS）
        # 生产环境请注释此段，改用 alembic upgrade head
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("✅ 数据库表已同步（DEBUG 模式）")
        except Exception as db_err:
            logger.warning(
                "⚠️  数据库连接失败，跳过建表（请确保 PostgreSQL 已启动）: %s", db_err
            )

    logger.info(f"🏥 {settings.APP_NAME} v{settings.APP_VERSION} 启动完成")
    logger.info(f"📖 API 文档地址：http://localhost:8000/docs")

    yield  # ← 应用正常运行期间在此暂停

    # ── 关闭阶段 ──────────────────────────────────────────────────────────────
    logger.info("🛑 应用正在关闭，释放连接池...")
    await engine.dispose()
    logger.info("✅ 连接池已释放")


# ══════════════════════════════════════════════════════════════════════════════
# FastAPI 应用实例
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
## 肝移植患者营养全流程管理系统

基于 **Agent-First** 架构，所有业务逻辑封装为可供智能体调用的 API Tools。

### 模块概览
| 模块          | 说明                               |
|---------------|------------------------------------|
| `/patients`   | 患者档案管理，包含阶段流转          |
| `/lab`        | 检验单上传、OCR 解析、AI 分析       |
| `/nutrition`  | 营养方案生成与管理                  |
| `/diet`       | 饮食打卡与依从性评估                |
| `/consent`    | 知情同意书签署与存档                |
| `/agent`      | 智能体任务调度与日志查询            |
| `/tools`      | Agent Tools 直接调用接口（内部使用）|
    """,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)


# ══════════════════════════════════════════════════════════════════════════════
# 中间件
# ══════════════════════════════════════════════════════════════════════════════

# CORS：允许小程序前端和管理后台跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 可信主机防护（生产环境应配置实际域名）
if not settings.DEBUG:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["yourdomain.com", "*.yourdomain.com"],
    )


# ══════════════════════════════════════════════════════════════════════════════
# 静态文件（上传目录）
# ══════════════════════════════════════════════════════════════════════════════

import os
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


# ══════════════════════════════════════════════════════════════════════════════
# 路由注册
# ══════════════════════════════════════════════════════════════════════════════

# ── 已注册模块 ──────────────────────────────────────────────────────────────
from app.api.endpoints.compliance   import router as compliance_router
from app.api.endpoints.agent_tools  import router as agent_tools_router
from app.api.endpoints.agent_query  import router as agent_query_router
from app.api.endpoints.copilot      import router as copilot_router
from app.api.endpoints.patients     import router as patients_router
from app.api.endpoints.lab_results  import router as lab_router
from app.api.endpoints.nutrition    import router as nutrition_router
from app.api.endpoints.diet         import router as diet_router
from app.api.endpoints.screening    import router as screening_router
from app.api.endpoints.messages     import router as messages_router
from app.api.endpoints.followup     import router as followup_router
from app.api.endpoints.medication   import router as medication_router
from app.api.endpoints.plans        import router as plans_router
from app.api.endpoints.assessment   import router as assessment_router
from app.api.endpoints.alerts       import router as alerts_router
from app.api.endpoints.knowledge    import router as knowledge_router
from app.api.endpoints.statistics   import router as statistics_router
from app.api.endpoints.system       import router as system_router
app.include_router(compliance_router,  prefix="/api/v1")
app.include_router(agent_tools_router, prefix="/api/v1")
app.include_router(agent_query_router, prefix="/api/v1")
app.include_router(copilot_router,     prefix="/api/v1")
app.include_router(patients_router,    prefix="/api/v1")
app.include_router(lab_router,         prefix="/api/v1")
app.include_router(nutrition_router,   prefix="/api/v1")
app.include_router(diet_router,        prefix="/api/v1")
app.include_router(screening_router,   prefix="/api/v1")
app.include_router(messages_router,    prefix="/api/v1")
app.include_router(followup_router,    prefix="/api/v1")
app.include_router(medication_router,  prefix="/api/v1")
app.include_router(plans_router,       prefix="/api/v1")
app.include_router(assessment_router,  prefix="/api/v1")
app.include_router(alerts_router,      prefix="/api/v1")
app.include_router(knowledge_router,   prefix="/api/v1")
app.include_router(statistics_router,  prefix="/api/v1")
app.include_router(system_router,      prefix="/api/v1")

# TODO: 后续每完成一个模块路由，解除以下对应注释
# app.include_router(patients.router, prefix="/api/v1/patients", tags=["患者档案"])
# app.include_router(lab_results.router, prefix="/api/v1/lab",    tags=["检验结果"])
# app.include_router(nutrition.router,  prefix="/api/v1/nutrition", tags=["营养方案"])
# app.include_router(diet.router,       prefix="/api/v1/diet",    tags=["饮食打卡"])
# app.include_router(agent.router,      prefix="/api/v1/agent",   tags=["智能体"])


# ══════════════════════════════════════════════════════════════════════════════
# 健康检查端点
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/health", tags=["系统"], summary="健康检查")
async def health_check():
    """
    返回服务健康状态。
    可用于 Docker/K8s 存活探针（liveness probe）。
    """
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }


@app.get("/", tags=["系统"], summary="根路径")
async def root():
    return {
        "message": f"欢迎使用 {settings.APP_NAME}",
        "docs": "/docs",
        "version": settings.APP_VERSION,
    }


@app.get("/debug/routes", tags=["系统"], summary="调试路由列表")
async def debug_routes():
    routes = []
    for r in app.routes:
        if hasattr(r, "path") and hasattr(r, "methods"):
            routes.append({"path": r.path, "methods": list(r.methods or [])})
    return {"total": len(routes), "routes": [r for r in routes if "diet" in r["path"]]}
