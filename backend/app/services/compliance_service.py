"""
app/services/compliance_service.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
知情同意书服务层
职责：
  1. 生成兜底 PDF 模板（当模板文件不存在时自动生成）
  2. 将患者手写签名图片合成到 PDF 指定坐标
  3. 更新 ConsentRecord 状态为 signed（解锁用户）
  4. 生成最终带签名的 PDF 并持久化

PDF 合成方案：
  - reportlab  →  将签名图绘制到浮层 PDF（仅含签名的单页）
  - pypdf       →  将浮层与模板逐页合并（Overlay merge）

目录约定：
  assets/templates/consent_template.pdf    预设模板（放入版本库）
  uploads/consent/signatures/{patient_id}/ 签名图原件
  uploads/consent/signed/{patient_id}/     合成后的 PDF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import io
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from pypdf import PdfReader, PdfWriter
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.models.models import ConsentRecord, ConsentStatus, PatientProfile

logger = logging.getLogger(__name__)

# ── 路径配置 ─────────────────────────────────────────────────────────────────
BASE_DIR          = Path(__file__).resolve().parent.parent.parent   # backend/
TEMPLATE_PATH     = BASE_DIR / "assets" / "templates" / "consent_template.pdf"
SIGNATURE_DIR     = Path(settings.UPLOAD_DIR) / "consent" / "signatures"
SIGNED_PDF_DIR    = Path(settings.UPLOAD_DIR) / "consent" / "signed"

# ── PDF 签名坐标（以模板最后一页、A4 左下角为原点，单位 mm）────────────────
# 根据实际模板调整以下数值
SIGNATURE_CONFIG = {
    "x_mm":     100.0,   # 签名框左边距（从左侧量）
    "y_mm":      35.0,   # 签名框底边距（从底部量，reportlab 坐标系）
    "width_mm":  80.0,   # 签名图宽度
    "height_mm": 25.0,   # 签名图高度
    "page_index": -1,    # -1 表示最后一页（通常盖在末页签名栏）
}

# ── 中文字体注册（需要将字体文件放入项目）──────────────────────────────────
_FONT_REGISTERED = False

def _ensure_chinese_font() -> str:
    """
    注册中文字体并返回字体名。
    优先使用项目内置字体，否则退回系统字体。
    字体文件建议放到 assets/fonts/SourceHanSansCN-Regular.ttf
    """
    global _FONT_REGISTERED
    font_name = "SimHei"  # 默认使用 reportlab 内置回退

    font_candidates = [
        BASE_DIR / "assets" / "fonts" / "SourceHanSansCN-Regular.ttf",
        Path("C:/Windows/Fonts/simhei.ttf"),               # Windows 黑体
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),  # Linux
    ]
    if not _FONT_REGISTERED:
        for font_path in font_candidates:
            if font_path.exists():
                try:
                    pdfmetrics.registerFont(TTFont("CustomCN", str(font_path)))
                    font_name = "CustomCN"
                    _FONT_REGISTERED = True
                    logger.info(f"中文字体已注册：{font_path}")
                    break
                except Exception as e:
                    logger.warning(f"字体注册失败 {font_path}: {e}")

    return font_name


# ══════════════════════════════════════════════════════════════════════════════
# 1. 模板生成（兜底方案）
# ══════════════════════════════════════════════════════════════════════════════

def generate_consent_template() -> Path:
    """
    当 assets/templates/consent_template.pdf 不存在时，
    使用 reportlab 自动生成一份标准《营养干预知情同意书》模板。
    实际项目中请替换为排版好的正式文件。
    """
    TEMPLATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    font_name = _ensure_chinese_font()

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CNTitle",
        fontName=font_name,
        fontSize=16,
        leading=24,
        alignment=1,   # 居中
        spaceAfter=12,
    )
    body_style = ParagraphStyle(
        "CNBody",
        fontName=font_name,
        fontSize=11,
        leading=18,
        spaceAfter=8,
    )
    hint_style = ParagraphStyle(
        "CNHint",
        fontName=font_name,
        fontSize=9,
        leading=14,
        textColor=colors.grey,
    )

    doc = SimpleDocTemplate(
        str(TEMPLATE_PATH),
        pagesize=A4,
        leftMargin=25 * mm,
        rightMargin=25 * mm,
        topMargin=30 * mm,
        bottomMargin=30 * mm,
    )

    story = [
        Paragraph("协和医院肝移植中心", hint_style),
        Spacer(1, 4 * mm),
        Paragraph("肝移植围手术期营养干预知情同意书", title_style),
        Spacer(1, 6 * mm),
        Paragraph(
            "尊敬的患者及家属：<br/>"
            "您好！为保障您在肝移植围手术期的营养状态，促进术后康复，"
            "我中心将对您实施个体化营养干预方案。在接受该干预前，"
            "请您仔细阅读以下内容，并在充分理解后签署本同意书。",
            body_style,
        ),
        Spacer(1, 4 * mm),
        Paragraph("<b>一、干预目的</b>", body_style),
        Paragraph(
            "通过科学评估患者营养状态，制定个性化营养支持方案，"
            "降低术后感染、延迟愈合等并发症风险，缩短住院时间。",
            body_style,
        ),
        Spacer(1, 2 * mm),
        Paragraph("<b>二、干预内容</b>", body_style),
        Paragraph(
            "1. 术前营养评估（人体测量、血液生化指标、膳食调查）；<br/>"
            "2. 个性化营养方案制定与调整；<br/>"
            "3. 营养宣教与饮食指导；<br/>"
            "4. 定期随访与方案优化。",
            body_style,
        ),
        Spacer(1, 2 * mm),
        Paragraph("<b>三、可能的风险与不适</b>", body_style),
        Paragraph(
            "营养干预总体安全，但少数患者可能出现消化不适、过敏反应等，"
            "如有异常请及时联系主管医师。",
            body_style,
        ),
        Spacer(1, 2 * mm),
        Paragraph("<b>四、患者权利</b>", body_style),
        Paragraph(
            "您有权在任何时候退出营养干预计划，退出不会影响您接受其他医疗服务的权利。",
            body_style,
        ),
        Spacer(1, 2 * mm),
        Paragraph("<b>五、数据使用声明</b>", body_style),
        Paragraph(
            "您的营养数据将以匿名形式用于医学研究，不会对外披露个人身份信息。",
            body_style,
        ),
        Spacer(1, 10 * mm),
        # 签名区域表格
        Table(
            [
                ["患者签名：", "", "日期：", ""],
                ["", "", "", ""],
            ],
            colWidths=[30 * mm, 80 * mm, 20 * mm, 30 * mm],
            rowHeights=[8 * mm, 30 * mm],
            style=TableStyle([
                ("FONTNAME",     (0, 0), (-1, -1), font_name),
                ("FONTSIZE",     (0, 0), (-1, -1), 11),
                ("LINEBELOW",    (1, 0), (1, 0), 0.5, colors.black),
                ("LINEBELOW",    (3, 0), (3, 0), 0.5, colors.black),
                ("LINEBELOW",    (1, 1), (1, 1), 1,   colors.black),
                ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ]),
        ),
        Spacer(1, 4 * mm),
        Paragraph(
            "（签名区）← 系统将在此处合成您的手写签名",
            hint_style,
        ),
    ]

    doc.build(story)
    logger.info(f"知情同意书模板已生成：{TEMPLATE_PATH}")
    return TEMPLATE_PATH


# ══════════════════════════════════════════════════════════════════════════════
# 2. 核心 PDF 合成
# ══════════════════════════════════════════════════════════════════════════════

def _build_signature_overlay(
    signature_image_path: Path,
    page_width: float,
    page_height: float,
) -> bytes:
    """
    用 reportlab 将签名图绘制到透明背景的单页浮层 PDF 中。
    返回该页的 PDF 字节流（内存中，不落盘）。
    """
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(page_width, page_height))

    # 将坐标从 mm 转换为 pt（reportlab 默认单位 pt，1mm ≈ 2.8346pt）
    x      = SIGNATURE_CONFIG["x_mm"]      * mm
    y      = SIGNATURE_CONFIG["y_mm"]      * mm
    width  = SIGNATURE_CONFIG["width_mm"]  * mm
    height = SIGNATURE_CONFIG["height_mm"] * mm

    # 预处理签名图：去白底、转 RGBA 保留透明度
    try:
        img = Image.open(str(signature_image_path)).convert("RGBA")
        # 将白色背景改为透明（容差 20）
        data = img.getdata()
        new_data = []
        for pixel in data:
            r, g, b, a = pixel
            if r > 235 and g > 235 and b > 235:
                new_data.append((255, 255, 255, 0))
            else:
                new_data.append(pixel)
        img.putdata(new_data)

        # 将处理后的图写入临时 BytesIO
        img_buf = io.BytesIO()
        img.save(img_buf, format="PNG")
        img_buf.seek(0)

        c.drawImage(
            img_buf,
            x, y, width, height,
            mask="auto",    # 透明通道处理
            preserveAspectRatio=True,
        )
    except Exception as e:
        logger.warning(f"签名图预处理失败，直接绘制原图：{e}")
        c.drawImage(str(signature_image_path), x, y, width, height, preserveAspectRatio=True)

    c.save()
    buf.seek(0)
    return buf.read()


def merge_signature_onto_pdf(
    template_path: Path,
    signature_image_path: Path,
    output_path: Path,
) -> Path:
    """
    将签名图合成到模板 PDF 的指定页面。

    步骤：
      1. 读取模板 PDF
      2. 用 reportlab 生成"仅含签名"的浮层 PDF
      3. 用 pypdf 将浮层 merge 到模板目标页（overlay）
      4. 写入 output_path

    Args:
        template_path:       知情同意书 PDF 模板路径
        signature_image_path: 患者签名图路径（PNG/JPG）
        output_path:         输出的带签名 PDF 路径

    Returns:
        output_path  合成成功后的文件路径
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(template_path))
    writer = PdfWriter()

    total_pages = len(reader.pages)
    target_idx = SIGNATURE_CONFIG["page_index"] % total_pages   # 支持负数索引

    for idx, page in enumerate(reader.pages):
        if idx == target_idx:
            # 取目标页尺寸，构建同尺寸浮层
            page_width  = float(page.mediabox.width)
            page_height = float(page.mediabox.height)

            overlay_bytes = _build_signature_overlay(
                signature_image_path, page_width, page_height
            )
            overlay_reader = PdfReader(io.BytesIO(overlay_bytes))
            overlay_page   = overlay_reader.pages[0]

            # merge_page：把浮层渲染到当前页上方
            page.merge_page(overlay_page)

        writer.add_page(page)

    with open(str(output_path), "wb") as f:
        writer.write(f)

    logger.info(f"带签名 PDF 已生成：{output_path}")
    return output_path


