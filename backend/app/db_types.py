"""
app/db_types.py
─────────────────────────────────────────────────────────────
跨数据库兼容 JSON 类型。

  PostgreSQL  → JSONB（二进制 JSON，支持高效索引）
  SQLite      → JSON （文本存储，预览 / 测试用）

用法：在 models.py 中用 FlexJSON 替换 JSONB
  from app.db_types import FlexJSON
  field: Mapped[dict] = mapped_column(FlexJSON)
─────────────────────────────────────────────────────────────
"""
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import TypeDecorator, Text
import json


class FlexJSON(TypeDecorator):
    """
    在 PostgreSQL 上使用 JSONB，在其他数据库（SQLite 等）上使用 JSON 文本。
    对上层代码完全透明——读写均处理为 Python dict/list。
    """
    impl = Text
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())

    def process_bind_param(self, value, dialect):
        # PostgreSQL / JSON 方言自己处理序列化，只在 SQLite fallback 情况下手动序列化
        if dialect.name not in ("postgresql",) and value is not None:
            return json.dumps(value, ensure_ascii=False)
        return value

    def process_result_value(self, value, dialect):
        if dialect.name not in ("postgresql",) and isinstance(value, str):
            try:
                return json.loads(value)
            except (ValueError, TypeError):
                return value
        return value
