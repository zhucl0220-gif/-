"""
app/api/endpoints/agent_query.py
══════════════════════════════════════════════════════
POST /api/v1/agent/query              医生自然语言问询入口
GET  /api/v1/agent/logs               日志列表（含完整思考链，供前端时间轴展示）
GET  /api/v1/agent/tasks              查询历史 AgentTask 列表
GET  /api/v1/agent/tasks/{task_id}    查看单次任务详情（含思考链）
══════════════════════════════════════════════════════
"""

import uuid
from datetime import timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import AgentTask, PatientProfile
from app.services.agent_service import analyze_patient_query

router = APIRouter(prefix="/agent", tags=["Agent Query"])


# ── 请求 / 响应 Schema ────────────────────────────────────────────────────────

class AgentQueryRequest(BaseModel):
    patient_id:   Optional[str] = Field(None,  description="患者 UUID（可选，为空时以通用肝移植知识库回答）")
    query:        str           = Field(..., min_length=2, max_length=1000, description="自然语言问题")
    triggered_by: str           = Field(default="user", description="触发来源")


class TrendPoint(BaseModel):
    date:        str | None
    value:       float
    unit:        str
    is_abnormal: bool


class TrendAnalysis(BaseModel):
    slope:        float | None
    is_declining: bool
    is_abnormal:  bool
    latest_value: float | None
    values:       list[float]


class AgentQueryResponse(BaseModel):
    task_id:         str
    patient_name:    str
    answer:          str
    albumin_series:  list[dict[str, Any]]
    trend_analysis:  dict[str, Any]
    search_evidence: list[str]
    thinking_steps:  int
    total_tokens:    int
    duration_ms:     int


# ── 端点实现 ─────────────────────────────────────────────────────────────────

@router.post(
    "/query",
    response_model=AgentQueryResponse,
    status_code=status.HTTP_200_OK,
    summary="医生自然语言问询（Multi-Tool Agent）",
    description=(
        "输入自然语言问题，Agent 自动编排工具调用（数据库查询 → Python 趋势分析 → "
        "条件触发 WebSearch → LLM 综合建议），返回结构化分析结果。"
    ),
)
async def agent_query(
    body: AgentQueryRequest,
    db:   AsyncSession = Depends(get_db),
) -> AgentQueryResponse:
    # patient_id 为空时，尝试取数据库第一位患者（演示/测试场景）
    effective_pid = body.patient_id
    if not effective_pid:
        from sqlalchemy import select as _sel
        from app.models.models import PatientProfile as _PP
        row = (await db.execute(_sel(_PP.id).limit(1))).scalar_one_or_none()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="patient_id 未提供且数据库中尚无患者档案，请先完善个人信息",
            )
        effective_pid = str(row)
    try:
        result = await analyze_patient_query(
            db           = db,
            patient_id   = effective_pid,
            doctor_query = body.query,
            triggered_by = body.triggered_by,
        )
        return AgentQueryResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent 执行失败: {e}")


