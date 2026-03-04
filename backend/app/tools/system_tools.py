"""
app/tools/system_tools.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
系统管理 Agent Tools (AD-22 ~ AD-25)

对外暴露：
  get_registered_agent_tools()
      返回系统中所有注册 Tool 的元数据列表，支持按类型/模块过滤。
      enabled 状态持久化到 uploads/system/tool_states.json。

  update_tool_state(tool_name, enabled)
      切换指定 Tool 的启用状态，并更新持久化文件。

  get_consent_templates()
      返回当前所有协议模板列表（含版本号与内容）。

  update_consent_template(key, content, updated_by)
      更新指定 key 的协议模板内容，自动递增版本号。
      模板持久化到 uploads/system/consent_templates.json。

  get_operation_logs(page, page_size, task_type, status)
      查询 AgentTask 操作日志（带分页）。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select, func

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import AgentTask, AgentTaskStatus, AgentTaskType

logger = logging.getLogger(__name__)

# ── 持久化目录 ───────────────────────────────────────────────────────────────
_SYS_DIR = Path(settings.UPLOAD_DIR) / "system"
_SYS_DIR.mkdir(parents=True, exist_ok=True)

_TOOL_STATES_FILE     = _SYS_DIR / "tool_states.json"
_TEMPLATES_FILE       = _SYS_DIR / "consent_templates.json"


# ══════════════════════════════════════════════════════════════════════════════
# 工具注册表（静态元数据 + 动态 enabled 状态）
# ══════════════════════════════════════════════════════════════════════════════

# 工具类型枚举
_TYPE_RETRIEVAL  = "retrieval"    # 检索类
_TYPE_COMPUTE    = "compute"      # 计算类
_TYPE_FILE_OPS   = "file_ops"     # 文件操作类
_TYPE_WRITE      = "write"        # 写入/变更类
_TYPE_EXTERNAL   = "external"     # 外部调用类

# 类型中文标签
TOOL_TYPE_LABELS: dict[str, str] = {
    _TYPE_RETRIEVAL: "检索类",
    _TYPE_COMPUTE:   "计算类",
    _TYPE_FILE_OPS:  "文件操作类",
    _TYPE_WRITE:     "写入/变更类",
    _TYPE_EXTERNAL:  "外部调用类",
}

# 类型颜色（供前端 Tag 使用）
TOOL_TYPE_COLORS: dict[str, str] = {
    _TYPE_RETRIEVAL: "blue",
    _TYPE_COMPUTE:   "purple",
    _TYPE_FILE_OPS:  "cyan",
    _TYPE_WRITE:     "orange",
    _TYPE_EXTERNAL:  "geekblue",
}

# 工具分类
_CAT_SYSTEM  = "系统工具"
_CAT_SCENE   = "场景工具"
_CAT_API     = "API工具"

# 风险等级
_RISK_LOW    = "低"
_RISK_MID    = "中"
_RISK_HIGH   = "高"

# 完整工具注册表
# 新增字段说明：
#   category        — 工具分类: 系统工具 / 场景工具 / API工具
#   affiliated_agent— 所属 Agent 名称
#   parameter_count — 调用时需要传入的参数数量
#   risk_level      — 操作风险等级: 低 / 中 / 高
TOOL_REGISTRY: list[dict[str, Any]] = [
    # ── 合规 / 知情同意 ───────────────────────────────────────────────────────
    {
        "name": "sign_and_unlock_user",
        "label": "签署知情同意书",
        "description": "处理患者签名数据，生成 PDF 并解锁小程序功能",
        "type": _TYPE_WRITE,
        "module": "compliance_tools",
        "module_label": "合规管理",
        "category": _CAT_SCENE,
        "affiliated_agent": "合规审核 Agent",
        "parameter_count": 3,
        "risk_level": _RISK_HIGH,
    },
    {
        "name": "check_consent_status",
        "label": "查询同意书状态",
        "description": "查询指定患者的知情同意书签署状态",
        "type": _TYPE_RETRIEVAL,
        "module": "compliance_tools",
        "module_label": "合规管理",
        "category": _CAT_SCENE,
        "affiliated_agent": "合规审核 Agent",
        "parameter_count": 1,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "revoke_consent",
        "label": "撤销知情同意",
        "description": "将指定同意书状态置为已撤回",
        "type": _TYPE_WRITE,
        "module": "compliance_tools",
        "module_label": "合规管理",
        "category": _CAT_SCENE,
        "affiliated_agent": "合规审核 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_HIGH,
    },
    {
        "name": "get_consent_detail",
        "label": "获取同意书详情",
        "description": "返回某份知情同意书的完整信息（含 PDF 链接）",
        "type": _TYPE_RETRIEVAL,
        "module": "compliance_tools",
        "module_label": "合规管理",
        "category": _CAT_SCENE,
        "affiliated_agent": "合规审核 Agent",
        "parameter_count": 1,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "get_consent_pdf_url",
        "label": "获取同意书 PDF 链接",
        "description": "返回患者最新签署同意书的 PDF 临时下载 URL",
        "type": _TYPE_FILE_OPS,
        "module": "compliance_tools",
        "module_label": "合规管理",
        "category": _CAT_SCENE,
        "affiliated_agent": "合规审核 Agent",
        "parameter_count": 1,
        "risk_level": _RISK_LOW,
    },
    # ── 搜索 ──────────────────────────────────────────────────────────────────
    {
        "name": "web_search",
        "label": "网络搜索",
        "description": "调用外部搜索引擎检索医学/营养相关文献",
        "type": _TYPE_EXTERNAL,
        "module": "search_tools",
        "module_label": "搜索引擎",
        "category": _CAT_API,
        "affiliated_agent": "搜索 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "web_search_summary",
        "label": "搜索结果摘要",
        "description": "搜索并由 LLM 对结果做二次摘要",
        "type": _TYPE_EXTERNAL,
        "module": "search_tools",
        "module_label": "搜索引擎",
        "category": _CAT_API,
        "affiliated_agent": "搜索 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_LOW,
    },
    # ── 代码沙箱 ──────────────────────────────────────────────────────────────
    {
        "name": "execute_python_code",
        "label": "Python 代码沙箱",
        "description": "在安全沙箱中执行 Python 代码（数据分析/图表生成）",
        "type": _TYPE_COMPUTE,
        "module": "sandbox_tools",
        "module_label": "代码沙箱",
        "category": _CAT_SYSTEM,
        "affiliated_agent": "代码执行 Agent",
        "parameter_count": 1,
        "risk_level": _RISK_MID,
    },
    # ── 营养方案 ──────────────────────────────────────────────────────────────
    {
        "name": "get_nutrition_plan_detail",
        "label": "获取营养方案详情",
        "description": "根据方案 ID 返回完整营养方案内容",
        "type": _TYPE_RETRIEVAL,
        "module": "nutrition_tools",
        "module_label": "营养方案",
        "category": _CAT_SCENE,
        "affiliated_agent": "营养方案 Agent",
        "parameter_count": 1,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "get_current_plan",
        "label": "获取患者当前方案",
        "description": "返回指定患者当前生效的营养方案",
        "type": _TYPE_RETRIEVAL,
        "module": "nutrition_tools",
        "module_label": "营养方案",
        "category": _CAT_SCENE,
        "affiliated_agent": "营养方案 Agent",
        "parameter_count": 1,
        "risk_level": _RISK_LOW,
    },
    # ── 营养评估 ──────────────────────────────────────────────────────────────
    {
        "name": "get_patient_assessment_history",
        "label": "获取营养评估历史",
        "description": "返回患者历次 NRS-2002 评分与营养评估记录",
        "type": _TYPE_RETRIEVAL,
        "module": "assessment_tools",
        "module_label": "营养评估",
        "category": _CAT_SCENE,
        "affiliated_agent": "营养评估 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "get_lab_records_with_images",
        "label": "获取带图检验记录",
        "description": "返回患者检验单列表（含原始图片 URL 与结构化指标）",
        "type": _TYPE_RETRIEVAL,
        "module": "assessment_tools",
        "module_label": "营养评估",
        "category": _CAT_SCENE,
        "affiliated_agent": "营养评估 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "get_indicator_trends",
        "label": "获取指标趋势数据",
        "description": "返回指定患者多个营养指标的时序趋势数据",
        "type": _TYPE_RETRIEVAL,
        "module": "assessment_tools",
        "module_label": "营养评估",
        "category": _CAT_SCENE,
        "affiliated_agent": "营养评估 Agent",
        "parameter_count": 3,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "generate_baseline_report_pdf",
        "label": "生成基线评估 PDF 报告",
        "description": "为患者生成 PDF 格式营养基线评估报告并返回下载链接",
        "type": _TYPE_FILE_OPS,
        "module": "assessment_tools",
        "module_label": "营养评估",
        "category": _CAT_SCENE,
        "affiliated_agent": "营养评估 Agent",
        "parameter_count": 1,
        "risk_level": _RISK_MID,
    },
    # ── 风险预警 ──────────────────────────────────────────────────────────────
    {
        "name": "scan_and_create_alerts",
        "label": "扫描并生成风险预警",
        "description": "扫描近 90 天检验记录，自动创建越阈值预警",
        "type": _TYPE_COMPUTE,
        "module": "alert_tools",
        "module_label": "风险预警",
        "category": _CAT_SCENE,
        "affiliated_agent": "风险预警 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_MID,
    },
    {
        "name": "get_high_risk_alerts",
        "label": "获取高风险预警列表",
        "description": "自动扫描后返回当前所有活跃预警（分页）",
        "type": _TYPE_RETRIEVAL,
        "module": "alert_tools",
        "module_label": "风险预警",
        "category": _CAT_SCENE,
        "affiliated_agent": "风险预警 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "acknowledge_alert",
        "label": "确认/处理预警",
        "description": "医生确认预警并填写处理备注，状态变更为 acknowledged",
        "type": _TYPE_WRITE,
        "module": "alert_tools",
        "module_label": "风险预警",
        "category": _CAT_SCENE,
        "affiliated_agent": "风险预警 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_MID,
    },
    # ── 知识库 ────────────────────────────────────────────────────────────────
    {
        "name": "manage_symptom_dict",
        "label": "症状字典管理",
        "description": "症状库的 CRUD 操作（创建/更新/停用症状条目）",
        "type": _TYPE_WRITE,
        "module": "knowledge_tools",
        "module_label": "知识库管理",
        "category": _CAT_SCENE,
        "affiliated_agent": "知识库 Agent",
        "parameter_count": 3,
        "risk_level": _RISK_MID,
    },
    {
        "name": "manage_knowledge_graph",
        "label": "Q&A 知识图谱管理",
        "description": "Q&A 对的 CRUD 操作及一键向量化同步",
        "type": _TYPE_WRITE,
        "module": "knowledge_tools",
        "module_label": "知识库管理",
        "category": _CAT_SCENE,
        "affiliated_agent": "知识库 Agent",
        "parameter_count": 3,
        "risk_level": _RISK_MID,
    },
    {
        "name": "manage_nutrition_rules",
        "label": "阶段营养规则配置",
        "description": "按移植阶段配置能量/蛋白目标与评估模板",
        "type": _TYPE_WRITE,
        "module": "knowledge_tools",
        "module_label": "知识库管理",
        "category": _CAT_SCENE,
        "affiliated_agent": "知识库 Agent",
        "parameter_count": 4,
        "risk_level": _RISK_HIGH,
    },
    # ── 统计报表 ──────────────────────────────────────────────────────────────
    {
        "name": "get_dashboard_statistics",
        "label": "获取仪表盘统计数据",
        "description": "计算患者阶段分布、风险分布、近30天功能使用趋势等 KPI",
        "type": _TYPE_COMPUTE,
        "module": "statistics_tools",
        "module_label": "统计报表",
        "category": _CAT_SYSTEM,
        "affiliated_agent": "统计分析 Agent",
        "parameter_count": 1,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "export_system_data",
        "label": "导出系统数据",
        "description": "将患者/检验/饮食/预警等数据导出为 Excel 文件",
        "type": _TYPE_FILE_OPS,
        "module": "statistics_tools",
        "module_label": "统计报表",
        "category": _CAT_SYSTEM,
        "affiliated_agent": "统计分析 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_MID,
    },
    # ── 系统 ──────────────────────────────────────────────────────────────────
    {
        "name": "get_registered_agent_tools",
        "label": "列出注册工具",
        "description": "返回系统中所有已注册 Tool 的元数据列表",
        "type": _TYPE_RETRIEVAL,
        "module": "system_tools",
        "module_label": "系统设置",
        "category": _CAT_SYSTEM,
        "affiliated_agent": "系统管理 Agent",
        "parameter_count": 2,
        "risk_level": _RISK_LOW,
    },
    {
        "name": "update_consent_template",
        "label": "更新协议模板",
        "description": "编辑指定协议声明的模板文本，自动升级版本号",
        "type": _TYPE_WRITE,
        "module": "system_tools",
        "module_label": "系统设置",
        "category": _CAT_SYSTEM,
        "affiliated_agent": "系统管理 Agent",
        "parameter_count": 3,
        "risk_level": _RISK_HIGH,
    },
]

# ── 辅助：加载/保存 enabled 状态 ─────────────────────────────────────────────

def _load_tool_states() -> dict[str, bool]:
    """从 JSON 文件加载 tool enabled 状态，缺失则默认 True"""
    if _TOOL_STATES_FILE.exists():
        try:
            return json.loads(_TOOL_STATES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_tool_states(states: dict[str, bool]) -> None:
    _TOOL_STATES_FILE.write_text(json.dumps(states, ensure_ascii=False, indent=2), encoding="utf-8")


# ══════════════════════════════════════════════════════════════════════════════
# Tool 1 – 获取注册工具列表
# ══════════════════════════════════════════════════════════════════════════════

async def get_registered_agent_tools(
    tool_type:  str | None = None,
    module:     str | None = None,
    category:   str | None = None,
    risk_level: str | None = None,
) -> dict[str, Any]:
    """
    返回系统中所有注册 Tool 的元数据列表。

    参数：
      tool_type:  按类型过滤 (retrieval / compute / file_ops / write / external)
      module:     按所属模块过滤 (如 "alert_tools")
      category:   按分类过滤 (系统工具 / 场景工具 / API工具)
      risk_level: 按风险等级过滤 (低 / 中 / 高)

    新增返回字段（每个 item）：
      category         — 工具分类
      affiliated_agent — 所属 Agent
      parameter_count  — 参数数量
      risk_level       — 风险等级
      status           — "已启用" 或 "未启用"
    """
    states = _load_tool_states()
    items = []
    for t in TOOL_REGISTRY:
        if tool_type  and t["type"]       != tool_type:  continue
        if module     and t["module"]     != module:     continue
        if category   and t.get("category")   != category:   continue
        if risk_level and t.get("risk_level")  != risk_level: continue

        enabled = states.get(t["name"], True)
        items.append({
            **t,
            "type_label":      TOOL_TYPE_LABELS.get(t["type"], t["type"]),
            "type_color":      TOOL_TYPE_COLORS.get(t["type"], "default"),
            "affiliated_agent": t.get("affiliated_agent", "-"),
            "parameter_count":  t.get("parameter_count", 0),
            "risk_level":       t.get("risk_level", _RISK_LOW),
            "category":         t.get("category", _CAT_SCENE),
            "enabled":          enabled,
            "status":           "已启用" if enabled else "未启用",
        })

    # 统计可用过滤选项
    all_types      = sorted({t["type"]                    for t in TOOL_REGISTRY})
    all_modules    = sorted({t["module"]                  for t in TOOL_REGISTRY})
    all_categories = sorted({t.get("category", _CAT_SCENE) for t in TOOL_REGISTRY})
    all_risks      = [_RISK_LOW, _RISK_MID, _RISK_HIGH]

    return {
        "total": len(items),
        "items": items,
        "type_options":     [{"value": k, "label": TOOL_TYPE_LABELS.get(k, k)} for k in all_types],
        "module_options":   [{"value": t["module"], "label": t["module_label"]}
                             for t in {m["module"]: m for m in TOOL_REGISTRY}.values()],
        "category_options": [{"value": c, "label": c} for c in all_categories],
        "risk_options":     [{"value": r, "label": r} for r in all_risks],
    }


# ══════════════════════════════════════════════════════════════════════════════
# Tool 2 – 切换工具启用状态
# ══════════════════════════════════════════════════════════════════════════════

async def update_tool_state(tool_name: str, enabled: bool) -> dict[str, Any]:
    """切换指定工具的启用状态并持久化。"""
    known = {t["name"] for t in TOOL_REGISTRY}
    if tool_name not in known:
        return {"success": False, "error": f"未知工具: {tool_name}"}
    states = _load_tool_states()
    states[tool_name] = enabled
    _save_tool_states(states)
    return {
        "success":   True,
        "tool_name": tool_name,
        "enabled":   enabled,
        "status":    "已启用" if enabled else "未启用",
    }


# ══════════════════════════════════════════════════════════════════════════════
# 协议模板（Consent Templates）持久化
# ══════════════════════════════════════════════════════════════════════════════

# 默认模板集合
_DEFAULT_TEMPLATES: dict[str, dict[str, Any]] = {
    "privacy_policy": {
        "key": "privacy_policy",
        "title": "个人信息保护声明",
        "version": "1.0",
        "content": """# 个人信息保护声明

