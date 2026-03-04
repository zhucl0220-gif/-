将正式版《知情同意书.pdf》模板文件放置于本目录，命名为：
  consent_template.pdf

模板制作要求：
  - 纸张：A4 纵向
  - 签名区域：位于最后一页，距底部约 35mm，距左侧约 100mm，宽 80mm 高 25mm
  - 上述坐标通过 app/services/compliance_service.py 中的 SIGNATURE_CONFIG 配置

若本目录不存在 consent_template.pdf，后端将在首次调用签署接口时
自动生成一份标准模板（仅用于开发调试，生产环境必须替换为正式文件）。
