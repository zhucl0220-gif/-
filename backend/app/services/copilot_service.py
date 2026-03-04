"""
app/services/copilot_service.py
═══════════════════════════════════════════════════════════════════════════════
全局 AI Copilot 服务 — 多轮交互 + 自动执行工具链

核心设计模式：OpenAI Function Calling + Slot Filling + SSE 流式推送
─────────────────────────────────────────────────────────────────────────────
执行流程：
  1. 接收 messages 历史 → 调用 LLM（带 tools 参数）
  2. LLM 若返回 tool_calls → 执行工具 → 追加 observation → 继续循环
  3. LLM 若返回文本（无 tool_call）→ 直接推送给前端（可能是反问补参数）
  4. 最多循环 MAX_ITERATIONS 轮，防止死循环

SSE 事件格式（每行 `data: {JSON}\n\n`）：
  { "type": "thinking",    "content": "..." }          AI 推理文案
  { "type": "tool_start",  "step": N, "tool": "...",   "input": {...} }
  { "type": "tool_done",   "step": N, "tool": "...",   "output": {...}, "ms": N }
  { "type": "tool_error",  "step": N, "tool": "...",   "error": "..." }
  { "type": "reply_chunk", "content": "..." }          流式文字块
  { "type": "done",        "reply": "...", "steps": N }
  { "type": "error",       "message": "..." }
═══════════════════════════════════════════════════════════════════════════════
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone, date
from typing import Any, AsyncGenerator

from openai import AsyncOpenAI
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.models import (
    AgentTask, AgentTaskStatus, AgentTaskType,
    LabResult, NutritionPlan, PatientProfile, TransplantPhase, DietRecord,
)
from app.tools.search_tools import web_search_summary

logger = logging.getLogger(__name__)
settings = get_settings()

MAX_ITERATIONS = 8   # 最大 ReAct 循环轮数，防止无限循环

# ══════════════════════════════════════════════════════════════════════════════
# 工具定义（OpenAI Function Calling 格式）
# ══════════════════════════════════════════════════════════════════════════════

COPILOT_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_patient_by_name",
            "description": (
                "通过患者姓名在数据库中查找患者档案，返回患者ID、性别、年龄、诊断、"
                "移植日期、当前阶段、体重、身高、BMI等基本信息。"
                "当需要操作某位患者但只知道姓名时，必须先调用此工具获取 patient_id。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "患者姓名，支持模糊匹配（例如：张三、张）"
                    }
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_latest_lab_results",
            "description": (
                "获取指定患者最近的化验结果列表，包含白蛋白、肌酐、血红蛋白等指标。"
                "在分析患者营养状态或生成营养方案之前，应先调用此工具获取化验数据。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "patient_id": {
                        "type": "string",
                        "description": "患者UUID（从 get_patient_by_name 获取）"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "查询最近几次化验，默认3次",
                        "default": 3
                    }
                },
                "required": ["patient_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_diet_recent_summary",
            "description": (
                "获取患者最近7天的饮食打卡记录，包含总热量、蛋白质摄入、饮食依从性评分。"
                "用于评估患者实际饮食情况与营养方案的差距。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "patient_id": {
                        "type": "string",
                        "description": "患者UUID"
                    }
                },
                "required": ["patient_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_nutrition_plan",
            "description": (
                "根据患者档案、化验结果等信息，由 AI 自动生成个性化营养方案。"
                "方案包含每日热量目标、蛋白质目标、三餐建议、补充剂推荐、禁忌食物。"
                "调用此函数前，应已获取患者基本信息和最新化验结果。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "patient_id": {
                        "type": "string",
                        "description": "患者UUID"
                    },
                    "patient_context": {
                        "type": "string",
                        "description": "患者信息摘要（姓名、阶段、化验关键指标），作为生成依据"
                    },
                    "plan_type": {
                        "type": "string",
                        "description": "方案类型，如 '术后第1周'、'术后第2周'、'康复期'，默认自动判断",
                        "default": "auto"
                    }
                },
                "required": ["patient_id", "patient_context"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "save_nutrition_plan",
            "description": (
                "将生成的营养方案保存到数据库，返回方案ID和查看链接。"
                "这是营养方案生成流程的最后一步，在 generate_nutrition_plan 之后调用。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "patient_id": {
                        "type": "string",
                        "description": "患者UUID"
                    },
                    "plan_content": {
                        "type": "object",
                        "description": "方案内容（JSON），包含 energy_kcal, protein_g, meals, restrictions, supplements 等字段"
                    },
                    "phase": {
                        "type": "string",
                        "description": "适用阶段枚举：pre_assessment/pre_operation/early_post_op/recovery/rehabilitation/long_term_follow",
                        "default": "recovery"
                    }
                },
                "required": ["patient_id", "plan_content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_medical_knowledge",
            "description": (
                "在医学知识库和循证文献中搜索指定问题的最新建议。"
                "适用于：查询肝移植营养指南、药物-营养素相互作用、特定手术阶段的饮食建议等。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，支持中英文，例如：肝移植术后低蛋白血症营养干预"
                    }
                },
                "required": ["query"]
            }
        }
    },
]


# ══════════════════════════════════════════════════════════════════════════════
# 工具执行函数
# ══════════════════════════════════════════════════════════════════════════════

async def _tool_get_patient_by_name(name: str, db: AsyncSession) -> dict[str, Any]:
    """模糊搜索患者姓名"""
    from sqlalchemy import or_
    result = await db.execute(
        select(PatientProfile)
        .where(PatientProfile.name.ilike(f"%{name}%"))
        .limit(5)
    )
    patients = result.scalars().all()
    if not patients:
        return {"found": False, "message": f"未找到姓名包含「{name}」的患者，请确认姓名是否正确。"}
    if len(patients) == 1:
        p = patients[0]
        return {
            "found": True,
            "count": 1,
            "patient": {
                "id":              str(p.id),
                "name":            p.name,
                "gender":          p.gender.value,
                "weight_kg":       p.weight_kg,
                "height_cm":       p.height_cm,
                "bmi":             p.bmi,
                "diagnosis":       p.diagnosis,
                "transplant_date": p.transplant_date.isoformat() if p.transplant_date else None,
                "current_phase":   p.current_phase.value,
                "risk_level":      getattr(p, "risk_level", None),
            }
        }
    return {
        "found": True,
        "count": len(patients),
        "patients": [
            {"id": str(p.id), "name": p.name, "phase": p.current_phase.value}
            for p in patients
        ],
        "message": f"找到 {len(patients)} 位患者，请确认是哪一位。"
    }


async def _tool_get_latest_lab_results(
    patient_id: str, limit: int, db: AsyncSession
) -> dict[str, Any]:
    """查询最近 N 次化验结果"""
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        return {"error": f"patient_id 格式无效：{patient_id}"}
    results = await db.execute(
        select(LabResult)
        .where(LabResult.patient_id == pid)
        .order_by(desc(LabResult.report_date))
        .limit(limit)
    )
    labs = results.scalars().all()
    if not labs:
        return {"found": False, "message": "该患者暂无化验记录。"}
    return {
        "found": True,
        "count": len(labs),
        "results": [
            {
                "id":               str(r.id),
                "report_date":      r.report_date.isoformat() if r.report_date else None,
                "report_type":      r.report_type,
                "structured_items": (r.structured_items or [])[:20],  # 截断避免超 token
                "phase":            r.phase_at_upload.value if r.phase_at_upload else None,
            }
            for r in labs
        ]
    }


async def _tool_get_diet_recent_summary(
    patient_id: str, db: AsyncSession
) -> dict[str, Any]:
    """获取最近7天饮食打卡汇总"""
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        return {"error": f"patient_id 格式无效：{patient_id}"}
    from datetime import timedelta
    cutoff = date.today() - timedelta(days=7)
    results = await db.execute(
        select(DietRecord)
        .where(DietRecord.patient_id == pid, DietRecord.record_date >= cutoff)
        .order_by(desc(DietRecord.record_date))
        .limit(30)
    )
    records = results.scalars().all()
    if not records:
        return {"found": False, "message": "最近7天无饮食打卡记录。"}
    total_calories = sum(r.total_calories or 0 for r in records)
    total_protein  = sum(r.total_protein_g or 0 for r in records)
    avg_compliance = (
        sum(r.compliance_score or 0 for r in records) / len(records)
        if records else 0
    )
    return {
        "found": True,
        "record_count":       len(records),
        "total_calories_avg": round(total_calories / max(len({r.record_date for r in records}), 1), 1),
        "total_protein_avg":  round(total_protein  / max(len({r.record_date for r in records}), 1), 1),
        "avg_compliance_pct": round(avg_compliance, 1),
        "recent_dates":       sorted({r.record_date.isoformat() for r in records}, reverse=True)[:7],
    }


async def _tool_generate_nutrition_plan(
    patient_id: str,
    patient_context: str,
    plan_type: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """调用 LLM 生成结构化营养方案"""
    client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL or "https://api.openai.com/v1",
    )
    system_p = (
        "你是一位专注于肝移植患者营养管理的资深临床营养师。"
        "请根据患者信息，严格按照 JSON 格式返回个性化营养方案，不要添加任何额外文本。"
    )
    user_p = f"""
