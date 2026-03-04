"""
饮食打卡管理 API (AD-26 ~ AD-28)
"""
from datetime import date, datetime, timedelta
import random
import base64
import json
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, File, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DietRecord, PatientProfile
from app.config import settings

router = APIRouter(prefix="/diet", tags=["饮食打卡"])

# ── 静态 mock 食物库 ────────────────────────────────────────────────────────
_FOOD_POOL = [
    {"name": "白米粥", "unit": "碗", "amount": 1, "kcal": 58, "protein_g": 1.2},
    {"name": "鸡蛋羹", "unit": "个", "amount": 1, "kcal": 75, "protein_g": 6.3},
    {"name": "豆腐脑", "unit": "碗", "amount": 1, "kcal": 50, "protein_g": 4.5},
    {"name": "清蒸鱼", "unit": "g", "amount": 100, "kcal": 113, "protein_g": 20.1},
    {"name": "时令蔬菜", "unit": "盘", "amount": 1, "kcal": 40, "protein_g": 2.0},
    {"name": "全麦面包", "unit": "片", "amount": 2, "kcal": 140, "protein_g": 6.0},
    {"name": "纯牛奶", "unit": "mL", "amount": 200, "kcal": 138, "protein_g": 6.6},
    {"name": "水煮鸡胸", "unit": "g", "amount": 80, "kcal": 90, "protein_g": 18.4},
    {"name": "香蕉", "unit": "根", "amount": 1, "kcal": 89, "protein_g": 1.1},
    {"name": "燕麦粥", "unit": "碗", "amount": 1, "kcal": 150, "protein_g": 5.0},
]

_AI_FB = [
    "蛋白质摄入达标，继续保持！",
    "今日热量略低，建议晚餐增加优质蛋白",
    "饮食结构均衡，符合术后恢复阶段要求",
    "钠摄入偏高，明日请减少酱油用量",
    "脂肪摄入过高，建议减少油炸食品",
    "饮水量不足，请注意补充水分",
    "今日蛋白质来源单一，建议多样化",
    None,
]

_MEALS = ["breakfast", "lunch", "dinner", "snack"]
_MEAL_LABEL = {"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐", "snack": "加餐"}


def _mock_records(patient_id: int, days: int = 30):
    records = []
    base = date.today()
    rng = random.Random(patient_id * 17 + 3)
    rid = patient_id * 1000
    for d in range(days):
        rec_date = base - timedelta(days=d)
        for meal in rng.sample(_MEALS, rng.randint(2, 4)):
            foods = rng.sample(_FOOD_POOL, rng.randint(2, 4))
            kcal = round(sum(f["kcal"] for f in foods) + rng.uniform(-20, 30))
            prot = round(sum(f["protein_g"] for f in foods) + rng.uniform(-2, 3), 1)
            rid += 1
            records.append({
                "id": rid,
                "patient_id": patient_id,
                "record_date": rec_date.isoformat(),
                "meal_type": meal,
                "meal_label": _MEAL_LABEL[meal],
                "food_items": foods,
                "total_kcal": kcal,
                "protein_g": prot,
                "photo_path": None,
                "ai_feedback": rng.choice(_AI_FB),
                "has_ai_feedback": True,
            })
    return records


# ── 路由 ────────────────────────────────────────────────────────────────────

@router.get("/records", summary="饮食打卡列表")
async def list_diet_records(
    patient_id: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    meal_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    try:
        q = select(PatientProfile).where(PatientProfile.is_active == True)
        res = await db.execute(q)
        patients = res.scalars().all()
        if not patients:
            raise Exception("no patients")

        all_records = []
        pat_map = {p.id: p.name for p in patients}
        target_patients = [p for p in patients if patient_id is None or p.id == patient_id]

        for p in target_patients:
            recs = _mock_records(p.id, 14)
            for r in recs:
                r["patient_name"] = pat_map[p.id]
            all_records.extend(recs)

        # filter date
        if start_date:
            all_records = [r for r in all_records if r["record_date"] >= start_date]
        if end_date:
            all_records = [r for r in all_records if r["record_date"] <= end_date]
        if meal_type:
            all_records = [r for r in all_records if r["meal_type"] == meal_type]

        all_records.sort(key=lambda r: (r["record_date"], r["patient_id"]), reverse=True)

        total = len(all_records)
        start = (page - 1) * page_size
        end = start + page_size

        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": all_records[start:end],
            "is_mock": True,
        }
    except Exception:
        return {"total": 0, "page": page, "page_size": page_size, "items": [], "is_mock": True}


