"""
随访计划管理 API (AD-37 ~ AD-39)
"""
from datetime import date, datetime, timedelta
import random
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PatientProfile

router = APIRouter(prefix="/followup", tags=["随访计划"])

_TASK_TYPES = ["lab_check", "nutrition_review", "weight_record", "outpatient", "phone_followup", "imaging"]
_TASK_LABEL = {
    "lab_check": "化验复查", "nutrition_review": "营养评估",
    "weight_record": "体重记录", "outpatient": "门诊复诊",
    "phone_followup": "电话随访", "imaging": "影像检查",
}
_TASK_STATUS = ["pending", "completed", "overdue", "cancelled"]
_TASK_STATUS_LABEL = {
    "pending": "待完成", "completed": "已完成",
    "overdue": "已逾期", "cancelled": "已取消",
}
_TASK_STATUS_COLOR = {
    "pending": "processing", "completed": "success",
    "overdue": "error", "cancelled": "default",
}

_PHASE_FOLLOWUP_PLAN = {
    "pre_surgery": ["lab_check", "nutrition_review", "outpatient"],
    "surgery": ["weight_record", "lab_check"],
    "post_surgery_acute": ["lab_check", "weight_record", "nutrition_review", "phone_followup"],
    "post_surgery_stable": ["lab_check", "outpatient", "imaging"],
    "long_term_care": ["lab_check", "outpatient", "phone_followup"],
    "rehabilitation": ["nutrition_review", "weight_record", "outpatient"],
}


def _mock_followup_tasks(patients):
    rng = random.Random(77)
    tasks = []
    tid = 1
    for p in patients:
        phase = p.current_phase or "post_surgery_stable"
        task_types = _PHASE_FOLLOWUP_PLAN.get(phase, ["lab_check", "outpatient"])
        for tt in task_types:
            for cycle in range(3):
                due = date.today() + timedelta(days=rng.randint(-10, 30) + cycle * 30)
                status = "pending"
                if due < date.today():
                    status = rng.choice(["completed", "overdue", "completed"])
                tasks.append({
                    "id": tid,
                    "patient_id": p.id,
                    "patient_name": p.name,
                    "patient_no": p.patient_no,
                    "current_phase": phase,
                    "task_type": tt,
                    "task_label": _TASK_LABEL[tt],
                    "due_date": due.isoformat(),
                    "status": status,
                    "status_label": _TASK_STATUS_LABEL[status],
                    "status_color": _TASK_STATUS_COLOR[status],
                    "assignee": rng.choice(["李主任", "王护士", "张医生"]),
                    "notes": "按时完成复查" if status == "completed" else None,
                    "completed_at": (datetime.combine(due, datetime.min.time()) + timedelta(hours=rng.randint(8, 17))).strftime("%Y-%m-%d %H:%M") if status == "completed" else None,
                })
                tid += 1
    tasks.sort(key=lambda t: t["due_date"])
    return tasks


@router.get("/tasks", summary="随访任务列表")
async def list_followup_tasks(
    patient_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    task_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    try:
        res = await db.execute(select(PatientProfile).where(PatientProfile.is_active == True))
        patients = res.scalars().all()
        if not patients:
            raise Exception()
        tasks = _mock_followup_tasks(patients)
        if patient_id:
            tasks = [t for t in tasks if t["patient_id"] == patient_id]
        if status:
            tasks = [t for t in tasks if t["status"] == status]
        if task_type:
            tasks = [t for t in tasks if t["task_type"] == task_type]
        total = len(tasks)
        start = (page - 1) * page_size
        overdue_count = sum(1 for t in tasks if t["status"] == "overdue")
        pending_count = sum(1 for t in tasks if t["status"] == "pending")
        return {
            "total": total,
            "items": tasks[start: start + page_size],
            "overdue_count": overdue_count,
            "pending_count": pending_count,
            "is_mock": True,
        }
    except Exception:
        return {"total": 0, "items": [], "overdue_count": 0, "pending_count": 0, "is_mock": True}


@router.patch("/tasks/{task_id}/complete", summary="标记随访任务完成")
async def complete_task(task_id: int, notes: Optional[str] = Query(None)):
    return {
        "id": task_id,
        "status": "completed",
        "status_label": "已完成",
        "completed_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "notes": notes,
        "success": True,
    }


@router.get("/calendar", summary="随访日历视图数据")
async def followup_calendar(
    year: int = Query(date.today().year),
    month: int = Query(date.today().month),
    db: AsyncSession = Depends(get_db),
):
    try:
        res = await db.execute(select(PatientProfile).where(PatientProfile.is_active == True))
        patients = res.scalars().all()
        tasks = _mock_followup_tasks(patients)
        month_str = f"{year:04d}-{month:02d}"
        month_tasks = [t for t in tasks if t["due_date"].startswith(month_str)]
        by_date = {}
        for t in month_tasks:
            by_date.setdefault(t["due_date"], []).append(t)
        return {
            "year": year, "month": month,
            "calendar": [{"date": d, "tasks": ts} for d, ts in sorted(by_date.items())],
            "is_mock": True,
        }
    except Exception:
        return {"year": year, "month": month, "calendar": [], "is_mock": True}
