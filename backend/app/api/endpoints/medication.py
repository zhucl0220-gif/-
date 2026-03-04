"""
药物依从性管理 API (AD-40 ~ AD-41)
"""
from datetime import date, timedelta
import random
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PatientProfile

router = APIRouter(prefix="/medication", tags=["用药管理"])

_TARGET_MIN = 5.0   # ng/mL - FK506 目标下限
_TARGET_MAX = 10.0  # ng/mL - 稳定期上限
_HIGH_THRESHOLD = 15.0
_LOW_THRESHOLD = 4.0

_COMMON_DRUGS = [
    {"name": "他克莫司(FK506)", "code": "fk506", "unit": "mg", "freq": "每日2次", "target_level": "5-10 ng/mL"},
    {"name": "霉酚酸酯(MMF)", "code": "mmf", "unit": "mg", "freq": "每日2次", "target_level": None},
    {"name": "甲泼尼龙", "code": "steroid", "unit": "mg", "freq": "每日1次", "target_level": None},
]

_ALERT_REASONS = [
    "FK506 血药浓度连续3天低于目标范围",
    "FK506 血药浓度超过安全上限",
    "连续2天未记录服药",
    "剂量自行调整，需医生确认",
]


def _mock_drug_levels(patient_id: int, days: int = 30):
    rng = random.Random(patient_id * 13 + 7)
    records = []
    base = date.today()
    for d in range(days):
        rec_date = base - timedelta(days=d)
        if rng.random() > 0.15:  # 85% check compliance
            # simulate level fluctuations
            center = rng.uniform(5.5, 9.0)
            level = round(center + rng.gauss(0, 1.5), 2)
            level = max(1.0, min(20.0, level))
            taken = rng.random() > 0.1  # 90% medication compliance
            records.append({
                "date": rec_date.isoformat(),
                "fk506_level": level,
                "taken_morning": taken,
                "taken_evening": taken and rng.random() > 0.08,
                "dose_mg": rng.choice([1.5, 2.0, 2.5, 3.0]),
                "in_range": _TARGET_MIN <= level <= _TARGET_MAX,
                "too_low": level < _LOW_THRESHOLD,
                "too_high": level > _HIGH_THRESHOLD,
            })
    records.sort(key=lambda r: r["date"], reverse=True)
    return records


def _mock_alerts(patients):
    rng = random.Random(55)
    alerts = []
    aid = 1
    for p in patients:
        levels = _mock_drug_levels(p.id, 7)
        low_count = sum(1 for l in levels if l["too_low"])
        high_count = sum(1 for l in levels if l["too_high"])
        miss_count = sum(1 for l in levels if not l["taken_morning"])

        if low_count >= 3:
            alerts.append({
                "id": aid, "patient_id": p.id, "patient_name": p.name,
                "patient_no": p.patient_no,
                "alert_type": "low_level", "severity": "high",
                "severity_label": "高危", "severity_color": "red",
                "reason": "FK506 血药浓度连续{}天低于目标范围".format(low_count),
                "current_avg": round(sum(l["fk506_level"] for l in levels[:3]) / 3, 2),
                "target": "5-10 ng/mL",
                "created_date": date.today().isoformat(),
                "is_handled": False,
            })
            aid += 1
        if high_count >= 2:
            alerts.append({
                "id": aid, "patient_id": p.id, "patient_name": p.name,
                "patient_no": p.patient_no,
                "alert_type": "high_level", "severity": "medium",
                "severity_label": "中危", "severity_color": "orange",
                "reason": "FK506 血药浓度超过安全上限",
                "current_avg": round(sum(l["fk506_level"] for l in levels[:2]) / 2, 2),
                "target": "5-10 ng/mL",
                "created_date": date.today().isoformat(),
                "is_handled": rng.random() > 0.6,
            })
            aid += 1
        if miss_count >= 2:
            alerts.append({
                "id": aid, "patient_id": p.id, "patient_name": p.name,
                "patient_no": p.patient_no,
                "alert_type": "missed_dose", "severity": "medium",
                "severity_label": "中危", "severity_color": "orange",
                "reason": "连续{}天未记录服药".format(miss_count),
                "current_avg": None,
                "target": None,
                "created_date": date.today().isoformat(),
                "is_handled": False,
            })
            aid += 1
    return alerts


@router.get("/levels/{patient_id}", summary="患者FK506血药浓度趋势")
async def get_drug_levels(
    patient_id: int,
    days: int = Query(30, ge=7, le=90),
    db: AsyncSession = Depends(get_db),
):
    records = _mock_drug_levels(patient_id, days)
    in_range = sum(1 for r in records if r["in_range"])
    return {
        "patient_id": patient_id,
        "days": days,
        "records": records,
        "target_min": _TARGET_MIN,
        "target_max": _TARGET_MAX,
        "compliance_rate": round(in_range / max(len(records), 1) * 100, 1),
        "avg_level": round(sum(r["fk506_level"] for r in records) / max(len(records), 1), 2),
        "is_mock": True,
    }


@router.get("/alerts", summary="依从性预警列表")
async def list_medication_alerts(
    patient_id: Optional[int] = Query(None),
    severity: Optional[str] = Query(None),
    is_handled: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    try:
        res = await db.execute(select(PatientProfile).where(PatientProfile.is_active == True))
        patients = res.scalars().all()
        if not patients:
            raise Exception()
        alerts = _mock_alerts(patients)
        if patient_id:
            alerts = [a for a in alerts if a["patient_id"] == patient_id]
        if severity:
            alerts = [a for a in alerts if a["severity"] == severity]
        if is_handled is not None:
            alerts = [a for a in alerts if a["is_handled"] == is_handled]
        total = len(alerts)
        start = (page - 1) * page_size
        return {
            "total": total,
            "unhandled": sum(1 for a in alerts if not a["is_handled"]),
            "items": alerts[start: start + page_size],
            "is_mock": True,
        }
    except Exception:
        return {"total": 0, "unhandled": 0, "items": [], "is_mock": True}


@router.patch("/alerts/{alert_id}/handle", summary="处理依从预警")
async def handle_alert(alert_id: int, notes: Optional[str] = Query(None)):
    return {
        "id": alert_id,
        "is_handled": True,
        "handled_by": "李主任",
        "handled_at": date.today().isoformat(),
        "notes": notes,
        "success": True,
    }


@router.get("/list", summary="患者用药总览")
async def list_medications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    try:
        res = await db.execute(select(PatientProfile).where(PatientProfile.is_active == True))
        patients = res.scalars().all()
        rng = random.Random(88)
        items = []
        for p in patients:
            levels = _mock_drug_levels(p.id, 7)
            latest = levels[0] if levels else None
            compliance = round(sum(1 for l in levels if l["in_range"]) / max(len(levels), 1) * 100, 0)
            items.append({
                "patient_id": p.id,
                "patient_name": p.name,
                "patient_no": p.patient_no,
                "current_phase": p.current_phase,
                "latest_fk506": latest["fk506_level"] if latest else None,
                "latest_date": latest["date"] if latest else None,
                "in_range": latest["in_range"] if latest else None,
                "compliance_7d": compliance,
                "alert_count": rng.randint(0, 2),
                "drugs": _COMMON_DRUGS,
            })
        total = len(items)
        start = (page - 1) * page_size
        return {
            "total": total,
            "items": items[start: start + page_size],
            "is_mock": True,
        }
    except Exception:
        return {"total": 0, "items": [], "is_mock": True}
