"""
app/services/agent_service.py
═══════════════════════════════════════════════════════════════════════════════
核心 Agent 编排服务 —— 肝移植营养管理 Multi-Tool Reasoning Chain

架构模式：ReAct（Reasoning + Acting）
  每一步先写 thought（推理），再执行 action（工具调用），
  所有步骤记录到 AgentTask.thinking_chain / tool_call_chain，实现完整可审计。

工具清单（Tool Registry）
  ┌──────────────────────┬─────────────────────────────────────────────────┐
  │ 工具名称              │ 说明                                            │
  ├──────────────────────┼─────────────────────────────────────────────────┤
  │ db_get_recent_labs   │ 查询最近 N 次化验结果（从 PostgreSQL）           │
  │ db_get_patient_info  │ 查询患者基本档案                                │
  │ web_search           │ 调用 Serper / Google CSE / Mock 搜索引擎         │
  │ run_python           │ Python 沙箱（计算趋势斜率、营养评分等）          │
  └──────────────────────┴─────────────────────────────────────────────────┘

完整调用流程（以"白蛋白异常查询"为例）
  Step 1  解析 Intent     → 识别出关键指标：albumin；任务类型：trend + advice
  Step 2  db_get_patient_info → 获取患者基本信息（体重、阶段、移植日期）
  Step 3  db_get_recent_labs  → 最近 5 次化验，提取 albumin 序列
  Step 4  run_python          → 计算趋势斜率，判断是否持续下降
  Step 5  web_search          → 若异常，搜索最新循证饮食建议
  Step 6  LLM Synthesis       → 将患者数据 + 搜索结果 → 生成最终建议
  Step 7  持久化 AgentTask     → 写入 thinking_chain + tool_call_chain + final_output
═══════════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.models import (
    AgentTask, AgentTaskStatus, AgentTaskType,
    LabResult, PatientProfile,
)
from app.tools.sandbox_tools import execute_python_code
from app.tools.search_tools import web_search_summary

logger = logging.getLogger(__name__)
settings = get_settings()

# ─── 白蛋白正常参考范围（g/L） ────────────────────────────────────────────────
ALBUMIN_LOW  = 35.0   # 低于此值视为低蛋白血症
ALBUMIN_HIGH = 55.0

# ─── 趋势判断阈值：连续下降斜率（g/L / 次化验）────────────────────────────────
ALBUMIN_DECLINE_SLOPE_THRESHOLD = -0.5   # 每次化验平均降幅 > 0.5 g/L 视为持续下降


# ══════════════════════════════════════════════════════════════════════════════
# 内部工具函数（Database Tools）
# ══════════════════════════════════════════════════════════════════════════════

async def _db_get_patient_info(
    db: AsyncSession,
    patient_id: str,
) -> dict[str, Any] | None:
    """
    工具：db_get_patient_info
    从 patient_profiles 表查询患者基础信息。
    返回字典格式，方便直接注入到 LLM prompt context 中。
    """
    result = await db.execute(
        select(PatientProfile).where(
            PatientProfile.id == uuid.UUID(patient_id)
        )
    )
    patient: PatientProfile | None = result.scalar_one_or_none()
    if patient is None:
        return None

    return {
        "id":              str(patient.id),
        "name":            patient.name,
        "gender":          patient.gender.value,
        "weight_kg":       patient.weight_kg,
        "height_cm":       patient.height_cm,
        "bmi":             patient.bmi,
        "diagnosis":       patient.diagnosis,
        "transplant_date": patient.transplant_date.isoformat() if patient.transplant_date else None,
        "current_phase":   patient.current_phase.value,
    }


async def _db_get_recent_labs(
    db: AsyncSession,
    patient_id: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """
    工具：db_get_recent_labs
    查询患者最近 N 次化验结果，按 report_date 倒序排列。
    返回列表，每项包含 report_date、report_type、structured_items（化验指标列表）。

    structured_items 格式示例：
      [{"name": "白蛋白", "value": 28.5, "unit": "g/L",
        "ref_range": "35-55", "is_abnormal": true}, ...]
    """
    result = await db.execute(
        select(LabResult)
        .where(LabResult.patient_id == uuid.UUID(patient_id))
        .order_by(desc(LabResult.report_date))
        .limit(limit)
    )
    rows: list[LabResult] = list(result.scalars().all())

    return [
        {
            "id":               str(r.id),
            "report_date":      r.report_date.isoformat() if r.report_date else None,
            "report_type":      r.report_type,
            "structured_items": r.structured_items or [],
            "phase_at_upload":  r.phase_at_upload.value if r.phase_at_upload else None,
        }
        for r in rows
    ]


# ══════════════════════════════════════════════════════════════════════════════
# 辅助：从 structured_items 中提取单项指标序列
# ══════════════════════════════════════════════════════════════════════════════

def _extract_metric_series(
    labs: list[dict[str, Any]],
    metric_name: str,
) -> list[dict[str, Any]]:
    """
    从多次化验结果中提取某一指标的时间序列。

    返回格式：[{"date": "2025-01-20", "value": 28.5, "is_abnormal": True}, ...]
    按日期升序排列（便于趋势计算）。
    """
    series: list[dict[str, Any]] = []
    keywords = metric_name.lower().replace(" ", "")

    for lab in labs:
        for item in lab.get("structured_items", []):
            item_name = item.get("name", "").lower().replace(" ", "")
            # 模糊匹配：含关键词即命中（支持"白蛋白" / "albumin" / "ALB"）
            if keywords in item_name or item_name in keywords:
                try:
                    series.append({
                        "date":        lab["report_date"],
                        "value":       float(item["value"]),
                        "unit":        item.get("unit", ""),
                        "is_abnormal": bool(item.get("is_abnormal", False)),
                    })
                except (TypeError, ValueError):
                    pass

    # 升序排列
    series.sort(key=lambda x: x["date"] or "")
    return series


# ══════════════════════════════════════════════════════════════════════════════
# ReAct 思考链记录器
# ══════════════════════════════════════════════════════════════════════════════

class ThinkingChain:
    """
    线性记录 Agent 的推理步骤（Thought）和工具调用（Action/Observation）。
    最终序列化为 JSONB 写入 AgentTask.thinking_chain 和 tool_call_chain。
    """

    def __init__(self) -> None:
        self._steps: list[dict[str, Any]] = []
        self._tool_calls: list[dict[str, Any]] = []
        self._step_counter = 0

    def thought(self, content: str) -> None:
        """记录一步推理"""
        self._step_counter += 1
        self._steps.append({
            "step":      self._step_counter,
            "type":      "thought",
            "content":   content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        logger.debug("[Agent THOUGHT %d] %s", self._step_counter, content)

    def action(
        self,
        tool: str,
        tool_input: dict[str, Any],
        observation: Any,
        duration_ms: int,
        success: bool = True,
    ) -> None:
        """记录工具调用（action + observation）"""
        self._step_counter += 1
        step = {
            "step":          self._step_counter,
            "type":          "action",
            "tool":          tool,
            "action_input":  tool_input,
            "observation":   observation,
            "duration_ms":   duration_ms,
            "success":       success,
            "timestamp":     datetime.now(timezone.utc).isoformat(),
        }
        self._steps.append(step)
        self._tool_calls.append({
            "tool":        tool,
            "input":       tool_input,
            "output":      observation,
            "ms":          duration_ms,
            "success":     success,
        })
        logger.debug("[Agent ACTION %d] tool=%s duration=%dms", self._step_counter, tool, duration_ms)

    def conclusion(self, summary: str) -> None:
        """记录最终结论步骤"""
        self._step_counter += 1
        self._steps.append({
            "step":      self._step_counter,
            "type":      "conclusion",
            "content":   summary,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    @property
    def thinking_chain(self) -> list[dict[str, Any]]:
        return self._steps

    @property
    def tool_call_chain(self) -> list[dict[str, Any]]:
        return self._tool_calls


# ══════════════════════════════════════════════════════════════════════════════
# LLM 客户端（统一封装，方便未来换成 Claude / 本地模型）
# ══════════════════════════════════════════════════════════════════════════════

def _get_llm_client() -> AsyncOpenAI:
    """返回配置好的 AsyncOpenAI 客户端"""
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


async def _call_llm(
    system_prompt: str,
    user_message: str,
    model: str = "gpt-4o",
    temperature: float = 0.3,
) -> tuple[str, int]:
    """
    调用 LLM，返回 (reply_text, total_tokens)。
    temperature=0.3 保证医疗建议的稳定性和可复现性。
    """
    client = _get_llm_client()
    response = await client.chat.completions.create(
        model=model,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_message},
        ],
    )
    text   = response.choices[0].message.content or ""
    tokens = response.usage.total_tokens if response.usage else 0
    return text, tokens


# ══════════════════════════════════════════════════════════════════════════════
# 主 Agent 函数：analyze_patient_query
# ══════════════════════════════════════════════════════════════════════════════

async def analyze_patient_query(
    db: AsyncSession,
    patient_id: str,
    doctor_query: str,
    triggered_by: str = "user",
) -> dict[str, Any]:
    """
    核心 Agent 入口：解析医生自然语言问题，编排多工具推理，返回结构化建议。

    Parameters
    ----------
    db            : 异步数据库 session
    patient_id    : 患者 UUID（字符串格式）
    doctor_query  : 医生输入的自然语言，如"这个患者最近白蛋白怎么样？"
    triggered_by  : 触发来源（"user" | "system" | "scheduler"）

    Returns
    -------
    {
        "task_id":         str,             # AgentTask UUID
        "patient_name":    str,
        "answer":          str,             # 最终建议文本（Markdown）
        "albumin_series":  list[dict],      # 白蛋白时间序列
        "trend_analysis":  dict,            # 趋势分析结果
        "search_evidence": list[str],       # 循证检索摘要列表
        "thinking_steps":  int,             # 推理步骤总数
        "total_tokens":    int,
        "duration_ms":     int,
    }
    """
    wall_start = time.monotonic()
    chain      = ThinkingChain()
    total_tokens = 0

    # ── 创建 AgentTask 记录（状态：RUNNING）──────────────────────────────────
    task = AgentTask(
        patient_id   = uuid.UUID(patient_id),
        task_type    = AgentTaskType.LAB_ANALYSIS,
        status       = AgentTaskStatus.RUNNING,
        started_at   = datetime.now(timezone.utc),
        input_payload= {"query": doctor_query, "patient_id": patient_id},
        triggered_by = triggered_by,
        llm_model    = "gpt-4o",
    )
    db.add(task)
    await db.flush()   # 获得 task.id，不提交事务

    try:
        # ════════════════════════════════════════════════════════════════════
        # Step 1  Intent 解析
        # ════════════════════════════════════════════════════════════════════
        chain.thought(
            f"收到医生问题：「{doctor_query}」\n"
            "解析 Intent：\n"
            "  - 目标指标：白蛋白（albumin）\n"
            "  - 分析要求：（1）查询历史趋势，（2）若异常则搜索最新饮食建议\n"
            "  - 执行计划：db_get_patient_info → db_get_recent_labs → "
            "run_python(趋势斜率) → [条件触发] web_search → LLM 综合分析"
        )

        # ════════════════════════════════════════════════════════════════════
        # Step 2  数据库工具：查询患者基本信息
        # ════════════════════════════════════════════════════════════════════
        chain.thought("调用 db_get_patient_info：获取患者体重、移植阶段等上下文信息，"
                      "这些数据将用于个性化计算蛋白质目标摄入量。")
        t0 = time.monotonic()
        patient_info = await _db_get_patient_info(db, patient_id)
        tool_ms = int((time.monotonic() - t0) * 1000)

        if patient_info is None:
            raise ValueError(f"未找到患者 ID: {patient_id}")

        chain.action(
            tool        = "db_get_patient_info",
            tool_input  = {"patient_id": patient_id},
            observation = patient_info,
            duration_ms = tool_ms,
        )

        # ════════════════════════════════════════════════════════════════════
        # Step 3  数据库工具：查询最近 5 次化验结果
        # ════════════════════════════════════════════════════════════════════
        chain.thought("调用 db_get_recent_labs：检索最近 5 次化验单。"
                      "优先关注营养指标报告（白蛋白、前白蛋白、肌酐）。")
        t0 = time.monotonic()
        recent_labs = await _db_get_recent_labs(db, patient_id, limit=5)
        tool_ms = int((time.monotonic() - t0) * 1000)

        chain.action(
            tool        = "db_get_recent_labs",
            tool_input  = {"patient_id": patient_id, "limit": 5},
            observation = {
                "count":       len(recent_labs),
                "date_range":  (
                    f"{recent_labs[-1]['report_date']} ~ {recent_labs[0]['report_date']}"
                    if recent_labs else "无数据"
                ),
                "sample_types": list({r["report_type"] for r in recent_labs}),
            },
            duration_ms = tool_ms,
        )

        # 提取白蛋白时间序列（升序）
        albumin_series = _extract_metric_series(recent_labs, "白蛋白")
        if not albumin_series:
            # 尝试英文名称
            albumin_series = _extract_metric_series(recent_labs, "albumin")

        chain.thought(
            f"提取到白蛋白序列：{albumin_series}\n"
            f"共 {len(albumin_series)} 个数据点。"
            + (" 数据充足，准备进行趋势斜率分析。" if len(albumin_series) >= 2
               else " 数据点不足，无法计算趋势，跳过斜率计算。")
        )

        # ════════════════════════════════════════════════════════════════════
        # Step 4  Python 沙箱：计算趋势斜率（线性回归 slope）
        # ════════════════════════════════════════════════════════════════════
        trend_analysis: dict[str, Any] = {
            "slope":        None,
            "is_declining": False,
            "is_abnormal":  False,
            "latest_value": None,
            "values":       [p["value"] for p in albumin_series],
        }

        if len(albumin_series) >= 2:
            chain.thought("数据点 ≥ 2，调用 run_python 沙箱执行线性回归，"
                          "计算趋势斜率（slope），判断是否持续下降。")

            values_str = str([p["value"] for p in albumin_series])
            code = f"""