患者信息：
{patient_context}

方案类型：{plan_type}

请输出以下 JSON 格式的营养方案（不要有 Markdown 代码块包裹，直接输出 JSON）：
{{
  "summary": "方案摘要（1-2句话）",
  "energy_kcal": 1800,
  "protein_g": 90,
  "meals": [
    {{"meal": "早餐", "suggestions": ["燕麦粥200ml", "水煮蛋1个"], "notes": "低脂"}},
    {{"meal": "午餐", "suggestions": ["米饭150g", "清蒸鱼100g", "西兰花100g"], "notes": ""}},
    {{"meal": "晚餐", "suggestions": ["小米粥150ml", "豆腐50g", "青菜100g"], "notes": ""}},
    {{"meal": "加餐", "suggestions": ["脱脂牛奶200ml", "苹果半个"], "notes": "睡前2小时"}}
  ],
  "restrictions": ["限制高钾食物（香蕉、橙子）", "避免生冷食物", "限盐 <3g/天"],
  "supplements": ["支链氨基酸制剂", "维生素D 800IU/天"],
  "monitoring": "每周复查白蛋白，目标 ≥35 g/L",
  "phase_label": "{plan_type}"
}}
"""
    try:
        resp = await client.chat.completions.create(
            model=settings.LLM_MODEL,
            temperature=0.2,
            messages=[
                {"role": "system", "content": system_p},
                {"role": "user",   "content": user_p},
            ],
        )
        text = (resp.choices[0].message.content or "").strip()
        # 清理可能的 Markdown 代码块
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        plan_json = json.loads(text)
        return {"success": True, "plan": plan_json, "patient_id": patient_id}
    except json.JSONDecodeError:
        # LLM 未能输出合法 JSON，返回基础模板
        return {
            "success": True,
            "plan": {
                "summary": f"为患者生成的{plan_type}营养方案",
                "energy_kcal": 1800,
                "protein_g": 80,
                "meals": [],
                "restrictions": ["低盐低脂", "避免生冷"],
                "supplements": ["维生素D"],
                "monitoring": "每周复查营养指标",
                "phase_label": plan_type,
                "raw_text": text,
            },
            "patient_id": patient_id,
        }
    except Exception as e:
        logger.exception("generate_nutrition_plan error")
        return {"success": False, "error": str(e)}


async def _tool_save_nutrition_plan(
    patient_id: str,
    plan_content: dict[str, Any],
    phase: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """将营养方案持久化到数据库"""
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        return {"success": False, "error": f"patient_id 格式无效：{patient_id}"}

    phase_map = {v.value: v for v in TransplantPhase}
    phase_enum = phase_map.get(phase, TransplantPhase.RECOVERY)

    plan = NutritionPlan(
        patient_id    = pid,
        phase         = phase_enum,
        valid_from    = date.today(),
        is_active     = True,
        plan_content  = plan_content,
        generated_by  = "copilot",
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return {
        "success":  True,
        "plan_id":  str(plan.id),
        "view_url": f"/nutrition?patient_id={patient_id}",
        "message":  f"营养方案已保存，ID: {str(plan.id)[:8]}…",
    }


async def _tool_search_medical_knowledge(query: str) -> dict[str, Any]:
    """搜索医学知识库"""
    result = await web_search_summary(query=query, num_results=5)
    if result.get("success") and result.get("results"):
        snippets = [
            f"[{r.get('title','来源')}] {r.get('snippet') or r.get('summary','')}"
            for r in result["results"][:5]
            if r.get("snippet") or r.get("summary")
        ]
        return {"found": True, "snippets": snippets, "query": query}
    return {"found": False, "message": "未检索到相关文献，请参考 ESPEN/EASL 最新肝移植营养指南。"}


# ══════════════════════════════════════════════════════════════════════════════
# 工具分发器
# ══════════════════════════════════════════════════════════════════════════════

async def _dispatch_tool(
    tool_name: str,
    tool_args: dict[str, Any],
    db: AsyncSession,
) -> dict[str, Any]:
    """根据工具名称分发到具体执行函数"""
    if tool_name == "get_patient_by_name":
        return await _tool_get_patient_by_name(tool_args["name"], db)

    elif tool_name == "get_latest_lab_results":
        return await _tool_get_latest_lab_results(
            tool_args["patient_id"],
            tool_args.get("limit", 3),
            db,
        )

    elif tool_name == "get_diet_recent_summary":
        return await _tool_get_diet_recent_summary(tool_args["patient_id"], db)

    elif tool_name == "generate_nutrition_plan":
        return await _tool_generate_nutrition_plan(
            tool_args["patient_id"],
            tool_args.get("patient_context", ""),
            tool_args.get("plan_type", "auto"),
            db,
        )

    elif tool_name == "save_nutrition_plan":
        return await _tool_save_nutrition_plan(
            tool_args["patient_id"],
            tool_args.get("plan_content", {}),
            tool_args.get("phase", "recovery"),
            db,
        )

    elif tool_name == "search_medical_knowledge":
        return await _tool_search_medical_knowledge(tool_args["query"])

    else:
        return {"error": f"未知工具：{tool_name}"}


# ══════════════════════════════════════════════════════════════════════════════
# SSE 辅助：格式化事件
# ══════════════════════════════════════════════════════════════════════════════

def _sse(payload: dict[str, Any]) -> str:
    """将字典序列化为 SSE data 行"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


