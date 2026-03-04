"""
测试数据种子脚本
向 livertransplant 数据库插入：
  - 5 位测试患者（不同移植阶段）
  - 每位患者 3 条肝功能/营养指标化验结果
  - 每位患者 1 条营养方案
  - 每位患者 2 条饮食记录
  - 3 条 AgentTask 日志
  - 每位患者 1 条知情同意书
"""
import asyncio
import sys
import os
from datetime import date, timedelta, datetime, timezone

_backend = os.path.join(os.path.dirname(__file__), "backend")
sys.path.insert(0, _backend)
os.chdir(_backend)

from dotenv import load_dotenv
load_dotenv(os.path.join(_backend, ".env"))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.models.models import (
    PatientProfile, ConsentRecord, LabResult, NutritionPlan,
    DietRecord, AgentTask,
    GenderEnum, TransplantPhase, ConsentStatus,
    AgentTaskType, AgentTaskStatus,
)
from app.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

TODAY = date.today()


# ─── 测试患者数据 ────────────────────────────────────────────────────────────
PATIENTS = [
    dict(
        name="张伟",
        gender=GenderEnum.MALE,
        birth_date=date(1965, 3, 12),
        phone="13800001111",
        height_cm=172.0, weight_kg=68.5, bmi=23.2,
        diagnosis="乙型肝炎后肝硬化（终末期）",
        transplant_date=TODAY - timedelta(days=5),
        current_phase=TransplantPhase.EARLY_POST_OP,
        id_number="110101196503120011",
    ),
    dict(
        name="李秀英",
        gender=GenderEnum.FEMALE,
        birth_date=date(1972, 7, 28),
        phone="13900002222",
        height_cm=158.0, weight_kg=52.0, bmi=20.8,
        diagnosis="原发性胆汁性肝硬化（PBC）",
        transplant_date=TODAY - timedelta(days=20),
        current_phase=TransplantPhase.RECOVERY,
        id_number="310105197207280022",
    ),
    dict(
        name="王建国",
        gender=GenderEnum.MALE,
        birth_date=date(1958, 11, 5),
        phone="13700003333",
        height_cm=168.0, weight_kg=74.0, bmi=26.2,
        diagnosis="肝细胞癌（Child B级）",
        transplant_date=TODAY - timedelta(days=60),
        current_phase=TransplantPhase.REHABILITATION,
        id_number="440101195811050033",
    ),
    dict(
        name="陈小梅",
        gender=GenderEnum.FEMALE,
        birth_date=date(1980, 2, 14),
        phone="13600004444",
        height_cm=162.0, weight_kg=58.0, bmi=22.1,
        diagnosis="自身免疫性肝炎（AIH）",
        transplant_date=None,
        current_phase=TransplantPhase.PRE_OPERATION,
        id_number="320101198002140044",
    ),
    dict(
        name="刘洋",
        gender=GenderEnum.MALE,
        birth_date=date(1975, 9, 22),
        phone="13500005555",
        height_cm=175.0, weight_kg=71.0, bmi=23.2,
        diagnosis="丙型肝炎肝硬化",
        transplant_date=TODAY - timedelta(days=180),
        current_phase=TransplantPhase.LONG_TERM_FOLLOW,
        id_number="510101197509220055",
    ),
]


def make_lab_items(phase: TransplantPhase, offset_days: int):
    """根据阶段生成有代表性的化验指标"""
    # 白蛋白随恢复期逐渐回升
    alb_map = {
        TransplantPhase.EARLY_POST_OP:    28.0 + offset_days * 0.3,
        TransplantPhase.RECOVERY:         32.0 + offset_days * 0.2,
        TransplantPhase.REHABILITATION:   36.0 + offset_days * 0.1,
        TransplantPhase.PRE_OPERATION:    30.5,
        TransplantPhase.LONG_TERM_FOLLOW: 40.0,
    }
    alb = round(alb_map.get(phase, 35.0), 1)

    return [
        {"name": "白蛋白(ALB)",    "value": alb,             "unit": "g/L",  "ref_range": "35-55",   "is_abnormal": alb < 35},
        {"name": "总胆红素(TBIL)", "value": round(35.0 - offset_days * 1.5, 1), "unit": "μmol/L", "ref_range": "3.4-17.1", "is_abnormal": True},
        {"name": "谷丙转氨酶(ALT)","value": round(80.0 - offset_days * 3.0, 1), "unit": "U/L",   "ref_range": "7-40", "is_abnormal": True},
        {"name": "谷草转氨酶(AST)","value": round(65.0 - offset_days * 2.5, 1), "unit": "U/L",   "ref_range": "13-35","is_abnormal": True},
        {"name": "前白蛋白(PA)",   "value": round(150.0 + offset_days * 5, 1),  "unit": "mg/L",  "ref_range": "170-420","is_abnormal": True},
        {"name": "血红蛋白(HB)",   "value": round(95.0 + offset_days * 1.0, 1), "unit": "g/L",   "ref_range": "120-160","is_abnormal": True},
    ]


