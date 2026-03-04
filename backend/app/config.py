"""
应用配置模块
使用 pydantic-settings 从环境变量读取配置
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── 应用基础 ──────────────────────────────────────────
    APP_NAME: str = "肝移植患者营养全流程管理系统"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # ── 数据库 ────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/liver_nutrition"

    # ── JWT 认证 ──────────────────────────────────────────
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 小时

    # ── 文件存储 ──────────────────────────────────────────
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE_MB: int = 20

    # ── AI / LLM ──────────────────────────────────────────
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    LLM_MODEL: str = "gpt-4o"

    # ── OCR ───────────────────────────────────────────────
    OCR_ENGINE: str = "paddleocr"  # paddleocr | tesseract | cloud

    # ── WebSearch ─────────────────────────────────────────
    # 搜索引擎选择：serper | google | mock
    SEARCH_ENGINE:      str = "mock"            # 开发默认 mock，生产改为 serper
    SERPER_API_KEY:     str = ""                # https://serper.dev
    GOOGLE_CSE_API_KEY: str = ""               # Google Custom Search API Key
    GOOGLE_CSE_ID:      str = ""               # Google Programmable Search Engine ID

    # ── Python 沙箱 ───────────────────────────────────────
    SANDBOX_MODE:         str = "exec"         # exec(dev) | docker(prod)
    SANDBOX_TIMEOUT_SEC:  int = 30             # 默认执行超时
    SANDBOX_DOCKER_IMAGE: str = "python:3.12-slim"  # 生产沙箱镜像

    # ── CORS ─────────────────────────────────────────────
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """单例配置，整个应用复用同一实例"""
    return Settings()


settings = get_settings()
