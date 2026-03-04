"""
app/api/endpoints/statistics.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
统计报表 HTTP 路由

挂载前缀: /api/v1/statistics

端点列表:
  GET  /statistics/dashboard         全局仪表盘统计数据
  POST /statistics/export            触发数据导出，返回下载 URL
  GET  /statistics/download/{file}   下载已导出的 Excel 文件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.tools.statistics_tools import export_system_data, get_dashboard_statistics

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/statistics", tags=["统计报表"])

_EXPORT_DIR = Path(settings.UPLOAD_DIR) / "exports"


# ══════════════════════════════════════════════════════════════════════════════
# Pydantic Schemas
# ══════════════════════════════════════════════════════════════════════════════

class ExportRequest(BaseModel):
    target: Literal["patients", "lab_results", "diet_records", "alerts"] = Field(
        "patients",
        description="导出目标数据集",
    )
    fmt: Literal["excel"] = Field(
        "excel",
        description="导出格式（当前仅支持 excel）",
    )


# ══════════════════════════════════════════════════════════════════════════════
# 路由
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/dashboard", summary="获取全局仪表盘统计数据")
async def dashboard_statistics() -> dict[str, Any]:
    """
    返回：
    - kpi：患者总数、活跃预警数、平均饮食依从性、近30天 Agent 任务数
    - phase_distribution：患者阶段分布
    - risk_distribution：营养风险等级分布
    - usage_trend_30d：近30天功能使用趋势（每天各任务类型计数）
    """
    try:
        result = await get_dashboard_statistics()
        return result
    except Exception as e:
        logger.exception("Dashboard statistics failed")
        raise HTTPException(status_code=500, detail=f"统计计算失败: {str(e)}")


@router.post("/export", summary="触发数据导出（Agent-callable）")
async def trigger_export(body: ExportRequest) -> dict[str, Any]:
    """
    生成 Excel 文件，返回临时下载 URL。
    Agent 可直接调用此接口完成"报表导出"任务。
    """
    result = await export_system_data(target=body.target, fmt=body.fmt)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "导出失败"))
    return result


@router.get(
    "/download/{filename}",
    summary="下载导出文件",
    response_class=FileResponse,
    include_in_schema=True,
)
async def download_export(filename: str) -> FileResponse:
    """
    下载已生成的 Excel 导出文件。
    文件名由 /export 返回的 filename 字段提供。
    """
    # 安全检查：防止路径穿越
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="非法文件名")
    filepath = _EXPORT_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="文件不存在或已过期")
    return FileResponse(
        path=str(filepath),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