# ══════════════════════════════════════════════════════════════════════════════
# 核心 Copilot 流式执行器
# ══════════════════════════════════════════════════════════════════════════════

# 系统提示词
_SYSTEM_PROMPT = """\
你是「肝移植营养 AI 助理」，一套专为协和医院肝移植中心设计的智能助手。\
你可以帮助医生和营养师快速查询患者信息、分析化验结果、生成和保存营养方案。

## 你的能力（工具列表）
- get_patient_by_name：通过姓名查找患者档案和ID
- get_latest_lab_results：获取患者最新化验结果
- get_diet_recent_summary：查看患者近期饮食打卡数据
- generate_nutrition_plan：AI自动生成个性化营养方案
- save_nutrition_plan：将方案保存到数据库
- search_medical_knowledge：搜索循证医学文献建议

## 行为准则
1. **主动补全参数**：如果用户意图清晰但缺少必要参数（例如患者姓名），请直接询问。
2. **工具链自动执行**：一旦参数充足，主动串联多步工具调用完成复杂任务，无需等待用户逐步确认。
3. **简洁回复**：工具执行完成后，用1-3句话总结结果，并在适当时提供链接。
4. **安全边界**：不编造医疗数据，所有建议基于实际化验结果和循证依据。
5. 请使用中文回复，语气专业但亲切。
"""