# ── Pydantic body model for POST ────────────────────────────────────────────
class DietRecordCreate(BaseModel):
    patient_id: Any  # accept int or UUID string
    date: Optional[str] = None
    meal_type: Optional[str] = "other"
    foods: Optional[str] = ""
    calories: Optional[float] = None
    protein: Optional[float] = None
    # full-day diary variant fields
    meals: Optional[Dict[str, Any]] = None
    note: Optional[str] = ""
    total_calories: Optional[float] = None
    total_protein: Optional[float] = None


@router.post("/records", summary="提交饮食打卡")
async def create_diet_record(body: DietRecordCreate, db: AsyncSession = Depends(get_db)):
    """
    接收小程序提交的单餐或全日饮食记录，返回 AI 反馈（mock）。
    """
    rng = random.Random()
    ai_feedback = rng.choice([f for f in _AI_FB if f is not None])

    today_totals: Dict[str, float] = {}
    if body.meals:
        # full-day diary: aggregate totals from meals dict
        cal = sum(float(v.get("calories") or 0) for v in body.meals.values() if isinstance(v, dict))
        prot = sum(float(v.get("protein") or 0) for v in body.meals.values() if isinstance(v, dict))
        today_totals = {"calories": cal, "protein": prot, "water": 0}
    elif body.calories is not None or body.protein is not None:
        today_totals = {"calories": body.calories or 0, "protein": body.protein or 0, "water": 0}

    return {
        "id": rng.randint(10000, 99999),
        "status": "ok",
        "ai_feedback": ai_feedback,
        "today_totals": today_totals if today_totals else None,
        "is_mock": True,
    }


@router.post("/ocr-food", summary="食物图片OCR识别")
async def ocr_food_image(image: UploadFile = File(...)):
    """
    接受图片文件（multipart/form-data，字段名 image），
    调用视觉大模型识别图中食物，返回食物描述、热量估算、蛋白质估算。
    失败时返回 error 字段。
    """
    try:
        contents = await image.read()
        b64_image = base64.b64encode(contents).decode("utf-8")

        from openai import OpenAI
        client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
        )

        response = client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64_image}"},
                        },
                        {
                            "type": "text",
                            "text": (
                                "请识别图中的食物，严格以JSON格式输出，不要输出其他任何文字：\n"
                                '{"foods": "食物描述（如：米饭150g、清蒸鱼200g）", '
                                '"calories_estimate": 热量整数(kcal), '
                                '"protein_estimate": 蛋白质浮点数(g)}'
                            ),
                        },
                    ],
                }
            ],
            max_tokens=200,
        )

        text = response.choices[0].message.content.strip()
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            result = json.loads(match.group())
            return {
                "foods": str(result.get("foods", "")),
                "calories_estimate": int(result.get("calories_estimate", 0) or 0),
                "protein_estimate": float(result.get("protein_estimate", 0) or 0),
            }
        return {"foods": "", "calories_estimate": 0, "protein_estimate": 0, "error": "识别失败"}
    except Exception:
        return {"foods": "", "calories_estimate": 0, "protein_estimate": 0, "error": "识别失败"}


@router.get("/records/{record_id}", summary="饮食打卡详情")
async def get_diet_record(record_id: int, db: AsyncSession = Depends(get_db)):
    patient_id = record_id // 1000
    recs = _mock_records(patient_id, 30)
    detail = next((r for r in recs if r["id"] == record_id), None)
    if not detail:
        return {"error": "not found"}
    return detail


@router.get("/compliance/{patient_id}", summary="患者饮食依从性统计")
async def get_diet_compliance(patient_id: int, db: AsyncSession = Depends(get_db)):
    recs = _mock_records(patient_id, 30)
    by_date = {}
    for r in recs:
        d = r["record_date"]
        by_date.setdefault(d, []).append(r)

    daily_list = []
    for d, day_recs in sorted(by_date.items(), reverse=True):
        meals = [r["meal_type"] for r in day_recs]
        kcal = sum(r["total_kcal"] for r in day_recs)
        prot = round(sum(r["protein_g"] for r in day_recs), 1)
        daily_list.append({
            "date": d,
            "meal_count": len(day_recs),
            "meals": meals,
            "total_kcal": kcal,
            "total_protein_g": prot,
            "target_kcal": 1800,
            "target_protein_g": 75,
            "kcal_ok": 1500 <= kcal <= 2200,
            "protein_ok": prot >= 60,
        })

    compliance_rate = round(
        sum(1 for d in daily_list if d["kcal_ok"] and d["protein_ok"]) / max(len(daily_list), 1) * 100, 1
    )

    return {
        "patient_id": patient_id,
        "days_analyzed": len(daily_list),
        "compliance_rate": compliance_rate,
        "avg_kcal": round(sum(d["total_kcal"] for d in daily_list) / max(len(daily_list), 1), 0),
        "avg_protein_g": round(sum(d["total_protein_g"] for d in daily_list) / max(len(daily_list), 1), 1),
        "daily": daily_list[:14],
        "is_mock": True,
    }
