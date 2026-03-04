"""
app/api/endpoints/nutrition.py
══════════════════════════════════════════════════════════════════
GET  /api/v1/nutrition/plan/{patient_id}   基于规则计算当前营养方案
GET  /api/v1/nutrition/plans/{patient_id}  历史方案列表（含数据库记录）
POST /api/v1/nutrition/plan/{patient_id}   保存/覆盖当前规则方案到 DB
══════════════════════════════════════════════════════════════════
"""
import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import PatientProfile, NutritionPlan, TransplantPhase

router = APIRouter(prefix="/nutrition", tags=["营养方案"])


# ─── 阶段配置规则表 ──────────────────────────────────────────────────────────

PHASE_RULES: dict[str, dict[str, Any]] = {
    TransplantPhase.PRE_ASSESSMENT.value: {
        "label":       "术前评估期",
        "kcal_per_kg": 30,
        "protein_per_kg": 1.2,
        "suggestions": [
            "均衡饮食，保证多样化食物摄入",
            "每日蛋白质以鸡蛋、鱼肉、豆制品为主",
            "限制高脂肪、高盐食物，减轻肝脏负担",
            "适当补充维生素 D 和锌",
            "建议营养科门诊完成 NRS-2002 评分",
        ],
        "restrictions": ["限盐 < 5 g/天", "限酒精", "避免生食水产"],
        "supplements":  ["多种维生素矿物质片（低剂量）"],
        "color": "#1677FF",
    },
    TransplantPhase.PRE_OPERATION.value: {
        "label":       "等待手术期",
        "kcal_per_kg": 32,
        "protein_per_kg": 1.5,
        "suggestions": [
            "增加优质蛋白摄入，为手术储备营养储备",
            "少食多餐（每日 5~6 餐），减少肝糖原消耗",
            "口服营养补充（ONS）：每日 2 份蛋白粉或全营养制剂",
            "支链氨基酸（BCAA）饮料有助于减少肌肉分解",
            "保持充足水分摄入（1500~2000 mL/天）",
        ],
        "restrictions": ["严格限盐 < 3 g/天（腹水患者）", "限钾（高血钾时）", "限制高铜食物"],
        "supplements":  ["乳清蛋白粉", "支链氨基酸（BCAA）", "维生素 K"],
        "color": "#722ED1",
    },
    TransplantPhase.EARLY_POST_OP.value: {
        "label":       "术后早期（0–7 天）",
        "kcal_per_kg": 25,
        "protein_per_kg": 1.8,
        "suggestions": [
            "肠内营养为主，首选鼻胃管或鼻空肠管",
            "术后 6~12 小时可启动早期肠内营养",
            "流质 → 半流质 → 软食逐步过渡",
            "每次进食量 < 200 mL，避免腹胀",
            "密切监测血糖，控制在 7.8–10 mmol/L",
        ],
        "restrictions": ["禁食高渗食物", "限钠 < 2 g/天", "禁止饮酒"],
        "supplements":  ["肝病专用型肠内营养配方（HE 系列）", "谷氨酰胺"],
        "color": "#FF4D4F",
    },
    TransplantPhase.RECOVERY.value: {
        "label":       "恢复期（8–30 天）",
        "kcal_per_kg": 30,
        "protein_per_kg": 1.5,
        "suggestions": [
            "逐步恢复正常饮食，以软食为主",
            "每日 4~5 餐，规律进食",
            "增加高生物价蛋白：鸡蛋白、鱼肉、低脂牛奶",
            "补充锌和硒，促进伤口愈合",
            "避免西柚及葡萄柚（干扰免疫抑制剂代谢）",
        ],
        "restrictions": ["禁止西柚 / 杨桃", "限制高钾食物", "低脂饮食"],
        "supplements":  ["乳清蛋白粉", "锌补充剂（PO 15 mg/天）"],
        "color": "#FA8C16",
    },
    TransplantPhase.REHABILITATION.value: {
        "label":       "康复期（1–3 个月）",
        "kcal_per_kg": 30,
        "protein_per_kg": 1.2,
        "suggestions": [
            "恢复正常均衡饮食，食物多样化",
            "每周至少摄入 2 次深海鱼（Omega-3 来源）",
            "增加蔬菜水果摄入（300~500 g/天蔬菜）",
            "监测体重，目标 BMI 18.5–25",
            "根据血脂结果调整脂肪摄入种类",
        ],
        "restrictions": ["禁止西柚 / 杨桃（持续）", "限制高嘌呤食物（gout 风险）"],
        "supplements":  ["钙 + 维生素 D（预防骨质疏松）"],
        "color": "#13C2C2",
    },
    TransplantPhase.LONG_TERM_FOLLOW.value: {
        "label":       "长期随访（>3 个月）",
        "kcal_per_kg": 28,
        "protein_per_kg": 1.0,
        "suggestions": [
            "遵循地中海饮食模式（蔬菜、全谷物、橄榄油、鱼）",
            "控制钠摄入 < 5 g/天，预防高血压",
            "维持健康体重，预防代谢综合征",
            "每日适量运动（150 min/周中等强度有氧）",
            "每半年复查营养相关指标（白蛋白、维生素 D、血脂）",
        ],
        "restrictions": ["禁止西柚 / 杨桃（长期）", "限制加工食品和含糖饮料"],
        "supplements":  ["钙 + 维生素 D（长期）", "必要时补充叶酸"],
        "color": "#52C41A",
    },
}

# 默认规则（未知阶段回退）
_DEFAULT_RULE = PHASE_RULES[TransplantPhase.RECOVERY.value]