import numpy as np
values = {values_str}
x = np.arange(len(values))
slope, intercept = np.polyfit(x, values, 1)
latest = values[-1]
mean_val = np.mean(values)
std_val  = np.std(values)
result = {{
    "slope":        round(float(slope), 4),
    "intercept":    round(float(intercept), 4),
    "latest_value": round(float(latest), 2),
    "mean":         round(float(mean_val), 2),
    "std":          round(float(std_val), 2),
    "values":       values,
}}
print(result)
"""
            t0 = time.monotonic()
            sandbox_result = await execute_python_code(code, timeout_sec=15)
            tool_ms = int((time.monotonic() - t0) * 1000)

            if sandbox_result.get("success") and sandbox_result.get("stdout"):
                import ast as _ast
                try:
                    parsed = _ast.literal_eval(sandbox_result["stdout"].strip())
                    slope   = parsed.get("slope", 0.0)
                    latest  = parsed.get("latest_value", albumin_series[-1]["value"])

                    trend_analysis.update({
                        "slope":        slope,
                        "latest_value": latest,
                        "mean":         parsed.get("mean"),
                        "std":          parsed.get("std"),
                        "is_declining": slope <= ALBUMIN_DECLINE_SLOPE_THRESHOLD,
                        "is_abnormal":  latest < ALBUMIN_LOW or latest > ALBUMIN_HIGH,
                    })

                    chain.action(
                        tool        = "run_python",
                        tool_input  = {"code_summary": "numpy 线性回归（白蛋白趋势）", "values": values_str},
                        observation = trend_analysis,
                        duration_ms = tool_ms,
                    )
                    chain.thought(
                        f"斜率 = {slope:.4f} g/L/次，最新值 = {latest} g/L。\n"
                        + (f"⚠️  斜率 ≤ {ALBUMIN_DECLINE_SLOPE_THRESHOLD}，判断为持续下降趋势。\n"
                           if trend_analysis["is_declining"] else "趋势平稳或上升。\n")
                        + (f"⚠️  最新值 {latest} g/L 低于正常下限 {ALBUMIN_LOW} g/L，存在低蛋白血症。"
                           if trend_analysis["is_abnormal"] else "最新值在参考区间内。")
                    )
                except Exception as parse_err:
                    logger.warning("[Agent] 沙箱结果解析失败: %s", parse_err)
                    chain.action(
                        tool="run_python", tool_input={}, observation={"error": str(parse_err)},
                        duration_ms=tool_ms, success=False,
                    )
        else:
            # 数据不足时直接用最新值判断
            if albumin_series:
                latest = albumin_series[-1]["value"]
                trend_analysis["latest_value"] = latest
                trend_analysis["is_abnormal"]  = latest < ALBUMIN_LOW or latest > ALBUMIN_HIGH
            chain.thought("数据点不足 2 个，跳过斜率计算，仅依据最新值判断异常。")

        # ════════════════════════════════════════════════════════════════════
        # Step 5  条件触发：WebSearch（仅在指标异常或下降时触发）
        # ════════════════════════════════════════════════════════════════════
        search_evidence: list[str] = []
        should_search = trend_analysis["is_abnormal"] or trend_analysis["is_declining"]

        if should_search:
            chain.thought(
                "白蛋白异常或呈下降趋势，触发 web_search 工具检索循证饮食建议。\n"
                "搜索关键词：liver transplant albumin low diet recommendation evidence"
            )

            search_queries = [
                "liver transplant low albumin diet recommendation",
                "肝移植术后低蛋白血症营养干预 中国指南",
            ]

            for query in search_queries:
                t0 = time.monotonic()
                search_result = await web_search_summary(
                    query      = query,
                    num_results= 5,
                )
                tool_ms = int((time.monotonic() - t0) * 1000)

                summaries: list[str] = []
                if search_result.get("success") and search_result.get("results"):
                    for item in search_result["results"]:
                        snippet = item.get("snippet") or item.get("summary") or ""
                        if snippet:
                            summaries.append(f"[{item.get('title', '来源')}] {snippet}")

                chain.action(
                    tool        = "web_search",
                    tool_input  = {"query": query, "num_results": 5},
                    observation = {
                        "result_count": len(summaries),
                        "top_titles":   [r.get("title") for r in search_result.get("results", [])[:3]],
                    },
                    duration_ms = tool_ms,
                )
                search_evidence.extend(summaries)

            chain.thought(
                f"WebSearch 共获取 {len(search_evidence)} 条循证依据，"
                "将作为上下文喂给 LLM，生成个性化饮食建议。"
            )
        else:
            chain.thought(
                f"白蛋白最新值 {trend_analysis.get('latest_value')} g/L，"
                "趋势平稳且在正常范围内。无需触发 WebSearch，节约 API 配额。"
            )

        # ════════════════════════════════════════════════════════════════════
        # Step 6  LLM 综合分析：将所有数据 → 最终建议
        # ════════════════════════════════════════════════════════════════════
        chain.thought(
            "准备调用 GPT-4o 进行综合分析。\n"
            f"上下文注入：患者基本信息 + 白蛋白序列({len(albumin_series)}点) + "
            f"趋势分析 + 循证检索({len(search_evidence)}条)。\n"
            "System Prompt 角色：资深临床营养师，专注肝移植术后营养管理。"
        )

        # 构建 System Prompt
        system_prompt = """你是一位资深临床营养师，专注于肝移植患者的围手术期及术后营养管理。
