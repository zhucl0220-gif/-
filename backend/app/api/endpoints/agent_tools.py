"""
app/api/endpoints/agent_tools.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
通用 Agent Tools 的 FastAPI HTTP 接口
用途：
  - 供管理后台（B端）直接测试/调用工具
  - 供外部 Agent 框架（如 Dify、AutoGen）通过 HTTP 调用工具
  - 调试和可观测性（所有调用记录在 AgentTask 表）

端点列表：
  POST /tools/search          WebSearch 工具
  POST /tools/sandbox         Python 沙箱执行
  GET  /tools/sandbox/output  查看沙箱输出图片列表
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import AgentTask, AgentTaskStatus, AgentTaskType
from app.tools.search_tools import web_search_summary
from app.tools.sandbox_tools import execute_python_code, SANDBOX_OUTPUT_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tools", tags=["Agent Tools"])


# ══════════════════════════════════════════════════════════════════════════════
# 请求/响应模型
# ══════════════════════════════════════════════════════════════════════════════

class SearchRequest(BaseModel):
    query:       str = Field(..., min_length=1, max_length=500, description="搜索关键词")
    num_results: int = Field(default=5, ge=1, le=10,            description="返回结果数量")
    patient_id:  str | None = Field(default=None,               description="（可选）关联患者 ID，用于 AgentTask 记录")


class SandboxRequest(BaseModel):
    code:        str = Field(..., min_length=1,  description="要执行的 Python 代码")
    timeout_sec: int = Field(default=30, ge=1, le=120, description="执行超时秒数")
    patient_id:  str | None = Field(default=None,       description="（可选）关联患者 ID")


class ApiResponse(BaseModel):
    code:    int    = 200
    message: str    = "success"
    data:    dict | None = None


# ══════════════════════════════════════════════════════════════════════════════
# 辅助：写入 AgentTask 记录
# ══════════════════════════════════════════════════════════════════════════════

async def _record_agent_task(
    db:          AsyncSession,
    task_type:   AgentTaskType,
    patient_id:  str | None,
    input_data:  dict,
    output_data: dict,
    started_at:  datetime,
    elapsed_ms:  int,
    success:     bool,
) -> str:
    """将工具调用记录为一条 AgentTask，返回 task_id 字符串。"""
    pid = None
    if patient_id:
        try:
            pid = uuid.UUID(patient_id)
        except ValueError:
            pass

    task = AgentTask(
        patient_id      = pid,
        task_type       = task_type,
        status          = AgentTaskStatus.COMPLETED if success else AgentTaskStatus.FAILED,
        started_at      = started_at,
        completed_at    = datetime.now(timezone.utc),
        duration_ms     = elapsed_ms,
        input_payload   = input_data,
        final_output    = output_data,
        tool_call_chain = [
            {
                "tool":   task_type.value,
                "input":  input_data,
                "output": output_data,
                "ms":     elapsed_ms,
            }
        ],
        triggered_by    = "api",
    )
    db.add(task)
    await db.flush()
    return str(task.id)


# ══════════════════════════════════════════════════════════════════════════════
# 端点 1：WebSearch
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/search",
    response_model=ApiResponse,
    summary="WebSearch 工具 — 搜索医学文献与营养指南",
    description="""
调用 WebSearch Tool 执行互联网搜索。

**适用场景**
- 查询最新肝移植营养支持循证指南
- 检索特定营养素与免疫抑制剂的相互作用
- 获取食物营养成分数据

**引擎选择**（通过环境变量 `SEARCH_ENGINE` 配置）：
- `serper`（默认）→ Serper.dev Google Search API
- `google` → Google Custom Search
- `mock` → 离线 Mock（开发用）
    """,
)
async def search_tool_endpoint(
    body: SearchRequest,
    db:   AsyncSession = Depends(get_db),
) -> ApiResponse:
    started_at = datetime.now(timezone.utc)

    result = await web_search_summary(
        query       = body.query,
        num_results = body.num_results,
    )

    # 记录 AgentTask
    task_id = await _record_agent_task(
        db          = db,
        task_type   = AgentTaskType.WEB_SEARCH,
        patient_id  = body.patient_id,
        input_data  = {"query": body.query, "num_results": body.num_results},
        output_data = result,
        started_at  = started_at,
        elapsed_ms  = result.get("elapsed_ms", 0),
        success     = result.get("error") is None,
    )

    return ApiResponse(
        code    = 200,
        message = "搜索完成" if not result.get("error") else f"搜索出错：{result['error']}",
        data    = {**result, "task_id": task_id},
    )


# ══════════════════════════════════════════════════════════════════════════════
# 端点 2：Python 沙箱执行
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/sandbox",
    response_model=ApiResponse,
    summary="Python 沙箱 — 执行代码计算与图表生成",
    description="""
