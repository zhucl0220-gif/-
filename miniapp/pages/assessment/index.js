
// pages/assessment/index.js
const app = getApp()
const storage = require('../../utils/storage')

const NRS_QUESTIONS = [
  { id: 'q1', text: '最近1周内，您的饮食摄入量是否减少？', options: [
    { score: 0, label: '无减少，饮食正常' },
    { score: 1, label: '减少约1/4' },
    { score: 2, label: '减少约1/2' },
    { score: 3, label: '几乎不能进食或只能进流食' },
  ]},
  { id: 'q2', text: '近3个月内体重是否有明显下降？', options: [
    { score: 0, label: '无明显下降' },
    { score: 1, label: '下降约5%' },
    { score: 2, label: '下降约10%' },
    { score: 3, label: '下降>15%' },
  ]},
  { id: 'q3', text: '当前BMI大约是多少（kg/m²）？', options: [
    { score: 0, label: '≥ 20.5（正常或偏高）' },
    { score: 1, label: '18.5 ~ 20.4（偏低）' },
    { score: 2, label: '17 ~ 18.4（偏瘦）' },
    { score: 3, label: '< 17（极低）' },
  ]},
  { id: 'q4', text: '目前是否正在接受以下任一治疗？', options: [
    { score: 0, label: '无特殊治疗' },
    { score: 1, label: '肿瘤/慢性炎症/肝硬化等' },
    { score: 2, label: '腹部大手术/严重肺炎' },
    { score: 3, label: '器官移植/重症监护/多发伤' },
  ]},
]

const SGA_ITEMS = [
  { id: 's1', text: '过去2周内体重变化？', options: [
    { score: 0, label: '稳定或略升' },
    { score: 1, label: '小幅下降（<5%）' },
    { score: 2, label: '明显下降（≥5%）' },
  ]},
  { id: 's2', text: '近期食欲变化？', options: [
    { score: 0, label: '正常，无变化' },
    { score: 1, label: '略有减少' },
    { score: 2, label: '明显减少或厌食' },
  ]},
  { id: 's3', text: '消化道症状（恶心/呕吐/腹泻等）？', options: [
    { score: 0, label: '无' },
    { score: 1, label: '偶尔出现（每周<3次）' },
    { score: 2, label: '频繁出现（每周≥3次）' },
  ]},
  { id: 's4', text: '近期活动能力？', options: [
    { score: 0, label: '如常，无明显受限' },
    { score: 1, label: '活动减少，容易疲倦' },
    { score: 2, label: '基本卧床，需要协助' },
  ]},
]

const LAB_FIELDS = [
  { key: 'albumin',    label: '血清白蛋白',  unit: 'g/L',   placeholder: '正常 35~55',      normal: [35, 55]   },
  { key: 'prealbumin', label: '前白蛋白',    unit: 'mg/L',  placeholder: '正常 200~400',     normal: [200, 400] },
  { key: 'weight',     label: '体重',        unit: 'kg',    placeholder: '请输入当前体重',   normal: null        },
  { key: 'hemoglobin', label: '血红蛋白',    unit: 'g/L',   placeholder: '正常 110~160',     normal: [110, 160] },
  { key: 'bmi',        label: 'BMI',         unit: 'kg/m²', placeholder: '正常 18.5~24',     normal: [18.5, 24] },
]