# ══════════════════════════════════════════════════════════════════════════════
# 3. 数据库操作
# ══════════════════════════════════════════════════════════════════════════════

async def get_or_create_consent_record(
    db: AsyncSession,
    patient_id: uuid.UUID,
    consent_type: str = "营养干预知情同意书",
) -> ConsentRecord:
    """获取患者最新的待签同意书，若不存在则创建。"""
    stmt = (
        select(ConsentRecord)
        .where(
            ConsentRecord.patient_id == patient_id,
            ConsentRecord.consent_type == consent_type,
            ConsentRecord.status == ConsentStatus.PENDING,
        )
        .order_by(ConsentRecord.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if not record:
        record = ConsentRecord(
            patient_id=patient_id,
            consent_type=consent_type,
            status=ConsentStatus.PENDING,
        )
        db.add(record)
        await db.flush()  # 获取 id 但不提交

    return record


async def mark_consent_signed(
    db: AsyncSession,
    record_id: uuid.UUID,
    signature_image_path: str | None,
    pdf_path: str,
    ip_address: str | None = None,
) -> ConsentRecord:
    """将同意书记录标记为已签署（解锁用户）。"""
    stmt = select(ConsentRecord).where(ConsentRecord.id == record_id)
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if not record:
        raise ValueError(f"ConsentRecord {record_id} 不存在")

    record.status               = ConsentStatus.SIGNED
    record.signed_at            = datetime.now(timezone.utc)
    record.signature_image_path = signature_image_path
    record.pdf_path             = pdf_path
    record.ip_address           = ip_address

    await db.flush()
    return record


async def get_consent_status(
    db: AsyncSession,
    patient_id: uuid.UUID,
) -> dict:
    """查询患者是否已完成知情同意签署。"""
    stmt = (
        select(ConsentRecord)
        .where(
            ConsentRecord.patient_id == patient_id,
            ConsentRecord.status == ConsentStatus.SIGNED,
        )
        .order_by(ConsentRecord.signed_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    return {
        "patient_id":  str(patient_id),
        "is_unlocked": record is not None,
        "signed_at":   record.signed_at.isoformat() if record else None,
        "pdf_path":    record.pdf_path if record else None,
        "record_id":   str(record.id) if record else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# 4. 主流程编排（供 Tool 层直接调用）
# ══════════════════════════════════════════════════════════════════════════════

async def process_consent_signing(
    db: AsyncSession,
    patient_id: uuid.UUID,
    signature_image_bytes: bytes,
    filename: str,
    ip_address: str | None = None,
    consent_type: str = "营养干预知情同意书",
) -> dict:
    """
    知情同意签署主流程：
      1. 持久化签名原图
      2. 检查 PDF 模板是否存在（不存在则自动生成）
      3. 合成带签名的最终 PDF
      4. 更新数据库 → ConsentRecord.status = SIGNED
      5. 返回结构化结果

    Args:
        db:                    AsyncSession
        patient_id:            患者 UUID
        signature_image_bytes: 签名图二进制内容
        filename:              原始文件名（用于取扩展名）
        ip_address:            客户端 IP
        consent_type:          同意书类型

    Returns:
        {
          "success": bool,
          "record_id": str,
          "pdf_url": str,       # 供前端展示的相对 URL
          "signed_at": str,
          "message": str
        }
    """
    # ── Step 1: 保存签名原图 ────────────────────────────────────────────────
    sig_ext = Path(filename).suffix or ".png"
    sig_dir = SIGNATURE_DIR / str(patient_id)
    sig_dir.mkdir(parents=True, exist_ok=True)

    sig_filename    = f"{uuid.uuid4().hex}{sig_ext}"
    sig_image_path  = sig_dir / sig_filename

    with open(str(sig_image_path), "wb") as f:
        f.write(signature_image_bytes)
    logger.info(f"签名图已保存：{sig_image_path}")

    # ── Step 2: 确保 PDF 模板存在 ───────────────────────────────────────────
    if not TEMPLATE_PATH.exists():
        logger.warning("PDF 模板不存在，自动生成兜底模板...")
        generate_consent_template()

    # ── Step 3: 合成带签名的 PDF ─────────────────────────────────────────────
    pdf_dir      = SIGNED_PDF_DIR / str(patient_id)
    pdf_filename = f"consent_{uuid.uuid4().hex}.pdf"
    pdf_path     = pdf_dir / pdf_filename

    merge_signature_onto_pdf(
        template_path        = TEMPLATE_PATH,
        signature_image_path = sig_image_path,
        output_path          = pdf_path,
    )

    # ── Step 4: 更新数据库 ──────────────────────────────────────────────────
    record = await get_or_create_consent_record(db, patient_id, consent_type)

    # 转为 POSIX 相对路径存储（便于跨平台和 URL 映射）
    sig_rel_path = sig_image_path.relative_to(BASE_DIR).as_posix()
    pdf_rel_path = pdf_path.relative_to(BASE_DIR).as_posix()

    updated_record = await mark_consent_signed(
        db            = db,
        record_id     = record.id,
        signature_image_path = sig_rel_path,
        pdf_path      = pdf_rel_path,
        ip_address    = ip_address,
    )

    # Session 统一由 get_db 依赖提交，此处无需 commit

    return {
        "success":   True,
        "record_id": str(updated_record.id),
        "pdf_url":   f"/uploads/consent/signed/{patient_id}/{pdf_filename}",
        "pdf_path":  pdf_rel_path,
        "signed_at": updated_record.signed_at.isoformat(),
        "message":   "知情同意书签署成功，账户已解锁",
    }
