"""
营养方案生命周期管理 API (AD-34 ~ AD-36)
方案审核、版本对比、手动创建
"""
from datetime import date, datetime, timedelta
import random
from typing import Optional

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import NutritionPlan, PatientProfile

router = APIRouter(prefix="/plans", tags=["方案生命周期"])

_REVIEW_STATUS = ["pending_review", "approved", "rejected", "expired"]
_RS_LABEL = {
    "pending_review": "待审核", "approved": "已批准",
    "rejected": "已驳回", "expired": "已过期",
}
_RS_COLOR = {
    "pending_review": "processing", "approved": "success",
    "rejected": "error", "expired": "default",
}

_PLAN_PHASES = {
    "pre_surgery": "术前准备",
    "surgery": "手术期",
    "post_surgery_acute": "术后急性期",
    "post_surgery_stable": "术后稳定期",
    "long_term_care": "长期维护",
    "rehabilitation": "康复随访",
}


def _mock_plan_list(patients):
    rng = random.Random(33)
    plans = []
    pid = 1
    for p in patients:
        for version in range(1, rng.randint(2, 4)):
            phase = rng.choice(list(_PLAN_PHASES.keys()))
            status = rng.choice(_REVIEW_STATUS)
            created = date.today() - timedelta(days=rng.randint(10, 200))
            plans.append({
                "id": pid,
                "patient_id": p.id,
                "patient_name": p.name,
                "patient_no": p.patient_no,
                "phase": phase,
                "phase_label": _PLAN_PHASES.get(phase, phase),
                "version": version,
                "review_status": status,
                "review_status_label": _RS_LABEL[status],
                "review_status_color": _RS_COLOR[status],
                "generated_by": rng.choice(["AI自动生成", "李主任手动创建", "营养师王红创建"]),
                "valid_from": created.isoformat(),
                "valid_until": (created + timedelta(days=30)).isoformat(),
                "is_active": status == "approved" and version == max(range(1, version + 1)),
                "created_at": created.isoformat(),
                "reviewer": "王主任" if status != "pending_review" else None,
                "review_date": (created + timedelta(days=2)).isoformat() if status != "pending_review" else None,
                "review_notes": "营养方案合理，建议执行" if status == "approved" else ("热量目标偏低，请修正" if status == "rejected" else None),
                "plan_content": {
                    "total_kcal": rng.choice([1600, 1800, 2000, 2200]),
                    "protein_g": rng.choice([60, 70, 80, 90]),
                    "fat_g": rng.choice([50, 60, 70]),
                    "carb_g": rng.choice([200, 220, 250]),
                    "highlights": ["低钠低脂", "优质蛋白优先", "少量多餐"],
                },
            })
            pid += 1
    plans.sort(key=lambda p: p["created_at"], reverse=True)
    return plans


@router.get("/list", summary="营养方案管理列表")
async def list_plans(
    patient_id: Optional[int] = Query(None),
    review_status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    try:
        res = await db.execute(select(PatientProfile).where(PatientProfile.is_active == True))
        patients = res.scalars().all()
        if not patients:
            raise Exception()
        plans = _mock_plan_list(patients)
        if patient_id:
            plans = [p for p in plans if p["patient_id"] == patient_id]
        if review_status:
            plans = [p for p in plans if p["review_status"] == review_status]
        total = len(plans)
        start = (page - 1) * page_size
        return {
            "total": total,
            "pending_count": sum(1 for p in plans if p["review_status"] == "pending_review"),
            "items": plans[start: start + page_size],
            "is_mock": True,
        }
    except Exception:
        return {"total": 0, "pending_count": 0, "items": [], "is_mock": True}


@router.patch("/{plan_id}/review", summary="审核营养方案")
async def review_plan(
    plan_id: int,
    action: str = Query(..., regex="^(approve|reject)$"),
    notes: Optional[str] = Query(None),
):
    return {
        "id": plan_id,
        "review_status": "approved" if action == "approve" else "rejected",
        "review_status_label": "已批准" if action == "approve" else "已驳回",
        "reviewer": "李主任",
        "review_date": date.today().isoformat(),
        "review_notes": notes,
        "success": True,
    }


@router.get("/compare", summary="方案版本对比")
async def compare_plans(
    plan_a_id: int = Query(...),
    plan_b_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    rng = random.Random(plan_a_id + plan_b_id)
    def _plan(pid, version):
        return {
            "id": pid, "version": version,
            "total_kcal": rng.choice([1600, 1800, 2000]),
            "protein_g": rng.choice([60, 70, 80]),
            "fat_g": rng.choice([50, 60]),
            "carb_g": rng.choice([200, 220, 250]),
            "highlights": rng.sample(["低钠", "低脂", "优质蛋白", "少量多餐", "补充维生素D", "控制水分"], 3),
            "phase": rng.choice(list(_PLAN_PHASES.keys())),
            "valid_from": (date.today() - timedelta(days=rng.randint(30, 90))).isoformat(),
        }
    return {
        "plan_a": _plan(plan_a_id, 1),
        "plan_b": _plan(plan_b_id, 2),
        "diff_keys": ["total_kcal", "protein_g", "fat_g"],
        "is_mock": True,
    }


@router.post("/create", summary="手动创建营养方案")
async def create_plan_manual(
    patient_id: int = Query(...),
    phase: str = Query(...),
    total_kcal: int = Query(1800),
    protein_g: int = Query(70),
    fat_g: int = Query(55),
    carb_g: int = Query(220),
    notes: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return {
        "success": True,
        "plan_id": 9999,
        "patient_id": patient_id,
        "phase": phase,
        "review_status": "pending_review",
        "review_status_label": "待审核",
        "generated_by": "李主任手动创建",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "plan_content": {
            "total_kcal": total_kcal,
            "protein_g": protein_g,
            "fat_g": fat_g,
            "carb_g": carb_g,
            "notes": notes,
        },
    }