# ══════════════════════════════════════════════════════════════════════════════
# Mock 模式（Key 未配置 / 占位符时自动启用）
# ══════════════════════════════════════════════════════════════════════════════

def _is_mock_mode() -> bool:
    """检查是否需要启用演示 Mock 模式"""
    key = settings.OPENAI_API_KEY or ""
    return not key or key.startswith("sk-placeholder") or key == "your-api-key"


async def _stream_text(text: str, chunk_size: int = 6) -> AsyncGenerator[str, None]:
    """将文本按块流式推送为 reply_chunk 事件"""
    for i in range(0, len(text), chunk_size):
        yield _sse({"type": "reply_chunk", "content": text[i:i + chunk_size]})
        await asyncio.sleep(0.02)


async def _mock_tool_step(
    step: int,
    tool: str,
    tool_input: dict[str, Any],
    db: AsyncSession,
    delay_ms: int = 0,
) -> tuple[str, dict[str, Any]]:
    """
    执行真实数据库工具（返回真实数据），同时推送 SSE 事件。
    返回两个 SSE 字符串：tool_start 和 tool_done / tool_error
    """
    start_evt = _sse({"type": "tool_start", "step": step, "tool": tool, "input": tool_input})
    if delay_ms:
        await asyncio.sleep(delay_ms / 1000)
    t0 = time.monotonic()
    try:
        observation = await _dispatch_tool(tool, tool_input, db)
    except Exception as e:
        ms = int((time.monotonic() - t0) * 1000)
        observation = {"error": str(e)}
        done_evt = _sse({"type": "tool_error", "step": step, "tool": tool, "error": str(e), "ms": ms})
        return start_evt, done_evt, observation
    ms = int((time.monotonic() - t0) * 1000)
    done_evt = _sse({"type": "tool_done", "step": step, "tool": tool, "output": observation, "ms": ms})
    return start_evt, done_evt, observation