**协和医院肝移植中心营养管理系统**

## 一、信息收集范围

本系统收集您的以下个人信息用于营养随访管理：
- 基本信息：姓名、性别、出生日期、联系电话
- 健康信息：身高、体重、诊断、检验结果、饮食记录
- 设备信息：微信 OpenID（用于小程序身份识别）

## 二、信息使用目的

收集的信息仅用于：
1. 为您提供个性化营养方案和随访管理
2. 支持医护人员进行临床决策
3. 系统功能改进（经匿名化处理后）

## 三、信息保护措施

- 所有敏感数据采用加密存储
- 系统访问需经过身份认证
- 仅授权医护人员可查看您的完整信息

## 四、您的权利

您有权查看、更正或请求删除您的个人信息，请联系管理员。
""",
        "updated_at": None,
        "updated_by": None,
    },
    "informed_consent": {
        "key": "informed_consent",
        "title": "营养干预知情同意书",
        "version": "1.0",
        "content": """# 营养干预知情同意书

**协和医院肝移植中心**

## 一、干预内容

本营养干预方案针对肝移植术后患者，包括：
- 个性化能量与蛋白质摄入目标
- 分阶段膳食结构调整建议
- 定期营养指标监测与方案优化

## 二、预期收益

- 促进移植后肝功能恢复
- 降低营养不良风险
- 改善免疫功能与生活质量

