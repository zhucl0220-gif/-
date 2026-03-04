"""
app/api/endpoints/system.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
系统设置 HTTP 路由

挂载前缀: /api/v1/system

端点列表:
  大模型工具箱:
    GET   /system/tools                   获取所有注册工具元数据
    PATCH /system/tools/{name}/state      切换工具启用状态

  协议模板管理:
    GET   /system/consent-templates       获取所有协议模板
    PUT   /system/consent-templates/{key} 更新指定协议模板

  操作日志:
    GET   /system/operation-logs          分页查询 Agent 操作日志
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.tools.system_tools import (
    get_registered_agent_tools,
    update_tool_state,
    get_consent_templates,
    update_consent_template,
    get_operation_logs,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system", tags=["系统设置"])


# ══════════════════════════════════════════════════════════════════════════════
# Pydantic Schemas
# ══════════════════════════════════════════════════════════════════════════════

class ToolStateBody(BaseModel):
    enabled: bool = Field(..., description="true = 启用，false = 禁用")


class TemplateUpdateBody(BaseModel):
    content:    str            = Field(..., description="Markdown 格式的模板内容")
    updated_by: Optional[str] = Field("admin", description="操作人姓名或 ID")


# ══════════════════════════════════════════════════════════════════════════════
# 工具管理
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/tools", summary="获取所有注册工具元数据")
async def list_tools(
    tool_type:  Optional[str] = Query(None, description="按类型过滤: retrieval/compute/file_ops/write/external"),
    module:     Optional[str] = Query(None, description="按所属模块过滤"),
    category:   Optional[str] = Query(None, description="按分类过滤: 系统工具/场景工具/API工具"),
    risk_level: Optional[str] = Query(None, description="按风险等级过滤: 低/中/高"),
) -> dict[str, Any]:
    """返回系统中注册的所有 Agent Tool 元数据，含启用状态、分类、风险等级等信息。"""
    return await get_registered_agent_tools(
        tool_type=tool_type,
        module=module,
        category=category,
        risk_level=risk_level,
    )


@router.patch("/tools/{tool_name}/state", summary="切换工具启用状态")
async def toggle_tool(tool_name: str, body: ToolStateBody) -> dict[str, Any]:
    """切换指定工具的 enabled 开关，状态持久化到磁盘。"""
    result = await update_tool_state(tool_name, body.enabled)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "操作失败"))
    return result


# ══════════════════════════════════════════════════════════════════════════════
# 协议模板管理
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/consent-templates", summary="获取所有协议模板")
async def list_consent_templates() -> dict[str, Any]:
    """返回三份协议声明的当前内容与版本号。"""
    return await get_consent_templates()


@router.put("/consent-templates/{key}", summary="更新协议模板")
async def update_template(key: str, body: TemplateUpdateBody) -> dict[str, Any]:
    """更新指定协议模板内容并自动递增版本号。"""
    result = await update_consent_template(
        key=key,
        content=body.content,
        updated_by=body.updated_by or "admin",
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "更新失败"))
    return result


# ══════════════════════════════════════════════════════════════════════════════
# 操作日志
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/operation-logs", summary="分页查询 Agent 操作日志")
async def list_operation_logs(
    page:      int            = Query(1,  ge=1),
    page_size: int            = Query(20, ge=1, le=100),
    task_type: Optional[str] = Query(None, description="按任务类型过滤"),
    status:    Optional[str] = Query(None, description="按状态过滤: queued/running/completed/failed"),
) -> dict[str, Any]:
    """返回 AgentTask 操作日志，支持按任务类型和状态过滤。"""
    return await get_operation_logs(
        page=page,
        page_size=page_size,
        task_type=task_type,
        status=status,
    )
