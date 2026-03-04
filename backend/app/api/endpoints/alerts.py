"""
app/api/endpoints/alerts.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
预警中心 HTTP 路由 — 将 alert_tools 的 Tool 暴露为 FastAPI 接口

端点列表（挂载在 /api/v1/alerts）：
  GET  /alerts                        获取预警列表（自动触发扫描）
  GET  /alerts/summary                预警汇总统计（不触发扫描）
  POST /alerts/scan                   手动触发一次扫描
  PATCH /alerts/{alert_id}/acknowledge 医生确认/处理预警
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.tools.alert_tools import (
    acknowledge_alert,
    get_high_risk_alerts,
    scan_and_create_alerts,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["风险预警"])


# ══════════════════════════════════════════════════════════════════════════════
# 请求体模型
# ══════════════════════════════════════════════════════════════════════════════

class AcknowledgeRequest(BaseModel):
    doctor_id:    str = Field(..., min_length=1, description="操作医生 ID 或姓名")
    resolve_note: str = Field(default="", description="处理备注（可选）")


# ══════════════════════════════════════════════════════════════════════════════
# GET /alerts — 预警列表（自动扫描后返回）
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "",
    summary="获取预警列表",
    description="""
扫描最近 90 天内的检验记录，自动生成新预警后返回当前预警列表。

**过滤参数：**
- `status`：`active`（默认）/ `acknowledged` / `resolved` / `all`
- `severity`：`critical` / `warning` / `info`（可多选）
- `patient_id`：按患者过滤
- `page` / `page_size`：分页

**返回字段说明：**
- `severity`：`critical`（危急红色）/ `warning`（警告橙色）
- `direction`：`below` 偏低 / `above` 偏高
- `metric_value`：实际检测值
- `threshold_value`：被突破的阈值
    """,
)
async def list_alerts(
    status:      str           = Query(default="active",  description="active | acknowledged | resolved | all"),
    severity:    list[str]     = Query(default=[],        description="critical / warning / info（可多选）"),
    patient_id:  Optional[str] = Query(default=None,      description="按患者 UUID 过滤"),
    page:        int           = Query(default=1,  ge=1),
    page_size:   int           = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    # 状态筛选
    if status == "all":
        status_filter = ["active", "acknowledged", "resolved"]
    else:
        status_filter = [status]

    severity_filter = severity if severity else None

    # 验证 patient_id
    if patient_id:
        try:
            uuid.UUID(patient_id)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"无效的 patient_id: {patient_id}")

    data = await get_high_risk_alerts(
        status_filter   = status_filter,
        severity_filter = severity_filter,
        patient_id      = patient_id,
        page            = page,
        page_size       = page_size,
    )
    return data


# ══════════════════════════════════════════════════════════════════════════════
# GET /alerts/summary — 纯汇总统计（不触发扫描，速度快）
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/summary",
    summary="预警汇总统计",
    description="快速返回各状态预警数量，适合首页仪表盘展示。不触发扫描。",
)
async def alert_summary() -> dict[str, Any]:
    from sqlalchemy import func, select
    from app.database import AsyncSessionLocal
    from app.models.models import AlertStatus, AlertSeverity, RiskAlert
    from datetime import datetime, timezone

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(RiskAlert))
        all_alerts = res.scalars().all()

        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

        active_alerts    = [a for a in all_alerts if a.status == AlertStatus.ACTIVE]
        critical_active  = [a for a in active_alerts if a.severity == AlertSeverity.CRITICAL]
        warning_active   = [a for a in active_alerts if a.severity == AlertSeverity.WARNING]
        new_today        = [a for a in active_alerts if a.created_at and a.created_at >= today_start]
        acknowledged_all = [a for a in all_alerts if a.status == AlertStatus.ACKNOWLEDGED]

    return {
        "total_active":        len(active_alerts),
        "critical_count":      len(critical_active),
        "warning_count":       len(warning_active),
        "high_risk_patients":  len({a.patient_id for a in critical_active}),
        "new_today":           len(new_today),
        "total_acknowledged":  len(acknowledged_all),
        "total_all":           len(all_alerts),
    }


# ══════════════════════════════════════════════════════════════════════════════
# POST /alerts/scan — 手动触发扫描
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/scan",
    summary="手动触发预警扫描",
    description="扫描近 90 天检验记录，对越阈值指标生成新预警记录。返回本次新建/跳过数量。",
)
async def trigger_scan() -> dict[str, Any]:
    result = await scan_and_create_alerts()
    return {
        "message": f"扫描完成，新建 {result['created']} 条预警，跳过（已存在）{result['skipped']} 条",
        **result,
    }


# ══════════════════════════════════════════════════════════════════════════════
# PATCH /alerts/{alert_id}/acknowledge — 医生确认预警
# ══════════════════════════════════════════════════════════════════════════════

@router.patch(
    "/{alert_id}/acknowledge",
    summary="医生确认并处理预警",
    description="""
将指定预警状态更新为 `acknowledged`，记录处理医生和时间。

- `doctor_id`：操作医生的用户名或姓名（如 `李医生`）
- `resolve_note`：处理说明（如 `已加强蛋白质补充，预约复查`）
    """,
)
async def acknowledge(
    alert_id: str,
    body:     AcknowledgeRequest,
) -> dict[str, Any]:
    try:
        uuid.UUID(alert_id)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"无效的 alert_id: {alert_id}")

    result = await acknowledge_alert(
        alert_id     = alert_id,
        doctor_id    = body.doctor_id,
        resolve_note = body.resolve_note,
    )
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "操作失败"))
    return result
