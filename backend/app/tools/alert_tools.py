"""
app/tools/alert_tools.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
风险预警 Agent Tools

对外暴露：
  - get_high_risk_alerts()                汇总并返回当前所有活跃预警
  - acknowledge_alert(alert_id, doctor_id, note)  医生确认/处理预警
  - scan_and_create_alerts()              扫描最新检验数据，自动生成预警（供定时任务调用）

架构说明：
  Tool 调用 DB → 自动扫描新检验记录 → 写入 risk_alerts 表 → 返回汇总
  FastAPI 路由层直接透传调用结果，不含业务逻辑。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.models import (
    AlertSeverity, AlertStatus, AlertType,
    LabResult, PatientProfile, RiskAlert, TransplantPhase,
)

logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════════════════
# 安全阈值配置表
# ══════════════════════════════════════════════════════════════════════════════

# 指标名称别名：统一映射到内部 key
_METRIC_ALIASES: dict[str, list[str]] = {
    "albumin":       ["白蛋白", "albumin", "alb", "ALB", "ALB(g/L)", "白蛋白(g/L)"],
    "total_protein": ["总蛋白", "TP", "total protein", "Total Protein", "TP(g/L)"],
    "prealbumin":    ["前白蛋白", "prealbumin", "PA", "Prealbumin", "PA(mg/L)"],
    "hemoglobin":    ["血红蛋白", "HGB", "hemoglobin", "Hemoglobin", "Hb", "HGB(g/L)"],
    "weight":        ["体重", "weight", "BW", "Weight(kg)", "体重(kg)"],
    "bmi":           ["BMI", "bmi", "Body Mass Index"],
    "potassium":     ["钾", "K", "Potassium", "K(mmol/L)", "血钾"],
    "sodium":        ["钠", "Na", "Sodium", "Na(mmol/L)", "血钠"],
    "creatinine":    ["肌酐", "Cr", "Creatinine", "CREA", "CREA(μmol/L)"],
    "alt":           ["谷丙转氨酶", "ALT", "alt", "ALT(U/L)"],
    "ast":           ["谷草转氨酶", "AST", "ast", "AST(U/L)"],
}

# 阈值 schema: low_critical / low_warning / high_warning / high_critical
# 均可省略（None = 不检测该方向）
THRESHOLDS: dict[str, dict[str, Any]] = {
    "albumin": {
        "low_critical": 25,    # g/L  危急：白蛋白 < 25
        "low_warning":  30,    # g/L  警告：白蛋白 < 30
        "unit": "g/L",
        "label": "白蛋白",
        "desc_low": "白蛋白降低提示重度营养不良，需立即干预",
    },
    "total_protein": {
        "low_critical": 50,
        "low_warning":  60,
        "unit": "g/L",
        "label": "总蛋白",
        "desc_low": "总蛋白低下，蛋白质合成严重不足",
    },
    "prealbumin": {
        "low_critical": 150,
        "low_warning":  180,
        "unit": "mg/L",
        "label": "前白蛋白",
        "desc_low": "前白蛋白是最敏感的营养状态早期指标",
    },
    "hemoglobin": {
        "low_critical": 80,
        "low_warning":  100,
        "unit": "g/L",
        "label": "血红蛋白",
        "desc_low": "贫血加重，营养摄入不足或吸收障碍",
    },
    "potassium": {
        "low_critical": 3.0,
        "low_warning":  3.5,
        "high_warning": 5.5,
        "high_critical": 6.0,
        "unit": "mmol/L",
        "label": "血钾",
        "desc_low": "低钾血症，可能与营养摄入不足或利尿剂使用相关",
        "desc_high": "高钾血症，肾功能受损风险，需限钾饮食",
    },
    "sodium": {
        "low_critical": 130,
        "low_warning":  135,
        "high_warning": 150,
        "high_critical": 155,
        "unit": "mmol/L",
        "label": "血钠",
        "desc_low": "低钠血症（腹水 / 稀释性），需限水",
        "desc_high": "高钠血症，脱水或钠摄入过多",
    },
    "creatinine": {
        "high_warning":  200,
        "high_critical": 400,
        "unit": "μmol/L",
        "label": "肌酐",
        "desc_high": "肌酐升高提示肾功能受损，需调整蛋白质摄入",
    },
    "alt": {
        "high_warning":  80,
        "high_critical": 200,
        "unit": "U/L",
        "label": "谷丙转氨酶(ALT)",
        "desc_high": "转氨酶升高，肝细胞损伤，需评估营养方案安全性",
    },
    "ast": {
        "high_warning":  80,
        "high_critical": 200,
        "unit": "U/L",
        "label": "谷草转氨酶(AST)",
        "desc_high": "转氨酶升高，肝细胞损伤信号",
    },
}

# 高风险患者判断：BMI 极低阈值
_BMI_CRITICAL = 16.0
_BMI_WARNING  = 18.5

# 扫描窗口：只扫描最近 N 天的检验记录（避免对历史数据反复报警）
_SCAN_DAYS = 90


# ══════════════════════════════════════════════════════════════════════════════
# 工具函数：规范化指标名
# ══════════════════════════════════════════════════════════════════════════════

def _normalize_metric(name: str) -> str | None:
    """将检验单中的原始指标名映射为内部 key，若无匹配返回 None。"""
    name_lower = name.lower().strip()
    for key, aliases in _METRIC_ALIASES.items():
        if any(a.lower() in name_lower or name_lower in a.lower() for a in aliases):
            return key
    return None


# ══════════════════════════════════════════════════════════════════════════════
# Tool 核心：扫描并创建预警
# ══════════════════════════════════════════════════════════════════════════════

async def scan_and_create_alerts() -> dict[str, int]:
    """
    扫描近期（_SCAN_DAYS 天内）所有检验记录，
    对越阈值指标自动创建 RiskAlert（已存在则跳过）。
    同时检测 BMI 极低患者，创建 high_risk_patient 预警。

    返回：{"created": N, "skipped": M}
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=_SCAN_DAYS)
    created = skipped = 0

    async with AsyncSessionLocal() as db:
        # ── 扫描检验指标 ─────────────────────────────────────────────────────
        lab_res = await db.execute(
            select(LabResult)
            .where(LabResult.created_at >= cutoff)
            .where(LabResult.structured_items.is_not(None))
        )
        labs = lab_res.scalars().all()

        for lab in labs:
            for item in (lab.structured_items or []):
                raw_name  = str(item.get("name", ""))
                raw_value = item.get("value")
                metric_key = _normalize_metric(raw_name)
                if not metric_key or raw_value is None:
                    continue
                try:
                    value = float(str(raw_value).replace(",", "").strip())
                except (TypeError, ValueError):
                    continue

                thresh = THRESHOLDS.get(metric_key)
                if not thresh:
                    continue

                # 判断是否越阈值
                severity, direction, threshold_val, desc = _check_threshold(value, thresh)
                if not severity:
                    continue

                # 去重：同患者 + 同指标 + 同 lab_result 只建一条 active 预警
                existing = await db.execute(
                    select(RiskAlert).where(
                        and_(
                            RiskAlert.patient_id    == lab.patient_id,
                            RiskAlert.metric_name   == metric_key,
                            RiskAlert.lab_result_id == lab.id,
                            RiskAlert.status        == AlertStatus.ACTIVE,
                        )
                    )
                )
                if existing.scalars().first():
                    skipped += 1
                    continue

                unit  = item.get("unit") or thresh.get("unit", "")
                label = thresh.get("label", metric_key)
                msg = (
                    f"{label} 检测值 {value} {unit}"
                    f"（阈值 {threshold_val} {unit}，方向：{'偏低' if direction == 'below' else '偏高'}）"
                    f" — {desc}"
                )
                alert = RiskAlert(
                    patient_id      = lab.patient_id,
                    lab_result_id   = lab.id,
                    alert_type      = AlertType.ABNORMAL_INDICATOR,
                    severity        = severity,
                    status          = AlertStatus.ACTIVE,
                    metric_name     = metric_key,
                    metric_value    = value,
                    threshold_value = threshold_val,
                    unit            = unit,
                    direction       = direction,
                    message         = msg,
                )
                db.add(alert)
                created += 1

        # ── 扫描高风险患者（BMI 极低） ────────────────────────────────────────
        patient_res = await db.execute(
            select(PatientProfile)
            .where(PatientProfile.bmi.is_not(None))
            .where(PatientProfile.bmi < _BMI_WARNING)
        )
        patients = patient_res.scalars().all()

        for patient in patients:
            sev = AlertSeverity.CRITICAL if patient.bmi < _BMI_CRITICAL else AlertSeverity.WARNING
            existing = await db.execute(
                select(RiskAlert).where(
                    and_(
                        RiskAlert.patient_id  == patient.id,
                        RiskAlert.alert_type  == AlertType.HIGH_RISK_PATIENT,
                        RiskAlert.metric_name == "bmi",
                        RiskAlert.status      == AlertStatus.ACTIVE,
                    )
                )
            )
            if existing.scalars().first():
                skipped += 1
                continue

            msg = (
                f"患者 BMI={patient.bmi:.1f} kg/m²，"
                f"低于{'危急' if sev == AlertSeverity.CRITICAL else '警告'}阈值 "
                f"{_BMI_CRITICAL if sev == AlertSeverity.CRITICAL else _BMI_WARNING} kg/m²，"
                f"存在重度营养不良风险"
            )
            alert = RiskAlert(
                patient_id      = patient.id,
                alert_type      = AlertType.HIGH_RISK_PATIENT,
                severity        = sev,
                status          = AlertStatus.ACTIVE,
                metric_name     = "bmi",
                metric_value    = patient.bmi,
                threshold_value = _BMI_CRITICAL if sev == AlertSeverity.CRITICAL else _BMI_WARNING,
                unit            = "kg/m²",
                direction       = "below",
                message         = msg,
            )
            db.add(alert)
            created += 1

        await db.commit()

    logger.info("预警扫描完成：新建 %d 条，跳过（已存在）%d 条", created, skipped)
    return {"created": created, "skipped": skipped}


