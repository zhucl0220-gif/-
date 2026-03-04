"""
患者档案 CRUD 端点
GET  /api/v1/patients          — 患者列表（分页、搜索、阶段过滤）
POST /api/v1/patients          — 新建患者
GET  /api/v1/patients/{id}     — 患者详情
PATCH /api/v1/patients/{id}    — 更新患者信息
GET /api/v1/patients/{id}/summary — 患者全览（化验+方案+打卡）
"""
import uuid
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.models import (
    PatientProfile, LabResult, NutritionPlan, DietRecord,
    TransplantPhase, GenderEnum,
)

router = APIRouter(prefix="/patients", tags=["患者档案"])


# ─── Pydantic Schemas ────────────────────────────────────────────────────────

class PatientCreate(BaseModel):
    name: str
    gender: GenderEnum = GenderEnum.UNKNOWN
    birth_date: Optional[date] = None
    phone: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    diagnosis: Optional[str] = None
    transplant_date: Optional[date] = None
    current_phase: TransplantPhase = TransplantPhase.PRE_ASSESSMENT
    id_number: Optional[str] = None


class PatientUpdate(BaseModel):
    name: Optional[str] = None
    gender: Optional[GenderEnum] = None
    phone: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    diagnosis: Optional[str] = None
    transplant_date: Optional[date] = None
    current_phase: Optional[TransplantPhase] = None


# ─── 辅助函数 ────────────────────────────────────────────────────────────────

def _patient_to_dict(p: PatientProfile, risk_level: Optional[str] = None) -> dict:
    age = None
    if p.birth_date:
        from datetime import date as _date
        today = _date.today()
        age = today.year - p.birth_date.year - (
            (today.month, today.day) < (p.birth_date.month, p.birth_date.day)
        )
    return {
        "id": str(p.id),
        "name": p.name,
        "gender": p.gender.value if p.gender else None,
        "age": age,
        "birth_date": p.birth_date.isoformat() if p.birth_date else None,
        "phone": p.phone,
        "height_cm": p.height_cm,
        "weight_kg": p.weight_kg,
        "bmi": p.bmi,
        "diagnosis": p.diagnosis,
        "transplant_date": p.transplant_date.isoformat() if p.transplant_date else None,
        "current_phase": p.current_phase.value,
        "risk_level": risk_level or "unknown",
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


# ─── 路由 ────────────────────────────────────────────────────────────────────

@router.get("", summary="患者列表")
async def list_patients(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    search: Optional[str] = Query(None, description="按姓名/手机号模糊搜索"),
    phase: Optional[TransplantPhase] = Query(None, description="按移植阶段过滤"),
    db: AsyncSession = Depends(get_db),
):
    """获取患者列表，支持分页、搜索和阶段过滤"""
    stmt = select(PatientProfile).order_by(PatientProfile.created_at.desc())

    if search:
        stmt = stmt.where(
            PatientProfile.name.ilike(f"%{search}%")
            | PatientProfile.phone.ilike(f"%{search}%")
        )
    if phase:
        stmt = stmt.where(PatientProfile.current_phase == phase)

    # 总数
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    # 分页
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    patients = result.scalars().all()

    # 批量获取各患者最新化验的风险等级（一次查询）
    risk_map: dict[str, str] = {}
    if patients:
        patient_ids = [p.id for p in patients]
        # 用 ROW_NUMBER() 取每个患者最新一条已分析化验的 analysis_result
        rn_col = func.row_number().over(
            partition_by=LabResult.patient_id,
            order_by=LabResult.report_date.desc(),
        ).label("rn")
        inner = (
            select(LabResult.patient_id, LabResult.analysis_result, rn_col)
            .where(
                LabResult.patient_id.in_(patient_ids),
                LabResult.is_analyzed == True,
            )
            .subquery()
        )
        risk_rows = await db.execute(
            select(inner.c.patient_id, inner.c.analysis_result).where(inner.c.rn == 1)
        )
        for row in risk_rows.fetchall():
            ar = row.analysis_result if isinstance(row.analysis_result, dict) else {}
            risk_map[str(row.patient_id)] = ar.get("risk_level", "unknown")

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_patient_to_dict(p, risk_map.get(str(p.id), "unknown")) for p in patients],
    }