def _to_list(value: Any, fallback: list) -> list:
    """把可能是 list / dict / None 的值统一转为 list 字符串"""
    if isinstance(value, list) and value:
        return value
    if isinstance(value, dict) and value:
        # meals dict: {"breakfast": "...", "lunch": "...", ...}
        MEAL_LABELS = {
            "breakfast": "早餐", "lunch": "午餐",
            "dinner":    "晚餐", "snack": "加餐",
        }
        return [
            f"{MEAL_LABELS.get(k, k)}：{v}"
            for k, v in value.items()
        ]
    return fallback


def _calc_plan(patient: PatientProfile) -> dict[str, Any]:
    """基于患者体重 + 阶段，按规则计算营养目标"""
    rule = PHASE_RULES.get(patient.current_phase.value, _DEFAULT_RULE)

    weight = patient.weight_kg or 60.0  # 无体重数据时用 60 kg 兜底

    energy  = round(weight * rule["kcal_per_kg"])
    protein = round(weight * rule["protein_per_kg"], 1)

    # 术后能量分配参考
    fat_kcal  = round(energy * 0.30)
    carb_kcal = round(energy * 0.50)
    pro_kcal  = round(protein * 4)      # 1 g 蛋白质 ≈ 4 kcal

    return {
        "patient_id":   str(patient.id),
        "patient_name": patient.name,
        "weight_kg":    patient.weight_kg,
        "phase":        patient.current_phase.value,
        "phase_label":  rule["label"],
        "phase_color":  rule["color"],
        "targets": {
            "energy":        energy,
            "protein":       protein,
            "fat_kcal":      fat_kcal,
            "carb_kcal":     carb_kcal,
            "protein_kcal":  pro_kcal,
            "kcal_per_kg":   rule["kcal_per_kg"],
            "protein_per_kg": rule["protein_per_kg"],
        },
        "suggestions":   rule["suggestions"],
        "restrictions":  rule["restrictions"],
        "supplements":   rule["supplements"],
        "rule_based":    True,   # 标记为规则生成（非 Agent 生成）
        "has_db_plan":   False,  # 由下游端点填充
    }


# ─── 端点 ────────────────────────────────────────────────────────────────────

@router.get(
    "/plan/{patient_id}",
    summary="获取患者营养方案（规则 + 数据库）",
)
async def get_nutrition_plan(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    优先返回数据库中最新有效方案；若无，则用规则引擎即时计算。
    前端可通过 `rule_based` 字段判断数据来源。
    """
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="patient_id 格式不正确")

    # 查患者
    result = await db.execute(
        select(PatientProfile).where(PatientProfile.id == pid)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="患者不存在")

    # 尝试读取最新有效 DB 方案
    plan_result = await db.execute(
        select(NutritionPlan)
        .where(NutritionPlan.patient_id == pid, NutritionPlan.is_active == True)
        .order_by(NutritionPlan.created_at.desc())
        .limit(1)
    )
    db_plan = plan_result.scalar_one_or_none()

    if db_plan and db_plan.plan_content:
        # 把 DB 方案合并到规则计算结果（DB 数据优先覆盖）
        rule_data = _calc_plan(patient)
        content   = db_plan.plan_content
        rule_data.update({
            "rule_based":  False,
            "has_db_plan": True,
            "plan_id":     str(db_plan.id),
            "generated_by": db_plan.generated_by,
            "valid_from":  db_plan.valid_from.isoformat() if db_plan.valid_from else None,
            "valid_until": db_plan.valid_until.isoformat() if db_plan.valid_until else None,
            "targets": {
                **rule_data["targets"],
                "energy":  content.get("energy_kcal") or rule_data["targets"]["energy"],
                "protein": content.get("protein_g")   or rule_data["targets"]["protein"],
            },
            "suggestions": _to_list(
                content.get("suggestions") or content.get("meals"),
                rule_data["suggestions"]
            ),
            "restrictions": _to_list(
                content.get("restrictions"),
                rule_data["restrictions"]
            ),
            "supplements": _to_list(
                content.get("supplements"),
                rule_data["supplements"]
            ),
            "notes":        content.get("notes"),
            "raw_content":  content,
        })
        return rule_data

    # 无 DB 方案 → 规则计算
    return _calc_plan(patient)


@router.get(
    "/plans/{plan_id}/detail",
    summary="获取营养方案完整详情（含食材推荐和常见误区）",
    description="""
调用 nutrition_tools.get_nutrition_plan_detail，返回：
  - 目标热量 / 蛋白质 / 脂肪 / 碳水
  - 宜吃食材列表
  - 禁忌食材列表（含药物相互作用提示）
  - 针对当前阶段的常见误区
  - 原始饮食建议、补充剂推荐
    """,
)
async def get_plan_detail(
    plan_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    from app.tools.nutrition_tools import get_nutrition_plan_detail
    result = await get_nutrition_plan_detail(plan_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get(
    "/plans/{patient_id}",
    summary="患者历史营养方案列表",
)
async def list_nutrition_plans(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="patient_id 格式不正确")

    result = await db.execute(
        select(NutritionPlan)
        .where(NutritionPlan.patient_id == pid)
        .order_by(NutritionPlan.created_at.desc())
    )
    plans = result.scalars().all()
    return [
        {
            "id":           str(p.id),
            "phase":        p.phase.value,
            "phase_label":  PHASE_RULES.get(p.phase.value, _DEFAULT_RULE)["label"],
            "is_active":    p.is_active,
            "generated_by": p.generated_by,
            "valid_from":   p.valid_from.isoformat() if p.valid_from else None,
            "valid_until":  p.valid_until.isoformat() if p.valid_until else None,
            "energy_kcal":  (p.plan_content or {}).get("energy_kcal"),
            "protein_g":    (p.plan_content or {}).get("protein_g"),
            "created_at":   p.created_at.isoformat(),
        }
        for p in plans
    ]