## 三、潜在风险

- 个体对饮食调整的耐受性存在差异
- AI 生成的建议需经营养师或医生审核后执行

## 四、自愿原则

您可在任何时候撤回知情同意，这不会影响您接受其他医疗服务。

## 五、联系方式

如有疑问，请联系主管医生或营养科。
""",
        "updated_at": None,
        "updated_by": None,
    },
    "data_sharing": {
        "key": "data_sharing",
        "title": "数据共享授权声明",
        "version": "1.0",
        "content": """# 数据共享授权声明

**协和医院肝移植中心营养管理系统**

## 一、共享范围

经您授权，您的匿名化健康数据可能用于：
- 院内临床研究与质量改进
- 多学科团队会诊讨论

## 二、数据去标识化

共享前，所有数据将经过去标识化处理，移除可直接识别个人身份的信息。

## 三、数据安全

- 共享数据受相同的安全措施保护
- 不会向医院外部第三方商业机构出售

## 四、撤回授权

您可随时联系管理员撤回数据共享授权。
""",
        "updated_at": None,
        "updated_by": None,
    },
}


def _load_templates() -> dict[str, dict[str, Any]]:
    if _TEMPLATES_FILE.exists():
        try:
            return json.loads(_TEMPLATES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return dict(_DEFAULT_TEMPLATES)


def _save_templates(templates: dict[str, dict[str, Any]]) -> None:
    _TEMPLATES_FILE.write_text(json.dumps(templates, ensure_ascii=False, indent=2), encoding="utf-8")
    # 初始化写入文件（首次调用时）
    if not _TEMPLATES_FILE.exists():
        pass  # already written above


# ══════════════════════════════════════════════════════════════════════════════
# Tool 3 – 获取协议模板列表
# ══════════════════════════════════════════════════════════════════════════════

async def get_consent_templates() -> dict[str, Any]:
    """
    返回所有协议模板列表（含版本号与内容）。
    """
    templates = _load_templates()
    items = list(templates.values())
    return {"success": True, "total": len(items), "items": items}


# ══════════════════════════════════════════════════════════════════════════════
# Tool 4 – 更新协议模板
# ══════════════════════════════════════════════════════════════════════════════

async def update_consent_template(
    key: str,
    content: str,
    updated_by: str = "admin",
) -> dict[str, Any]:
    """
    更新指定协议模板的内容，自动递增版本号（小版本 +0.1）。

    key:        模板唯一键 (privacy_policy / informed_consent / data_sharing)
    content:    新的 Markdown 格式内容
    updated_by: 操作人姓名/ID
    """
    templates = _load_templates()
    # 若 key 不存在，从默认模板中初始化（防止首次加载时丢失）
    if key not in templates:
        if key in _DEFAULT_TEMPLATES:
            templates[key] = dict(_DEFAULT_TEMPLATES[key])
        else:
            return {"success": False, "error": f"未知模板 key: {key}"}

    tpl = templates[key]

    # 递增版本号
    try:
        major, minor = tpl["version"].split(".")
        new_version = f"{major}.{int(minor) + 1}"
    except Exception:
        new_version = "1.1"

    tpl["content"]    = content
    tpl["version"]    = new_version
    tpl["updated_at"] = datetime.now(timezone.utc).isoformat()
    tpl["updated_by"] = updated_by

    _save_templates(templates)
    logger.info("协议模板 [%s] 已更新至 v%s by %s", key, new_version, updated_by)

    return {
        "success":    True,
        "key":        key,
        "title":      tpl["title"],
        "version":    new_version,
        "updated_at": tpl["updated_at"],
    }


# ══════════════════════════════════════════════════════════════════════════════
# Tool 5 – 操作日志（AgentTask）
# ══════════════════════════════════════════════════════════════════════════════

async def get_operation_logs(
    page:      int = 1,
    page_size: int = 20,
    task_type: str | None = None,
    status:    str | None = None,
) -> dict[str, Any]:
    """
    分页查询 AgentTask 操作日志。

    返回每条记录：id, task_type, status, triggered_by, llm_model,
                  total_tokens, duration_ms, created_at, started_at, completed_at,
                  patient_name (可能为 None)
    """
    from app.models.models import PatientProfile
    from sqlalchemy.orm import aliased

    async with AsyncSessionLocal() as session:
        stmt = (
            select(
                AgentTask,
                PatientProfile.name.label("patient_name"),
            )
            .outerjoin(PatientProfile, AgentTask.patient_id == PatientProfile.id)
            .order_by(AgentTask.created_at.desc())
        )
        if task_type:
            try:
                tt_enum = AgentTaskType(task_type)
                stmt = stmt.where(AgentTask.task_type == tt_enum)
            except ValueError:
                pass
        if status:
            try:
                st_enum = AgentTaskStatus(status)
                stmt = stmt.where(AgentTask.status == st_enum)
            except ValueError:
                pass

        # 总数
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await session.execute(count_stmt)).scalar_one()

        # 分页
        page = max(1, page)
        page_size = min(100, page_size)
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)
        rows = (await session.execute(stmt)).all()

        items = []
        for task, patient_name in rows:
            tt  = task.task_type.value  if hasattr(task.task_type, 'value')  else str(task.task_type)
            st  = task.status.value     if hasattr(task.status, 'value')     else str(task.status)
            items.append({
                "id":           str(task.id),
                "task_type":    tt,
                "status":       st,
                "triggered_by": task.triggered_by,
                "llm_model":    task.llm_model,
                "total_tokens": task.total_tokens,
                "duration_ms":  task.duration_ms,
                "patient_name": patient_name,
                "created_at":   task.created_at.isoformat() if task.created_at else None,
                "started_at":   task.started_at.isoformat() if task.started_at else None,
                "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            })

        return {
            "success":   True,
            "total":     total,
            "page":      page,
            "page_size": page_size,
            "items":     items,
        }
