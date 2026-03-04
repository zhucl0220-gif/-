"""
app/api/endpoints/knowledge.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
知识库 CMS HTTP 路由

挂载前缀: /api/v1/knowledge

端点列表:
  症状字典：
    GET    /symptoms              获取症状列表（可按 category 过滤）
    POST   /symptoms              新建症状条目
    PATCH  /symptoms/{id}         更新症状条目
    DELETE /symptoms/{id}         软删除症状条目

  Q&A 知识图谱:
    GET    /qa                    分页查询 Q&A 列表
    POST   /qa                    新建 Q&A 条目
    PATCH  /qa/{id}               更新 Q&A 条目
    DELETE /qa/{id}               删除 Q&A 条目
    POST   /qa/vectorize          批量向量化未同步条目（可选指定 id）

  阶段营养规则:
    GET    /rules                 获取全部阶段规则
    GET    /rules/{phase}         获取指定阶段规则
    PUT    /rules/{phase}         创建或更新指定阶段规则
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.tools.knowledge_tools import (
    manage_symptom_dict,
    manage_knowledge_graph,
    manage_nutrition_rules,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["知识库管理"])


# ══════════════════════════════════════════════════════════════════════════════
# Pydantic Schemas
# ══════════════════════════════════════════════════════════════════════════════

class FourDim(BaseModel):
    nutrition_impact:  str = ""
    dietary_advice:    str = ""
    warning_signs:     str = ""
    follow_up_action:  str = ""


class SymptomCreateBody(BaseModel):
    symptom_name:    str
    category:        str
    four_dim:        FourDim = Field(default_factory=FourDim)
    phase_relevance: dict[str, bool] = Field(default_factory=dict)
    is_active:       bool = True


class SymptomUpdateBody(BaseModel):
    symptom_name:    Optional[str]  = None
    category:        Optional[str]  = None
    four_dim:        Optional[dict[str, Any]] = None
    phase_relevance: Optional[dict[str, Any]] = None
    is_active:       Optional[bool] = None


class QACreateBody(BaseModel):
    question:   str
    answer:     str
    category:   str
    phase_tags: list[str] = Field(default_factory=list)
    source_doc: Optional[str] = None


class QAUpdateBody(BaseModel):
    question:   Optional[str]       = None
    answer:     Optional[str]       = None
    category:   Optional[str]       = None
    phase_tags: Optional[list[str]] = None
    source_doc: Optional[str]       = None


class VectorizeBody(BaseModel):
    id: Optional[str] = Field(None, description="指定单条 QA 的 UUID；为空则批量处理全部未向量化条目")


class RuleUpsertBody(BaseModel):
    energy_kcal_per_kg:   Optional[float]        = None
    protein_g_per_kg:     Optional[float]        = None
    rule_content:         dict[str, Any]         = Field(default_factory=dict)
    assessment_template:  dict[str, Any]         = Field(default_factory=dict)
    is_active:             bool                  = True
    updated_by:            Optional[str]         = None


# ══════════════════════════════════════════════════════════════════════════════
# 内部辅助
# ══════════════════════════════════════════════════════════════════════════════

def _raise_if_error(result: dict[str, Any]) -> None:
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "操作失败"))


# ══════════════════════════════════════════════════════════════════════════════
# 症状字典路由
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/symptoms", summary="获取症状列表")
async def list_symptoms(
    category: Optional[str] = Query(None, description="按分类过滤"),
    active_only: bool = Query(True, description="仅返回启用条目"),
) -> dict[str, Any]:
    result = await manage_symptom_dict(
        "list",
        {"category": category, "active_only": active_only},
    )
    _raise_if_error(result)
    return result


@router.post("/symptoms", summary="新建症状条目", status_code=201)
async def create_symptom(body: SymptomCreateBody) -> dict[str, Any]:
    result = await manage_symptom_dict("create", body.model_dump())
    _raise_if_error(result)
    return result


@router.patch("/symptoms/{symptom_id}", summary="更新症状条目")
async def update_symptom(symptom_id: str, body: SymptomUpdateBody) -> dict[str, Any]:
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    payload["id"] = symptom_id
    result = await manage_symptom_dict("update", payload)
    _raise_if_error(result)
    return result


@router.delete("/symptoms/{symptom_id}", summary="软删除症状条目")
async def delete_symptom(symptom_id: str) -> dict[str, Any]:
    result = await manage_symptom_dict("delete", {"id": symptom_id})
    _raise_if_error(result)
    return result


# ══════════════════════════════════════════════════════════════════════════════
# Q&A 知识图谱路由
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/qa", summary="分页查询 Q&A")
async def list_qa(
    category:   Optional[str]  = Query(None),
    vectorized: Optional[bool] = Query(None, description="过滤向量化状态"),
    page:       int            = Query(1, ge=1),
    page_size:  int            = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    result = await manage_knowledge_graph("list", {
        "category":   category,
        "vectorized": vectorized,
        "page":       page,
        "page_size":  page_size,
    })
    _raise_if_error(result)
    return result


@router.post("/qa", summary="新建 Q&A 条目", status_code=201)
async def create_qa(body: QACreateBody) -> dict[str, Any]:
    result = await manage_knowledge_graph("create", body.model_dump())
    _raise_if_error(result)
    return result


@router.patch("/qa/{qa_id}", summary="更新 Q&A 条目")
async def update_qa(qa_id: str, body: QAUpdateBody) -> dict[str, Any]:
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    payload["id"] = qa_id
    result = await manage_knowledge_graph("update", payload)
    _raise_if_error(result)
    return result


@router.delete("/qa/{qa_id}", summary="删除 Q&A 条目")
async def delete_qa(qa_id: str) -> dict[str, Any]:
    result = await manage_knowledge_graph("delete", {"id": qa_id})
    _raise_if_error(result)
    return result


@router.post("/qa/vectorize", summary="批量向量化 Q&A 条目")
async def vectorize_qa(body: VectorizeBody) -> dict[str, Any]:
    result = await manage_knowledge_graph("vectorize", {"id": body.id})
    _raise_if_error(result)
    return result


# ══════════════════════════════════════════════════════════════════════════════
# 阶段营养规则路由
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/rules", summary="获取全部阶段规则")
async def list_rules() -> dict[str, Any]:
    result = await manage_nutrition_rules("", {"list_all": True})
    _raise_if_error(result)
    return result


@router.get("/rules/{phase}", summary="获取指定阶段规则")
async def get_rule(phase: str) -> dict[str, Any]:
    result = await manage_nutrition_rules(phase, {"list_all": False})
    _raise_if_error(result)
    return result


@router.put("/rules/{phase}", summary="创建或更新指定阶段规则")
async def upsert_rule(phase: str, body: RuleUpsertBody) -> dict[str, Any]:
    result = await manage_nutrition_rules(phase, body.model_dump())
    _raise_if_error(result)
    return result
