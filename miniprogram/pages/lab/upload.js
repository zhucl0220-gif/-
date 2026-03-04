const app = getApp()
const BASE_URL = app.globalData.baseUrl

Page({
  data: {
    imageUrl: '',
    loading: false,
    result: null,
    selectedType: 'liver_function',
    reportTypes: [
      { label: '肝功能', value: 'liver_function' },
      { label: '血常规', value: 'blood_routine' },
      { label: '营养指标', value: 'nutrition' },
      { label: '凝血功能', value: 'coagulation' },
      { label: '免疫抑制剂', value: 'immunosuppressant' },
    ],
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ imageUrl: res.tempFiles[0].tempFilePath, result: null })
      },
    })
  },

  selectType(e) {
    this.setData({ selectedType: e.currentTarget.dataset.value })
  },

  async submit() {
    if (!this.data.imageUrl) return
    this.setData({ loading: true })

    // 模拟 AI 分析结果（对接后端后替换）
    setTimeout(() => {
      this.setData({
        loading: false,
        result: {
          summary: '白蛋白 28.5 g/L，低于正常下限（35 g/L），提示营养不良风险。胆红素轻度升高，肝功能处于恢复期。',
          risk_level: 'medium',
          risk_text: '中风险',
          recommendations: [
            '建议增加优质蛋白摄入（白蛋白偏低）',
            '每日蛋白质目标：1.2–1.5 g/kg 体重',
            '监测胆红素变化，必要时复查',
          ],
        },
      })
    }, 1500)
  },
})
