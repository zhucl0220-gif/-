"""
核心数据库模型（SQLAlchemy 2.x ORM）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
表列表：
  - PatientProfile   患者基础档案（含移植阶段）
  - ConsentRecord    知情同意书（签名图 + PDF 路径）
  - LabResult        检验结果（JSONB 存储 OCR 原始数据与 AI 分析结果）
  - NutritionPlan    营养方案（与 PatientProfile 关联）
  - DietRecord       饮食打卡记录
  - AgentTask        智能体任务日志（思考链 + 工具调用链）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import enum
import uuid
from datetime import datetime, date
from typing import Any

from sqlalchemy import (
    String, Text, Float, Boolean, Date, DateTime,
    ForeignKey, Enum as SAEnum, Integer, func, Uuid as UUID, Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.db_types import FlexJSON


# ══════════════════════════════════════════════════════════════════════════════
# 枚举类型
# ══════════════════════════════════════════════════════════════════════════════

class TransplantPhase(str, enum.Enum):
    """移植全流程阶段"""
    PRE_ASSESSMENT    = "pre_assessment"     # 术前评估期
    PRE_OPERATION     = "pre_operation"      # 术前准备期（等待期）
    EARLY_POST_OP     = "early_post_op"      # 术后早期（ICU，0–7天）
    RECOVERY          = "recovery"           # 恢复期（8–30天）
    REHABILITATION    = "rehabilitation"     # 康复期（1–3个月）
    LONG_TERM_FOLLOW  = "long_term_follow"   # 长期随访（>3个月）


class GenderEnum(str, enum.Enum):
    MALE    = "male"
    FEMALE  = "female"
    UNKNOWN = "unknown"


class ConsentStatus(str, enum.Enum):
    PENDING   = "pending"    # 待签署
    SIGNED    = "signed"     # 已签署
    REVOKED   = "revoked"    # 已撤回


class AgentTaskStatus(str, enum.Enum):
    QUEUED     = "queued"     # 排队中
    RUNNING    = "running"    # 执行中
    COMPLETED  = "completed"  # 已完成
    FAILED     = "failed"     # 失败


class AgentTaskType(str, enum.Enum):
    LAB_ANALYSIS       = "lab_analysis"        # 检验单解读
    NUTRITION_PLAN     = "nutrition_plan"       # 营养方案生成
    WEB_SEARCH         = "web_search"           # 网络搜索
    CODE_EXECUTION     = "code_execution"       # 代码沙箱执行
    DIET_EVALUATION    = "diet_evaluation"      # 饮食评估
    GENERAL_QA         = "general_qa"           # 通用问答


class AlertStatus(str, enum.Enum):
    ACTIVE       = "active"        # 待处理
    ACKNOWLEDGED = "acknowledged"  # 医生已确认/处理
    RESOLVED     = "resolved"      # 已自动恢复或手动解除


class AlertType(str, enum.Enum):
    ABNORMAL_INDICATOR = "abnormal_indicator"  # 检验指标越阈值
    HIGH_RISK_PATIENT  = "high_risk_patient"   # 患者整体高风险（NRS-2002 ≥5 or BMI 极低）
    WEIGHT_LOSS        = "weight_loss"          # 近期体重骤降
    LOW_COMPLIANCE     = "low_compliance"       # 饮食依从性持续偏低


class AlertSeverity(str, enum.Enum):
    CRITICAL = "critical"  # 危急（红色）
    WARNING  = "warning"   # 警告（橙色）
    INFO     = "info"      # 提示（蓝色）


# ══════════════════════════════════════════════════════════════════════════════
# Mixin：公共字段
# ══════════════════════════════════════════════════════════════════════════════

class TimestampMixin:
    """自动维护 created_at / updated_at"""
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UUIDPrimaryKeyMixin:
    """UUID 主键（PostgreSQL uuid-ossp 或 Python 端生成）"""
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )


# ══════════════════════════════════════════════════════════════════════════════
# 1. PatientProfile — 患者基础档案
# ══════════════════════════════════════════════════════════════════════════════

class PatientProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    患者主档案。
    current_phase 驱动全系统的营养方案逻辑——阶段变更时，
    Agent 应自动触发重新评估任务。
    """
    __tablename__ = "patient_profiles"

    # ── 基本信息 ──────────────────────────────────────────────────────────────
    name:           Mapped[str]           = mapped_column(String(64), nullable=False, comment="真实姓名")
    id_number:      Mapped[str | None]    = mapped_column(String(18), unique=True, comment="身份证号（脱敏存储）")
    gender:         Mapped[GenderEnum]    = mapped_column(SAEnum(GenderEnum), default=GenderEnum.UNKNOWN)
    birth_date:     Mapped[date | None]   = mapped_column(Date, comment="出生日期")
    phone:          Mapped[str | None]    = mapped_column(String(20), comment="手机号")
    wechat_openid:  Mapped[str | None]    = mapped_column(String(64), unique=True, comment="微信小程序 OpenID")

    # ── 体格测量 ──────────────────────────────────────────────────────────────
    height_cm:      Mapped[float | None]  = mapped_column(Float, comment="身高 cm")
    weight_kg:      Mapped[float | None]  = mapped_column(Float, comment="体重 kg")
    bmi:            Mapped[float | None]  = mapped_column(Float, comment="BMI，由服务层计算")

    # ── 移植信息 ──────────────────────────────────────────────────────────────
    diagnosis:      Mapped[str | None]    = mapped_column(Text, comment="原发病诊断")
    transplant_date: Mapped[date | None]  = mapped_column(Date, comment="移植手术日期")
    current_phase:  Mapped[TransplantPhase] = mapped_column(
        SAEnum(TransplantPhase),
        default=TransplantPhase.PRE_ASSESSMENT,
        nullable=False,
        index=True,
        comment="当前所处移植阶段，驱动营养方案逻辑",
    )

    # ── 关系 ──────────────────────────────────────────────────────────────────
    consent_records:  Mapped[list["ConsentRecord"]]  = relationship(back_populates="patient", cascade="all, delete-orphan")
    lab_results:      Mapped[list["LabResult"]]       = relationship(back_populates="patient", cascade="all, delete-orphan")
    nutrition_plans:  Mapped[list["NutritionPlan"]]   = relationship(back_populates="patient", cascade="all, delete-orphan")
    diet_records:     Mapped[list["DietRecord"]]      = relationship(back_populates="patient", cascade="all, delete-orphan")
    agent_tasks:      Mapped[list["AgentTask"]]       = relationship(back_populates="patient", cascade="all, delete-orphan")
    risk_alerts:      Mapped[list["RiskAlert"]]       = relationship(back_populates="patient", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<PatientProfile id={self.id} name={self.name} phase={self.current_phase}>"


# ══════════════════════════════════════════════════════════════════════════════
# 2. ConsentRecord — 知情同意书
# ══════════════════════════════════════════════════════════════════════════════

class ConsentRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    存储患者签署的知情同意书。
    signature_image_path : 手写签名图片的服务器相对路径（或 OSS URL）
    pdf_path             : 生成的 PDF 文件路径
    """
    __tablename__ = "consent_records"

    patient_id:           Mapped[uuid.UUID]       = mapped_column(UUID(as_uuid=True), ForeignKey("patient_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    consent_type:         Mapped[str]             = mapped_column(String(128), nullable=False, comment="同意书类型，如 营养干预知情同意书")
    status:               Mapped[ConsentStatus]   = mapped_column(SAEnum(ConsentStatus), default=ConsentStatus.PENDING, nullable=False)
    signed_at:            Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="签署时间")
    signature_image_path: Mapped[str | None]      = mapped_column(Text, comment="签名图路径 / OSS URL")
    pdf_path:             Mapped[str | None]      = mapped_column(Text, comment="PDF 文件路径 / OSS URL")
    ip_address:           Mapped[str | None]      = mapped_column(String(45), comment="签署时客户端 IP（IPv6 最长 45 字符）")
    remarks:              Mapped[str | None]      = mapped_column(Text, comment="备注")

    patient: Mapped["PatientProfile"] = relationship(back_populates="consent_records")

    def __repr__(self) -> str:
        return f"<ConsentRecord id={self.id} type={self.consent_type} status={self.status}>"


# ══════════════════════════════════════════════════════════════════════════════
# 3. LabResult — 检验结果
# ══════════════════════════════════════════════════════════════════════════════

class LabResult(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    检验单结果。
    ┌──────────────────────────────────────────────────────────────┐
    │ JSONB 字段说明                                               │
    │  ocr_raw_data     : OCR 引擎输出的原始结构化数据             │
    │  structured_items : 经解析的指标列表                         │
    │                     [{"name":"ALT","value":35,"unit":"U/L",  │
    │                       "ref_range":"7-40","is_abnormal":false}]│
    │  analysis_result  : AI Agent 分析结论（含营养相关解读）      │
    └──────────────────────────────────────────────────────────────┘
    """
    __tablename__ = "lab_results"

    patient_id:       Mapped[uuid.UUID]     = mapped_column(UUID(as_uuid=True), ForeignKey("patient_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    report_date:      Mapped[date | None]   = mapped_column(Date, comment="报告日期")
    report_type:      Mapped[str]           = mapped_column(String(128), nullable=False, comment="报告类型，如 肝功能 / 血常规 / 营养指标")
    source_image_path: Mapped[str | None]   = mapped_column(Text, comment="原始检验单图片路径")

    # ── JSONB 核心字段 ────────────────────────────────────────────────────────
    ocr_raw_data:     Mapped[dict[str, Any] | None] = mapped_column(
        FlexJSON,
        comment="OCR 引擎原始输出，保留完整结构以备溯源",
    )
    structured_items: Mapped[list[dict[str, Any]] | None] = mapped_column(
        FlexJSON,
        comment="结构化指标列表 [{name, value, unit, ref_range, is_abnormal}]",
    )
    analysis_result:  Mapped[dict[str, Any] | None] = mapped_column(
        FlexJSON,
        comment="AI Agent 营养相关分析结论 {summary, risks, recommendations, generated_at}",
    )

    # ── 状态 ──────────────────────────────────────────────────────────────────
    is_analyzed:      Mapped[bool]          = mapped_column(Boolean, default=False, nullable=False, comment="是否已完成 AI 分析")
    phase_at_upload:  Mapped[TransplantPhase | None] = mapped_column(SAEnum(TransplantPhase), comment="上传时患者所处阶段")

    patient: Mapped["PatientProfile"] = relationship(back_populates="lab_results")

    def __repr__(self) -> str:
        return f"<LabResult id={self.id} type={self.report_type} analyzed={self.is_analyzed}>"


# ══════════════════════════════════════════════════════════════════════════════
# 4. NutritionPlan — 营养方案
# ══════════════════════════════════════════════════════════════════════════════

class NutritionPlan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    由 Agent 生成或营养师审核的营养方案。
    plan_content 使用 JSONB 灵活存储：
      {
        "energy_kcal": 1800,
        "protein_g": 90,
        "meals": [...],
        "restrictions": [...],
        "supplements": [...]
      }
    """
    __tablename__ = "nutrition_plans"

    patient_id:    Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), ForeignKey("patient_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    phase:         Mapped[TransplantPhase]   = mapped_column(SAEnum(TransplantPhase), nullable=False, comment="本方案适用阶段")
    valid_from:    Mapped[date | None]        = mapped_column(Date, comment="方案生效日期")
    valid_until:   Mapped[date | None]        = mapped_column(Date, comment="方案失效日期")
    is_active:     Mapped[bool]              = mapped_column(Boolean, default=True, nullable=False)
    plan_content:  Mapped[dict[str, Any]]    = mapped_column(FlexJSON, nullable=False, comment="方案详细内容（结构化 JSON）")
    generated_by:  Mapped[str]              = mapped_column(String(64), default="agent", comment="生成来源：agent | dietitian | system")
    agent_task_id: Mapped[uuid.UUID | None]  = mapped_column(UUID(as_uuid=True), ForeignKey("agent_tasks.id", ondelete="SET NULL"), comment="生成本方案的 Agent 任务 ID")

    patient: Mapped["PatientProfile"] = relationship(back_populates="nutrition_plans")

    def __repr__(self) -> str:
        return f"<NutritionPlan id={self.id} phase={self.phase} active={self.is_active}>"


# ══════════════════════════════════════════════════════════════════════════════
# 5. DietRecord — 饮食打卡记录
# ══════════════════════════════════════════════════════════════════════════════

class DietRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    患者每日饮食打卡（C 端小程序提交）。
    food_items 示例：
      [{"name":"米饭","amount_g":150,"calories":174},
       {"name":"清蒸鱼","amount_g":100,"calories":113}]
    """
    __tablename__ = "diet_records"

    patient_id:      Mapped[uuid.UUID]              = mapped_column(UUID(as_uuid=True), ForeignKey("patient_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    record_date:     Mapped[date]                   = mapped_column(Date, nullable=False, comment="打卡日期")
    meal_type:       Mapped[str]                    = mapped_column(String(32), nullable=False, comment="早餐/午餐/晚餐/加餐")
    food_items:      Mapped[list[dict[str, Any]]]   = mapped_column(FlexJSON, nullable=False, comment="食物列表")
    image_path:      Mapped[str | None]             = mapped_column(Text, comment="饮食图片路径")
    total_calories:  Mapped[float | None]           = mapped_column(Float, comment="本餐合计热量 kcal")
    total_protein_g: Mapped[float | None]           = mapped_column(Float, comment="本餐合计蛋白质 g")
    compliance_score: Mapped[float | None]          = mapped_column(Float, comment="方案依从性评分 0-100")
    ai_feedback:     Mapped[dict[str, Any] | None]  = mapped_column(FlexJSON, comment="AI 即时反馈")

    patient: Mapped["PatientProfile"] = relationship(back_populates="diet_records")

    def __repr__(self) -> str:
        return f"<DietRecord id={self.id} date={self.record_date} meal={self.meal_type}>"


# ══════════════════════════════════════════════════════════════════════════════
# 6. AgentTask — 智能体任务日志
# ══════════════════════════════════════════════════════════════════════════════

class AgentTask(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    记录智能体的完整执行过程，实现可审计、可追溯的 Agent-First 架构。

    ┌──────────────────────────────────────────────────────────────────────┐
    │ JSONB 字段说明                                                       │
    │  input_payload   : Agent 收到的原始输入（用户消息 / 触发事件）       │
    │  thinking_chain  : 思考链（CoT），如 ReAct 的 Thought 序列           │
    │    [{"step":1,"thought":"...","action":"tool_name","action_input":{}}]│
    │  tool_call_chain : 工具调用链（含入参、出参、耗时）                  │
    │    [{"tool":"search_web","input":{...},"output":{...},"ms":320}]     │
    │  final_output    : Agent 最终输出结果                                │
    │  error_detail    : 失败时的错误信息                                  │
    └──────────────────────────────────────────────────────────────────────┘
    """
    __tablename__ = "agent_tasks"

    patient_id:       Mapped[uuid.UUID | None]      = mapped_column(UUID(as_uuid=True), ForeignKey("patient_profiles.id", ondelete="SET NULL"), index=True, comment="关联患者（可为空，如系统级任务）")
    task_type:        Mapped[AgentTaskType]         = mapped_column(SAEnum(AgentTaskType), nullable=False, index=True)
    status:           Mapped[AgentTaskStatus]       = mapped_column(SAEnum(AgentTaskStatus), default=AgentTaskStatus.QUEUED, nullable=False, index=True)

    # ── 时间记录 ──────────────────────────────────────────────────────────────
    started_at:       Mapped[datetime | None]       = mapped_column(DateTime(timezone=True))
    completed_at:     Mapped[datetime | None]       = mapped_column(DateTime(timezone=True))
    duration_ms:      Mapped[int | None]            = mapped_column(Integer, comment="总执行耗时（毫秒）")

    # ── JSONB 核心字段 ────────────────────────────────────────────────────────
    input_payload:    Mapped[dict[str, Any] | None] = mapped_column(FlexJSON, comment="原始输入")
    thinking_chain:   Mapped[list[dict[str, Any]] | None] = mapped_column(
        FlexJSON,
        comment="ReAct 思考链 [{step, thought, action, action_input}]",
    )
    tool_call_chain:  Mapped[list[dict[str, Any]] | None] = mapped_column(
        FlexJSON,
        comment="工具调用明细 [{tool, input, output, ms}]",
    )
    final_output:     Mapped[dict[str, Any] | None] = mapped_column(FlexJSON, comment="最终输出结果")
    error_detail:     Mapped[dict[str, Any] | None] = mapped_column(FlexJSON, comment="错误详情 {type, message, traceback}")

    # ── 元数据 ────────────────────────────────────────────────────────────────
    llm_model:        Mapped[str | None]            = mapped_column(String(64), comment="执行时使用的 LLM 模型")
    total_tokens:     Mapped[int | None]            = mapped_column(Integer, comment="消耗 Token 数")
    triggered_by:     Mapped[str | None]            = mapped_column(String(64), comment="触发来源：user | system | scheduler")

    patient: Mapped["PatientProfile | None"] = relationship(back_populates="agent_tasks")

    def __repr__(self) -> str:
        return f"<AgentTask id={self.id} type={self.task_type} status={self.status}>"


# ══════════════════════════════════════════════════════════════════════════════
# 7. RiskAlert — 风险预警记录
# ══════════════════════════════════════════════════════════════════════════════

class RiskAlert(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    系统自动或手动生成的风险预警。
    每条记录对应一次"触发事件"，医生确认后 status → acknowledged。

    ┌──────────────────────────────────────────────────────────────┐
    │ 预警触发逻辑                                                 │
    │  abnormal_indicator : LabResult.structured_items 中某指标   │
    │                        低于/高于安全阈值                     │
    │  high_risk_patient  : 患者 NRS-2002 ≥ 5 或 BMI < 16        │
    │  weight_loss        : 近 30 天体重下降 > 5%                  │
    │  low_compliance     : 近 7 天依从性均分 < 60                  │
    └──────────────────────────────────────────────────────────────┘
    """
    __tablename__ = "risk_alerts"

    # ── 关联 ──────────────────────────────────────────────────────────────────
    patient_id:      Mapped[uuid.UUID]        = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_profiles.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    lab_result_id:   Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lab_results.id", ondelete="SET NULL"),
        nullable=True, index=True,
        comment="触发本预警的检验记录（可空）",
    )

    # ── 分类 ──────────────────────────────────────────────────────────────────
    alert_type:   Mapped[AlertType]     = mapped_column(SAEnum(AlertType),     nullable=False, index=True)
    severity:     Mapped[AlertSeverity] = mapped_column(SAEnum(AlertSeverity), nullable=False, index=True)
    status:       Mapped[AlertStatus]   = mapped_column(
        SAEnum(AlertStatus),
        default=AlertStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    # ── 指标详情（异常指标类预警） ─────────────────────────────────────────────
    metric_name:     Mapped[str | None]   = mapped_column(String(64),  comment="指标名称，如 albumin / hemoglobin")
    metric_value:    Mapped[float | None] = mapped_column(Float,       comment="检测到的实际值")
    threshold_value: Mapped[float | None] = mapped_column(Float,       comment="被突破的安全阈值")
    unit:            Mapped[str | None]   = mapped_column(String(32),  comment="指标单位")
    direction:       Mapped[str | None]   = mapped_column(String(8),   comment="below | above")

    # ── 信息 ──────────────────────────────────────────────────────────────────
    message:         Mapped[str]          = mapped_column(Text, nullable=False, comment="预警描述（人类可读）")

    # ── 处理 ──────────────────────────────────────────────────────────────────
    acknowledged_by: Mapped[str | None]       = mapped_column(String(64),               comment="确认医生 ID 或姓名")
    acknowledged_at: Mapped[datetime | None]  = mapped_column(DateTime(timezone=True),  comment="确认时间")
    resolve_note:    Mapped[str | None]       = mapped_column(Text,                     comment="处理备注")

    # ── 去重唯一键（相同患者+指标+检验单只生成一条 active 预警） ────────────────
    __table_args__ = (
        Index("ix_risk_alert_dedup", "patient_id", "alert_type", "metric_name", "lab_result_id"),
    )

    patient: Mapped["PatientProfile"] = relationship(back_populates="risk_alerts")

    def __repr__(self) -> str:
        return f"<RiskAlert id={self.id} type={self.alert_type} severity={self.severity} status={self.status}>"


# ══════════════════════════════════════════════════════════════════════════════
# 知识库 CMS 表
# ══════════════════════════════════════════════════════════════════════════════

class SymptomEntry(Base):
    """
    症状字典库
    每条记录描述一个症状（如：恶心、腹泻、腹水）以及对应的营养干预四维解析。
    """
    __tablename__ = "symptom_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    symptom_name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True, comment="症状名称，如 恶心、腹水")
    category:     Mapped[str] = mapped_column(String(64),  nullable=False, index=True, comment="分类，如 消化系统 / 代谢 / 感染")
    # four_dim: { nutrition_impact, dietary_advice, warning_signs, follow_up_action }
    four_dim: Mapped[dict[str, Any]] = mapped_column(FlexJSON, nullable=False, default=dict, comment="四维解析 JSON")
    # phase_relevance: { "early_post_op": true, "recovery": true, ... }
    phase_relevance: Mapped[dict[str, Any]] = mapped_column(FlexJSON, nullable=False, default=dict, comment="适用阶段标记")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="是否启用")

    def __repr__(self) -> str:
        return f"<SymptomEntry name={self.symptom_name} category={self.category}>"


class KnowledgeQA(Base):
    """
    AI 知识图谱 Q&A 对（用于 RAG 检索）
    支持手动录入和文档解析，vectorized_at 记录向量化时间。
    """
    __tablename__ = "knowledge_qa"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    question:    Mapped[str]          = mapped_column(Text,        nullable=False, comment="问题文本")
    answer:      Mapped[str]          = mapped_column(Text,        nullable=False, comment="答案文本")
    category:    Mapped[str]          = mapped_column(String(64),  nullable=False, index=True, comment="知识类别")
    phase_tags:  Mapped[dict[str, Any]] = mapped_column(FlexJSON,  nullable=False, default=list, comment="适用阶段标签列表")
    source_doc:  Mapped[str | None]   = mapped_column(String(256), comment="来源文档名称或路径")
    vector_id:   Mapped[str | None]   = mapped_column(String(128), comment="向量库记录 ID")
    is_vectorized: Mapped[bool]       = mapped_column(Boolean, default=False, nullable=False, index=True)
    vectorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="向量化完成时间")

    def __repr__(self) -> str:
        return f"<KnowledgeQA id={self.id} category={self.category} vectorized={self.is_vectorized}>"


class NutritionRuleConfig(Base):
    """
    各阶段营养规则配置表（每个移植阶段一行）
    存储能量/蛋白目标、详细规则、评估量表模板等。
    """
    __tablename__ = "nutrition_rule_configs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    phase: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True,
        comment="移植阶段，与 TransplantPhase 枚举值对应"
    )
    energy_kcal_per_kg:  Mapped[float | None] = mapped_column(Float, comment="推荐能量 kcal/kg/d")
    protein_g_per_kg:    Mapped[float | None] = mapped_column(Float, comment="推荐蛋白 g/kg/d")
    # rule_content: 完整规则描述 JSON，任意结构供前端表单渲染
    rule_content:        Mapped[dict[str, Any]] = mapped_column(FlexJSON, nullable=False, default=dict, comment="完整规则配置")
    # assessment_template: 评估量表模板 JSON
    assessment_template: Mapped[dict[str, Any]] = mapped_column(FlexJSON, nullable=False, default=dict, comment="评估量表模板")
    is_active:  Mapped[bool]       = mapped_column(Boolean, default=True, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(64), comment="最后修改人")

    def __repr__(self) -> str:
        return f"<NutritionRuleConfig phase={self.phase} energy={self.energy_kcal_per_kg}>"
