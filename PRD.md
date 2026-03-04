# 肝移植患者营养全流程管理系统
## 产品需求文档（PRD）v1.0

**文档日期：** 2026-03-03  
**版本状态：** 正式稿  
**适用范围：** 产品、开发、测试、运营全团队

---

## 目录

1. [产品概述](#1-产品概述)
2. [目标用户与使用场景](#2-目标用户与使用场景)
3. [整体架构设计](#3-整体架构设计)
4. [数据库层设计](#4-数据库层设计)
5. [服务层设计](#5-服务层设计)
6. [Tools / API 层设计](#6-tools--api-层设计)
7. [GUI 层设计](#7-gui-层设计)
8. [智能体（Agent）设计](#8-智能体agent设计)
9. [小程序端功能需求](#9-小程序端功能需求)
10. [管理端功能需求](#10-管理端功能需求)
11. [非功能性需求](#11-非功能性需求)
12. [技术选型汇总](#12-技术选型汇总)

---

## 1. 产品概述

### 1.1 产品定位

**肝移植患者营养全流程管理系统**是一套面向协和医院肝移植中心的数字化营养管理平台，通过微信小程序（患者侧）+ Web 管理端（医护侧）+ 大模型智能体（AI侧）三端协同，覆盖患者从术前评估到出院后长期随访的完整营养管理旅程。

### 1.2 核心价值

- **合规优先**：强制知情同意流程，电子签名 + PDF 存档，满足医疗数据合规要求
- **全程陪伴**：四阶段动态营养管理，跟随患者移植旅程自适应调整
- **智能驱动**：所有核心业务均可由 AI 智能体通过工具调用自动完成，无需人工点击操作
- **工具化架构**：系统所有能力均封装为标准 Tool，支持 Agent 自主编排调用

### 1.3 产品边界声明

> 本系统提供**营养教育支持**，不进行疾病诊断，不提供紧急医疗决策，所有输出内容不构成医疗诊断建议。

---

## 2. 目标用户与使用场景

| 用户角色 | 使用端 | 核心诉求 |
|---|---|---|
| 肝移植患者 | 微信小程序 | 获得个性化营养指导，了解各阶段饮食注意事项 |
| 临床营养师 | Web 管理端 | 监控患者营养状态，调整营养方案，生成报告 |
| 主治医生 | Web 管理端 | 快速查看患者风险预警，自然语言问询患者状况 |
| 系统管理员 | Web 管理端 | 维护知识库、量表模板、账号权限、工具配置 |

---

## 3. 整体架构设计

### 3.1 架构总览

系统采用四层纵向架构，全栈 Python 实现，各层职责单一、向下依赖：

```
┌─────────────────────────────────────────────────────────────────┐
│                         GUI 层（应用层）                         │
│   微信小程序（Wepy/原生）    ·    Web 管理端（React/Vite）       │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / WebSocket
┌────────────────────────────▼────────────────────────────────────┐
│                      Tools / API 层                              │
│   FastAPI RESTful API    ·    Agent Tool 注册中心                │
│   WebSearch Tool  ·  Bash/Sandbox Tool  ·  File Tool  ·  Code   │
└────────────────────────────┬────────────────────────────────────┘
                             │ Python 函数调用
┌────────────────────────────▼────────────────────────────────────┐
│                         服务层                                    │
│   PatientService  ·  ConsentService  ·  LabService               │
│   NutritionService  ·  AgentService  ·  FileService              │
└────────────────────────────┬────────────────────────────────────┘
                             │ SQLAlchemy ORM（异步）
┌────────────────────────────▼────────────────────────────────────┐
│                         数据库层                                  │
│          PostgreSQL（主库）  ·  pgvector（向量检索）              │
│      AsyncSessionLocal  ·  Alembic 迁移  ·  FlexJSON(JSONB)     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Agent 调用链路

系统所有业务逻辑均可绕过 GUI，由 Agent 通过工具链直接完成：

```
用户自然语言指令
       │
       ▼
  AgentService（LangChain / OpenAI Function Calling）
       │
       ├──► web_search_tool        → 检索医学文献/营养指南
       ├──► bash_sandbox_tool      → 执行Python计算/绘图代码
       ├──► file_read_write_tool   → 读写患者报告/检验单文件
       ├──► coding_tool            → 动态生成分析代码并执行
       ├──► compliance_tool        → 查询/处理知情同意状态
       ├──► patient_query_tool     → 查询/更新患者档案
       ├──► lab_analysis_tool      → 检验单OCR解析与指标分析
       ├──► nutrition_plan_tool    → 生成/查询营养方案
       └──► report_gen_tool        → 生成PDF营养报告
              │
              ▼
         结构化结果 → 写入 AgentTask 日志 → 返回 GUI
```

### 3.3 技术架构图

```
微信小程序                Web 管理端（React）
    │                           │
    └──────────┬────────────────┘
               │ HTTPS
    ┌──────────▼────────────────┐
    │    FastAPI（Python 3.12）  │
    │    uvicorn + asyncio      │
    │  ┌────────────────────┐   │
    │  │   Agent Tools 层   │   │
    │  │  WebSearch │ Bash  │   │
    │  │  FileIO  │ Coding  │   │
    │  └────────────────────┘   │
    │  ┌────────────────────┐   │
    │  │   Service 层       │   │
    │  └────────────────────┘   │
    └──────────┬────────────────┘
               │ asyncpg
    ┌──────────▼────────────────┐
    │       PostgreSQL           │
    │   + pgvector 扩展          │
    └───────────────────────────┘
```

---

## 4. 数据库层设计

### 4.1 设计原则

- 全部使用 **SQLAlchemy 2.x ORM + asyncpg** 异步驱动
- JSON字段使用 **FlexJSON（PostgreSQL → JSONB，SQLite → JSON）** 适配多环境
- 所有表含 `created_at` / `updated_at` 自动时间戳
- 主键统一使用 UUID，防止ID枚举攻击
- 数据库迁移使用 **Alembic**，禁止直接 `drop_all`

### 4.2 核心数据表

#### 4.2.1 PatientProfile（患者档案表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| name | String(50) | 姓名 |
| gender | Enum(GenderEnum) | 性别 |
| birth_date | Date | 出生日期 |
| phone | String(20) | 手机号 |
| height_cm | Float | 身高(cm) |
| weight_kg | Float | 体重(kg) |
| bmi | Float | BMI |
| diagnosis | Text | 原发疾病诊断 |
| transplant_date | Date | 移植手术日期 |
| current_phase | Enum(TransplantPhase) | 当前阶段 |
| risk_level | String(10) | 营养风险等级(低/中/高) |
| nutrition_type | String(50) | 营养分型 |
| is_consent_signed | Boolean | 是否已完成知情同意 |
| extended_data | FlexJSON | 扩展字段(JSONB) |

#### 4.2.2 ConsentRecord（知情同意记录表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| patient_id | UUID(FK) | 关联患者 |
| consent_type | String(100) | 同意书类型 |
| template_version | String(20) | 模板版本号 |
| status | Enum(ConsentStatus) | 状态(pending/signed/revoked) |
| signature_path | Text | 手写签名图存储路径 |
| pdf_path | Text | 生成的PDF存储路径 |
| signed_at | DateTime | 签署时间 |
| ip_address | String(45) | 签署时IP地址 |
| revoke_reason | Text | 撤回原因 |

#### 4.2.3 LabResult（检验结果表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| patient_id | UUID(FK) | 关联患者 |
| phase | Enum(TransplantPhase) | 所属阶段 |
| test_date | Date | 检验日期 |
| image_path | Text | 检验单图片路径 |
| ocr_raw | FlexJSON | OCR原始识别结果 |
| parsed_data | FlexJSON | 结构化指标数据 |
| ai_analysis | FlexJSON | AI分析结论 |
| albumin | Float | 白蛋白(g/L) |
| prealbumin | Float | 前白蛋白(mg/L) |
| hemoglobin | Float | 血红蛋白(g/L) |
| blood_glucose | Float | 血糖(mmol/L) |
| is_abnormal | Boolean | 是否存在异常指标 |

#### 4.2.4 NutritionPlan（营养方案表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| patient_id | UUID(FK) | 关联患者 |
| phase | Enum(TransplantPhase) | 适用阶段 |
| energy_kcal_min | Float | 能量目标下限 |
| energy_kcal_max | Float | 能量目标上限 |
| protein_g_min | Float | 蛋白质目标下限 |
| protein_g_max | Float | 蛋白质目标上限 |
| support_mode | String(50) | 营养支持方式 |
| diet_pattern | FlexJSON | 推荐饮食模式详情 |
| contraindications | FlexJSON | 禁忌食物列表 |
| is_active | Boolean | 是否为当前激活方案 |
| generated_by | String(20) | 生成来源(ai/manual) |

#### 4.2.5 DietRecord（饮食日志表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| patient_id | UUID(FK) | 关联患者 |
| record_date | Date | 记录日期 |
| meal_type | String(20) | 餐次(早/午/晚/加餐) |
| foods | FlexJSON | 食物条目列表 |
| total_energy_kcal | Float | 合计能量 |
| total_protein_g | Float | 合计蛋白质 |
| notes | Text | 备注 |

#### 4.2.6 AgentTask（智能体任务日志表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| patient_id | UUID(FK) | 关联患者（可选） |
| task_type | Enum(AgentTaskType) | 任务类型 |
| status | Enum(AgentTaskStatus) | 状态 |
| triggered_by | String(50) | 触发来源(user/system/agent) |
| input_query | Text | 输入内容 |
| tool_calls | FlexJSON | 工具调用链（思考链） |
| result | FlexJSON | 最终结构化结果 |
| error_message | Text | 错误信息 |
| duration_ms | Integer | 执行耗时(毫秒) |

### 4.3 移植阶段枚举

| 枚举值 | 含义 | 对应业务阶段 |
|---|---|---|
| pre_assessment | 术前评估期 | 营养旅程第一阶段 |
| pre_operation | 术前准备期 | 营养旅程第二阶段 |
| early_post_op | 术后早期(ICU 0–7天) | 地下室住院期 |
| recovery | 恢复期(8–30天) | 出院准备期 |
| rehabilitation | 康复期(1–3个月) | 出院后居家期 |
| long_term_follow | 长期随访(>3个月) | 长期管理 |

---

## 5. 服务层设计

服务层为纯 Python 业务逻辑，不依赖 HTTP 请求/响应对象，可同时被 API 层和 Agent Tools 层调用。

### 5.1 服务模块清单

| 服务模块 | 文件 | 核心职责 |
|---|---|---|
| PatientService | patient_service.py | 患者档案 CRUD、阶段流转、风险等级计算 |
| ConsentService | compliance_service.py | 知情同意签署、PDF生成、状态查询、撤回 |
| LabService | lab_service.py | 检验单OCR解析、指标结构化存储、异常判定 |
| NutritionService | nutrition_service.py | 营养方案生成（基于知识图谱+阶段+个人指标）|
| AgentService | agent_service.py | Agent任务调度、工具编排、结果汇总 |
| FileService | file_service.py | 文件上传/下载、路径管理、临时文件清理 |
| ReportService | report_service.py | PDF营养报告生成（reportlab）|
| ScreeningService | screening_service.py | 营养筛查量表评分计算与分型判定 |

### 5.2 关键服务流程

#### ConsentService 签署流程

```
接收(patient_id, signature_file_path)
        │
        ▼
   校验患者存在性
        │
        ▼
  获取/创建 ConsentRecord
        │
        ▼
  读取签名图 → 嵌入PDF模板
        │
        ▼
  生成电子同意书PDF → 写入 uploads/consent/
        │
        ▼
  更新 ConsentRecord.status = SIGNED
        │
        ▼
  更新 PatientProfile.is_consent_signed = True
        │
        ▼
  返回 {success, pdf_url, signed_at}
```

#### NutritionService 方案生成流程

```
接收(patient_id, phase)
        │
        ▼
  查询最新 LabResult（白蛋白、BMI等）
        │
        ▼
  查询最新 ScreeningResult（营养风险等级）
        │
        ▼
  匹配阶段知识图谱（能量/蛋白质/支持方式）
        │
        ▼
  个性化调整（体重 × 系数 / 基础代谢公式）
        │
        ▼
  写入 NutritionPlan（关闭旧激活方案）
        │
        ▼
  返回完整方案结构体
```

---

## 6. Tools / API 层设计

### 6.1 设计原则

- 所有 Tool 函数均为 **async Python 函数**，返回 JSON-serializable dict
- Tool 函数内部捕获异常，不向上抛出，Agent 根据返回值决策重试
- 每个 Tool 附带 **Pydantic 输入/输出 Schema**，自动生成 Function Calling Schema
- API 端点与 Tool 函数一一对应，HTTP API = Tool 的 HTTP 包装层
- 所有工具调用写入 **AgentTask** 日志，全程可审计

### 6.2 核心 Tool 清单

#### 6.2.1 WebSearch Tool（网络搜索）

| 属性 | 说明 |
|---|---|
| 工具名 | web_search |
| 类型 | 检索类 |
| API端点 | POST /api/v1/tools/search |
| 功能 | 检索医学文献、营养指南、循证证据 |
| 入参 | query: str, num_results: int(1-10) |
| 出参 | {results: [{title, url, snippet}], summary: str} |
| 所属模块 | 营养解惑 / 智能问答 / 医生问询 |
| 使用场景 | Agent判断本地知识不足时，主动检索最新指南 |

#### 6.2.2 Bash / Sandbox Tool（代码沙箱执行）

| 属性 | 说明 |
|---|---|
| 工具名 | execute_python_code |
| 类型 | 计算类 / Bash执行类 |
| API端点 | POST /api/v1/tools/sandbox |
| 功能 | 在受限沙箱中执行Python代码，支持数值计算与图表生成 |
| 入参 | code: str, timeout_sec: int(≤30) |
| 出参 | {stdout, stderr, image_url, execution_time_ms, success} |
| 所属模块 | 营养计算 / 指标趋势分析 / 报表可视化 |
| 典型代码 | Harris-Benedict 公式计算、matplotlib 趋势图、pandas 数据分析 |
| 安全限制 | 黑名单过滤(os/sys/subprocess)、CPU超时、内存限制、网络隔离 |

#### 6.2.3 File Read/Write Tool（文件存取）

| 属性 | 说明 |
|---|---|
| 工具名 | file_read / file_write |
| 类型 | 文件存取类 |
| API端点 | GET /api/v1/files/{path}、POST /api/v1/files/upload |
| 功能 | 读写患者报告、检验单图片、签名文件、生成PDF |
| 入参(read) | file_path: str |
| 入参(write) | file_path: str, content: bytes/str |
| 出参 | {success, file_path, file_url, size_bytes} |
| 存储结构 | uploads/consent/ · uploads/lab/ · uploads/reports/ · uploads/sandbox_outputs/ |
| 所属模块 | 全模块（知情同意、检验单、报告生成）|

#### 6.2.4 Coding Tool（动态代码生成执行）

| 属性 | 说明 |
|---|---|
| 工具名 | coding_agent |
| 类型 | 编码类 |
| 功能 | LLM动态生成分析代码 → Sandbox执行 → 返回结果 |
| 使用场景 | 复杂营养计算（多指标联合）、自定义趋势分析、批量报告生成 |
| 编排方式 | AgentService 先调用 LLM 生成代码，再调用 Sandbox 执行 |

#### 6.2.5 Compliance Tool（知情同意工具）

| 工具函数 | 说明 |
|---|---|
| sign_and_unlock_user | 完整签署流程（主工具）：签名图→PDF→解锁账户 |
| check_consent_status | 查询患者是否已完成签署及解锁状态 |
| revoke_consent | 撤销知情同意，记录撤回原因 |
| get_consent_pdf_url | 获取已签署PDF的访问URL |

#### 6.2.6 Patient Query Tool（患者档案工具）

| 工具函数 | 说明 |
|---|---|
| get_patient_profile | 获取患者完整档案（含阶段、风险等级）|
| update_patient_phase | 变更患者当前阶段 |
| get_lab_trend | 获取指定指标历史趋势数据 |
| get_high_risk_patients | 获取高风险患者列表 |

#### 6.2.7 Nutrition Tool（营养方案工具）

| 工具函数 | 说明 |
|---|---|
| get_current_plan | 获取患者当前激活营养方案 |
| generate_nutrition_plan | 基于阶段+指标自动生成营养方案 |
| get_phase_diet_pattern | 获取指定阶段推荐饮食模式 |
| get_nutrition_report | 生成营养起点报告PDF |

#### 6.2.8 Lab Analysis Tool（检验分析工具）

| 工具函数 | 说明 |
|---|---|
| upload_and_ocr_lab | 上传检验单图片并触发OCR解析 |
| analyze_lab_indicators | 对结构化指标进行AI分析与异常判定 |
| get_latest_lab_result | 获取患者最新检验结果 |

### 6.3 FastAPI 路由总览

```
/health                              健康检查
/api/v1/patients                     患者档案 CRUD
/api/v1/compliance/sign              知情同意签署
/api/v1/compliance/status/{id}       同意状态查询
/api/v1/lab                          检验结果管理
/api/v1/nutrition                    营养方案管理
/api/v1/diet                         饮食记录
/api/v1/screening                    营养筛查量表
/api/v1/messages                     消息通知
/api/v1/followup                     随访记录
/api/v1/medication                   服药提醒
/api/v1/plans                        阶段行动计划
/api/v1/tools/search                 WebSearch Tool API
/api/v1/tools/sandbox                Sandbox Tool API
/api/v1/tools/sandbox/outputs        沙箱输出文件列表
/api/v1/tools/manifest               已注册工具清单
/api/v1/agent/query                  Agent 自然语言问询
/api/v1/agent/logs                   Agent 日志列表
/api/v1/agent/tasks                  Agent 任务列表
/api/v1/agent/tasks/{id}             Agent 任务详情
```

---

## 7. GUI 层设计

### 7.1 微信小程序端（患者侧）

**技术栈：** 微信原生小程序（JS/WXML/WXSS）  
**入口文件：** miniprogram/app.js  
**页面路由：**

```
pages/
├── index/           首页（营养旅程总览）
├── consent/
│   ├── consent      知情同意书多页展示 + 勾选
│   └── signature    手写电子签名画板
├── screening/
│   ├── screening    营养量表填写
│   └── report       营养起点报告展示
├── nutrition/
│   ├── plan         营养行动主页（目标/饮食模式/支持方式）
│   └── detail       营养行动详情
├── lab/
│   ├── upload       检验单上传
│   └── result       检验结果展示
├── diet/
│   └── record       简易饮食日志
├── messages/
│   └── messages     消息/提醒中心
└── profile/
    └── profile      个人中心（档案/报告/趋势图）
```

### 7.2 Web 管理端（医护侧）

**技术栈：** React 18 + Vite + ECharts  
**入口文件：** frontend/src/main.jsx  
**页面路由：**

```
src/pages/
├── Dashboard/           管理首页（数据总览 / 风险预警）
├── PatientOverview/     患者列表与详情
├── ConsentManagement/   同意书合规管理
├── LabManagement/       检验档案管理
├── NutritionManagement/ 营养方案管理
├── ContentManagement/   知识内容配置（症状库/量表/饮食模式）
├── Statistics/          数据统计与报表
├── AgentConsole/        Agent 问询控制台（思考链展示）
└── SystemSettings/      系统管理（账号/工具/日志/模板）
```

---

## 8. 智能体（Agent）设计

### 8.1 Agent 能力边界

| 可做 | 不可做 |
|---|---|
| 营养教育问答 | 疾病诊断 |
| 检验单指标解读（营养相关）| 开具医疗处方 |
| 营养方案生成建议 | 紧急医疗决策 |
| 检索最新营养指南 | 替代医生判断 |
| 数据趋势分析与可视化 | 访问外部医疗系统 |

### 8.2 Agent 问询流程（Multi-Tool）

```
医生输入自然语言问题
         │
         ▼
    AgentService 接收请求
         │
         ▼
    ┌────────────────────────────────┐
    │  Step 1: 结构化理解            │
    │  识别意图 → 确定所需工具列表   │
    └───────────────┬────────────────┘
                    │
         ┌──────────▼──────────┐
         │  Step 2: 工具编排   │
         │                     │
         │ ① get_patient_profile  (患者档案查询)
         │ ② get_lab_trend        (指标趋势)
         │ ③ execute_python_code  (趋势计算/绘图)
         │ ④ web_search           (条件触发：指南检索)
         │ ⑤ get_current_plan     (当前方案)
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │  Step 3: LLM 综合   │
         │  整合所有工具结果    │
         │  生成结构化分析建议  │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │  Step 4: 记录日志   │
         │  写入 AgentTask     │
         │  含完整思考链       │
         └──────────┬──────────┘
                    │
                    ▼
            返回结构化响应给 GUI
```

### 8.3 四大核心 Tool 类型对应关系

| Tool 类型 | 对应实现 | 主要使用场景 |
|---|---|---|
| **WebSearch** | search_tools.py → /api/v1/tools/search | 检索医学指南、营养循证证据 |
| **Bash/Sandbox** | sandbox_tools.py → /api/v1/tools/sandbox | 营养计算公式、趋势图绘制、数据分析 |
| **文件存取** | file_service.py → /api/v1/files | 读写检验单、签名图、PDF报告 |
| **Coding** | AgentService + sandbox 联动 | 动态生成分析代码并执行，返回可视化结果 |

---

## 9. 小程序端功能需求

### 9.1 法律与知情同意

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| MP-01 | 知情同意强制拦截 | P0 | 首次启动弹出同意书流程，未完成不允许进入任何功能页面 |
| MP-02 | 多页声明阅读与勾选 | P0 | 分3页展示《个人信息保护声明》《医疗健康数据使用授权》《健康教育与非诊疗免责声明》，每页独立勾选确认 |
| MP-03 | 手写电子签名 | P0 | 提供手写签名画板，支持清空重签 |
| MP-04 | 同意状态持久化 | P0 | 记录患者同意时间戳与版本号，已完成者不重复触发 |
| MP-05 | 功能模块解锁控制 | P0 | 同意书完成后全局解锁所有功能入口 |

### 9.2 首页 / 营养旅程总览

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| MP-06 | 基本信息填写 | P0 | 收集性别、年龄、原发疾病 |
| MP-07 | 阶段自动/手动确认 | P0 | 系统推断当前阶段，患者可手动修正 |
| MP-08 | 四阶段进度条展示 | P1 | 可视化展示"术前准备期 → 地下室住院期 → 出院准备期 → 出院后居家期" |
| MP-09 | 阶段风险营养提示 | P0 | 首页展示当前阶段营养风险等级（低/中/高） |

### 9.3 营养入门

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| MP-10 | 阶段营养升级引导 | P1 | 进入新阶段时弹出提示，引导完成本阶段营养评估 |
| MP-11 | 营养量表填写 | P0 | 按阶段动态加载对应评估量表，逐题作答 |
| MP-12 | 关键指标手动录入 | P0 | 录入体重、白蛋白、前白蛋白、血压等关键指标 |
| MP-13 | 检验单图片上传 | P1 | 拍照/相册选取检验单图片，关联当前记录 |
| MP-14 | 营养风险等级展示 | P0 | 展示系统计算的低/中/高风险分级结果 |
| MP-15 | 营养分型展示 | P1 | 展示当前营养状态分型结果 |
| MP-16 | 阶段营养起点报告查阅 | P1 | 查看本阶段生成的结构化营养起点报告 |

### 9.4 营养行动

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| MP-17 | 阶段核心目标展示 | P0 | 展示能量目标区间、蛋白质目标区间、液体控制重点 |
| MP-18 | 推荐饮食模式展示 | P0 | 展示食物类型、食物结构比例、每日饮食频率建议 |
| MP-19 | 营养支持方式说明 | P1 | 分情况说明普通饮食、ONS、肠内营养、肠外营养适用场景 |
| MP-20 | 常见误区提醒 | P1 | 展示本阶段高发错误认知，点击查看纠正说明 |
| MP-21 | 简易饮食记录 | P2 | 按餐次快速记录食物条目的饮食日志 |
| MP-22 | 服药提醒说明 | P2 | 展示本阶段服药与饮食相互作用提示 |

### 9.5 营养解惑

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| MP-23 | 常见症状列表 | P1 | 按阶段展示高频症状（恶心、腹胀、乏力、浮肿等） |
| MP-24 | 症状详情四维解析 | P1 | 点击症状展示：① 通俗病因解释 ② 是否阶段性正常 ③ 可尝试的饮食策略 ④ 需就医的预警信号 |

### 9.6 智能营养问答

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| MP-25 | 悬浮快捷入口 | P1 | 全局悬浮按钮，不影响当前页面操作 |
| MP-26 | 知识图谱限定域问答 | P0 | 基于肝移植营养知识图谱的闭域问答，仅回答营养教育相关问题 |
| MP-27 | 问答边界控制与免责声明 | P0 | 拒绝诊断类/紧急医疗类问题，每条结果附免责声明 |

### 9.7 个人中心

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| MP-28 | 个人档案查阅与修改 | P1 | 查看/编辑基本信息、原发疾病、当前阶段 |
| MP-29 | 历史报告查阅 | P2 | 查阅各阶段营养起点报告及电子同意书 |
| MP-30 | 关键指标趋势图 | P2 | 折线图展示体重、白蛋白等指标的历史变化 |

---

## 10. 管理端功能需求

### 10.1 患者档案管理

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| AD-01 | 患者列表与搜索 | P0 | 分页展示所有患者，支持按姓名、阶段、风险等级筛选 |
| AD-02 | 患者详情查看 | P0 | 查看患者基本信息、当前阶段、营养分型、风险等级 |
| AD-03 | 患者档案创建/编辑 | P0 | 新增患者或编辑档案基本字段 |
| AD-04 | 阶段手动调整 | P1 | 由医护人员手动变更患者所处阶段 |

### 10.2 同意书与合规文档管理

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| AD-05 | 电子同意书存档查阅 | P0 | 查看患者签署的电子同意书PDF，支持下载 |
| AD-06 | 同意书版本管理 | P1 | 维护同意书模板版本，记录患者签署对应的版本号 |
| AD-07 | 合规状态总览 | P0 | 展示哪些患者已签署/未签署，便于合规追踪 |

### 10.3 营养评估管理

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| AD-08 | 量表结果查阅 | P1 | 查看患者各阶段量表填写记录与评分明细 |
| AD-09 | 检验指标记录查阅 | P0 | 查看患者上传的检验指标数据及检验单图片 |
| AD-10 | 营养起点报告管理 | P1 | 查阅/下载各患者各阶段的营养起点报告PDF |
| AD-11 | 指标趋势监控 | P1 | 以图表形式监控患者关键指标（体重、白蛋白等）纵向变化 |

### 10.4 风险预警

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| AD-12 | 高风险患者预警列表 | P0 | 自动汇总营养风险等级为"高"的患者，便于重点关注 |
| AD-13 | 指标异常提醒 | P1 | 患者录入指标超出阈值时，管理端生成提醒标记 |

### 10.5 知识内容管理

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| AD-14 | 营养行动内容配置 | P1 | 按阶段维护能量目标、推荐饮食模式、误区提醒等展示内容 |
| AD-15 | 症状库管理 | P1 | 增删改查症状条目及其四维解析内容 |
| AD-16 | 营养知识图谱维护 | P2 | 管理智能问答依赖的知识图谱词条与问答对 |
| AD-17 | 量表模板管理 | P1 | 配置各阶段对应的量表题目与评分规则 |

### 10.6 数据统计与报表

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| AD-18 | 患者阶段分布统计 | P2 | 展示各阶段患者数量分布 |
| AD-19 | 营养风险等级分布统计 | P2 | 展示低/中/高风险患者占比 |
| AD-20 | 功能使用情况统计 | P2 | 统计问答使用次数、饮食记录提交率、报告生成数等 |
| AD-21 | 数据导出 | P2 | 支持将患者档案、指标记录、评估结果导出为Excel/CSV |

### 10.7 系统管理

| 功能编号 | 功能名称 | 优先级 | 描述 |
|---|---|---|---|
| AD-22 | 账号与权限管理 | P1 | 管理医护账号，支持角色分配（管理员/医生/营养师） |
| AD-23 | 操作日志审计 | P1 | 记录管理端关键操作日志，满足医疗数据合规要求 |
| AD-24 | 同意书模板编辑 | P1 | 在线编辑三页声明文本，变更时自动升级版本号 |
| AD-25 | 大模型工具查看 | P2 | 展示系统中注册的所有大模型工具列表，包含工具名称、工具类型（检索类/计算类/知识图谱查询类/报告生成类等）、所属模块、当前启用状态 |

---

## 11. 非功能性需求

### 11.1 安全性

| 要求 | 说明 |
|---|---|
| 数据加密 | 患者敏感信息传输使用HTTPS，静态存储使用AES-256 |
| 接口鉴权 | JWT Token 认证，管理端强制鉴权，小程序端使用微信 OpenID |
| 代码沙箱隔离 | sandbox_tools 生产环境必须使用Docker容器级隔离，禁止访问网络和宿主文件系统 |
| 知情同意合规 | 电子同意书含版本号、签署时间、IP地址、签名图，不可篡改 |
| 操作审计 | 管理端所有写操作记录审计日志，保留至少3年 |
| 医疗数据分级 | 检验数据、同意书为敏感等级，访问需记录日志 |

### 11.2 性能

| 指标 | 目标值 |
|---|---|
| API P95 响应时间 | ≤500ms（非AI接口）|
| Agent 问询响应时间 | ≤15s（含工具调用链）|
| 文件上传大小限制 | 图片 ≤ 10MB，PDF ≤ 20MB |
| 并发患者数 | 支持100名患者同时在线 |
| 数据库连接池 | 异步连接池 min=5, max=20 |

### 11.3 可用性

| 要求 | 说明 |
|---|---|
| 系统可用性 | ≥99.5%(月度) |
| 数据备份 | PostgreSQL 每日自动备份，保留30天 |
| 降级策略 | AI接口不可用时，降级返回静态知识库内容 |
| 错误提示 | 所有错误提供用户友好的中文提示 |

### 11.4 合规性

- 符合《个人信息保护法（PIPL）》
- 符合《医疗数据安全管理规范》
- 患者数据最小化采集原则
- 支持数据主体权利（查询/撤回/删除）

---

## 12. 技术选型汇总

### 12.1 后端技术栈（全Python）

| 组件 | 技术选型 | 版本 | 用途 |
|---|---|---|---|
| Web框架 | FastAPI | ≥0.110 | RESTful API + OpenAPI文档 |
| ASGI服务器 | Uvicorn | ≥0.27 | 异步HTTP服务 |
| ORM | SQLAlchemy | 2.x | 数据库操作（异步） |
| 数据库驱动 | asyncpg | ≥0.29 | PostgreSQL异步驱动 |
| 数据验证 | Pydantic | v2 | 请求/响应Schema / Tool入参验证 |
| AI框架 | LangChain + OpenAI SDK | latest | Agent编排 / Function Calling |
| PDF生成 | reportlab | ≥4.0 | 营养报告 / 电子同意书 |
| PDF解析 | pypdf | ≥4.0 | PDF内容提取 |
| 数据分析 | numpy + pandas | latest | 指标趋势计算 |
| 可视化 | matplotlib | latest | Sandbox图表生成 |
| 异步文件 | aiofiles | ≥23.0 | 异步文件读写 |
| HTTP客户端 | httpx | ≥0.27 | WebSearch / 外部API调用 |
| 数据库迁移 | Alembic | latest | 数据库版本管理 |
| 环境配置 | python-dotenv | latest | 配置管理 |

### 12.2 前端技术栈

| 组件 | 技术选型 | 用途 |
|---|---|---|
| 管理端框架 | React 18 + Vite | Web管理端 |
| 图表库 | ECharts + echarts-for-react | 数据可视化 |
| 小程序 | 微信原生小程序 | 患者端 |

### 12.3 基础设施

| 组件 | 技术选型 | 用途 |
|---|---|---|
| 主数据库 | PostgreSQL 15+ | 主存储 |
| 向量数据库 | pgvector 扩展 | 知识图谱检索 |
| 文件存储 | 本地 uploads/ 目录（可升级OSS）| 图片/PDF存储 |
| 代码沙箱（生产） | Docker + --network none | 安全代码执行 |

---

## 附录：功能优先级汇总

| 优先级 | 定义 | 小程序端 | 管理端 |
|---|---|---|---|
| P0 | 核心必须，MVP上线前完成 | MP-01~09, MP-11, MP-12, MP-14, MP-17, MP-18, MP-26, MP-27 | AD-01~03, AD-05, AD-07, AD-09, AD-12 |
| P1 | 重要功能，第一迭代完成 | MP-10, MP-13, MP-15, MP-16, MP-19~20, MP-23~26, MP-28 | AD-04, AD-06, AD-08, AD-10~11, AD-13~15, AD-17, AD-22~24 |
| P2 | 完善功能，后续迭代 | MP-21, MP-22, MP-29, MP-30 | AD-16, AD-18~21, AD-25 |

**系统合计：小程序端 30 项 + 管理端 25 项 = 55 项功能**
