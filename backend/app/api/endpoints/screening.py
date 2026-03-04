"""
入组筛查管理 API (AD-29 ~ AD-30)
"""
from datetime import date, timedelta
import random
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PatientProfile

router = APIRouter(prefix="/screening", tags=["入组筛查"])

_CRITERIA = [
    "年龄 18-70 岁",
    "原发性肝病（乙肝/肝硬化/肝癌）",
    "MELD 评分 >= 15",
    "无严重心肺基础疾病",
    "签署知情同意书",
]

_EXCLUSION = [
    "严重凝血障碍", "活动性感染未控制", "精神疾病史",
    "依从性极差（拒绝随访）", "体重指数 > 40",
]

_SCREENING_STATUS = ["pending", "approved", "rejected", "waitlisted"]
_STATUS_LABEL = {
    "pending": "待审核", "approved": "已入组",
    "rejected": "未通过", "waitlisted": "候补等待",
}
_STATUS_COLOR = {
    "pending": "processing", "approved": "success",
    "rejected": "error", "waitlisted": "warning",
}


def _mock_screening(patients):
    rng = random.Random(42)
    records = []
    for i, p in enumerate(patients):
        status = _STATUS_LABEL.keys()
        st = rng.choice(list(status))
        met = rng.sample(_CRITERIA, rng.randint(3, 5))
        excl = rng.sample(_EXCLUSION, rng.randint(0, 1))
        submit_days = rng.randint(1, 90)
        records.append({
            "id": i + 1,
            "patient_id": p.id,
            "patient_name": p.name,
            "patient_no": p.patient_no,
            "gender": p.gender,
            "age": (date.today() - p.birth_date).days // 365 if p.birth_date else None,
            "submit_date": (date.today() - timedelta(days=submit_days)).isoformat(),
            "review_date": (date.today() - timedelta(days=submit_days - rng.randint(1, 5))).isoformat() if st != "pending" else None,
            "reviewer": "王主任" if st != "pending" else None,
            "status": st,
            "status_label": _STATUS_LABEL[st],
            "status_color": _STATUS_COLOR[st],
            "criteria_met": met,
            "exclusion_flags": excl,
            "meld_score": rng.randint(12, 35),
            "notes": "患者依从性良好，建议优先入组" if st == "approved" else ("指标未达标，建议3个月后复查" if st == "rejected" else None),
        })
    return records


@router.get("/list", summary="筛查记录列表")
async def list_screening(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    try:
        res = await db.execute(select(PatientProfile).where(PatientProfile.is_active == True))
        patients = res.scalars().all()
        if not patients:
            raise Exception("no patients")
        records = _mock_screening(patients)
        if status:
            records = [r for r in records if r["status"] == status]
        total = len(records)
        start = (page - 1) * page_size
        return {
            "total": total,
            "items": records[start: start + page_size],
            "summary": {
                "pending": sum(1 for r in records if r["status"] == "pending"),
                "approved": sum(1 for r in records if r["status"] == "approved"),
                "rejected": sum(1 for r in records if r["status"] == "rejected"),
                "waitlisted": sum(1 for r in records if r["status"] == "waitlisted"),
            },
            "is_mock": True,
        }
    except Exception:
        return {"total": 0, "items": [], "summary": {}, "is_mock": True}


@router.patch("/{record_id}/review", summary="审核入组申请")
async def review_screening(
    record_id: int,
    action: str = Query(..., regex="^(approve|reject|waitlist)$"),
    notes: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    action_map = {"approve": "approved", "reject": "rejected", "waitlist": "waitlisted"}
    return {
        "id": record_id,
        "status": action_map[action],
        "status_label": _STATUS_LABEL[action_map[action]],
        "review_date": date.today().isoformat(),
        "reviewer": "李主任",
        "notes": notes,
        "success": True,
    }
