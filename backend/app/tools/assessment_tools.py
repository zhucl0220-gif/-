"""
app/tools/assessment_tools.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
营养评估 Agent Tools
AI 可直接调用本模块中的函数；FastAPI 路由层负责将其暴露为 HTTP 接口。

对外暴露：
  - get_patient_assessment_history   获取患者各阶段量表记录与评分
  - get_lab_records_with_images      获取检验指标详情和图片 URL
  - get_indicator_trends             返回体重/白蛋白等指标的时序数据
  - generate_baseline_report_pdf     后端生成 PDF 并返回下载链接
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import io
import logging
import os
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.models import (
    LabResult, NutritionPlan, PatientProfile, TransplantPhase,
)

logger = logging.getLogger(__name__)

# PDF 下载目录（相对于 UPLOAD_DIR）
_PDF_SUBDIR = "assessment_reports"

# 阶段中文标签
_PHASE_LABELS: dict[str, str] = {
    "pre_assessment":   "术前评估期",
    "pre_operation":    "等待手术期",
    "early_post_op":    "术后早期",
    "recovery":         "恢复期",
    "rehabilitation":   "康复期",
    "long_term_follow": "长期随访",
}

# NRS-2002 量表参考分值（依赖 plan_content 中的字段，若无则用 BMI/白蛋白估算）
_NORMAL_ALBUMIN_G_L = 35.0  # g/L，低于此视为营养不良风险


# ══════════════════════════════════════════════════════════════════════════════
# Tool 1 — 患者各阶段量表历史
# ══════════════════════════════════════════════════════════════════════════════

async def get_patient_assessment_history(patient_id: str) -> dict[str, Any]:
    """
    返回患者各阶段营养评估记录与推算评分。

    数据来源：
      - NutritionPlan 表（每条方案 = 一次量表评估节点）
      - PatientProfile（体重、BMI 用于 NRS-2002 估算）
      - LabResult（最近一次白蛋白值）

    返回结构：
    {
      "patient_id": "...",
      "patient_name": "...",
      "assessments": [
        {
          "plan_id": "...",
          "phase": "pre_assessment",
          "phase_label": "术前评估期",
          "date": "2024-01-10",
          "nrs2002_score": 3,
          "risk_level": "中风险",
          "energy_kcal": 1800,
          "protein_g": 90,
          "generated_by": "agent",
          "notes": "...",
          "pdf_path": null
        },
        ...
      ]
    }
    """
    pid = _parse_uuid(patient_id)
    async with AsyncSessionLocal() as db:
        patient = await _get_patient(db, pid)
        if not patient:
            return {"error": f"患者 {patient_id} 不存在"}

        # 取全部营养方案，按创建时间倒序
        plans_result = await db.execute(
            select(NutritionPlan)
            .where(NutritionPlan.patient_id == pid)
            .order_by(NutritionPlan.valid_from.desc().nullslast(), NutritionPlan.created_at.desc())
        )
        plans = plans_result.scalars().all()

        # 最近一次白蛋白值（用于评分）
        latest_albumin = await _get_latest_albumin(db, pid)

        assessments = []
        for plan in plans:
            score, risk = _estimate_nrs2002(
                bmi=patient.bmi,
                weight=patient.weight_kg,
                albumin=latest_albumin,
                phase=plan.phase.value if plan.phase else None,
            )
            content: dict = plan.plan_content or {}
            assessments.append({
                "plan_id":       str(plan.id),
                "phase":         plan.phase.value if plan.phase else None,
                "phase_label":   _PHASE_LABELS.get(plan.phase.value, plan.phase.value) if plan.phase else "--",
                "date":          plan.valid_from.isoformat() if plan.valid_from else plan.created_at.date().isoformat(),
                "nrs2002_score": score,
                "risk_level":    risk,
                "energy_kcal":   content.get("energy_kcal"),
                "protein_g":     content.get("protein_g"),
                "generated_by":  plan.generated_by,
                "is_active":     plan.is_active,
                "notes":         content.get("notes"),
                "pdf_path":      None,  # 由 generate_baseline_report_pdf 生成后填充
            })

        return {
            "patient_id":   str(pid),
            "patient_name": patient.name,
            "weight_kg":    patient.weight_kg,
            "height_cm":    patient.height_cm,
            "bmi":          patient.bmi,
            "current_phase": patient.current_phase.value,
            "assessments":  assessments,
        }


# ══════════════════════════════════════════════════════════════════════════════
# Tool 2 — 检验记录 + 图片 URL
# ══════════════════════════════════════════════════════════════════════════════

async def get_lab_records_with_images(patient_id: str, base_url: str = "") -> dict[str, Any]:
    """
    返回患者全部检验单记录，每条记录附带原始图片 URL（若存在）。

    返回结构：
    {
      "patient_id": "...",
      "records": [
        {
          "id": "...",
          "report_date": "2024-03-01",
          "report_type": "营养指标",
          "phase": "recovery",
          "phase_label": "恢复期",
          "image_url": "http://host/uploads/xxx.jpg",  // 可为 null
          "items": [
            {"name": "白蛋白", "value": 32.1, "unit": "g/L", "ref_range": "35-55", "is_abnormal": true},
            ...
          ],
          "analysis_summary": "...",
          "is_analyzed": true
        }
      ]
    }
    """
    pid = _parse_uuid(patient_id)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(LabResult)
            .where(LabResult.patient_id == pid)
            .order_by(LabResult.report_date.desc().nullslast(), LabResult.created_at.desc())
        )
        labs = result.scalars().all()

        records = []
        for lab in labs:
            image_url = None
            if lab.source_image_path:
                # 兼容绝对路径和相对路径
                path_str = lab.source_image_path.replace("\\", "/")
                if path_str.startswith("http"):
                    image_url = path_str
                else:
                    # 相对于 /uploads
                    clean = path_str.lstrip("/")
                    image_url = f"{base_url.rstrip('/')}/{clean}" if base_url else f"/uploads/{clean.replace('uploads/', '')}"

            analysis: dict = lab.analysis_result or {}
            records.append({
                "id":               str(lab.id),
                "report_date":      lab.report_date.isoformat() if lab.report_date else None,
                "report_type":      lab.report_type,
                "phase":            lab.phase_at_upload.value if lab.phase_at_upload else None,
                "phase_label":      _PHASE_LABELS.get(lab.phase_at_upload.value, "") if lab.phase_at_upload else "--",
                "image_url":        image_url,
                "items":            lab.structured_items or [],
                "analysis_summary": analysis.get("summary", ""),
                "recommendations":  analysis.get("recommendations", []),
                "is_analyzed":      lab.is_analyzed,
                "created_at":       lab.created_at.isoformat(),
            })

        return {
            "patient_id": str(pid),
            "total":      len(records),
            "records":    records,
        }


# ══════════════════════════════════════════════════════════════════════════════
# Tool 3 — 指标趋势时序数据
# ══════════════════════════════════════════════════════════════════════════════

_METRIC_ALIASES: dict[str, list[str]] = {
    "weight":  ["体重", "weight", "bw", "Weight(kg)", "体重(kg)"],
    "albumin": ["白蛋白", "albumin", "alb", "ALB", "Albumin", "ALB(g/L)", "白蛋白(g/L)"],
    "total_protein": ["总蛋白", "TP", "total protein", "Total Protein"],
    "prealbumin": ["前白蛋白", "prealbumin", "PA", "Prealbumin"],
    "hemoglobin": ["血红蛋白", "HGB", "hemoglobin", "Hemoglobin", "Hb"],
    "bmi":     ["bmi", "BMI", "Body Mass Index"],
}


async def get_indicator_trends(
    patient_id: str,
    metrics: list[str] | None = None,
) -> dict[str, Any]:
    """
    从 LabResult.structured_items 中提取指定指标的历史时序数据，
    用于前端绘制折线图。

    参数：
      patient_id : 患者 UUID 字符串
      metrics    : 指标列表，如 ["weight", "albumin"]，默认两者均取

    返回结构：
    {
      "patient_id": "...",
      "metrics": {
        "weight": {
          "unit": "kg",
          "series": [
            {"date": "2024-01-05", "value": 68.5},
            {"date": "2024-02-10", "value": 65.2},
            ...
          ]
        },
        "albumin": {
          "unit": "g/L",
          "reference_range": {"min": 35, "max": 55},
          "series": [...]
        }
      }
    }
    """
    if metrics is None:
        metrics = ["weight", "albumin"]

    pid = _parse_uuid(patient_id)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(LabResult)
            .where(LabResult.patient_id == pid)
            .where(LabResult.structured_items.is_not(None))
            .order_by(LabResult.report_date.asc().nullslast(), LabResult.created_at.asc())
        )
        labs = result.scalars().all()

        # 构建时序桶
        trend_data: dict[str, list[dict]] = {m: [] for m in metrics}
        unit_map: dict[str, str] = {}

        for lab in labs:
            date_str = lab.report_date.isoformat() if lab.report_date else lab.created_at.date().isoformat()
            items: list[dict] = lab.structured_items or []
            for item in items:
                item_name = str(item.get("name", ""))
                item_value_raw = item.get("value")
                item_unit = str(item.get("unit", ""))

                for metric in metrics:
                    aliases = _METRIC_ALIASES.get(metric, [metric])
                    if any(alias.lower() in item_name.lower() for alias in aliases):
                        try:
                            val = float(str(item_value_raw).replace(",", "").strip())
                        except (TypeError, ValueError):
                            continue
                        trend_data[metric].append({"date": date_str, "value": val})
                        if metric not in unit_map and item_unit:
                            unit_map[metric] = item_unit
                        break

        # 组装返回结构
        result_metrics: dict[str, Any] = {}
        for metric in metrics:
            entry: dict[str, Any] = {
                "unit":   unit_map.get(metric, _default_unit(metric)),
                "series": trend_data[metric],
            }
            # 附加参考区间
            ref = _reference_range(metric)
            if ref:
                entry["reference_range"] = ref
            result_metrics[metric] = entry

        return {
            "patient_id": str(pid),
            "metrics":    result_metrics,
        }


# ══════════════════════════════════════════════════════════════════════════════
# Tool 4 — 生成营养基线报告 PDF
# ══════════════════════════════════════════════════════════════════════════════

async def generate_baseline_report_pdf(
    patient_id: str,
    plan_id: str,
    upload_dir: str = "uploads",
) -> dict[str, Any]:
    """
    根据指定的营养方案 ID，生成 PDF 格式的营养评估报告。

    参数：
      patient_id  : 患者 UUID
      plan_id     : NutritionPlan UUID
      upload_dir  : 服务器上传根目录（默认 uploads/）

    返回：
    {
      "pdf_url": "/uploads/assessment_reports/report_<plan_id>.pdf",
      "filename": "营养评估报告_<患者姓名>_<日期>.pdf",
      "generated_at": "2024-03-01T10:00:00"
    }
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
        )
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError as e:
        return {"error": f"reportlab 未安装: {e}"}

    pid  = _parse_uuid(patient_id)
    plid = _parse_uuid(plan_id)

    async with AsyncSessionLocal() as db:
        patient = await _get_patient(db, pid)
        if not patient:
            return {"error": f"患者 {patient_id} 不存在"}

        plan_res = await db.execute(select(NutritionPlan).where(NutritionPlan.id == plid))
        plan: NutritionPlan | None = plan_res.scalars().first()
        if not plan:
            return {"error": f"方案 {plan_id} 不存在"}

        latest_albumin = await _get_latest_albumin(db, pid)

    content_data: dict = plan.plan_content or {}
    score, risk = _estimate_nrs2002(patient.bmi, patient.weight_kg, latest_albumin, plan.phase.value if plan.phase else None)
    phase_label  = _PHASE_LABELS.get(plan.phase.value, plan.phase.value) if plan.phase else "--"
    report_date  = (plan.valid_from or datetime.now().date()).isoformat()

    # ── 准备输出路径 ──────────────────────────────────────────────────────────
    pdf_dir  = Path(upload_dir) / _PDF_SUBDIR
    pdf_dir.mkdir(parents=True, exist_ok=True)
    filename = f"report_{plan_id}.pdf"
    filepath = pdf_dir / filename
    url_path = f"/uploads/{_PDF_SUBDIR}/{filename}"

    # ── 构建 PDF ─────────────────────────────────────────────────────────────
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        str(filepath),
        pagesize=A4,
        rightMargin=2 * cm, leftMargin=2 * cm,
        topMargin=2 * cm,   bottomMargin=2 * cm,
    )

    # 尝试注册中文字体（SimHei / NotoSansCJK，按环境适配）
    _register_chinese_font()

    styles = getSampleStyleSheet()
    cn_font = _get_cn_font_name()
    title_style = ParagraphStyle("Title", fontName=cn_font, fontSize=18, spaceAfter=6, alignment=1, leading=24)
    h2_style    = ParagraphStyle("H2",    fontName=cn_font, fontSize=13, spaceAfter=4, textColor=colors.HexColor("#1677FF"), leading=18)
    body_style  = ParagraphStyle("Body",  fontName=cn_font, fontSize=10, spaceAfter=2, leading=15)
    small_style = ParagraphStyle("Small", fontName=cn_font, fontSize=9,  textColor=colors.grey, leading=12)

    story = []

    # 标题
    story.append(Paragraph("营养评估基线报告", title_style))
    story.append(Spacer(1, 0.3 * cm))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#1677FF"), thickness=1.5))
    story.append(Spacer(1, 0.4 * cm))

    # 基本信息表
    gender_map = {"male": "男", "female": "女", "unknown": "未知"}
    info_data = [
        ["患者姓名", patient.name,         "性别", gender_map.get(patient.gender.value, "--")],
        ["当前阶段", phase_label,            "报告日期", report_date],
        ["身高(cm)",  str(patient.height_cm or "--"), "体重(kg)", str(patient.weight_kg or "--")],
        ["BMI",      f"{patient.bmi:.1f}" if patient.bmi else "--", "白蛋白(g/L)", f"{latest_albumin:.1f}" if latest_albumin else "--"],
    ]
    info_table = Table(info_data, colWidths=[3.5 * cm, 5 * cm, 3.5 * cm, 5 * cm])
    info_table.setStyle(TableStyle([
        ("FONTNAME",  (0, 0), (-1, -1), cn_font),
        ("FONTSIZE",  (0, 0), (-1, -1), 10),
        ("BACKGROUND",(0, 0), (0, -1), colors.HexColor("#F0F5FF")),
        ("BACKGROUND",(2, 0), (2, -1), colors.HexColor("#F0F5FF")),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#1677FF")),
        ("TEXTCOLOR", (2, 0), (2, -1), colors.HexColor("#1677FF")),
        ("FONTNAME",  (0, 0), (0, -1), cn_font),
        ("FONTNAME",  (2, 0), (2, -1), cn_font),
        ("GRID",      (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
        ("VALIGN",    (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",(0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 0.5 * cm))

    # NRS-2002 评分
    story.append(Paragraph("NRS-2002 营养风险筛查", h2_style))
    risk_color = "#FF4D4F" if score >= 3 else ("#FA8C16" if score >= 1 else "#52C41A")
    story.append(Paragraph(
        f"综合评分：<font color='{risk_color}'><b>{score} 分 — {risk}</b></font>",
        body_style,
    ))
    story.append(Paragraph("（评分依据：BMI、白蛋白、移植阶段综合估算）", small_style))
    story.append(Spacer(1, 0.4 * cm))

    # 营养目标
    story.append(Paragraph("营养量化目标", h2_style))
    goals = [
        ["指标",       "目标值",                   "单位"],
        ["能量",       str(content_data.get("energy_kcal", "--")), "kcal/天"],
        ["蛋白质",     str(content_data.get("protein_g", "--")),   "g/天"],
        ["脂肪",       str(content_data.get("fat_g", "--")),       "g/天"],
        ["碳水化合物", str(content_data.get("carb_g", "--")),      "g/天"],
    ]
    goal_table = Table(goals, colWidths=[5 * cm, 5 * cm, 5 * cm])
    goal_table.setStyle(TableStyle([
        ("FONTNAME",    (0, 0), (-1, -1), cn_font),
        ("FONTSIZE",    (0, 0), (-1, -1), 10),
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#1677FF")),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
        ("FONTNAME",    (0, 0), (-1, 0), cn_font),
        ("GRID",        (0, 0), (-1, -1), 0.5, colors.HexColor("#D0D0D0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9F9F9")]),
        ("ALIGN",       (1, 0), (-1, -1), "CENTER"),
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",  (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(goal_table)
    story.append(Spacer(1, 0.4 * cm))

    # 饮食建议
    suggestions = content_data.get("suggestions", [])
    if suggestions:
        story.append(Paragraph("饮食执行建议", h2_style))
        for i, s in enumerate(suggestions, 1):
            story.append(Paragraph(f"{i}. {s}", body_style))
        story.append(Spacer(1, 0.3 * cm))

    # 饮食禁忌
    restrictions = content_data.get("restrictions", [])
    if restrictions:
        story.append(Paragraph("饮食禁忌", h2_style))
        for r in restrictions:
            story.append(Paragraph(f"• {r}", body_style))
        story.append(Spacer(1, 0.3 * cm))

    # 补充剂
    supplements = content_data.get("supplements", [])
    if supplements:
        story.append(Paragraph("推荐补充剂", h2_style))
        for s in supplements:
            story.append(Paragraph(f"• {s}", body_style))
        story.append(Spacer(1, 0.4 * cm))

    story.append(HRFlowable(width="100%", color=colors.HexColor("#D0D0D0"), thickness=0.5))
    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph(
        f"本报告由协和医院肝移植中心营养系统自动生成，仅供临床参考。"
        f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
        small_style,
    ))

    doc.build(story)

    return {
        "pdf_url":      url_path,
        "filename":     f"营养评估报告_{patient.name}_{report_date}.pdf",
        "plan_id":      plan_id,
        "patient_name": patient.name,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 私有辅助函数
# ══════════════════════════════════════════════════════════════════════════════

def _parse_uuid(val: str) -> uuid.UUID:
    """字符串 → UUID，失败时抛 ValueError。"""
    return uuid.UUID(str(val))


async def _get_patient(db: AsyncSession, pid: uuid.UUID) -> PatientProfile | None:
    res = await db.execute(select(PatientProfile).where(PatientProfile.id == pid))
    return res.scalars().first()


async def _get_latest_albumin(db: AsyncSession, pid: uuid.UUID) -> float | None:
    """从最近一次化验单中提取白蛋白值。"""
    res = await db.execute(
        select(LabResult)
        .where(LabResult.patient_id == pid)
        .where(LabResult.structured_items.is_not(None))
        .order_by(LabResult.report_date.desc().nullslast(), LabResult.created_at.desc())
    )
    labs = res.scalars().all()
    for lab in labs:
        for item in (lab.structured_items or []):
            name = str(item.get("name", "")).lower()
            aliases = [a.lower() for a in _METRIC_ALIASES["albumin"]]
            if any(a in name for a in aliases):
                try:
                    return float(str(item.get("value", "")).replace(",", "").strip())
                except (TypeError, ValueError):
                    pass
    return None


def _estimate_nrs2002(
    bmi: float | None,
    weight: float | None,
    albumin: float | None,
    phase: str | None,
) -> tuple[int, str]:
    """
    简化版 NRS-2002 估算（正式临床须使用完整量表）。
    返回 (score, risk_label)
    """
    score = 0
    # ① 营养状态评分（根据 BMI 或白蛋白）
    if bmi is not None:
        if bmi < 18.5:
            score += 3
        elif bmi < 20.5:
            score += 2
    if albumin is not None:
        if albumin < 20:
            score += 3
        elif albumin < 30:
            score += 2
        elif albumin < _NORMAL_ALBUMIN_G_L:
            score += 1
    # ② 疾病严重程度（移植患者固定 +2）
    score += 2
    # ③ 年龄评分（无出生日期默认不加）

    if score >= 5:
        return score, "高风险 ⚠️"
    elif score >= 3:
        return score, "中风险"
    else:
        return score, "低风险"


def _default_unit(metric: str) -> str:
    units = {
        "weight":        "kg",
        "albumin":       "g/L",
        "total_protein": "g/L",
        "prealbumin":    "mg/L",
        "hemoglobin":    "g/L",
        "bmi":           "kg/m²",
    }
    return units.get(metric, "")


def _reference_range(metric: str) -> dict | None:
    ranges = {
        "albumin":       {"min": 35, "max": 55},
        "total_protein": {"min": 65, "max": 85},
        "prealbumin":    {"min": 200, "max": 400},
        "hemoglobin":    {"min": 115, "max": 150},
        "bmi":           {"min": 18.5, "max": 24.0},
    }
    return ranges.get(metric)


# ── 字体注册辅助（跨平台兼容）────────────────────────────────────────────────

_cn_font_registered = False
_cn_font_name = "Helvetica"   # 回退字体


def _register_chinese_font() -> None:
    """尝试注册系统中文字体用于 reportlab，失败时静默回退。"""
    global _cn_font_registered, _cn_font_name
    if _cn_font_registered:
        return
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        candidates = [
            ("SimHei",     r"C:\Windows\Fonts\simhei.ttf"),
            ("SimSun",     r"C:\Windows\Fonts\simsun.ttc"),
            ("MicrosoftYaHei", r"C:\Windows\Fonts\msyh.ttc"),
            ("NotoSansCJK", "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"),
            ("NotoSansCJK", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        ]
        for name, path in candidates:
            if os.path.exists(path):
                pdfmetrics.registerFont(TTFont(name, path))
                _cn_font_name = name
                _cn_font_registered = True
                logger.info("已注册中文字体: %s (%s)", name, path)
                return
    except Exception as e:
        logger.warning("中文字体注册失败，将使用 Helvetica（中文可能显示为方块）: %s", e)
    _cn_font_registered = True


def _get_cn_font_name() -> str:
    _register_chinese_font()
    return _cn_font_name