def _check_threshold(
    value: float,
    thresh: dict,
) -> tuple[AlertSeverity | None, str | None, float | None, str]:
    """
    检查 value 是否越过 thresh 中的阈值。
    返回 (severity, direction, crossed_threshold, description) 或 (None, None, None, "")
    """
    # 低阈值检测（优先判断危急）
    if "low_critical" in thresh and value < thresh["low_critical"]:
        return AlertSeverity.CRITICAL, "below", thresh["low_critical"], thresh.get("desc_low", "")
    if "low_warning" in thresh and value < thresh["low_warning"]:
        return AlertSeverity.WARNING, "below", thresh["low_warning"], thresh.get("desc_low", "")
    # 高阈值检测
    if "high_critical" in thresh and value > thresh["high_critical"]:
        return AlertSeverity.CRITICAL, "above", thresh["high_critical"], thresh.get("desc_high", "")
    if "high_warning" in thresh and value > thresh["high_warning"]:
        return AlertSeverity.WARNING, "above", thresh["high_warning"], thresh.get("desc_high", "")
    return None, None, None, ""


# ══════════════════════════════════════════════════════════════════════════════
# Tool 1 — 获取全部高风险预警
# ══════════════════════════════════════════════════════════════════════════════

async def get_high_risk_alerts(
    status_filter: list[str] | None = None,
    severity_filter: list[str] | None = None,
    patient_id: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    """
    汇总当前风险预警列表，自动触发一次最新扫描后返回结果。

    参数：
      status_filter   : ["active", "acknowledged"] 等；为 None 时默认返回 active
      severity_filter : ["critical", "warning", "info"]；None 时全量
      patient_id      : 仅返回指定患者的预警
      page / page_size: 分页

    返回结构：
    {
      "summary": {
        "total_active": N,
        "critical_count": N,
        "warning_count": N,
        "high_risk_patients": N,  // 有 critical 预警的患者数（去重）
        "new_today": N
      },
      "alerts": [
        {
          "id": "...",
          "patient_id": "...",
          "patient_name": "...",
          "patient_phase": "recovery",
          "alert_type": "abnormal_indicator",
          "alert_type_label": "检验指标异常",
          "severity": "critical",
          "status": "active",
          "metric_name": "albumin",
          "metric_label": "白蛋白",
          "metric_value": 22.5,
          "threshold_value": 25.0,
          "unit": "g/L",
          "direction": "below",
          "message": "...",
          "acknowledged_by": null,
          "acknowledged_at": null,
          "resolve_note": null,
          "created_at": "2024-03-01T08:00:00"
        },
        ...
      ],
      "total": N,
      "page": P,
      "page_size": PS
    }
    """
    # 先触发扫描，生成新预警
    await scan_and_create_alerts()

    # 默认只看 active
    if status_filter is None:
        status_filter = ["active"]

    async with AsyncSessionLocal() as db:
        # ── 构建查询 ──────────────────────────────────────────────────────────
        stmt = select(RiskAlert)

        # 状态过滤
        try:
            status_enums = [AlertStatus(s) for s in status_filter]
            stmt = stmt.where(RiskAlert.status.in_(status_enums))
        except ValueError:
            pass

        # 严重程度过滤
        if severity_filter:
            try:
                sev_enums = [AlertSeverity(s) for s in severity_filter]
                stmt = stmt.where(RiskAlert.severity.in_(sev_enums))
            except ValueError:
                pass

        # 患者过滤
        if patient_id:
            try:
                pid = uuid.UUID(patient_id)
                stmt = stmt.where(RiskAlert.patient_id == pid)
            except ValueError:
                pass

        # 排序：危急在前，再按时间倒序
        from sqlalchemy import case as sa_case
        stmt = stmt.order_by(
            sa_case(
                (RiskAlert.severity == AlertSeverity.CRITICAL, 0),
                (RiskAlert.severity == AlertSeverity.WARNING,  1),
                else_=2,
            ),
            RiskAlert.created_at.desc(),
        )

        # 汇总统计（在分页前）
        all_res = await db.execute(stmt)
        all_alerts: list[RiskAlert] = all_res.scalars().all()

        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        critical_count  = sum(1 for a in all_alerts if a.severity == AlertSeverity.CRITICAL)
        warning_count   = sum(1 for a in all_alerts if a.severity == AlertSeverity.WARNING)
        high_risk_patients = len({a.patient_id for a in all_alerts if a.severity == AlertSeverity.CRITICAL})
        new_today       = sum(1 for a in all_alerts if a.created_at and a.created_at >= today_start)

        # 分页
        total = len(all_alerts)
        paged = all_alerts[(page - 1) * page_size: page * page_size]

        # ── 加载患者信息 ──────────────────────────────────────────────────────
        patient_ids = list({a.patient_id for a in paged})
        patient_map: dict[uuid.UUID, PatientProfile] = {}
        if patient_ids:
            p_res = await db.execute(
                select(PatientProfile).where(PatientProfile.id.in_(patient_ids))
            )
            for p in p_res.scalars().all():
                patient_map[p.id] = p

        alerts_data = [_alert_to_dict(a, patient_map.get(a.patient_id)) for a in paged]

    return {
        "summary": {
            "total_active":      total,
            "critical_count":    critical_count,
            "warning_count":     warning_count,
            "high_risk_patients": high_risk_patients,
            "new_today":          new_today,
        },
        "alerts":    alerts_data,
        "total":     total,
        "page":      page,
        "page_size": page_size,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Tool 2 — 医生确认预警
# ══════════════════════════════════════════════════════════════════════════════

async def acknowledge_alert(
    alert_id: str,
    doctor_id: str,
    resolve_note: str = "",
) -> dict[str, Any]:
    """
    医生确认并处理一条预警。

    参数：
      alert_id     : RiskAlert UUID
      doctor_id    : 操作医生的 ID 或姓名
      resolve_note : 处理备注（可选）

    返回：
    {
      "success": true,
      "alert_id": "...",
      "status": "acknowledged",
      "acknowledged_by": "李医生",
      "acknowledged_at": "2024-03-01T10:00:00"
    }
    """
    try:
        aid = uuid.UUID(alert_id)
    except ValueError:
        return {"success": False, "error": f"无效的 alert_id: {alert_id}"}

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(RiskAlert).where(RiskAlert.id == aid))
        alert: RiskAlert | None = res.scalars().first()
        if not alert:
            return {"success": False, "error": f"预警记录 {alert_id} 不存在"}
        if alert.status == AlertStatus.ACKNOWLEDGED:
            return {
                "success": True,
                "alert_id": alert_id,
                "status": "acknowledged",
                "acknowledged_by": alert.acknowledged_by,
                "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
                "message": "预警已于之前处理过",
            }

        now = datetime.now(timezone.utc)
        alert.status          = AlertStatus.ACKNOWLEDGED
        alert.acknowledged_by = doctor_id
        alert.acknowledged_at = now
        alert.resolve_note    = resolve_note or None
        await db.commit()

    return {
        "success":         True,
        "alert_id":        alert_id,
        "status":          "acknowledged",
        "acknowledged_by": doctor_id,
        "acknowledged_at": now.isoformat(timespec="seconds"),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 辅助：序列化 RiskAlert
# ══════════════════════════════════════════════════════════════════════════════

_ALERT_TYPE_LABELS = {
    "abnormal_indicator": "检验指标异常",
    "high_risk_patient":  "高风险患者",
    "weight_loss":        "体重骤降",
    "low_compliance":     "依从性偏低",
}

_METRIC_LABELS = {k: v.get("label", k) for k, v in THRESHOLDS.items()}
_METRIC_LABELS["bmi"] = "BMI"

_PHASE_LABELS = {
    "pre_assessment":   "术前评估期",
    "pre_operation":    "等待手术期",
    "early_post_op":    "术后早期",
    "recovery":         "恢复期",
    "rehabilitation":   "康复期",
    "long_term_follow": "长期随访",
}


def _alert_to_dict(alert: RiskAlert, patient: PatientProfile | None) -> dict[str, Any]:
    return {
        "id":               str(alert.id),
        "patient_id":       str(alert.patient_id),
        "patient_name":     patient.name if patient else "--",
        "patient_phase":    patient.current_phase.value if patient else None,
        "patient_phase_label": _PHASE_LABELS.get(patient.current_phase.value, "") if patient else "--",
        "lab_result_id":    str(alert.lab_result_id) if alert.lab_result_id else None,
        "alert_type":       alert.alert_type.value,
        "alert_type_label": _ALERT_TYPE_LABELS.get(alert.alert_type.value, alert.alert_type.value),
        "severity":         alert.severity.value,
        "status":           alert.status.value,
        "metric_name":      alert.metric_name,
        "metric_label":     _METRIC_LABELS.get(alert.metric_name, alert.metric_name) if alert.metric_name else "--",
        "metric_value":     alert.metric_value,
        "threshold_value":  alert.threshold_value,
        "unit":             alert.unit,
        "direction":        alert.direction,
        "message":          alert.message,
        "acknowledged_by":  alert.acknowledged_by,
        "acknowledged_at":  alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
        "resolve_note":     alert.resolve_note,
        "created_at":       alert.created_at.isoformat() if alert.created_at else None,
    }
