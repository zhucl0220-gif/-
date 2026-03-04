"""
app/api/endpoints/copilot.py
══════════════════════════════════════════════════════════════════════════════
POST /api/v1/agent/copilot   全局 AI Copilot 对话接口（SSE 流式响应）

请求体：
  {
    "messages": [
      {"role": "user",      "content": "帮我生成一份营养方案"},
      {"role": "assistant", "content": "请问是为哪位患者？"},
      {"role": "user",      "content": "张三"}
    ],
    "session_id": "可选，用于日志关联"
  }

响应：text/event-stream，逐行推送 JSON 事件（见 copilot_service.py 注释）
══════════════════════════════════════════════════════════════════════════════
"""
import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.database import get_db
from app.services.copilot_service import run_copilot_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent", tags=["AI Copilot"])


# ── 请求 Schema ───────────────────────────────────────────────────────────────

class MessageItem(BaseModel):
    role:    str = Field(..., description="消息角色：user / assistant / tool")
    content: str = Field(default="", description="消息内容")


class CopilotRequest(BaseModel):
    messages:   list[MessageItem] = Field(..., min_length=1, description="对话历史（不含 system）")
    session_id: str | None        = Field(None, description="可选会话 ID，用于日志关联")


# ── 端点 ──────────────────────────────────────────────────────────────────────

@router.post(
    "/copilot",
    summary="AI Copilot 多轮对话（SSE 流式）",
    response_description="Server-Sent Events 流，每行 data: {JSON}",
)
async def copilot_chat(
    body: CopilotRequest,
    db=Depends(get_db),
):
    """
    接受完整对话历史，启动 Copilot 服务并以 SSE 流式推送执行过程。

    前端使用 `fetch + ReadableStream` 接收响应，实时更新 CoT 时间轴。
    """
    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    if body.session_id:
        logger.info("[Copilot] session=%s len=%d", body.session_id, len(messages))

    async def event_generator():
        try:
            async for chunk in run_copilot_stream(messages, db):
                yield chunk
        except asyncio.CancelledError:
            logger.info("[Copilot] 客户端断开连接")
        except Exception:
            logger.exception("[Copilot] event_generator 异常")
            import json
            yield f"data: {json.dumps({'type':'error','message':'内部服务错误'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",      # Nginx 禁用缓冲
            "Access-Control-Allow-Origin": "*",
        },
    )
