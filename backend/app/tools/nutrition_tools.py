"""
app/tools/nutrition_tools.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
营养方案 Agent Tools

对外暴露：
  - get_nutrition_plan_detail   获取指定 DB 方案的完整详情
  - get_current_plan            获取患者当前激活方案详情
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.models import NutritionPlan, PatientProfile

logger = logging.getLogger(__name__)


# ── 各阶段食材 & 常见误区数据库 ─────────────────────────────────────────────────

PHASE_DETAIL: dict[str, dict[str, list[str]]] = {
    "pre_assessment": {
        "foods_good": [
            "鸡蛋白（优质蛋白，低脂）",
            "低脂牛奶 / 无糖酸奶",
            "豆腐、豆浆（植物蛋白）",
            "鸡胸肉、鱼肉",
            "深色绿叶蔬菜（菠菜、西兰花）",
            "燕麦、糙米（全谷物）",
        ],
        "foods_avoid": [
            "动物内脏（肝、肾）—— 含铜量高，加重肝脏代谢负担",
            "腌制/熏制食品 —— 高钠，诱发腹水",
            "高糖饮料与甜品",
            "生冷海鲜（感染风险）",
            "酒精（一切来源）",
        ],
        "common_mistakes": [
            "误以为多吃补品（灵芝、虫草）可快速改善肝功 —— 实为额外代谢负担",
            "忽略限盐饮食 —— 钠摄入过多直接导致腹水加重",
            "蛋白质摄入不足 —— 术前营养不良是术后并发症的独立危险因素",
        ],
    },
    "pre_operation": {
        "foods_good": [
            "乳清蛋白粉（每日 1~2 份）",
            "支链氨基酸（BCAA）饮料",
            "鱼肉、去皮鸡肉",
            "鸡蛋（全蛋为佳）",
            "低脂酸奶、牛奶",
            "全麦面包、土豆",
            "新鲜应季水果（非西柚）",
        ],
        "foods_avoid": [
            "高钠腌菜（酱菜、泡菜）",
            "酒精饮料（清酒、啤酒、白酒）",
            "高铜食物（猪肝、坚果、牡蛎）—— Wilson 病患者尤须注意",
            "生食（刺身、沙拉）",
            "高磷食物（腹水患者限制）",
        ],
        "common_mistakes": [
            "术前大量进补导致代谢负担加重，反而升高转氨酶",
            "忽略 BCAA 的重要性 —— BCAA 可显著减少肌肉分解，改善预后",
            "误以为术前应少吃 —— 储备好营养才能更好耐受手术应激",
        ],
    },
    "early_post_op": {
        "foods_good": [
            "肝病专用型肠内营养制剂（HE 系列，已配好氨基酸比例）",
            "稀粥 / 米汤（术后 2~3 天过渡）",
            "豆腐脑、蒸蛋羹",
            "去皮鸡肉汤（清淡）",
            "低糖电解质饮料（避免低钾）",
        ],
        "foods_avoid": [
            "一切固体食物（肛门排气前禁止）",
            "高糖食物 —— 术后胰岛素抵抗，血糖波动大",
            "高钠食物 —— 加重水钠潴留",
            "产气食物（豆类、洋葱、萝卜）—— 腹胀易致吻合口张力升高",
            "浓缩果汁 —— 高糖且含钾",
        ],
        "common_mistakes": [
            "过早进食固体食物 —— 吻合口瘘是术后最严重并发症，急不得",
            "忍饥挨饿才能快点愈合 —— 早期肠内营养是恢复的关键驱动力",
            "忽略术后血糖监测 —— 目标控制在 7.8~10 mmol/L，过低同样危险",
        ],
    },
    "recovery": {
        "foods_good": [
            "鸡蛋白、清蒸鱼（白鱼、鳕鱼）",
            "低脂牛奶 / 无乳糖奶（乳糖不耐受时）",
            "嫩豆腐、豆腐脑",
            "蒸南瓜、胡萝卜",
            "米饭、面条、馒头（软食）",
            "苹果、梨（不含西柚）",
        ],
        "foods_avoid": [
            "⚠ 西柚 / 杨桃 —— 抑制 CYP3A4，使他克莫司血药浓度骤升，可致急性肾毒性",
            "生食（刺身、生蚝）—— 免疫抑制状态下感染风险极高",
            "高脂油炸食品 —— 损伤新肝脂质代谢",
            "高钾食物（香蕉、土豆）—— FK506 易致高血钾",
            "含酒精饮料",
        ],
        "common_mistakes": [
            "食用西柚味饮料 —— 即使是西柚味也可能含真实西柚成分，务必仔细辨别",
            "低估蛋白质需求量 —— 恢复期每日蛋白 >= 1.5 g/kg，不是少吃肉",
            "随意停止口服营养补充 —— 至少持续 4 周或至营养科复评",
        ],
    },
    "rehabilitation": {
        "foods_good": [
            "深海鱼（三文鱼、鳕鱼、金枪鱼）—— Omega-3，抗炎",
            "特级初榨橄榄油（代替部分动物油脂）",
            "全谷物（糙米、全麦、燕麦）",
            "各类蔬菜 >= 300 g/天",
            "低脂乳制品、豆制品",
            "坚果（适量，每日一小把）",
        ],
        "foods_avoid": [
            "⚠ 西柚 / 杨桃（持续终身禁止）",
            "高嘌呤食物（海鲜、内脏）—— 免疫抑制剂增加痛风风险",
            "含糖饮料与超加工食品",
            "高钠速食（盐摄入 < 5 g/天）",
        ],
        "common_mistakes": [
            "术后 3 个月就恢复完全正常饮食 —— 西柚等禁忌终身有效",
            "忽略钙质补充 —— 激素+他克莫司长期使用导致骨密度持续下降，DEXA 每年检查",
            "担心蛋白质吃多了伤肾 —— 肾功能正常时 1.2 g/kg 是安全目标",
        ],
    },
    "long_term_follow": {
        "foods_good": [
            "地中海模式：蔬菜、全谷物、橄榄油、豆类为基础",
            "每周深海鱼 >= 2 次（Omega-3 来源）",
            "低脂乳制品（钙质来源）",
            "天然香料（大蒜、姜黄）替代食盐",
            "绿茶（适量，勿过量）",
        ],
        "foods_avoid": [
            "⚠ 西柚 / 杨桃（终身禁止，无例外）",
            "精制糖与甜点 —— 代谢综合征风险",
            "含糖饮料",
            "深加工食品（火腿肠、方便面）",
            "高盐食品（每日 < 5 g）",
        ],
        "common_mistakes": [
            "停用钙+VitD 补充剂 —— 骨质疏松是长期生存的隐性杀手",
            "随意中断免疫抑制剂 —— 绝对禁忌，请遵医嘱",
            "忽略体重管理 —— 肥胖是移植后心血管事件的首要危险因素",
        ],
    },
}

# ── 阶段规则精简版（避免循环导入）────────────────────────────────────────────────
_PHASE_RULES_LITE: dict[str, dict] = {
    "pre_assessment":   {"label": "术前评估期",        "kcal_per_kg": 30, "protein_per_kg": 1.2},
    "pre_operation":    {"label": "等待手术期",        "kcal_per_kg": 32, "protein_per_kg": 1.5},
    "early_post_op":    {"label": "术后早期（0-7天）", "kcal_per_kg": 25, "protein_per_kg": 1.8},
    "recovery":         {"label": "恢复期（8-30天）",  "kcal_per_kg": 30, "protein_per_kg": 1.5},
    "rehabilitation":   {"label": "康复期（1-3个月）", "kcal_per_kg": 30, "protein_per_kg": 1.2},
    "long_term_follow": {"label": "长期随访（>3个月）","kcal_per_kg": 28, "protein_per_kg": 1.0},
}


# ─── Tool 函数 ────────────────────────────────────────────────────────────────

async def get_nutrition_plan_detail(plan_id: str) -> dict[str, Any]:
    """
    获取详细的营养干预方案，包含计算出的目标热量(kcal)、蛋白质(g)，
    以及针对当前恢复阶段的具体饮食建议、推荐食材和禁忌列表。

    Args:
        plan_id: NutritionPlan UUID 字符串

    Returns:
        {plan_id, patient_name, phase, phase_label, targets,
         foods_good, foods_avoid, common_mistakes,
         suggestions, restrictions, supplements,
         generated_by, valid_from, valid_until}
    """
    try:
        pid = uuid.UUID(plan_id)
    except ValueError:
        return {"error": "plan_id 格式无效，请传入合法的 UUID 字符串"}

    try:
        async with AsyncSessionLocal() as db:
            stmt = (
                select(NutritionPlan, PatientProfile.name.label("patient_name"))
                .join(PatientProfile, NutritionPlan.patient_id == PatientProfile.id, isouter=True)
                .where(NutritionPlan.id == pid)
            )
            result = await db.execute(stmt)
            row = result.first()

        if not row:
            return {"error": f"方案 {plan_id} 不存在"}

        plan, patient_name = row
        content   = plan.plan_content or {}
        phase_val = plan.phase.value if plan.phase else "recovery"
        detail    = PHASE_DETAIL.get(phase_val, {})
        rule      = _PHASE_RULES_LITE.get(phase_val, {"label": phase_val, "kcal_per_kg": 30, "protein_per_kg": 1.2})

        def to_list(val, fallback):
            if isinstance(val, list) and val:
                return val
            if isinstance(val, dict) and val:
                MEAL_LABELS = {"breakfast": "早餐", "lunch": "午餐",
                               "dinner": "晚餐", "snack": "加餐"}
                return [f"{MEAL_LABELS.get(k, k)}：{v}" for k, v in val.items()]
            return fallback

        return {
            "plan_id":       str(plan.id),
            "patient_name":  patient_name,
            "phase":         phase_val,
            "phase_label":   rule.get("label", phase_val),
            "phase_color":   "#1677FF",
            "targets": {
                "energy":           content.get("energy_kcal"),
                "protein":          content.get("protein_g"),
                "fat_g":            content.get("fat_g"),
                "carb_g":           content.get("carb_g"),
                "kcal_per_kg":      rule.get("kcal_per_kg"),
                "protein_per_kg":   rule.get("protein_per_kg"),
            },
            "foods_good":       detail.get("foods_good",      []),
            "foods_avoid":      detail.get("foods_avoid",     []),
            "common_mistakes":  detail.get("common_mistakes", []),
            "suggestions":      to_list(content.get("suggestions") or content.get("meals"), []),
            "restrictions":     to_list(content.get("restrictions"), []),
            "supplements":      to_list(content.get("supplements"),  []),
            "generated_by":     plan.generated_by,
            "valid_from":       plan.valid_from.isoformat()  if plan.valid_from  else None,
            "valid_until":      plan.valid_until.isoformat() if plan.valid_until else None,
        }

    except Exception as exc:
        logger.exception(f"get_nutrition_plan_detail 执行异常：{exc}")
        return {"error": str(exc)}


async def get_current_plan(patient_id: str) -> dict[str, Any]:
    """
    获取患者当前激活的营养方案详情（最新有效方案）。
    包含计算出的目标热量(kcal)、蛋白质(g)及针对当前恢复阶段的具体饮食建议。

    Args:
        patient_id: PatientProfile UUID 字符串

    Returns:
        同 get_nutrition_plan_detail 格式；若无激活方案则 error 字段说明原因
    """
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        return {"error": "patient_id 格式无效"}

    try:
        async with AsyncSessionLocal() as db:
            stmt = (
                select(NutritionPlan)
                .where(
                    NutritionPlan.patient_id == pid,
                    NutritionPlan.is_active   == True,   # noqa: E712
                )
                .order_by(NutritionPlan.created_at.desc())
                .limit(1)
            )
            result = await db.execute(stmt)
            plan   = result.scalar_one_or_none()

        if not plan:
            return {"error": "患者暂无激活的营养方案", "patient_id": patient_id}

        return await get_nutrition_plan_detail(str(plan.id))

    except Exception as exc:
        logger.exception(f"get_current_plan 执行异常：{exc}")
        return {"error": str(exc)}