@router.post("", summary="新建患者", status_code=201)
async def create_patient(
    body: PatientCreate,
    db: AsyncSession = Depends(get_db),
):
    """新建患者档案"""
    data = body.model_dump(exclude_none=True)
    # 计算 BMI
    if data.get("height_cm") and data.get("weight_kg"):
        h = data["height_cm"] / 100
        data["bmi"] = round(data["weight_kg"] / (h * h), 1)

    patient = PatientProfile(**data)
    db.add(patient)
    await db.commit()
    await db.refresh(patient)
    return _patient_to_dict(patient)


@router.get("/{patient_id}", summary="患者详情")
async def get_patient(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """获取单个患者详情"""
    result = await db.execute(
        select(PatientProfile).where(PatientProfile.id == patient_id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="患者不存在")
    return _patient_to_dict(patient)


@router.patch("/{patient_id}", summary="更新患者信息")
async def update_patient(
    patient_id: uuid.UUID,
    body: PatientUpdate,
    db: AsyncSession = Depends(get_db),
):
    """更新患者档案（部分更新）"""
    result = await db.execute(
        select(PatientProfile).where(PatientProfile.id == patient_id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="患者不存在")

    data = body.model_dump(exclude_none=True)
    for k, v in data.items():
        setattr(patient, k, v)
    # 重算 BMI
    if patient.height_cm and patient.weight_kg:
        h = patient.height_cm / 100
        patient.bmi = round(patient.weight_kg / (h * h), 1)

    await db.commit()
    await db.refresh(patient)
    return _patient_to_dict(patient)


@router.get("/{patient_id}/summary", summary="患者全览")
async def get_patient_summary(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    一次性返回患者档案 + 最近5条化验 + 当前营养方案 + 最近7天饮食打卡
    """
    # 患者
    result = await db.execute(
        select(PatientProfile).where(PatientProfile.id == patient_id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="患者不存在")

    # 最近5条化验
    labs_result = await db.execute(
        select(LabResult)
        .where(LabResult.patient_id == patient_id)
        .order_by(LabResult.report_date.desc())
        .limit(5)
    )
    labs = labs_result.scalars().all()

    # 当前有效营养方案
    plan_result = await db.execute(
        select(NutritionPlan)
        .where(NutritionPlan.patient_id == patient_id, NutritionPlan.is_active == True)
        .order_by(NutritionPlan.created_at.desc())
        .limit(1)
    )
    plan = plan_result.scalar_one_or_none()

    # 最近7天饮食打卡
    from datetime import date, timedelta
    diet_result = await db.execute(
        select(DietRecord)
        .where(
            DietRecord.patient_id == patient_id,
            DietRecord.record_date >= date.today() - timedelta(days=7),
        )
        .order_by(DietRecord.record_date.desc())
    )
    diets = diet_result.scalars().all()

    return {
        "patient": _patient_to_dict(patient),
        "recent_labs": [
            {
                "id": str(lab.id),
                "report_date": lab.report_date.isoformat() if lab.report_date else None,
                "report_type": lab.report_type,
                "structured_items": lab.structured_items,
                "analysis_result": lab.analysis_result,
                "is_analyzed": lab.is_analyzed,
            }
            for lab in labs
        ],
        "active_plan": {
            "id": str(plan.id),
            "phase": plan.phase.value,
            "plan_content": plan.plan_content,
            "created_at": plan.created_at.isoformat(),
        } if plan else None,
        "recent_diet": [
            {
                "id": str(d.id),
                "record_date": d.record_date.isoformat(),
                "meal_type": d.meal_type,
                "food_items": d.food_items,
                "total_calories": d.total_calories,
                "total_protein_g": d.total_protein_g,
                "compliance_score": d.compliance_score,
            }
            for d in diets
        ],
    }