在受限沙箱中执行 Python 代码，并返回标准输出和图片 URL。

**当前模式**：DEV（exec + 黑名单过滤）  
**生产模式**：需替换为 Docker 容器隔离（详见 sandbox_tools.py 注释）

**可用库**：`numpy`(np) / `pandas`(pd) / `matplotlib`(plt) / `math` / `statistics`

**图表说明**：代码中调用 `plt.show()` 或 `plt.savefig()` 时，图片会自动保存到服务器  
并通过 `image_paths` 字段返回访问 URL。

**示例代码**：
```python
import numpy as np
weight = [62, 63.5, 64, 63, 62.5]
days = list(range(1, 6))
print(f"平均体重：{np.mean(weight):.1f} kg")
plt.plot(days, weight, 'o-', color='#FF8C69')
plt.title('术后体重变化')
plt.xlabel('天数')
plt.ylabel('体重 (kg)')
plt.show()
```
    """,
)
async def sandbox_tool_endpoint(
    body: SandboxRequest,
    db:   AsyncSession = Depends(get_db),
) -> ApiResponse:
    started_at = datetime.now(timezone.utc)

    result = await execute_python_code(
        code        = body.code,
        timeout_sec = body.timeout_sec,
    )

    # 记录 AgentTask
    task_id = await _record_agent_task(
        db          = db,
        task_type   = AgentTaskType.CODE_EXECUTION,
        patient_id  = body.patient_id,
        input_data  = {
            "code":        body.code[:500],   # 截断过长代码，避免 JSONB 过大
            "timeout_sec": body.timeout_sec,
        },
        output_data = result,
        started_at  = started_at,
        elapsed_ms  = result.get("elapsed_ms", 0),
        success     = result.get("success", False),
    )

    http_status = (
        status.HTTP_200_OK
        if result.get("success")
        else status.HTTP_422_UNPROCESSABLE_ENTITY
    )

    return ApiResponse(
        code    = http_status,
        message = "执行成功" if result.get("success") else f"执行失败：{result.get('error')}",
        data    = {**result, "task_id": task_id},
    )


# ══════════════════════════════════════════════════════════════════════════════
# 端点 3：查看沙箱历史输出图片
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/sandbox/outputs",
    response_model=ApiResponse,
    summary="获取沙箱历史图片输出列表",
    description="返回 sandbox_outputs 目录下所有已生成图片的访问 URL（仅开发/调试用）。",
)
async def list_sandbox_outputs() -> ApiResponse:
    try:
        files = sorted(SANDBOX_OUTPUT_DIR.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True)
        urls  = [f"/uploads/sandbox_outputs/{f.name}" for f in files if f.is_file()]
        return ApiResponse(
            data={"total": len(urls), "images": urls[:50]}  # 最多返回最近 50 张
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )


# ══════════════════════════════════════════════════════════════════════════════
# 端点 4：工具清单（供 Agent 发现可用工具）
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/manifest",
    response_model=ApiResponse,
    summary="获取所有可用 Agent Tool 的清单",
    description="返回系统当前注册的所有 Agent Tools 的名称、描述和参数说明（OpenAPI 格式）。",
)
async def tools_manifest() -> ApiResponse:
    manifest = [
        {
            "name":        "web_search",
            "endpoint":    "POST /api/v1/tools/search",
            "description": "搜索互联网医学文献、营养指南和循证证据",
            "params": {
                "query":       "string, 搜索关键词",
                "num_results": "int, 返回结果数 1-10，默认 5",
            },
        },
        {
            "name":        "execute_python_code",
            "endpoint":    "POST /api/v1/tools/sandbox",
            "description": "在受限沙箱中执行 Python 代码，支持数值计算和图表生成",
            "params": {
                "code":        "string, Python 代码字符串",
                "timeout_sec": "int, 超时秒数 1-120，默认 30",
            },
        },
        {
            "name":        "sign_and_unlock_user",
            "endpoint":    "POST /api/v1/consent/sign",
            "description": "上传患者手写签名，完成知情同意签署并解锁账户",
            "params": {
                "patient_id":        "string (UUID), 患者 ID",
                "signature_image":   "file, 签名图片",
                "consent_type":      "string, 同意书类型",
            },
        },
    ]
    return ApiResponse(
        data={"total": len(manifest), "tools": manifest}
    )
