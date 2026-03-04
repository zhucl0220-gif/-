"""
app/api/endpoints/assessment.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
营养评估模块的 HTTP 路由 — 将 assessment_tools 中的 4 个 Tool 暴露为接口

端点列表（均挂载在 /api/v1/assessment 前缀下）：
  GET  /assessment/{patient_id}/history        量表历史 + NRS-2002 评分
  GET  /assessment/{patient_id}/lab-images     检验记录 + 原图 URL
  GET  /assessment/{patient_id}/trends         指标趋势时序数据
  POST /assessment/{patient_id}/report/pdf     生成并下载营养基线 PDF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pathlib import Path
from pydantic import BaseModel, Field

from app.config import settings
from app.tools.assessment_tools import (
    generate_baseline_report_pdf,
    get_indicator_trends,
    get_lab_records_with_images,
    get_patient_assessment_history,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assessment", tags=["营养评估"])


# ══════════════════════════════════════════════════════════════════════════════
# 请求体模型
# ══════════════════════════════════════════════════════════════════════════════

class PdfReportRequest(BaseModel):
    plan_id: str = Field(..., description="NutritionPlan UUID，用于确定要生成哪份报告")


# ══════════════════════════════════════════════════════════════════════════════
# 辅助：从 patient_id 字符串中验证 UUID
# ══════════════════════════════════════════════════════════════════════════════

def _validate_patient_uuid(patient_id: str) -> str:
    try:
        uuid.UUID(patient_id)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"无效的患者 ID: {patient_id}")
    return patient_id


# ══════════════════════════════════════════════════════════════════════════════
# Tool 1 — 量表历史与评估记录
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/{patient_id}/history",
    summary="获取患者营养评估历史",
    description="""
返回患者各阶段的营养方案记录，并附带 **NRS-2002 营养风险估算评分**。

每条评估记录包含：
- 阶段标签（术前评估期 / 术后早期 / 康复期 …）
- 评估日期
- NRS-2002 估算分值与风险等级
- 营养方案能量/蛋白质目标
- 是否由 AI Agent 生成
    """,
)
async def get_assessment_history(patient_id: str) -> dict[str, Any]:
    patient_id = _validate_patient_uuid(patient_id)
    data = await get_patient_assessment_history(patient_id)
    if "error" in data:
        raise HTTPException(status_code=404, detail=data["error"])
    return data


# ══════════════════════════════════════════════════════════════════════════════
# Tool 2 — 检验记录 + 原图 URL
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/{patient_id}/lab-images",
    summary="获取患者检验记录（含原图 URL）",
    description="""
返回该患者全部检验单，每条记录包含：
- 报告日期、报告类型、所处移植阶段
- 结构化指标列表（名称、值、单位、参考区间、是否异常）
- 原始检验单图片 URL（可直接在前端 Lightbox 使用）
- AI 分析摘要与建议
    """,
)
async def get_lab_images(
    patient_id: str,
    request: Request,
) -> dict[str, Any]:
    patient_id = _validate_patient_uuid(patient_id)
    # 从请求中推断 base_url，供图片路径拼接使用
    base_url = str(request.base_url).rstrip("/")
    data = await get_lab_records_with_images(patient_id, base_url=base_url)
    return data


# ══════════════════════════════════════════════════════════════════════════════
# Tool 3 — 指标趋势时序数据
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/{patient_id}/trends",
    summary="获取患者指标趋势数据",
    description="""
从历次检验单 `structured_items` 中提取指定指标的时序数据，
返回可直接喂入 ECharts 折线图的格式。

默认返回 **体重(weight)** 和 **白蛋白(albumin)**，
可通过 `metrics` 参数指定其他指标：
- `weight` 体重
- `albumin` 白蛋白
- `total_protein` 总蛋白
- `prealbumin` 前白蛋白
- `hemoglobin` 血红蛋白
    """,
)
async def get_trends(
    patient_id: str,
    metrics: list[str] = Query(default=["weight", "albumin"], description="指标名列表"),
) -> dict[str, Any]:
    patient_id = _validate_patient_uuid(patient_id)
    data = await get_indicator_trends(patient_id, metrics=metrics)
    return data


# ══════════════════════════════════════════════════════════════════════════════
# Tool 4 — 生成营养基线报告 PDF
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/{patient_id}/report/pdf",
    summary="生成营养评估基线报告 PDF",
    description="""
根据指定的营养方案 ID，**后端生成 PDF 报告**并返回下载链接。

生成内容包含：
- 患者基本信息（姓名、性别、BMI、白蛋白）
- NRS-2002 营养风险评分
- 营养量化目标表格（能量、蛋白质、脂肪）
- 饮食执行建议与禁忌
- 推荐补充剂列表

返回字段包括 `pdf_url`（可直接作为 `<a href>` 下载链接使用）。
    """,
)
async def generate_pdf_report(
    patient_id: str,
    body: PdfReportRequest,
) -> dict[str, Any]:
    patient_id = _validate_patient_uuid(patient_id)
    result = await generate_baseline_report_pdf(
        patient_id=patient_id,
        plan_id=body.plan_id,
        upload_dir=settings.UPLOAD_DIR,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ── 静态 PDF 下载（可选，若前端直接用 /uploads 路径则不必要）────────────────

@router.get(
    "/download/{filename}",
    summary="直接下载 PDF 报告文件（备用端点）",
    include_in_schema=False,
)
async def download_pdf(filename: str) -> FileResponse:
    filepath = Path(settings.UPLOAD_DIR) / "assessment_reports" / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(
        path=str(filepath),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