@router.get(
    "/logs",
    summary="AI 助手日志（含完整思考链，供时间轴展示）",
)
async def get_agent_logs(
    patient_id: Optional[str] = Query(None, description="按患者过滤"),
    limit:      int           = Query(20, ge=1, le=100, description="最多返回条数"),
    db:         AsyncSession  = Depends(get_db),
) -> dict[str, Any]:
    """
    返回格式化日志列表，每条任务展开为「时间轴步骤」序列：
    - step 列表 ：合并 thinking_chain + tool_call_chain，按步骤顺序排列
    - tool 图标  ：前端按 action 字段渲染不同图标
    - 最终答案   ：final_output.answer
    """
    q = (
        select(AgentTask, PatientProfile.name.label("patient_name"))
        .outerjoin(PatientProfile, AgentTask.patient_id == PatientProfile.id)
        .order_by(desc(AgentTask.created_at))
        .limit(limit)
    )
    if patient_id:
        try:
            q = q.where(AgentTask.patient_id == uuid.UUID(patient_id))
        except ValueError:
            raise HTTPException(status_code=422, detail="patient_id 格式不正确")

    rows = (await db.execute(q)).all()

    def _fmt_ts(dt) -> str:
        """将 datetime 格式化为 HH:MM:SS，兼容 naive/aware"""
        if dt is None:
            return "—"
        if dt.tzinfo is not None:
            from datetime import timezone as tz
            dt = dt.astimezone(tz.utc).replace(tzinfo=None)
        return dt.strftime("%H:%M:%S")

    items = []
    for row in rows:
        task: AgentTask = row[0]
        patient_name: str | None = row[1]

        thinking  = task.thinking_chain  or []
        tool_calls = task.tool_call_chain or []
        final     = task.final_output    or {}

        # 构建统一步骤列表
        steps = []
        for tc in thinking:
            step_no = tc.get("step", 0)
            # 找对应工具调用耗时
            tc_match = next(
                (t for t in tool_calls if t.get("tool") == tc.get("action")),
                None,
            )
            steps.append({
                "step":         step_no,
                "thought":      tc.get("thought", ""),
                "action":       tc.get("action", ""),
                "action_input": tc.get("action_input", {}),
                "duration_ms":  tc_match.get("ms") if tc_match else None,
                "output_brief": _brief(tc_match.get("output") if tc_match else None),
            })

        # 若没有 thinking_chain，直接用 tool_call_chain 构建
        if not steps:
            for i, tc in enumerate(tool_calls, start=1):
                steps.append({
                    "step":         i,
                    "thought":      f"调用工具 {tc.get('tool')}",
                    "action":       tc.get("tool", ""),
                    "action_input": tc.get("input", {}),
                    "duration_ms":  tc.get("ms"),
                    "output_brief": _brief(tc.get("output")),
                })

        items.append({
            "task_id":      str(task.id),
            "patient_id":   str(task.patient_id) if task.patient_id else None,
            "patient_name": patient_name or "—",
            "query":        (task.input_payload or {}).get("query", "—"),
            "task_type":    task.task_type.value,
            "status":       task.status.value,
            "created_at":   task.created_at.isoformat() if task.created_at else None,
            "started_ts":   _fmt_ts(task.started_at or task.created_at),
            "duration_ms":  task.duration_ms,
            "total_tokens": task.total_tokens,
            "steps":        steps,
            "final_answer": final.get("answer") or final.get("summary", ""),
            "error":        (task.error_detail or {}).get("message"),
        })

    return {"total": len(items), "items": items}


def _brief(obj: Any, max_len: int = 120) -> str:
    """将工具输出简化为单行文本摘要"""
    if obj is None:
        return ""
    if isinstance(obj, str):
        return obj[:max_len] + ("…" if len(obj) > max_len else "")
    if isinstance(obj, dict):
        s = str(obj.get("answer") or obj.get("result") or obj.get("summary") or obj)
    elif isinstance(obj, list):
        s = f"[{len(obj)} 条记录]"
    else:
        s = str(obj)
    return s[:max_len] + ("…" if len(s) > max_len else "")


@router.get(
    "/tasks",
    summary="查询 AgentTask 列表",
)
async def list_agent_tasks(
    patient_id: str | None = None,
    limit:      int        = 20,
    db:         AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    q = select(AgentTask).order_by(desc(AgentTask.created_at)).limit(limit)
    if patient_id:
        q = q.where(AgentTask.patient_id == uuid.UUID(patient_id))
    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "task_id":     str(t.id),
            "task_type":   t.task_type.value,
            "status":      t.status.value,
            "duration_ms": t.duration_ms,
            "total_tokens":t.total_tokens,
            "created_at":  t.created_at.isoformat(),
            "query":       (t.input_payload or {}).get("query"),
        }
        for t in rows
    ]


@router.get(
    "/tasks/{task_id}",
    summary="查看单次任务详情（含完整思考链）",
)
async def get_agent_task(
    task_id: str,
    db:      AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await db.execute(
        select(AgentTask).where(AgentTask.id == uuid.UUID(task_id))
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {
        "task_id":         str(task.id),
        "task_type":       task.task_type.value,
        "status":          task.status.value,
        "input_payload":   task.input_payload,
        "thinking_chain":  task.thinking_chain,
        "tool_call_chain": task.tool_call_chain,
        "final_output":    task.final_output,
        "error_detail":    task.error_detail,
        "llm_model":       task.llm_model,
        "total_tokens":    task.total_tokens,
        "duration_ms":     task.duration_ms,
        "started_at":      task.started_at.isoformat() if task.started_at else None,
        "completed_at":    task.completed_at.isoformat() if task.completed_at else None,
    }
