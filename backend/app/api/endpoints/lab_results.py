"""
化验结果 CRUD 端点
GET  /api/v1/lab                     — 化验列表（按患者过滤）
POST /api/v1/lab                     — 新建化验记录
GET  /api/v1/lab/{id}                — 化验详情
GET  /api/v1/lab/patient/{patient_id} — 某患者全部化验
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date

from app.database import get_db
from app.models.models import LabResult, TransplantPhase

router = APIRouter(prefix="/lab", tags=["化验结果"])


class LabCreate(BaseModel):
    patient_id: uuid.UUID
    report_date: Optional[date] = None
    report_type: str
    structured_items: Optional[list] = None
    analysis_result: Optional[dict] = None
    phase_at_upload: Optional[TransplantPhase] = None


@router.get("", summary="化验列表")
async def list_labs(
    patient_id: Optional[uuid.UUID] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(LabResult).order_by(LabResult.report_date.desc())
    if patient_id:
        stmt = stmt.where(LabResult.patient_id == patient_id)
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    labs = result.scalars().all()
    return {
        "items": [
            {
                "id": str(lab.id),
                "patient_id": str(lab.patient_id),
                "report_date": lab.report_date.isoformat() if lab.report_date else None,
                "report_type": lab.report_type,
                "structured_items": lab.structured_items,
                "analysis_result": lab.analysis_result,
                "is_analyzed": lab.is_analyzed,
                "phase_at_upload": lab.phase_at_upload.value if lab.phase_at_upload else None,
            }
            for lab in labs
        ]
    }


@router.get("/patient/{patient_id}", summary="某患者全部化验")
async def get_patient_labs(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LabResult)
        .where(LabResult.patient_id == patient_id)
        .order_by(LabResult.report_date.desc())
    )
    labs = result.scalars().all()
    return [
        {
            "id": str(lab.id),
            "report_date": lab.report_date.isoformat() if lab.report_date else None,
            "report_type": lab.report_type,
            "structured_items": lab.structured_items,
            "analysis_result": lab.analysis_result,
            "is_analyzed": lab.is_analyzed,
        }
        for lab in labs
    ]


@router.get("/{patient_id}/history", summary="患者化验趋势历史（最近N次关键指标）")
async def get_lab_history(
    patient_id: uuid.UUID,
    limit: int = Query(6, ge=1, le=20, description="返回最近几次"),
    db: AsyncSession = Depends(get_db),
):
    """
    返回患者最近 N 次化验的日期 + 关键指标提取值，供前端绘制趋势折线图。
    关键指标：白蛋白、前白蛋白、ALT、AST、总胆红素、肌酐、血红蛋白

    模拟 JSON 示例（前端可用此结构进行 Mock 测试）:
    {
      "patient_id": "uuid",
      "patient_name": "张伟",
      "history": [
        {
          "lab_id": "uuid1",
          "report_date": "2026-01-20",
          "report_type": "常规肝功",
          "metrics": {
            "albumin": 28.2, "prealbumin": 110, "alt": 120,
            "ast": 95, "tbil": 38.0, "creatinine": 98, "hemoglobin": 102
          },
          "risk_level": "high"
        }
      ]
    }
    """
    # ── 查询患者最近 N 次已分析化验 ─────────────────────────────────
    from app.models.models import PatientProfile
    pat = (await db.execute(
        select(PatientProfile).where(PatientProfile.id == patient_id)
    )).scalar_one_or_none()
    if not pat:
        raise HTTPException(status_code=404, detail="患者不存在")

    result = await db.execute(
        select(LabResult)
        .where(LabResult.patient_id == patient_id)
        .order_by(LabResult.report_date.desc())
        .limit(limit)
    )
    labs = result.scalars().all()

    # ── 指标名关键词映射 ─────────────────────────────────────────────
    METRIC_KEYWORDS = {
        "albumin":    ["白蛋白(ALB)", "ALB", "白蛋白"],
        "prealbumin": ["前白蛋白(PA)", "PA", "前白蛋白"],
        "alt":        ["谷丙转氨酶(ALT)", "ALT", "谷丙转氨酶"],
        "ast":        ["谷草转氨酶(AST)", "AST", "谷草转氨酶"],
        "tbil":       ["总胆红素(TBIL)", "TBIL", "总胆红素"],
        "creatinine": ["肌酐(Cr)", "血清肌酐", "肌酐", "CREA", "Cr"],
        "hemoglobin": ["血红蛋白(HB)", "HB", "Hb", "血红蛋白"],
    }

    def extract_metrics(items: list) -> dict:
        result = {}
        for metric, keywords in METRIC_KEYWORDS.items():
            for it in (items or []):
                name = it.get("name", "")
                if any(k in name for k in keywords):
                    try:
                        result[metric] = float(it["value"])
                    except (TypeError, ValueError):
                        pass
                    break
        return result

    history = []
    for lab in reversed(labs):   # 时间升序，便于前端直接绘图
        ar = lab.analysis_result or {}
        history.append({
            "lab_id": str(lab.id),
            "report_date": lab.report_date.isoformat() if lab.report_date else None,
            "report_type": lab.report_type,
            "metrics": extract_metrics(lab.structured_items or []),
            "risk_level": ar.get("risk_level", "unknown"),
            "structured_items": lab.structured_items,
        })

    return {
        "patient_id": str(patient_id),
        "patient_name": pat.name,
        "history": history,
    }


@router.get("/{lab_id}", summary="化验详情")
async def get_lab(
    lab_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LabResult).where(LabResult.id == lab_id)
    )
    lab = result.scalar_one_or_none()
    if not lab:
        raise HTTPException(status_code=404, detail="化验记录不存在")
    return {
        "id": str(lab.id),
        "patient_id": str(lab.patient_id),
        "report_date": lab.report_date.isoformat() if lab.report_date else None,
        "report_type": lab.report_type,
        "ocr_raw_data": lab.ocr_raw_data,
        "structured_items": lab.structured_items,
        "analysis_result": lab.analysis_result,
        "is_analyzed": lab.is_analyzed,
        "phase_at_upload": lab.phase_at_upload.value if lab.phase_at_upload else None,
        "created_at": lab.created_at.isoformat(),
    }