你的任务是根据患者的化验数据和最新循证医学文献，为主治医生提供专业、具体、可操作的营养干预建议。

回答要求：
1. 语言：简洁、专业，使用中文，适合在医疗系统中展示给临床医生。
2. 结构：使用 Markdown，包含：① 数据解读 ② 风险评估 ③ 干预建议（具体量化） ④ 监测计划
3. 引用：如有循证依据，请注明来源。
4. 安全性：明确指出哪些情况需要立即上报或多学科会诊。
5. 禁止编造数据，仅基于提供的信息作出分析。"""

        # 构建 User Message（注入所有工具输出作为上下文）
        search_section = "\n".join(
            f"  - {s}" for s in search_evidence[:8]   # 最多取前 8 条，避免超 token
        ) if search_evidence else "  （未检索到相关文献，请参考最新 ESPEN/EASL 肝移植营养指南）"

        albumin_trend_str = " → ".join(
            f"{p['date']}({p['value']}g/L)"
            for p in albumin_series
        ) if albumin_series else "暂无数据"

        user_message = f"""
## 患者基本信息
- 姓名：{patient_info['name']}  性别：{patient_info['gender']}
- 体重：{patient_info.get('weight_kg', '未知')} kg  BMI：{patient_info.get('bmi', '未知')}
- 原发病：{patient_info.get('diagnosis', '未知')}
- 移植日期：{patient_info.get('transplant_date', '未知')}
- 当前阶段：{patient_info.get('current_phase', '未知')}

