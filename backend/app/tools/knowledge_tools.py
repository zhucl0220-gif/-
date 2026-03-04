"""
app/tools/knowledge_tools.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
知识库 CMS 工具集（AI-callable Tools）

工具列表：
  manage_symptom_dict(action, symptom_data)      症状字典 CRUD
  manage_knowledge_graph(action, node_data)      Q&A 知识图谱 CRUD + 向量化
  manage_nutrition_rules(phase, rules)           阶段营养规则 upsert

所有工具均为 async 函数，供 AgentService / FastAPI 路由直接调用。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError

from app.database import AsyncSessionLocal
from app.models.models import SymptomEntry, KnowledgeQA, NutritionRuleConfig

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# Tool 1 – 症状字典管理
# ══════════════════════════════════════════════════════════════════════════════

async def manage_symptom_dict(
    action: str,
    symptom_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    症状字典 CRUD 工具。

    action:
      "list"   → 返回所有启用的症状条目（可选 category 过滤）
      "create" → 新建症状条目
      "update" → 按 id 更新字段
      "delete" → 按 id 软删除（is_active=False）
      "hard_delete" → 按 id 物理删除

    symptom_data 字段（create/update）：
      id (update/delete 必须), symptom_name, category,
      four_dim: { nutrition_impact, dietary_advice, warning_signs, follow_up_action },
      phase_relevance: { phase_key: bool, ... },
      is_active
    """
    action = (action or "").strip().lower()
    data = symptom_data or {}

    async with AsyncSessionLocal() as session:
        # ── LIST ─────────────────────────────────────────────────────────────
        if action == "list":
            stmt = select(SymptomEntry).order_by(SymptomEntry.category, SymptomEntry.symptom_name)
            category_filter = data.get("category")
            if category_filter:
                stmt = stmt.where(SymptomEntry.category == category_filter)
            active_only = data.get("active_only", True)
            if active_only:
                stmt = stmt.where(SymptomEntry.is_active.is_(True))
            rows = (await session.execute(stmt)).scalars().all()
            return {
                "success": True,
                "total": len(rows),
                "items": [_symptom_to_dict(r) for r in rows],
            }

        # ── CREATE ────────────────────────────────────────────────────────────
        if action == "create":
            required = ["symptom_name", "category"]
            missing = [f for f in required if not data.get(f)]
            if missing:
                return {"success": False, "error": f"缺少必填字段: {missing}"}
            entry = SymptomEntry(
                id=uuid.uuid4(),
                symptom_name=data["symptom_name"].strip(),
                category=data["category"].strip(),
                four_dim=data.get("four_dim", {
                    "nutrition_impact": "",
                    "dietary_advice": "",
                    "warning_signs": "",
                    "follow_up_action": "",
                }),
                phase_relevance=data.get("phase_relevance", {}),
                is_active=data.get("is_active", True),
            )
            try:
                session.add(entry)
                await session.commit()
                await session.refresh(entry)
                return {"success": True, "action": "created", "item": _symptom_to_dict(entry)}
            except IntegrityError:
                await session.rollback()
                return {"success": False, "error": f"症状名称 '{data['symptom_name']}' 已存在"}

        # ── UPDATE ────────────────────────────────────────────────────────────
        if action == "update":
            entry_id = data.get("id")
            if not entry_id:
                return {"success": False, "error": "update 需要提供 id"}
            entry = await session.get(SymptomEntry, uuid.UUID(str(entry_id)))
            if not entry:
                return {"success": False, "error": "未找到对应症状条目"}
            for field in ("symptom_name", "category", "four_dim", "phase_relevance", "is_active"):
                if field in data:
                    setattr(entry, field, data[field])
            await session.commit()
            await session.refresh(entry)
            return {"success": True, "action": "updated", "item": _symptom_to_dict(entry)}

        # ── DELETE (soft) ─────────────────────────────────────────────────────
        if action == "delete":
            entry_id = data.get("id")
            if not entry_id:
                return {"success": False, "error": "delete 需要提供 id"}
            entry = await session.get(SymptomEntry, uuid.UUID(str(entry_id)))
            if not entry:
                return {"success": False, "error": "未找到对应症状条目"}
            entry.is_active = False
            await session.commit()
            return {"success": True, "action": "deactivated", "id": str(entry_id)}

        # ── HARD DELETE ───────────────────────────────────────────────────────
        if action == "hard_delete":
            entry_id = data.get("id")
            if not entry_id:
                return {"success": False, "error": "hard_delete 需要提供 id"}
            stmt = delete(SymptomEntry).where(SymptomEntry.id == uuid.UUID(str(entry_id)))
            await session.execute(stmt)
            await session.commit()
            return {"success": True, "action": "deleted", "id": str(entry_id)}

    return {"success": False, "error": f"未知 action: {action}"}