async def _run_mock_stream(
    messages: list[dict[str, Any]],
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """
    Demo Mock 模式：无需真实 LLM，按对话意图模拟完整工具链流程。
    工具调用是真实的（查询真实数据库），只有 LLM 推理部分是规则模拟。
    """
    # 提取最后一条用户消息
    user_text = ""
    for m in reversed(messages):
        if m.get("role") == "user":
            user_text = m.get("content", "").strip()
            break

    # 提取对话历史中 AI 的上一条反问（判断是否是补参场景）
    last_assistant = ""
    for m in reversed(messages[:-1]):
        if m.get("role") == "assistant":
            last_assistant = m.get("content", "")
            break

    yield _sse({"type": "thinking", "content": "正在分析请求…"})
    await asyncio.sleep(0.3)

    # ── 场景一：生成营养方案 ──────────────────────────────────────────────────
    nutrition_keywords = ["营养方案", "营养计划", "生成方案", "制定方案", "饮食计划"]
    is_nutrition = any(k in user_text for k in nutrition_keywords)

    # 若上一条 AI 问的是患者姓名，且用户回答了 → 营养方案补参场景
    if "哪位患者" in last_assistant or "患者姓名" in last_assistant:
        is_nutrition = True

    # ── 场景二：查化验 ────────────────────────────────────────────────────────
    lab_keywords = ["化验", "检验", "血液", "白蛋白", "指标", "检查结果"]
    is_lab = any(k in user_text for k in lab_keywords) and not is_nutrition

    # ── 场景三：搜索知识库 ────────────────────────────────────────────────────
    search_keywords = ["指南", "建议", "搜索", "查询", "文献", "循证"]
    is_search = any(k in user_text for k in search_keywords) and not is_nutrition and not is_lab

    # ── 槽填充：用户说了患者姓名 → 触发营养方案主流 ─────────────────────────
    # 判断：短消息 + 看起来像姓名 + 上一条 AI 在问患者
    is_name_slot = (
        len(user_text) <= 8
        and "哪位" in last_assistant
        and not any(c in user_text for c in ["帮", "查", "生成", "方案"])
    )
    if is_name_slot:
        is_nutrition = True

    # ────────────────────────────────────────────────────────────────────────
    # 场景：仅询问患者姓名（补缺参数）
    # ────────────────────────────────────────────────────────────────────────
    if is_nutrition and not is_name_slot and not any(
        k in user_text for k in ["张", "李", "王", "刘", "陈", "赵", "孙"]
    ) and len(user_text) > 4 and "哪位" not in last_assistant:
        reply = "好的，请问您要为哪位患者生成营养方案？请输入患者姓名。"
        async for chunk in _stream_text(reply):
            yield chunk
        yield _sse({"type": "done", "reply": reply, "steps": 0})
        return

    # ────────────────────────────────────────────────────────────────────────
    # 场景：营养方案完整流程（已有患者姓名）
    # ────────────────────────────────────────────────────────────────────────
    if is_nutrition:
        # 从消息中提取患者名字（启发式：短消息 or 含常见姓氏）
        patient_name = user_text if len(user_text) <= 6 else None
        if not patient_name:
            for chunk in ["张伟", "张三"]:
                if chunk in user_text:
                    patient_name = chunk
                    break
        if not patient_name:
            patient_name = user_text[:4].strip() or "张伟"

        step = 0
        patient_id = None
        patient_info = {}

        # Step 1: 查找患者
        step += 1
        start, done, obs = await _mock_tool_step(
            step, "get_patient_by_name", {"name": patient_name}, db, delay_ms=200
        )
        yield start; yield done
        if obs.get("found") and obs.get("patient"):
            patient_id   = obs["patient"]["id"]
            patient_info = obs["patient"]
        elif obs.get("found") and obs.get("patients"):
            patient_id   = obs["patients"][0]["id"]
            patient_name = obs["patients"][0]["name"]
            patient_info = obs["patients"][0]

        if not patient_id:
            reply = f"抱歉，未找到姓名包含「{patient_name}」的患者，请确认姓名是否正确。"
            async for chunk in _stream_text(reply):
                yield chunk
            yield _sse({"type": "done", "reply": reply, "steps": step})
            return

        # Step 2: 查化验
        step += 1
        start, done, obs2 = await _mock_tool_step(
            step, "get_latest_lab_results", {"patient_id": patient_id, "limit": 3}, db, delay_ms=150
        )
        yield start; yield done

        # Step 3: 查饮食
        step += 1
        start, done, obs3 = await _mock_tool_step(
            step, "get_diet_recent_summary", {"patient_id": patient_id}, db, delay_ms=100
        )
        yield start; yield done

        # Step 4: 生成方案
        step += 1
        phase = patient_info.get("current_phase", "recovery")
        phase_label_map = {
            "pre_assessment": "术前评估期",
            "pre_operation": "术前准备期",
            "early_post_op": "术后早期",
            "recovery": "恢复期",
            "rehabilitation": "康复期",
            "long_term_follow": "长期随访期",
        }
        phase_label = phase_label_map.get(phase, "恢复期")
        lab_summary = f"化验 {obs2.get('count', 0)} 次记录" if obs2.get('found') else "暂无化验记录"
        diet_summary = (
            f"近7天均热量 {obs3.get('total_calories_avg', 'N/A')} kcal"
            if obs3.get('found') else "暂无饮食记录"
        )
        context_text = (
            f"患者：{patient_info.get('name', patient_name)}，"
            f"阶段：{phase_label}，体重：{patient_info.get('weight_kg', '?')}kg，"
            f"BMI：{patient_info.get('bmi', '?')}，{lab_summary}，{diet_summary}"
        )
        mock_plan = {
            "summary": f"{patient_info.get('name', patient_name)} {phase_label}营养方案",
            "energy_kcal": 1800,
            "protein_g": 85,
            "meals": [
                {"meal": "早餐", "suggestions": ["燕麦粥200ml", "水煮蛋1个", "全麦吐司1片"], "notes": "低脂"},
                {"meal": "午餐", "suggestions": ["米饭 150g", "清蒸鱼 100g", "西兰花 100g"], "notes": "优质蛋白"},
                {"meal": "晚餐", "suggestions": ["小米粥 150ml", "豆腐 80g", "菠菜 100g"], "notes": "易消化"},
                {"meal": "加餐", "suggestions": ["脱脂牛奶 200ml", "苹果 半个"], "notes": "睡前2小时"},
            ],
            "restrictions": ["限钠 <3g/天", "避免高钾食物（香蕉橙子）", "禁止生冷食物", "限制饮酒"],
            "supplements": ["支链氨基酸制剂（BCAA）", "维生素D 800IU/天", "益生菌制剂"],
            "monitoring": "每周复查白蛋白，目标 ≥35 g/L；每两周复查肾功能",
            "phase_label": phase_label,
        }
        start, done, obs4 = await _mock_tool_step(
            step, "generate_nutrition_plan",
            {"patient_id": patient_id, "patient_context": context_text, "plan_type": phase_label},
            db, delay_ms=800
        )
        # 用模拟方案替代（避免真实 LLM 调用失败）
        start_e = _sse({"type": "tool_start", "step": step, "tool": "generate_nutrition_plan",
                        "input": {"patient_id": patient_id, "plan_type": phase_label}})
        await asyncio.sleep(0.8)
        done_e = _sse({"type": "tool_done", "step": step, "tool": "generate_nutrition_plan",
                       "output": {"success": True, "plan": mock_plan}, "ms": 820})
        yield start_e; yield done_e

        # Step 5: 保存方案（真实写库）
        step += 1
        start, done, obs5 = await _mock_tool_step(
            step, "save_nutrition_plan",
            {"patient_id": patient_id, "plan_content": mock_plan, "phase": phase},
            db, delay_ms=100,
        )
        yield start; yield done

        # 最终回复
        pname = patient_info.get("name", patient_name)
        view_url = obs5.get("view_url", "/nutrition")
        plan_id  = obs5.get("plan_id", "")[:8] if obs5.get("plan_id") else ""
        reply = (
            f"✅ 已成功为 **{pname}** 生成并保存了《{phase_label}营养方案》。\n\n"
            f"**方案摘要：**\n"
            f"- 每日热量目标：**1800 kcal**\n"
            f"- 蛋白质目标：**85 g/天**（约 1.2g/kg 体重）\n"
            f"- 方案阶段：{phase_label}\n"
            f"- 监测目标：每周复查白蛋白 ≥35 g/L\n\n"
            f"方案 ID：`{plan_id}…`，可前往营养方案页面查看完整内容。\n\n"
            f"_注：当前为演示模式，配置真实 OPENAI_API_KEY 后将由 GPT-4o 生成个性化方案。_"
        )
        async for chunk in _stream_text(reply, chunk_size=10):
            yield chunk
        yield _sse({"type": "done", "reply": reply, "steps": step})
        return

    # ────────────────────────────────────────────────────────────────────────
    # 场景：查化验单
    # ────────────────────────────────────────────────────────────────────────
    if is_lab:
        # 先找患者
        name_hint = user_text
        step = 0
        step += 1
        start, done, obs = await _mock_tool_step(
            step, "get_patient_by_name", {"name": name_hint[:6]}, db, delay_ms=200
        )
        yield start; yield done

        patient_id = None
        if obs.get("found") and obs.get("patient"):
            patient_id = obs["patient"]["id"]
        elif obs.get("found") and obs.get("patients"):
            patient_id = obs["patients"][0]["id"]

        if patient_id:
            step += 1
            start, done, obs2 = await _mock_tool_step(
                step, "get_latest_lab_results", {"patient_id": patient_id, "limit": 3}, db, delay_ms=200
            )
            yield start; yield done
            count = obs2.get("count", 0)
            reply = (
                f"已查询到该患者最近 **{count}** 次化验记录。\n"
                "如需详细分析某项指标（如白蛋白趋势），请告知我具体需求。"
            )
        else:
            reply = "请提供患者姓名，我将为您查询化验结果。"

        async for chunk in _stream_text(reply):
            yield chunk
        yield _sse({"type": "done", "reply": reply, "steps": step})
        return

    # ────────────────────────────────────────────────────────────────────────
    # 场景：搜索医学知识
    # ────────────────────────────────────────────────────────────────────────
    if is_search:
        step = 1
        query = user_text[:50]
        start, done, obs = await _mock_tool_step(
            step, "search_medical_knowledge", {"query": query}, db, delay_ms=500
        )
        yield start; yield done
        snippets = obs.get("snippets", [])
        if snippets:
            reply = f"已检索到 {len(snippets)} 条相关文献，以下是主要建议：\n\n"
            for i, s in enumerate(snippets[:3], 1):
                reply += f"{i}. {s}\n"
        else:
            reply = "当前为演示模式（Mock 搜索），实际部署后将接入真实文献检索。建议参考 ESPEN/EASL 最新肝移植营养指南。"
        async for chunk in _stream_text(reply):
            yield chunk
        yield _sse({"type": "done", "reply": reply, "steps": step})
        return

    # ────────────────────────────────────────────────────────────────────────
    # 默认：通用回复
    # ────────────────────────────────────────────────────────────────────────
    reply = (
        "您好！我是肝移植营养 AI 助理（演示模式）。\n\n"
        "当前未配置真实 API Key，以下功能可正常演示：\n"
        "• 输入「帮我生成一份营养方案」→ 完整工具链演示\n"
        "• 输入患者姓名 → 查询真实数据库\n"
        "• 输入「查化验结果」→ 检索化验记录\n\n"
        "请在 `.env` 文件中配置 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 以启用完整 AI 功能。"
    )
    async for chunk in _stream_text(reply, chunk_size=10):
        yield chunk
    yield _sse({"type": "done", "reply": reply, "steps": 0})


async def run_copilot_stream(
    messages: list[dict[str, Any]],
    db: AsyncSession,
) -> AsyncGenerator[str, None]:
    """
    核心流式执行器。

    接收 messages（含完整对话历史），通过 SSE 逐步推送：
      - thinking 事件（每轮开始）
      - tool_start / tool_done 事件（每次工具调用）
      - reply_chunk 事件（最终回复流式输出）
      - done 事件（结束标志）

    参数
    ----
    messages : OpenAI 格式的消息列表，不含 system 消息（此处自动注入）
    db       : 异步数据库 session
    """
    # ── Mock 模式（API Key 未配置时自动降级）──────────────────────────────────
    if _is_mock_mode():
        async for event in _run_mock_stream(messages, db):
            yield event
        return

    client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL or "https://api.openai.com/v1",
    )

    # 注入系统提示
    full_messages: list[dict[str, Any]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        *messages,
    ]

    step_counter = 0
    full_reply   = ""

    try:
        for iteration in range(MAX_ITERATIONS):
            # ── 推送"思考中"状态 ──────────────────────────────────────────
            yield _sse({"type": "thinking", "content": "正在分析请求…"})

            # ── 调用 LLM（非流式，等待完整 response 以处理 tool_calls） ───
            response = await client.chat.completions.create(
                model=settings.LLM_MODEL,
                temperature=0.3,
                messages=full_messages,
                tools=COPILOT_TOOLS,
                tool_choice="auto",
            )

            msg = response.choices[0].message
            finish_reason = response.choices[0].finish_reason

            # ────────────────────────────────────────────────────────────────
            # 情况 A：LLM 返回文本（无工具调用）→ 直接作为最终回复输出
            # ────────────────────────────────────────────────────────────────
            if finish_reason == "stop" or not msg.tool_calls:
                text = msg.content or ""
                full_reply = text

                # 模拟流式：按字符块推送
                chunk_size = 8
                for i in range(0, len(text), chunk_size):
                    yield _sse({"type": "reply_chunk", "content": text[i:i + chunk_size]})

                yield _sse({
                    "type":  "done",
                    "reply": full_reply,
                    "steps": step_counter,
                })
                return

            # ────────────────────────────────────────────────────────────────
            # 情况 B：LLM 发出工具调用 → 逐一执行
            # ────────────────────────────────────────────────────────────────

            # 先将 assistant 消息（含 tool_calls）加入历史
            full_messages.append({
                "role":       "assistant",
                "content":    msg.content or "",
                "tool_calls": [
                    {
                        "id":       tc.id,
                        "type":     "function",
                        "function": {
                            "name":      tc.function.name,
                            "arguments": tc.function.arguments,
                        }
                    }
                    for tc in msg.tool_calls
                ]
            })

            tool_results: list[dict[str, Any]] = []

            for tc in msg.tool_calls:
                step_counter += 1
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                # ── 推送工具开始事件 ──────────────────────────────────────
                yield _sse({
                    "type":  "tool_start",
                    "step":  step_counter,
                    "tool":  tool_name,
                    "input": tool_args,
                })

                t0 = time.monotonic()
                try:
                    observation = await _dispatch_tool(tool_name, tool_args, db)
                    duration_ms = int((time.monotonic() - t0) * 1000)

                    yield _sse({
                        "type":    "tool_done",
                        "step":    step_counter,
                        "tool":    tool_name,
                        "output":  observation,
                        "ms":      duration_ms,
                    })
                    tool_results.append({
                        "tool_call_id": tc.id,
                        "role":         "tool",
                        "name":         tool_name,
                        "content":      json.dumps(observation, ensure_ascii=False),
                    })

                except Exception as tool_err:
                    duration_ms = int((time.monotonic() - t0) * 1000)
                    err_msg = str(tool_err)
                    logger.exception("[Copilot] tool=%s error", tool_name)

                    yield _sse({
                        "type":  "tool_error",
                        "step":  step_counter,
                        "tool":  tool_name,
                        "error": err_msg,
                        "ms":    duration_ms,
                    })
                    tool_results.append({
                        "tool_call_id": tc.id,
                        "role":         "tool",
                        "name":         tool_name,
                        "content":      json.dumps({"error": err_msg}, ensure_ascii=False),
                    })

            # 将所有 tool 结果追加到消息历史，进入下一轮
            full_messages.extend(tool_results)

        # 超出最大迭代次数
        err_text = "已达到最大推理轮数，请重新描述您的需求。"
        yield _sse({"type": "reply_chunk", "content": err_text})
        yield _sse({"type": "done", "reply": err_text, "steps": step_counter})

    except Exception as exc:
        exc_str = str(exc).lower()
        # 连接失败 / 认证失败 → 自动降级到 Mock 演示模式
        is_conn_err = any(k in exc_str for k in [
            "connection", "connect", "timeout", "network",
            "authentication", "unauthorized", "apiconnection",
            "接连", "超时", "refused",
        ])
        if is_conn_err:
            logger.warning("[CopilotService] LLM 连接失败，降级 Mock 模式: %s", exc)
            tip = _sse({
                "type": "reply_chunk",
                "content": "⚠️ LLM 服务连接失败（网络不可达），已切换演示模式。\n\n",
            })
            yield tip
            async for event in _run_mock_stream(messages, db):
                yield event
        else:
            logger.exception("[CopilotService] 未捕获异常")
            yield _sse({"type": "error", "message": str(exc)})
            yield _sse({"type": "done", "reply": f"发生错误：{exc}", "steps": step_counter})
