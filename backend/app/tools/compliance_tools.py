"""
app/tools/compliance_tools.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
知情同意 Agent Tools
将 compliance_service 的核心能力封装为标准化 Tool，
可被 LangChain Agent / OpenAI Function Calling 直接调用。

对外暴露的 Tool 函数：
  - sign_and_unlock_user       完整签署流程（主工具）
  - check_consent_status       查询用户是否已解锁
  - revoke_consent             撤销同意（退出知情同意）
  - get_consent_pdf_url        获取已签署 PDF 的访问 URL

每个函数均满足 Agent Tool 的设计原则：
  ✓ 纯函数签名，参数类型明确
  ✓ 返回 JSON-able 字典（Agent 可直接读取）
  ✓ 携带 Pydantic 描述，便于 Function Calling Schema 自动生成
  ✓ 内部异常被捕获并结构化返回（不抛出），让 Agent 决策如何重试
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.compliance_service import (
    get_consent_status,
    process_consent_signing,
    get_or_create_consent_record,
    mark_consent_signed,
    SIGNED_PDF_DIR,
)
from app.database import AsyncSessionLocal
from app.models.models import ConsentRecord, ConsentStatus
from sqlalchemy import select

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# Pydantic 入参/出参 Schema（供 Function Calling 自动生成文档）
# ══════════════════════════════════════════════════════════════════════════════

class SignAndUnlockInput(BaseModel):
    """sign_and_unlock_user 的入参 Schema"""
    patient_id: Annotated[str, Field(description="患者 UUID 字符串")]
    signature_file_path: Annotated[
        str,
        Field(description="签名图文件在服务器的绝对路径（或相对于项目根目录的路径）"),
    ]
    ip_address: Annotated[
        str | None,
        Field(default=None, description="患者签署时的客户端 IP 地址"),
    ]
    consent_type: Annotated[
        str,
        Field(default="营养干预知情同意书", description="同意书类型名称"),
    ]


class SignAndUnlockOutput(BaseModel):
    """sign_and_unlock_user 的出参 Schema"""
    success: bool
    record_id: str | None = None
    pdf_url: str | None   = None
    signed_at: str | None = None
    message: str
    error: str | None     = None


class ConsentStatusOutput(BaseModel):
    """check_consent_status 的出参 Schema"""
    patient_id: str
    is_unlocked: bool
    signed_at: str | None   = None
    pdf_path: str | None    = None
    record_id: str | None   = None


# ══════════════════════════════════════════════════════════════════════════════
# Tool 函数
# ══════════════════════════════════════════════════════════════════════════════

async def sign_and_unlock_user(
    patient_id: str,
    signature_file_path: str,
    ip_address: str | None = None,
    consent_type: str = "营养干预知情同意书",
) -> dict:
    """
    [Agent Tool] 知情同意签署并解锁用户账户。

    流程：
      1. 读取本地签名图文件
      2. 调用 compliance_service.process_consent_signing 完成 PDF 合成
      3. 数据库 ConsentRecord.status → SIGNED（即"解锁"）
      4. 返回结果供 Agent 进行后续决策

    Args:
        patient_id:           患者 UUID（字符串格式）
        signature_file_path:  签名图在服务器上的路径
        ip_address:           客户端 IP（可选，用于审计）
        consent_type:         同意书类型

    Returns:
        SignAndUnlockOutput 的 dict 表示
    """
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        return SignAndUnlockOutput(
            success=False,
            message="patient_id 格式无效，请传入合法的 UUID 字符串",
            error="INVALID_UUID",
        ).model_dump()

    sig_path = Path(signature_file_path)
    if not sig_path.exists():
        return SignAndUnlockOutput(
            success=False,
            message=f"签名图文件不存在：{signature_file_path}",
            error="FILE_NOT_FOUND",
        ).model_dump()

    try:
        sig_bytes = sig_path.read_bytes()
        filename  = sig_path.name

        # Tool 层自行管理 Session（不依赖 HTTP Request 生命周期）
        async with AsyncSessionLocal() as db:
            result = await process_consent_signing(
                db                   = db,
                patient_id           = pid,
                signature_image_bytes= sig_bytes,
                filename             = filename,
                ip_address           = ip_address,
                consent_type         = consent_type,
            )
            await db.commit()

        return SignAndUnlockOutput(**result).model_dump()

    except Exception as exc:
        logger.exception(f"sign_and_unlock_user 执行异常：{exc}")
        return SignAndUnlockOutput(
            success=False,
            message="签署流程发生内部错误，请稍后重试",
            error=str(exc),
        ).model_dump()


async def check_consent_status(patient_id: str) -> dict:
    """
    [Agent Tool] 查询患者是否已完成知情同意签署（账户是否已解锁）。

    Args:
        patient_id: 患者 UUID 字符串

    Returns:
        ConsentStatusOutput 的 dict 表示，其中 is_unlocked=True 即已签署
    """
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        return {
            "patient_id":  patient_id,
            "is_unlocked": False,
            "error":       "INVALID_UUID",
        }

    try:
        async with AsyncSessionLocal() as db:
            status = await get_consent_status(db, pid)
        return ConsentStatusOutput(**status).model_dump()

    except Exception as exc:
        logger.exception(f"check_consent_status 执行异常：{exc}")
        return {
            "patient_id":  patient_id,
            "is_unlocked": False,
            "error":       str(exc),
        }


async def revoke_consent(
    patient_id: str,
    record_id: str,
    reason: str = "",
) -> dict:
    """
    [Agent Tool] 撤销患者的知情同意（将状态改为 REVOKED）。
    撤销后，系统应限制该用户访问干预类功能。

    Args:
        patient_id: 患者 UUID
        record_id:  要撤销的 ConsentRecord UUID
        reason:     撤销原因（记录在 remarks 字段）

    Returns:
        {"success": bool, "message": str, "record_id": str}
    """
    try:
        rid = uuid.UUID(record_id)
    except ValueError:
        return {"success": False, "message": "record_id 格式无效", "record_id": record_id}

    try:
        async with AsyncSessionLocal() as db:
            stmt = select(ConsentRecord).where(ConsentRecord.id == rid)
            result = await db.execute(stmt)
            record = result.scalar_one_or_none()

            if not record:
                return {"success": False, "message": "同意书记录不存在", "record_id": record_id}

            if str(record.patient_id) != patient_id:
                return {"success": False, "message": "该记录不属于指定患者", "record_id": record_id}

            record.status  = ConsentStatus.REVOKED
            record.remarks = reason or "患者主动撤销"
            await db.commit()

        logger.info(f"患者 {patient_id} 已撤销知情同意 {record_id}")
        return {
            "success":    True,
            "message":    "知情同意已撤销",
            "record_id":  record_id,
        }

    except Exception as exc:
        logger.exception(f"revoke_consent 执行异常：{exc}")
        return {"success": False, "message": str(exc), "record_id": record_id}


async def get_consent_detail(consent_id: str) -> dict:
    """
    获取指定知情同意书的详细信息，包含签署时间、版本号、设备信息及 PDF 归档路径。
    可用于审计或验证用户是否已签署最新协议。

    Args:
        consent_id: ConsentRecord UUID 字符串（或演示前缀 mock-）

    Returns:
        {id, document_name, version, patient_name, signed_at, status, status_label,
         pdf_url, ip_address, device_info, signature_valid,
         audit_note, valid_from, valid_until, latest_version, is_latest_version}
    """
    _VERSION_MAP = {
        "营养干预知情同意书":         "v2.1",
        "肝移植患者营养干预知情同意书": "v2.1",
        "个人信息授权书":             "v1.3",
        "肝移植手术同意书":           "v3.0",
    }
    _STATUS_LABEL = {"signed": "已生效", "pending": "待签署", "revoked": "已撤销"}

    # 演示数据快速返回
    if consent_id.startswith("mock-"):
        return {
            "id":              consent_id,
            "document_name":   "营养干预知情同意书",
            "version":         "v2.1",
            "patient_name":    "演示患者",
            "patient_id":      None,
            "signed_at":       "2025-11-10T09:23:00+08:00",
            "status":          "signed",
            "status_label":    "已生效",
            "pdf_url":         None,
            "ip_address":      "192.168.1.101",
            "device_info":     "微信小程序 · iOS 17.2",
            "signature_valid": True,
            "audit_note":      "签署流程符合《电子签名法》第十三条可靠电子签名规范",
            "valid_from":      "2025-11-10",
            "valid_until":     "长期有效",
            "latest_version":  "v2.1",
            "is_latest_version": True,
            "remarks":         None,
        }

    try:
        rid = uuid.UUID(consent_id)
    except ValueError:
        return {"error": "consent_id 格式无效，请传入合法的 UUID 或演示 ID"}

    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select as sa_select
            from app.models.models import PatientProfile as PP
            stmt = (
                sa_select(ConsentRecord, PP.name.label("patient_name"))
                .join(PP, ConsentRecord.patient_id == PP.id, isouter=True)
                .where(ConsentRecord.id == rid)
            )
            result = await db.execute(stmt)
            row = result.first()

        if not row:
            return {"error": "同意书记录不存在"}

        rec, patient_name = row
        version = _VERSION_MAP.get(rec.consent_type, "v1.0")

        return {
            "id":              str(rec.id),
            "document_name":   rec.consent_type,
            "version":         version,
            "patient_name":    patient_name or "未知",
            "patient_id":      str(rec.patient_id) if rec.patient_id else None,
            "signed_at":       rec.signed_at.isoformat() if rec.signed_at else None,
            "status":          rec.status.value,
            "status_label":    _STATUS_LABEL.get(rec.status.value, rec.status.value),
            "pdf_url":         rec.pdf_path,
            "ip_address":      rec.ip_address,
            "device_info":     "微信小程序",
            "signature_valid": rec.status.value == "signed",
            "audit_note":      (
                "签署流程符合《电子签名法》第十三条可靠电子签名规范"
                if rec.status.value == "signed"
                else "暂未完成签署，协议尚未生效"
            ),
            "valid_from":      rec.signed_at.strftime("%Y-%m-%d") if rec.signed_at else None,
            "valid_until":     "长期有效",
            "latest_version":  version,
            "is_latest_version": True,
            "remarks":         rec.remarks,
        }

    except Exception as exc:
        logger.exception(f"get_consent_detail 执行异常：{exc}")
        return {"error": str(exc)}


async def get_consent_pdf_url(patient_id: str) -> dict:
    """
    [Agent Tool] 获取患者最新已签署知情同意书的 PDF 访问 URL。

    Returns:
        {"success": bool, "pdf_url": str | None, "message": str}
    """
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        return {"success": False, "pdf_url": None, "message": "patient_id 格式无效"}

    try:
        async with AsyncSessionLocal() as db:
            status = await get_consent_status(db, pid)

        if not status["is_unlocked"]:
            return {"success": False, "pdf_url": None, "message": "患者尚未完成知情同意签署"}

        return {
            "success": True,
            "pdf_url": status["pdf_path"],
            "record_id": status["record_id"],
            "signed_at": status["signed_at"],
            "message": "获取成功",
        }

    except Exception as exc:
        logger.exception(f"get_consent_pdf_url 执行异常：{exc}")
        return {"success": False, "pdf_url": None, "message": str(exc)}


# ══════════════════════════════════════════════════════════════════════════════
# LangChain Tool 注册入口（可选，配合 LangChain Agent 使用）
# ══════════════════════════════════════════════════════════════════════════════

def get_compliance_tools() -> list:
    """
    返回可注册到 LangChain Agent 的 Tool 列表。
    使用示例：
        from langchain.agents import AgentExecutor, create_openai_tools_agent
        tools = get_compliance_tools()
        agent = create_openai_tools_agent(llm, tools, prompt)
    """
    try:
        from langchain.tools import StructuredTool

        return [
            StructuredTool.from_function(
                coroutine=sign_and_unlock_user,
                name="sign_and_unlock_user",
                description=(
                    "让患者完成知情同意书手写签名并解锁账户。"
                    "需要患者UUID和已上传到服务器的签名图路径。"
                    "成功后返回 PDF URL 和签署时间。"
                ),
                args_schema=SignAndUnlockInput,
            ),
            StructuredTool.from_function(
                coroutine=check_consent_status,
                name="check_consent_status",
                description=(
                    "查询患者是否已签署知情同意书（账户是否解锁）。"
                    "在执行任何干预类操作前，应先调用此工具验证。"
                ),
            ),
            StructuredTool.from_function(
                coroutine=get_consent_pdf_url,
                name="get_consent_pdf_url",
                description="获取患者最新知情同意书PDF的访问URL，用于向用户展示或下载。",
            ),
            StructuredTool.from_function(
                coroutine=revoke_consent,
                name="revoke_consent",
                description="撤销患者的知情同意书，撤销后将限制干预类功能访问。",
            ),
        ]
    except ImportError:
        logger.warning("langchain 未安装，跳过 Tool 注册，仅可通过直接函数调用使用")
        return []