def _symptom_to_dict(e: SymptomEntry) -> dict[str, Any]:
    return {
        "id": str(e.id),
        "symptom_name": e.symptom_name,
        "category": e.category,
        "four_dim": e.four_dim,
        "phase_relevance": e.phase_relevance,
        "is_active": e.is_active,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Tool 2 – AI 知识图谱 Q&A 管理
# ══════════════════════════════════════════════════════════════════════════════

async def manage_knowledge_graph(
    action: str,
    node_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    AI 知识图谱（Q&A 对）CRUD + 向量化 工具。

    action:
      "list"      → 分页/过滤查询 Q&A 列表
      "create"    → 新建 Q&A 条目
      "update"    → 按 id 更新字段
      "delete"    → 按 id 物理删除
      "vectorize" → 将指定 id（或全部未向量化）的条目标记为已向量化
                    （真实场景此处调用 OpenAI Embeddings API，本版本模拟）

    node_data 字段（create/update）：
      id (update/delete/vectorize 需要), question, answer, category,
      phase_tags: [str, ...],
      source_doc, vector_id
    """
    action = (action or "").strip().lower()
    data = node_data or {}

    async with AsyncSessionLocal() as session:
        # ── LIST ─────────────────────────────────────────────────────────────
        if action == "list":
            stmt = select(KnowledgeQA).order_by(KnowledgeQA.created_at.desc())
            if data.get("category"):
                stmt = stmt.where(KnowledgeQA.category == data["category"])
            if data.get("vectorized") is not None:
                stmt = stmt.where(KnowledgeQA.is_vectorized.is_(data["vectorized"]))
            page = max(1, int(data.get("page", 1)))
            page_size = min(100, int(data.get("page_size", 20)))
            total_stmt = select(KnowledgeQA)
            if data.get("category"):
                total_stmt = total_stmt.where(KnowledgeQA.category == data["category"])
            all_rows = (await session.execute(total_stmt)).scalars().all()
            total = len(all_rows)
            stmt = stmt.offset((page - 1) * page_size).limit(page_size)
            rows = (await session.execute(stmt)).scalars().all()
            return {
                "success": True,
                "total": total,
                "page": page,
                "page_size": page_size,
                "items": [_qa_to_dict(r) for r in rows],
            }

        # ── CREATE ────────────────────────────────────────────────────────────
        if action == "create":
            required = ["question", "answer", "category"]
            missing = [f for f in required if not data.get(f)]
            if missing:
                return {"success": False, "error": f"缺少必填字段: {missing}"}
            qa = KnowledgeQA(
                id=uuid.uuid4(),
                question=data["question"].strip(),
                answer=data["answer"].strip(),
                category=data["category"].strip(),
                phase_tags=data.get("phase_tags", []),
                source_doc=data.get("source_doc"),
                vector_id=data.get("vector_id"),
                is_vectorized=False,
            )
            session.add(qa)
            await session.commit()
            await session.refresh(qa)
            return {"success": True, "action": "created", "item": _qa_to_dict(qa)}

        # ── UPDATE ────────────────────────────────────────────────────────────
        if action == "update":
            qa_id = data.get("id")
            if not qa_id:
                return {"success": False, "error": "update 需要提供 id"}
            qa = await session.get(KnowledgeQA, uuid.UUID(str(qa_id)))
            if not qa:
                return {"success": False, "error": "未找到对应 QA 条目"}
            for field in ("question", "answer", "category", "phase_tags", "source_doc", "vector_id"):
                if field in data:
                    setattr(qa, field, data[field])
            # 若内容被修改，重置向量化状态
            if any(f in data for f in ("question", "answer")):
                qa.is_vectorized = False
                qa.vectorized_at = None
            await session.commit()
            await session.refresh(qa)
            return {"success": True, "action": "updated", "item": _qa_to_dict(qa)}

        # ── DELETE ────────────────────────────────────────────────────────────
        if action == "delete":
            qa_id = data.get("id")
            if not qa_id:
                return {"success": False, "error": "delete 需要提供 id"}
            stmt = delete(KnowledgeQA).where(KnowledgeQA.id == uuid.UUID(str(qa_id)))
            result = await session.execute(stmt)
            await session.commit()
            return {
                "success": True,
                "action": "deleted",
                "rows_deleted": result.rowcount,
            }

        # ── VECTORIZE ─────────────────────────────────────────────────────────
        if action == "vectorize":
            target_id = data.get("id")
            if target_id:
                # 单条向量化
                qa = await session.get(KnowledgeQA, uuid.UUID(str(target_id)))
                if not qa:
                    return {"success": False, "error": "未找到对应 QA 条目"}
                targets = [qa]
            else:
                # 批量：所有未向量化
                stmt = select(KnowledgeQA).where(KnowledgeQA.is_vectorized.is_(False))
                targets = (await session.execute(stmt)).scalars().all()

            vectorized_count = 0
            for q in targets:
                # TODO: 真实场景此处调用 OpenAI text-embedding-3-small
                # embeddings = await openai_client.embeddings.create(...)
                # q.vector_id = embeddings.data[0].id or store_in_vector_db(...)
                q.is_vectorized = True
                q.vectorized_at = datetime.now(timezone.utc)
                vectorized_count += 1

            await session.commit()
            return {
                "success": True,
                "action": "vectorized",
                "vectorized_count": vectorized_count,
                "message": f"成功向量化 {vectorized_count} 条 Q&A 记录（模拟模式）",
            }

    return {"success": False, "error": f"未知 action: {action}"}


def _qa_to_dict(q: KnowledgeQA) -> dict[str, Any]:
    return {
        "id": str(q.id),
        "question": q.question,
        "answer": q.answer,
        "category": q.category,
        "phase_tags": q.phase_tags,
        "source_doc": q.source_doc,
        "vector_id": q.vector_id,
        "is_vectorized": q.is_vectorized,
        "vectorized_at": q.vectorized_at.isoformat() if q.vectorized_at else None,
        "created_at": q.created_at.isoformat() if q.created_at else None,
        "updated_at": q.updated_at.isoformat() if q.updated_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Tool 3 – 阶段营养规则配置
# ══════════════════════════════════════════════════════════════════════════════

async def manage_nutrition_rules(
    phase: str,
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    阶段营养规则 upsert 工具。

    phase: TransplantPhase 枚举值字符串，如 "early_post_op"
    rules:
      energy_kcal_per_kg (float)   推荐能量 kcal/kg/d
      protein_g_per_kg   (float)   推荐蛋白 g/kg/d
      rule_content       (dict)    完整规则描述，任意结构
      assessment_template(dict)    评估量表模板
      is_active          (bool)
      updated_by         (str)     操作医生姓名/ID
      list_all           (bool)    若 True 则忽略 phase，返回全部配置列表

    如果 rules 中包含 list_all=True，则返回所有阶段规则；
    否则对指定 phase 进行 upsert。
    """
    rules = rules or {}

    async with AsyncSessionLocal() as session:
        # ── LIST ALL ──────────────────────────────────────────────────────────
        if rules.get("list_all"):
            stmt = select(NutritionRuleConfig).order_by(NutritionRuleConfig.phase)
            rows = (await session.execute(stmt)).scalars().all()
            return {
                "success": True,
                "total": len(rows),
                "items": [_rule_to_dict(r) for r in rows],
            }

        if not phase:
            return {"success": False, "error": "phase 不能为空"}

        # ── UPSERT ────────────────────────────────────────────────────────────
        stmt = select(NutritionRuleConfig).where(NutritionRuleConfig.phase == phase)
        existing = (await session.execute(stmt)).scalar_one_or_none()

        if existing:
            for field in ("energy_kcal_per_kg", "protein_g_per_kg", "rule_content",
                          "assessment_template", "is_active", "updated_by"):
                if field in rules:
                    setattr(existing, field, rules[field])
            await session.commit()
            await session.refresh(existing)
            return {"success": True, "action": "updated", "item": _rule_to_dict(existing)}
        else:
            cfg = NutritionRuleConfig(
                id=uuid.uuid4(),
                phase=phase,
                energy_kcal_per_kg=rules.get("energy_kcal_per_kg"),
                protein_g_per_kg=rules.get("protein_g_per_kg"),
                rule_content=rules.get("rule_content", {}),
                assessment_template=rules.get("assessment_template", {}),
                is_active=rules.get("is_active", True),
                updated_by=rules.get("updated_by"),
            )
            session.add(cfg)
            await session.commit()
            await session.refresh(cfg)
            return {"success": True, "action": "created", "item": _rule_to_dict(cfg)}


def _rule_to_dict(r: NutritionRuleConfig) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "phase": r.phase,
        "energy_kcal_per_kg": r.energy_kcal_per_kg,
        "protein_g_per_kg": r.protein_g_per_kg,
        "rule_content": r.rule_content,
        "assessment_template": r.assessment_template,
        "is_active": r.is_active,
        "updated_by": r.updated_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }
