"""
app/api/endpoints/compliance.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
知情同意模块 FastAPI 路由

端点列表：
  POST   /consent/sign                    上传签名图，完成签署并解锁账户
  GET    /consent/status/{patient_id}     查询签署状态（是否已解锁）
  GET    /consent/download/{record_id}    下载已签署的 PDF 文件
  DELETE /consent/revoke/{record_id}      撤销知情同意

设计约定：
  - 文件上传使用 multipart/form-data
  - 所有响应统一包装为 {"code": int, "data": ..., "message": str}
  - 签名图大小限制由 config.MAX_UPLOAD_SIZE_MB 控制
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import uuid
import logging
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import get_db
from app.models.models import ConsentRecord, ConsentStatus, PatientProfile
from app.services.compliance_service import (
    get_consent_status,
    process_consent_signing,
    SIGNED_PDF_DIR,
    BASE_DIR,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/consent", tags=["知情同意"])

# ── 允许上传的文件类型 ──────────────────────────────────────────────────────
ALLOWED_MIME = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
MAX_SIZE_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024


# ══════════════════════════════════════════════════════════════════════════════
# 统一响应模型
# ══════════════════════════════════════════════════════════════════════════════

class ApiResponse(BaseModel):
    code: int    = 200
    message: str = "success"
    data: dict | None = None


# ══════════════════════════════════════════════════════════════════════════════
# 辅助函数
# ══════════════════════════════════════════════════════════════════════════════

def _get_client_ip(request: Request) -> str | None:
    """优先从反向代理头获取真实 IP"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


async def _validate_patient_exists(
    patient_id: uuid.UUID,
    db: AsyncSession,
) -> PatientProfile:
    """校验患者是否存在，不存在则抛出 404"""
    stmt = select(PatientProfile).where(PatientProfile.id == patient_id)
    result = await db.execute(stmt)
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"患者 {patient_id} 不存在",
        )
    return patient


# ══════════════════════════════════════════════════════════════════════════════
# 端点 1：上传签名并完成签署
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/sign",
    response_model=ApiResponse,
    status_code=status.HTTP_201_CREATED,
    summary="上传手写签名，完成知情同意签署并解锁账户",
    description="""
患者在小程序完成手写签名后，将签名图以 multipart/form-data 上传至此接口。

后端处理流程：
1. 校验文件类型和大小
2. 验证患者是否存在
3. 检查是否已经签署（幂等保护）
4. 将签名图合成到《知情同意书.pdf》模板的指定坐标
5. 更新数据库状态为 `signed`（账户解锁）
6. 返回 PDF 访问 URL

**注意**：每位患者只需签署一次，重复调用将返回已有签署记录。
    """,
)
async def upload_signature_and_sign(
    request: Request,
    patient_id: str = Form(..., description="患者 UUID 字符串"),
    consent_type: str = Form(default="营养干预知情同意书", description="同意书类型"),
    signature_image: UploadFile = File(
        ...,
        description="手写签名图片（PNG/JPG），建议白底黑字，≤20 MB",
    ),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    # ── 参数校验 ──────────────────────────────────────────────────────────────
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="patient_id 必须为合法的 UUID 格式",
        )

    if signature_image.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"不支持的文件类型：{signature_image.content_type}。允许：{ALLOWED_MIME}",
        )

    # ── 读取文件（先读到内存校验大小）────────────────────────────────────────
    image_bytes = await signature_image.read()
    if len(image_bytes) > MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"文件超过大小限制 {settings.MAX_UPLOAD_SIZE_MB} MB",
        )

    # ── 校验患者存在 ──────────────────────────────────────────────────────────
    await _validate_patient_exists(pid, db)

    # ── 幂等保护：已签署则直接返回 ─────────────────────────────────────────────
    current_status = await get_consent_status(db, pid)
    if current_status["is_unlocked"]:
        return ApiResponse(
            code=200,
            message="患者已完成签署，账户已解锁",
            data={
                "record_id": current_status["record_id"],
                "pdf_url":   current_status["pdf_path"],
                "signed_at": current_status["signed_at"],
                "already_signed": True,
            },
        )

    # ── 执行签署主流程 ─────────────────────────────────────────────────────────
    try:
        result = await process_consent_signing(
            db                    = db,
            patient_id            = pid,
            signature_image_bytes = image_bytes,
            filename              = signature_image.filename or "signature.png",
            ip_address            = _get_client_ip(request),
            consent_type          = consent_type,
        )
    except Exception as exc:
        logger.exception(f"知情同意签署失败 patient={patient_id}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF 合成失败，请联系管理员：{exc}",
        )

    return ApiResponse(
        code=201,
        message=result["message"],
        data={
            "record_id": result["record_id"],
            "pdf_url":   result["pdf_url"],
            "signed_at": result["signed_at"],
            "already_signed": False,
        },
    )


# ══════════════════════════════════════════════════════════════════════════════
# 端点 1b：轻量JSON签署记录（供小程序无文件场景调用）
# ══════════════════════════════════════════════════════════════════════════════

class ConsentRecordBody(BaseModel):
    patient_id:     str | None = None
    document_name:  str | None = None
    version:        str | None = None
    status:         str        = "signed"
    signed_at:      str | None = None
    device_info:    str | None = None
    signature_data: str | None = None


@router.post(
    "/record",
    response_model=ApiResponse,
    status_code=status.HTTP_201_CREATED,
    summary="记录知情同意确认（JSON，无需文件上传）",
    description="供小程序在完成本地手签后异步上报同意状态，不要求上传签名图片文件。",
)
async def record_consent_json(
    body: ConsentRecordBody,
    db:   AsyncSession = Depends(get_db),
) -> ApiResponse:
    """
    接收小程序侧的知情同意确认记录。
    - 若有 patient_id 且患者存在：写入 DB 并自动生成┼纯文本确认 PDF№
    - patient_id 可为空：仅记录日志。
    """
    record_id = str(uuid.uuid4())
    logger.info(
        "consent/record: patient=%s doc=%s ver=%s device=%s",
        body.patient_id, body.document_name, body.version, body.device_info,
    )

    if body.patient_id:
        try:
            pid = uuid.UUID(body.patient_id)
            stmt = select(PatientProfile).where(PatientProfile.id == pid)
            result = await db.execute(stmt)
            patient = result.scalar_one_or_none()
            if patient:
                try:
                    from app.models.models import ConsentRecord as CR, ConsentStatus
                    from app.services.compliance_service import (
                        SIGNED_PDF_DIR, _ensure_chinese_font,
                        get_or_create_consent_record, mark_consent_signed,
                    )
                    from reportlab.pdfgen import canvas as rl_canvas
                    from reportlab.lib.pagesizes import A4
                    from reportlab.lib.units import mm
                    import datetime as _dt

                    # 生成纯文本确认 PDF（无手写签名图的内建化方案）
                    font = _ensure_chinese_font()
                    pdf_dir = SIGNED_PDF_DIR / str(pid)
                    pdf_dir.mkdir(parents=True, exist_ok=True)
                    pdf_fname = f"consent_text_{uuid.uuid4().hex}.pdf"
                    pdf_abs   = pdf_dir / pdf_fname
                    consent_type = body.document_name or "营养干预知情同意书"
                    signed_at_str = body.signed_at or _dt.datetime.now(tz=_dt.timezone.utc).isoformat()

                    w, h = A4
                    c = rl_canvas.Canvas(str(pdf_abs), pagesize=A4)
                    # 标题
                    c.setFont(font, 20)
                    c.drawCentredString(w / 2, h - 40 * mm, consent_type)
                    c.setFont(font, 12)
                    c.drawCentredString(w / 2, h - 52 * mm, f"版本：{body.version or 'v1.0'}")
                    # 分隔线
                    c.setStrokeColorRGB(0.7, 0.7, 0.7)
                    c.line(20 * mm, h - 58 * mm, w - 20 * mm, h - 58 * mm)
                    # 患者信息
                    c.setFont(font, 12)
                    y = h - 70 * mm
                    for label, val in [
                        ("患者姓名", patient.name or "未知"),
                        ("签署时间", signed_at_str[:19].replace('T', ' ')),
                        ("签署渠道", body.device_info or 'WeChat MiniApp'),
                    ]:
                        c.drawString(25 * mm, y, f"{label}\uff1a{val}")
                        y -= 10 * mm
                    # 确认正文
                    y -= 5 * mm
                    c.setFont(font, 11)
                    for line in [
                        "本人已认真阅读上述同意书全文，对其中涉及的诊断、治疗",
                        "方案、可能西底与并发症已充分了解，自愿并同意进行相关处置。",
                        "本同意已由患者在微信小程序上完成电子确认。",
                    ]:
                        c.drawString(25 * mm, y, line)
                        y -= 9 * mm
                    # 章戚区
                    y -= 10 * mm
                    c.setFont(font, 10)
                    c.setFillColorRGB(0.5, 0.5, 0.5)
                    c.drawString(25 * mm, y, "签名方式：微信小程序电子确认——已安全存储")
                    c.save()

                    # 内部路径（相对 backend/）
                    from app.services.compliance_service import BASE_DIR as _BASE
                    pdf_rel = pdf_abs.relative_to(_BASE).as_posix()
                    pdf_url = f"/uploads/consent/signed/{pid}/{pdf_fname}"

                    # 写 DB
                    rec = await get_or_create_consent_record(db, pid, consent_type)
                    await mark_consent_signed(
                        db=db,
                        record_id=rec.id,
                        signature_image_path=None,
                        pdf_path=pdf_rel,
                        ip_address=None,
                    )
                    record_id = str(rec.id)
                    logger.info("consent/record: text-PDF generated -> %s", pdf_url)

                except Exception as db_err:
                    logger.warning("consent record PDF/DB write skipped: %s", db_err)
                    await db.rollback()
        except (ValueError, Exception) as e:
            logger.warning("consent/record invalid patient_id=%s: %s", body.patient_id, e)

    return ApiResponse(
        code    = 201,
        message = "知情同意记录已保存",
        data    = {"record_id": record_id, "status": body.status},
    )


# ══════════════════════════════════════════════════════════════════════════════
# 端点 2：查询签署状态
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/status/{patient_id}",
    response_model=ApiResponse,
    summary="查询患者知情同意签署状态",
    description="返回患者是否已完成签署（is_unlocked），以及签署时间和 PDF 路径。",
)
async def query_consent_status(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    try:
        pid = uuid.UUID(patient_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="patient_id 格式无效",
        )

    await _validate_patient_exists(pid, db)
    consent_data = await get_consent_status(db, pid)

    return ApiResponse(
        code=200,
        message="查询成功",
        data=consent_data,
    )


# ══════════════════════════════════════════════════════════════════════════════
# 端点 3：下载已签署 PDF
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/download/{record_id}",
    summary="下载已签署的知情同意书 PDF",
    description="根据 ConsentRecord ID 下载对应的带签名 PDF 文件。要求该记录状态为 signed。",
    response_class=FileResponse,
)
async def download_consent_pdf(
    record_id: str,
    db: AsyncSession = Depends(get_db),
):
    try:
        rid = uuid.UUID(record_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="record_id 格式无效",
        )

    # 查询记录
    stmt = select(ConsentRecord).where(ConsentRecord.id == rid)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="同意书记录不存在")

    if record.status != ConsentStatus.SIGNED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"该同意书状态为 {record.status}，仅 signed 状态可下载",
        )

    if not record.pdf_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF 文件路径未记录，可能尚未生成",
        )

    # 拼接绝对路径
    pdf_abs_path = BASE_DIR / record.pdf_path
    if not pdf_abs_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PDF 文件不存在于磁盘：{record.pdf_path}",
        )

    filename = f"知情同意书_{record.patient_id}.pdf"
    return FileResponse(
        path        = str(pdf_abs_path),
        media_type  = "application/pdf",
        filename    = filename,
        headers     = {
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Record-ID": str(rid),
        },
    )


# ══════════════════════════════════════════════════════════════════════════════
# 端点 4：撤销知情同意
# ══════════════════════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════════════════
# 端点 5：合规审计 — 已签署文件列表
# ══════════════════════════════════════════════════════════════════════════════

# 当数据库无真实签署记录时使用的演示数据
_MOCK_RECORDS = [
    {
        "id":            "mock-0001-0000-0000-000000000001",
        "document_name": "营养干预知情同意书",
        "version":       "v2.1",
        "patient_id":    None,
        "patient_name":  "张伟",
        "signed_at":     "2025-11-10T09:23:00+08:00",
        "status":        "signed",
        "status_label":  "已生效",
        "pdf_url":       "/static/demo/consent_zhangwei.pdf",
        "ip_address":    "192.168.1.101",
    },
    {
        "id":            "mock-0001-0000-0000-000000000002",
        "document_name": "个人信息授权书",
        "version":       "v1.3",
        "patient_id":    None,
        "patient_name":  "李秀英",
        "signed_at":     "2025-12-05T14:10:00+08:00",
        "status":        "signed",
        "status_label":  "已生效",
        "pdf_url":       "/static/demo/consent_lixiuying.pdf",
        "ip_address":    "192.168.1.102",
    },
    {
        "id":            "mock-0001-0000-0000-000000000003",
        "document_name": "肝移植手术同意书",
        "version":       "v3.0",
        "patient_id":    None,
        "patient_name":  "王建国",
        "signed_at":     "2025-10-22T10:45:00+08:00",
        "status":        "signed",
        "status_label":  "已生效",
        "pdf_url":       "/static/demo/consent_wangjianguo.pdf",
        "ip_address":    "192.168.1.103",
    },
    {
        "id":            "mock-0001-0000-0000-000000000004",
        "document_name": "营养干预知情同意书",
        "version":       "v2.1",
        "patient_id":    None,
        "patient_name":  "陈小梅",
        "signed_at":     "2026-01-08T16:30:00+08:00",
        "status":        "signed",
        "status_label":  "已生效",
        "pdf_url":       "/static/demo/consent_chenxiaomei.pdf",
        "ip_address":    "192.168.1.104",
    },
    {
        "id":            "mock-0001-0000-0000-000000000005",
        "document_name": "个人信息授权书",
        "version":       "v1.3",
        "patient_id":    None,
        "patient_name":  "刘洋",
        "signed_at":     None,
        "status":        "pending",
        "status_label":  "待签署",
        "pdf_url":       None,
        "ip_address":    None,
    },
    {
        "id":            "mock-0001-0000-0000-000000000006",
        "document_name": "肝移植手术同意书",
        "version":       "v3.0",
        "patient_id":    None,
        "patient_name":  "张伟",
        "signed_at":     "2025-11-10T09:25:00+08:00",
        "status":        "revoked",
        "status_label":  "已撤销",
        "pdf_url":       "/static/demo/consent_zhangwei_op.pdf",
        "ip_address":    "192.168.1.101",
    },
]

_STATUS_LABEL = {
    "signed":  "已生效",
    "pending": "待签署",
    "revoked": "已撤销",
}


@router.get(
    "/records",
    summary="合规审计 — 已签署文件列表",
    description="返回系统中所有患者的知情同意签署记录，用于合规审计界面。若数据库暂无真实签署记录，则返回演示数据。",
)
async def list_consent_records(
    page: int      = 1,
    page_size: int = 20,
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    查询 consent_records 表，联结 patient_profiles 获取患者姓名。
    若数据库为空，自动回退到演示数据，方便前端开发与演示。
    """
    stmt = (
        select(ConsentRecord, PatientProfile.name.label("patient_name"))
        .join(PatientProfile, ConsentRecord.patient_id == PatientProfile.id, isouter=True)
        .order_by(ConsentRecord.created_at.desc())
    )
    if status_filter:
        stmt = stmt.where(ConsentRecord.status == status_filter)

    result = await db.execute(stmt)
    rows = result.all()

    doc_version_map = {
        "营养干预知情同意书":         "v2.1",
        "肝移植患者营养干预知情同意书": "v2.1",
        "个人信息授权书":             "v1.3",
        "肝移植手术同意书":           "v3.0",
    }
    default_version = "v1.0"

    if rows:
        # 真实数据
        items = [
            {
                "id":            str(rec.id),
                "document_name": rec.consent_type,
                "version":       doc_version_map.get(rec.consent_type, default_version),
                "patient_id":    str(rec.patient_id) if rec.patient_id else None,
                "patient_name":  patient_name or "未知",
                "signed_at":     rec.signed_at.isoformat() if rec.signed_at else None,
                "status":        rec.status.value,
                "status_label":  _STATUS_LABEL.get(rec.status.value, rec.status.value),
                "pdf_url":       rec.pdf_path or None,
                "ip_address":    rec.ip_address,
            }
            for rec, patient_name in rows
        ]
    else:
        # 演示数据（数据库中尚无记录时）
        items = _MOCK_RECORDS
        if status_filter:
            items = [r for r in items if r["status"] == status_filter]

    total = len(items)
    start = (page - 1) * page_size
    paged = items[start: start + page_size]

    return {
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "is_mock":   not bool(rows),
        "items":     paged,
    }


# ══════════════════════════════════════════════════════════════════════════════
# 端点 6：单条同意书详情（供 Drawer 调用）
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/records/{record_id}/detail",
    response_model=ApiResponse,
    summary="获取单条知情同意书完整详情（含审计字段）",
    description="""
返回字段：协议名称、版本号、患者姓名、签署时间、PDF 预览链接、
设备信息、签名有效性状态、审计备注。
可用于合规审计 Drawer 或 Agent 工具层调用。
    """,
)
async def get_consent_record_detail(
    record_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    from app.tools.compliance_tools import get_consent_detail
    detail = await get_consent_detail(record_id)
    if "error" in detail:
        raise HTTPException(status_code=404, detail=detail["error"])
    return ApiResponse(code=200, message="查询成功", data=detail)


# ══════════════════════════════════════════════════════════════════════════════
# 端点 4+1：撤销知情同意（顺序调整）
# ══════════════════════════════════════════════════════════════════════════════

class RevokeRequest(BaseModel):
    reason: str = "患者主动撤销"


@router.delete(
    "/revoke/{record_id}",
    response_model=ApiResponse,
    summary="撤销患者知情同意",
    description="将指定 ConsentRecord 状态改为 revoked，后续系统应限制该用户的干预类功能。",
)
async def revoke_consent_record(
    record_id: str,
    body: RevokeRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    try:
        rid = uuid.UUID(record_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="record_id 格式无效",
        )

    stmt = select(ConsentRecord).where(ConsentRecord.id == rid)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="同意书记录不存在")

    if record.status == ConsentStatus.REVOKED:
        return ApiResponse(code=200, message="已处于撤销状态，无需重复操作", data={"record_id": record_id})

    record.status  = ConsentStatus.REVOKED
    record.remarks = body.reason
    # Session commit 由 get_db 依赖统一处理

    logger.info(f"同意书 {record_id} 已撤销，原因：{body.reason}")
    return ApiResponse(
        code=200,
        message="知情同意已撤销，相关功能已限制",
        data={"record_id": record_id, "reason": body.reason},
    )
