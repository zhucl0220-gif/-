"""
app/services — 业务逻辑层
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
纯 Python 业务逻辑，不直接依赖 HTTP 请求/响应对象。
由 Router 层调用，也可被 Agent Tools 调用。

待实现模块：
  - patient_service.py     患者档案 CRUD + 阶段流转
  - lab_service.py         检验单解析与存储
  - nutrition_service.py   营养方案计算
  - ocr_service.py         OCR 引擎封装
  - agent_service.py       Agent 任务调度
  - file_service.py        文件上传/下载
"""
