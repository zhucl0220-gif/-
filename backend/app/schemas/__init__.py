"""
app/schemas — Pydantic 数据校验层
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
用于 Request / Response 数据的序列化与校验。
与 ORM Model 解耦，避免直接暴露数据库字段。

待实现模块：
  - patient.py    患者档案相关 Schema
  - lab.py        检验结果相关 Schema
  - nutrition.py  营养方案相关 Schema
  - agent.py      Agent 任务相关 Schema
  - consent.py    知情同意书相关 Schema
"""