Page({
  data: {
    activeTab: 'scale',
    nrsQuestions: NRS_QUESTIONS,
    nrsAnswers: {},
    nrsScore: 0,
    nrsRisk: 'low',
    nrsRiskText: '无营养风险',
    sgaItems: SGA_ITEMS,
    sgaAnswers: {},
    sgaScore: 0,
    sgaRisk: 'A',
    sgaRiskText: 'A 级（营养良好）',
    labFields: LAB_FIELDS,
    labValues: {},
    labWarnings: {},
    imagePath: '',
    ocrLoading: false,
    ocrFilled: false,
    ocrFilledCount: 0,
    submitLoading: false,
    riskLevel: 'low',
    riskText: '综合风险评估中…',
    riskIcon: '🟢',
    riskExplain: '请完成问卷及指标录入后查看结果。',
    radarItems: [],
    suggestions: [],
    aiLoading: false,
  },

  onLoad() { this._loadHistory() },

  onTab(e) { this.setData({ activeTab: e.currentTarget.dataset.tab }) },

  onNrsAnswer(e) {
    const { qid, score } = e.currentTarget.dataset
    const answers = { ...this.data.nrsAnswers, [qid]: Number(score) }
    const total = Object.values(answers).reduce((a, b) => a + b, 0)
    let risk = 'low'; let text = '无营养风险'
    if (total >= 5) { risk = 'high'; text = '重度营养风险（NRS≥5）' }
    else if (total >= 3) { risk = 'medium'; text = '中度营养风险（NRS 3~4）' }
    else if (total >= 1) { risk = 'slight'; text = '轻度营养风险（NRS 1~2）' }
    this.setData({ nrsAnswers: answers, nrsScore: total, nrsRisk: risk, nrsRiskText: text })
  },

  saveNrsScale() {
    if (Object.keys(this.data.nrsAnswers).length < NRS_QUESTIONS.length) {
      wx.showToast({ title: '请回答全部问题', icon: 'none' }); return
    }
    wx.showToast({ title: '已保存 NRS-2002 评分', icon: 'success' })
    this.setData({ activeTab: 'sga' })
  },

  onSgaAnswer(e) {
    const { sid, score } = e.currentTarget.dataset
    const answers = { ...this.data.sgaAnswers, [sid]: Number(score) }
    const total = Object.values(answers).reduce((a, b) => a + b, 0)
    let risk = 'A'; let text = 'A 级（营养良好）'
    if (total >= 9) { risk = 'C'; text = 'C 级（重度营养不良）' }
    else if (total >= 4) { risk = 'B'; text = 'B 级（中度营养不良）' }
    this.setData({ sgaAnswers: answers, sgaScore: total, sgaRisk: risk, sgaRiskText: text })
  },

  saveSgaScale() {
    if (Object.keys(this.data.sgaAnswers).length < SGA_ITEMS.length) {
      wx.showToast({ title: '请回答全部问题', icon: 'none' }); return
    }
    this._buildRadar()
    wx.showToast({ title: '已保存 SGA 评分', icon: 'success' })
    this.setData({ activeTab: 'enter' })
  },

  onUploadAndOcr() { this._pickImage() },

  _pickImage() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['camera', 'album'],
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath
        this.setData({ imagePath: path, ocrLoading: true })
        this._doOcr(path)
      },
    })
  },

  _doOcr(path) {
    wx.uploadFile({
      url: app.globalData.apiBase + '/tools/lab/ocr-process',
      filePath: path, name: 'file',
      success: (res) => {
        try {
          const data = JSON.parse(res.data)
          if (data && data.structured_items) {
            this._applyOcrResult(data.structured_items)
          } else {
            wx.showToast({ title: 'OCR 服务暂不可用，请手动录入', icon: 'none', duration: 2500 })
          }
        } catch {
          wx.showToast({ title: 'OCR 服务暂不可用，请手动录入', icon: 'none', duration: 2500 })
        }
      },
      fail: () => wx.showToast({ title: 'OCR 服务暂不可用，请手动录入', icon: 'none', duration: 2500 }),
      complete: () => this.setData({ ocrLoading: false }),
    })
  },

  _applyOcrResult(items) {
    const values = { ...this.data.labValues }
    const warnings = { ...this.data.labWarnings }
    let count = 0
    LAB_FIELDS.forEach(f => {
      if (items[f.key] !== undefined) {
        values[f.key] = String(items[f.key])
        if (f.normal) {
          const v = parseFloat(items[f.key])
          warnings[f.key] = !isNaN(v) && (v < f.normal[0] || v > f.normal[1])
        }
        count++
      }
    })
    this.setData({ labValues: values, labWarnings: warnings, ocrFilled: count > 0, ocrFilledCount: count })
    if (count > 0) wx.showToast({ title: '识别完成，已回填 ' + count + ' 项', icon: 'success' })
    else wx.showToast({ title: '未识别到有效数据，请手动录入', icon: 'none' })
  },

  onLabInput(e) {
    const key = e.currentTarget.dataset.key
    const val = e.detail.value
    const field = LAB_FIELDS.find(f => f.key === key)
    let warn = false
    if (field && field.normal && val) {
      const v = parseFloat(val)
      warn = !isNaN(v) && (v < field.normal[0] || v > field.normal[1])
    }
    this.setData({ ['labValues.' + key]: val, ['labWarnings.' + key]: warn })
  },

  onSubmitLab() {
    const patientId = app.globalData.patientId
    if (!patientId) { wx.showToast({ title: '请先完善个人信息', icon: 'none' }); return }
    const vals = this.data.labValues
    const hasValue = LAB_FIELDS.some(f => vals[f.key])
    if (!hasValue) { wx.showToast({ title: '请至少录入一项检验指标', icon: 'none' }); return }
    const items = {}
    LAB_FIELDS.forEach(f => { if (vals[f.key]) items[f.key] = parseFloat(vals[f.key]) || vals[f.key] })
    this.setData({ submitLoading: true })
    wx.request({
      url: app.globalData.apiBase + '/lab',
      method: 'POST',
      data: { patient_id: patientId, report_date: new Date().toISOString().slice(0,10), report_type: 'manual', structured_items: items },
      success: (res) => {
        wx.showToast({ title: res.statusCode < 300 ? '提交成功' : '提交失败，请重试', icon: res.statusCode < 300 ? 'success' : 'none' })
        if (res.statusCode < 300) { this._buildRadar(); this.setData({ activeTab: 'result' }) }
      },
      fail: () => wx.showToast({ title: '网络错误，请重试', icon: 'none' }),
      complete: () => this.setData({ submitLoading: false }),
    })
  },

  onFetchAiSuggest() {
    const { nrsScore, nrsRiskText, sgaRiskText } = this.data
    const patientId = app.globalData.patientId
    if (!patientId) { wx.showToast({ title: '请先完善个人信息', icon: 'none' }); return }
    this.setData({ aiLoading: true })
    const query = 'NRS-2002 评分 ' + nrsScore + '（' + nrsRiskText + '），SGA 分级 ' + sgaRiskText + '，请给出个性化营养干预建议。'
    wx.request({
      url: app.globalData.apiBase + '/agent/query',
      method: 'POST',
      data: { patient_id: patientId, query: query },
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.answer) {
          const lines = res.data.answer.split('\n').filter(l => l.trim())
          this.setData({ suggestions: lines })
          wx.showToast({ title: '建议已更新', icon: 'success' })
        } else {
          wx.showToast({ title: 'AI 服务暂不可用', icon: 'none' })
        }
      },
      fail: () => wx.showToast({ title: 'AI 服务暂不可用', icon: 'none' }),
      complete: () => this.setData({ aiLoading: false }),
    })
  },

  _buildRadar() {
    const { nrsScore, sgaScore } = this.data
    const vals = this.data.labValues
    const albumin = parseFloat(vals.albumin) || 0
    const hb = parseFloat(vals.hemoglobin) || 0
    const bmi = parseFloat(vals.bmi) || 0
    const radarItems = [
      { label: 'NRS', value: Math.min(Math.round(nrsScore/6*100),100), max: 100 },
      { label: 'SGA', value: Math.min(Math.round(sgaScore/8*100),100), max: 100 },
      { label: '白蛋白', value: albumin > 0 ? Math.min(Math.round(albumin/55*100),100) : 0, max: 100 },
      { label: '血红蛋白', value: hb > 0 ? Math.min(Math.round(hb/160*100),100) : 0, max: 100 },
      { label: 'BMI', value: bmi > 0 ? Math.min(Math.round(bmi/30*100),100) : 0, max: 100 },
    ]
    const textMap = { high: '高风险', medium: '中风险', low: '低风险' }
    const iconMap = { high: '🔴', medium: '🟡', low: '🟢' }
    const explainMap = {
      high: '综合评估提示存在显著营养风险，建议尽快联系临床营养师制定个性化方案。',
      medium: '存在中等程度营养风险，建议增加高蛋白食物摄入并定期复查。',
      low: '营养状况基本良好，继续保持均衡饮食并定期自我监测。',
    }
    const sugMap = {
      high: ['立即联系临床营养科会诊', '考虑营养支持治疗（肠内/肠外）', '每周复查营养相关指标', '记录每日饮食摄入日记'],
      medium: ['增加优质蛋白摄入（鱼、蛋、豆制品）', '少量多餐，每日5~6次', '适量补充维生素D和Omega-3', '每2周随访营养状况'],
      low: ['保持均衡饮食，蛋白质充足', '每月自我监测体重', '规律复诊，按时检测血生化', '适量有氧运动，增强体能'],
    }
    const combined = (nrsScore >= 5 || sgaScore >= 9) ? 'high' : (nrsScore >= 3 || sgaScore >= 4) ? 'medium' : 'low'
    this.setData({
      radarItems, riskLevel: combined,
      riskText: textMap[combined], riskIcon: iconMap[combined],
      riskExplain: explainMap[combined], suggestions: sugMap[combined],
    })
  },

  _loadHistory() {
    const patientId = app.globalData.patientId
    if (!patientId) return
    wx.request({
      url: app.globalData.apiBase + '/patients/' + patientId + '/summary',
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          const d = res.data
          const mapping = { albumin: 'albumin', prealbumin: 'prealbumin', weight: 'weight', hemoglobin: 'hemoglobin', bmi: 'bmi' }
          const values = {}
          Object.entries(mapping).forEach(([k]) => { if (d[k]) values[k] = String(d[k]) })
          if (Object.keys(values).length > 0) this.setData({ labValues: values })
        }
      },
    })
  },
})
