"""
消息通知管理 API (AD-31 ~ AD-33)
"""
from datetime import datetime, timedelta
import random
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PatientProfile

router = APIRouter(prefix="/messages", tags=["消息通知"])

_MSG_TYPES = ["lab_abnormal", "nutrition_reminder", "followup_reminder", "consent_expiry", "medication_alert", "system"]
_TYPE_LABEL = {
    "lab_abnormal": "化验异常提醒",
    "nutrition_reminder": "营养打卡提醒",
    "followup_reminder": "随访提醒",
    "consent_expiry": "同意书到期",
    "medication_alert": "用药依从预警",
    "system": "系统通知",
}
_TYPE_COLOR = {
    "lab_abnormal": "red", "nutrition_reminder": "green",
    "followup_reminder": "blue", "consent_expiry": "orange",
    "medication_alert": "volcano", "system": "default",
}
_CHANNELS = ["weapp", "sms", "email"]
_CHANNEL_LABEL = {"weapp": "小程序", "sms": "短信", "email": "邮件"}
_STATUS = ["sent", "delivered", "read", "failed"]
_STATUS_LABEL = {"sent": "已发送", "delivered": "已送达", "read": "已读", "failed": "发送失败"}
_STATUS_COLOR = {"sent": "processing", "delivered": "success", "read": "default", "failed": "error"}

_TEMPLATES = [
    {"id": 1, "name": "化验异常提醒", "type": "lab_abnormal", "channel": "weapp",
     "content": "您好，患者 {name} 的最新化验结果出现异常指标，请及时查看。", "enabled": True},
    {"id": 2, "name": "每日打卡提醒", "type": "nutrition_reminder", "channel": "weapp",
     "content": "提醒您记录今日饮食，保持良好营养依从性！", "enabled": True},
    {"id": 3, "name": "随访到期提醒", "type": "followup_reminder", "channel": "sms",
     "content": "您好 {name}，您有一项随访任务将于明日到期，请及时完成。", "enabled": True},
    {"id": 4, "name": "知情同意到期", "type": "consent_expiry", "channel": "weapp",
     "content": "患者 {name} 的知情同意书即将到期，请安排重新签署。", "enabled": False},
    {"id": 5, "name": "FK506 依从预警", "type": "medication_alert", "channel": "sms",
     "content": "系统检测到 {name} 连续3天FK506血药浓度偏低，请核查用药情况。", "enabled": True},
]


def _mock_send_records(patients, count=50):
    rng = random.Random(123)
    records = []
    for i in range(count):
        p = rng.choice(patients)
        msg_type = rng.choice(_MSG_TYPES)
        channel = rng.choice(_CHANNELS)
        status = rng.choice(_STATUS)
        send_time = datetime.now() - timedelta(hours=rng.randint(1, 720))
        tmpl = next((t for t in _TEMPLATES if t["type"] == msg_type), _TEMPLATES[0])
        records.append({
            "id": i + 1,
            "patient_id": p.id,
            "patient_name": p.name,
            "patient_no": p.patient_no,
            "msg_type": msg_type,
            "type_label": _TYPE_LABEL[msg_type],
            "type_color": _TYPE_COLOR[msg_type],
            "channel": channel,
            "channel_label": _CHANNEL_LABEL[channel],
            "content": tmpl["content"].replace("{name}", p.name),
            "status": status,
            "status_label": _STATUS_LABEL[status],
            "status_color": _STATUS_COLOR[status],
            "send_time": send_time.strftime("%Y-%m-%d %H:%M"),
            "read_time": (send_time + timedelta(minutes=rng.randint(5, 120))).strftime("%Y-%m-%d %H:%M") if status == "read" else None,
        })
    records.sort(key=lambda x: x["send_time"], reverse=True)
    return records


@router.get("/templates", summary="消息模板列表")
async def list_templates():
    return {"items": _TEMPLATES, "total": len(_TEMPLATES)}


@router.patch("/templates/{template_id}", summary="启用/禁用模板")
async def toggle_template(template_id: int, enabled: bool = Query(...)):
    tmpl = next((t for t in _TEMPLATES if t["id"] == template_id), None)
    if not tmpl:
        return {"error": "not found"}
    tmpl["enabled"] = enabled
    return {**tmpl, "success": True}


@router.get("/records", summary="发送记录列表")
async def list_records(
    patient_id: Optional[int] = Query(None),
    msg_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    try:
        res = await db.execute(select(PatientProfile).where(PatientProfile.is_active == True))
        patients = res.scalars().all()
        if not patients:
            raise Exception()
        records = _mock_send_records(patients)
        if patient_id:
            records = [r for r in records if r["patient_id"] == patient_id]
        if msg_type:
            records = [r for r in records if r["msg_type"] == msg_type]
        if status:
            records = [r for r in records if r["status"] == status]
        total = len(records)
        start = (page - 1) * page_size
        return {"total": total, "page": page, "page_size": page_size,
                "items": records[start: start + page_size], "is_mock": True}
    except Exception:
        return {"total": 0, "page": page, "page_size": page_size, "items": [], "is_mock": True}


@router.post("/send", summary="手动发送消息")
async def manual_send(
    patient_id: int = Query(...),
    msg_type: str = Query(...),
    channel: str = Query("weapp"),
    content: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return {
        "success": True,
        "message_id": 9999,
        "patient_id": patient_id,
        "msg_type": msg_type,
        "channel": channel,
        "status": "sent",
        "send_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


@router.get("/stats", summary="消息统计")
async def message_stats(db: AsyncSession = Depends(get_db)):
    try:
        res = await db.execute(select(PatientProfile).where(PatientProfile.is_active == True))
        patients = res.scalars().all()
        records = _mock_send_records(patients)
        return {
            "total_sent": len(records),
            "delivered": sum(1 for r in records if r["status"] in ("delivered", "read")),
            "read": sum(1 for r in records if r["status"] == "read"),
            "failed": sum(1 for r in records if r["status"] == "failed"),
            "read_rate": round(sum(1 for r in records if r["status"] == "read") / max(len(records), 1) * 100, 1),
            "by_type": {t: sum(1 for r in records if r["msg_type"] == t) for t in _MSG_TYPES},
            "is_mock": True,
        }
    except Exception:
        return {"total_sent": 0, "is_mock": True}