async def seed():
    async with AsyncSessionLocal() as session:
        print("[1/6] 插入患者档案...")
        patient_objs = []
        for p in PATIENTS:
            obj = PatientProfile(**p)
            session.add(obj)
            patient_objs.append(obj)
        await session.flush()  # 获取生成的 UUID

        print("[2/6] 插入化验结果（每人3条）...")
        for pat in patient_objs:
            for i, day_offset in enumerate([0, 7, 14]):
                items = make_lab_items(pat.current_phase, day_offset)
                abnormal_count = sum(1 for x in items if x["is_abnormal"])
                lab = LabResult(
                    patient_id=pat.id,
                    report_date=TODAY - timedelta(days=14 - day_offset),
                    report_type="肝功能+营养指标",
                    source_image_path=None,
                    ocr_raw_data={"raw_text": f"[模拟OCR] {pat.name} 第{i+1}次化验"},
                    structured_items=items,
                    analysis_result={
                        "summary": f"白蛋白{items[0]['value']}g/L，{'偏低需干预' if items[0]['is_abnormal'] else '正常范围'}",
                        "risk_level": "high" if abnormal_count >= 4 else ("medium" if abnormal_count >= 2 else "low"),
                        "recommendations": [
                            "增加优质蛋白摄入（白蛋白偏低）",
                            "监测胆红素变化趋势",
                        ] if items[0]["is_abnormal"] else ["继续当前饮食方案"],
                    },
                    is_analyzed=i > 0,
                    phase_at_upload=pat.current_phase,
                )
                session.add(lab)

        print("[3/6] 插入营养方案...")
        PLANS = [
            ("肝移植术后早期肠内营养方案",
             {"energy_kcal": 1800, "protein_g": 90, "fat_g": 50, "carb_g": 240,
              "route": "鼻空肠管+口服补充", "formula": "肝病专用配方"},
             "术后早期以肠内营养为主，逐步过渡到经口进食。蛋白质供给1.2-1.5g/kg/d"),
            ("恢复期饮食方案",
             {"energy_kcal": 2000, "protein_g": 100, "fat_g": 55, "carb_g": 270,
              "route": "经口", "restriction": "低盐、低脂、软食"},
             "以优质蛋白（蛋、鱼、豆腐）为主，避免高钾食物，少食多餐"),
            ("康复期营养强化方案",
             {"energy_kcal": 2200, "protein_g": 110, "fat_g": 60, "carb_g": 280,
              "route": "经口", "supplement": "维生素D3 2000IU/d、钙片"},
             "注意免疫抑制剂与食物相互作用（避免西柚、石榴汁）"),
            ("术前营养支持方案",
             {"energy_kcal": 1900, "protein_g": 95, "fat_g": 52, "carb_g": 255,
              "route": "经口+口服营养补充剂(ONS)", "formula": "整蛋白型"},
             "术前纠正营养不良，目标体重增加1-2kg，提高手术耐受性"),
            ("长期随访营养维持方案",
             {"energy_kcal": 2000, "protein_g": 85, "fat_g": 55, "carb_g": 275,
              "route": "正常均衡饮食", "monitor": "每3个月复查营养指标"},
             "维持健康体重，预防代谢性并发症（糖尿病、高血压、高脂血症）"),
        ]
        for i, pat in enumerate(patient_objs):
            title, macros, notes = PLANS[i]
            plan = NutritionPlan(
                patient_id=pat.id,
                phase=pat.current_phase,
                is_active=True,
                generated_by="agent",
                plan_content={
                    "title": title,
                    **macros,
                    "meals": {
                        "breakfast": "小米粥200ml + 蒸蛋1个 + 豆腐脑100g",
                        "lunch": "米饭150g + 清蒸鱼100g + 炒时蔬150g",
                        "dinner": "面条150g + 鸡蓉豆腐汤 + 拌黄瓜",
                        "snack": "口服营养补充剂 200ml",
                    },
                    "restrictions": ["低盐(<3g/天)", "避免生冷", "避免西柚"],
                    "supplements": ["复合维生素B", "维生素D3", "钙片"],
                    "agent_notes": notes,
                },
            )
            session.add(plan)

        print("[4/6] 插入饮食打卡记录...")
        MEALS = [
            ("早餐", {"items": [{"name": "小米粥", "amount": "200ml"}, {"name": "蒸鸡蛋", "amount": "1个"}],
                      "energy_kcal": 320, "protein_g": 18}, 95, "进食良好，无恶心"),
            ("午餐", {"items": [{"name": "软米饭", "amount": "150g"}, {"name": "清蒸鲈鱼", "amount": "100g"}],
                      "energy_kcal": 480, "protein_g": 32}, 85, "食欲稍差，进食约80%"),
        ]
        for pat in patient_objs:
            for j, (meal_type, food_data, compliance_score, notes) in enumerate(MEALS):
                record = DietRecord(
                    patient_id=pat.id,
                    record_date=TODAY - timedelta(days=j),
                    meal_type=meal_type,
                    food_items=food_data["items"],
                    total_calories=food_data["energy_kcal"],
                    total_protein_g=food_data["protein_g"],
                    compliance_score=compliance_score,
                    ai_feedback={"notes": notes, "reviewed": True},
                )
                session.add(record)

        print("[5/6] 插入知情同意书...")
        for pat in patient_objs:
            consent = ConsentRecord(
                patient_id=pat.id,
                consent_type="肝移植患者营养干预知情同意书",
                status=ConsentStatus.SIGNED if pat.transplant_date else ConsentStatus.PENDING,
                signed_at=datetime(2026, 2, 1, 10, 30, tzinfo=timezone.utc) if pat.transplant_date else None,
                signature_image_path="/uploads/signatures/mock_sig.png" if pat.transplant_date else None,
                remarks="患者本人签署，清楚了解营养干预方案内容",
            )
            session.add(consent)

        print("[6/6] 插入 Agent 任务日志...")
        agent_tasks_data = [
            (patient_objs[0], AgentTaskType.LAB_ANALYSIS, AgentTaskStatus.COMPLETED,
             "分析最新肝功能化验结果",
             [{"step": "db_get_patient_info", "result": "OK"}, {"step": "db_get_recent_labs", "result": "3条"}, {"step": "run_python", "result": "slope=-0.8"}],
             "检测到白蛋白持续下降趋势（斜率=-0.8 g/L/天），当前值28.2g/L，低于正常下限35g/L。建议增加蛋白质摄入至1.5g/kg/d，考虑静脉补充人血白蛋白。"),
            (patient_objs[1], AgentTaskType.NUTRITION_PLAN, AgentTaskStatus.COMPLETED,
             "生成恢复期营养方案",
             [{"step": "db_get_patient_info", "result": "OK"}, {"step": "web_search", "result": "找到3篇指南"}, {"step": "plan_generate", "result": "OK"}],
             "基于患者恢复期特点，生成个体化营养方案：热量2000kcal/d，蛋白质100g/d，低盐软食为主。"),
            (patient_objs[2], AgentTaskType.GENERAL_QA, AgentTaskStatus.COMPLETED,
             "患者询问：免疫抑制剂期间可以吃西柚吗？",
             [{"step": "web_search", "result": "found drug-food interaction"}, {"step": "llm_synthesis", "result": "OK"}],
             "西柚中含有呋喃香豆素，可抑制CYP3A4酶，导致他克莫司、环孢素等免疫抑制剂血药浓度升高，增加毒副作用风险。建议严格避免食用西柚及其果汁。"),
        ]
        for pat, task_type, status, query, tool_chain, conclusion in agent_tasks_data:
            task = AgentTask(
                patient_id=pat.id,
                task_type=task_type,
                status=status,
                input_payload={"query": query},
                tool_call_chain=tool_chain,
                thinking_chain=[{"step": 1, "thought": "分析患者病情和化验数据...", "action": "db_get_patient_info"}, {"step": 2, "thought": "结合临床指南给出建议", "action": "llm_synthesis"}],
                final_output={"conclusion": conclusion},
                llm_model="gpt-4o",
                total_tokens=1250,
                triggered_by="user",
            )
            session.add(task)

        await session.commit()
        print("\n=== 测试数据写入完成 ===")
        print(f"  患者:       {len(patient_objs)} 条")
        print(f"  化验结果:   {len(patient_objs) * 3} 条")
        print(f"  营养方案:   {len(patient_objs)} 条")
        print(f"  饮食打卡:   {len(patient_objs) * 2} 条")
        print(f"  知情同意:   {len(patient_objs)} 条")
        print(f"  Agent任务:  3 条")


if __name__ == "__main__":
    asyncio.run(seed())