## 医生提问
{doctor_query}

## 白蛋白历史趋势（升序）
{albumin_trend_str}

## 趋势分析结果
- 最新值：{trend_analysis.get('latest_value', '未知')} g/L（参考区间：{ALBUMIN_LOW}–{ALBUMIN_HIGH} g/L）
- 线性斜率：{trend_analysis.get('slope', '未计算')} g/L/次化验
- 是否持续下降：{"是 ⚠️" if trend_analysis['is_declining'] else "否"}
- 是否异常：{"是 ⚠️" if trend_analysis['is_abnormal'] else "否"}

## 最新循证文献摘要
{search_section}

请基于以上信息，给出专业的营养评估与干预建议。
"""

        t0 = time.monotonic()
        llm_answer, tokens = await _call_llm(
            system_prompt = system_prompt,
            user_message  = user_message,
            model         = "gpt-4o",
            temperature   = 0.3,
        )
        llm_ms = int((time.monotonic() - t0) * 1000)
        total_tokens += tokens

        chain.action(
            tool        = "llm_synthesis",
            tool_input  = {
                "model":          "gpt-4o",
                "context_tokens": len(user_message.split()),   # 粗略估计
            },
            observation = {
                "answer_length": len(llm_answer),
                "total_tokens":  tokens,
            },
            duration_ms = llm_ms,
        )

        chain.conclusion(f"LLM 综合分析完成，生成建议文本（{len(llm_answer)} 字）。任务结束。")

        # ════════════════════════════════════════════════════════════════════
        # Step 7  持久化 AgentTask
        # ════════════════════════════════════════════════════════════════════
        total_ms = int((time.monotonic() - wall_start) * 1000)

        final_output = {
            "answer":          llm_answer,
            "albumin_series":  albumin_series,
            "trend_analysis":  trend_analysis,
            "search_evidence": search_evidence,
        }

        task.status         = AgentTaskStatus.COMPLETED
        task.completed_at   = datetime.now(timezone.utc)
        task.duration_ms    = total_ms
        task.thinking_chain = chain.thinking_chain
        task.tool_call_chain= chain.tool_call_chain
        task.final_output   = final_output
        task.total_tokens   = total_tokens

        await db.commit()

        logger.info(
            "[AgentService] task=%s completed in %dms tokens=%d steps=%d",
            task.id, total_ms, total_tokens, len(chain.thinking_chain),
        )

        return {
            "task_id":         str(task.id),
            "patient_name":    patient_info["name"],
            "answer":          llm_answer,
            "albumin_series":  albumin_series,
            "trend_analysis":  trend_analysis,
            "search_evidence": search_evidence,
            "thinking_steps":  len(chain.thinking_chain),
            "total_tokens":    total_tokens,
            "duration_ms":     total_ms,
        }

    except Exception as exc:
        # ── 错误处理：更新 AgentTask 状态为 FAILED ─────────────────────────
        import traceback
        total_ms = int((time.monotonic() - wall_start) * 1000)

        task.status          = AgentTaskStatus.FAILED
        task.completed_at    = datetime.now(timezone.utc)
        task.duration_ms     = total_ms
        task.thinking_chain  = chain.thinking_chain
        task.tool_call_chain = chain.tool_call_chain
        task.error_detail    = {
            "type":      type(exc).__name__,
            "message":   str(exc),
            "traceback": traceback.format_exc(),
        }
        await db.commit()

        logger.exception("[AgentService] task=%s FAILED: %s", task.id, exc)
        raise
