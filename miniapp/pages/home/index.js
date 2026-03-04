// pages/home/index.js
const app = getApp()
const storage = require('../../utils/storage')

const PHASES = [
  { id: 1, name: '术前准备期', tip: '这一阶段需关注术前营养储备，保证蛋白质和热量摄入充足，有助于手术耐受性。' },
  { id: 2, name: '住院期',     tip: '住院期间配合医护团队完成饮食康复，从流质到普通饮食逐步过渡，注意控制液体摄入量。' },
  { id: 3, name: '出院准备期', tip: '出院前重点评估营养状态，建立居家饮食计划，学习免疫抑制剂服用和食物相互作用知识。' },
  { id: 4, name: '居家恢复期', tip: '居家期间每日饮食打卡与定期复查同等重要，持续追踪白蛋白与体重变化。' },
]
const RISK_MAP = {
  low:    { text: '低风险', icon: '🟢', tip: '您目前营养状态良好，请继续保持均衡饮食与规律打卡。' },
  medium: { text: '中风险', icon: '🟡', tip: '您存在一定营养风险，建议增加蛋白质摄入并完成当日饮食记录。' },
  high:   { text: '高风险', icon: '🔴', tip: '营养风险较高，请尽快联系营养师或主治医生制定干预方案。' },
}

Page({
  data: {
    greeting: '', today: '', patientName: '', profileComplete: false,
    currentPhase: 'pre', phaseIdx: 1, phaseText: '术前准备期',
    phases: PHASES, phaseProgress: 0, phaseTip: '',
    riskLevel: 'low', riskText: '低风险', riskIcon: '🟢', riskTip: '',
    showRiskPop: false, recentDietDays: 0, recentCompliance: 0,
    lastAlbuminVal: null, lastRisk: 'success',
  },
  onLoad() { this._loadLocalData() },
  onShow()  { this._loadLocalData(); this._refreshData() },
  _loadLocalData() {
    const info = storage.getPatientInfo() || {}
    const phase = storage.getPhase() || 'pre'
    const { phaseIdx, phaseText, phaseTip } = this._resolvePhase(phase)
    const rl = info.riskLevel || 'low'
    const rm = RISK_MAP[rl] || RISK_MAP.low
    this.setData({
      greeting: this._getGreeting(), today: this._getToday(),
      patientName: info.name || '', profileComplete: !!(info && info.name && info.age),
      currentPhase: phase, phaseIdx, phaseText, phaseTip,
      phaseProgress: ((phaseIdx - 1) / 3) * 100,
      riskLevel: rl, riskText: rm.text, riskIcon: rm.icon, riskTip: rm.tip,
    })
  },
  _refreshData() {
    const patientId = app.globalData.patientId
    if (!patientId) return
    wx.request({
      url: app.globalData.apiBase + '/diet/records',
      method: 'GET', data: { patient_id: patientId, page_size: 7 },
      success: (res) => {
        if (res.statusCode === 200) {
          const records = res.data.items || []
          const days = records.length
          const compliance = days > 0 ? Math.round(records.filter(r => r.compliance === 'good').length / days * 100) : 0
          this.setData({ recentDietDays: days, recentCompliance: compliance })
        }
      },
    })
    wx.request({
      url: app.globalData.apiBase + '/patients/' + patientId + '/summary',
      method: 'GET',
      success: (res) => {
        if (res.statusCode !== 200) return
        const labs = res.data.recent_labs || []
        if (!labs.length) return
        const albItem = (labs[0].structured_items || []).find(it => (it.name || '').includes('白蛋白'))
        if (albItem) {
          const val = parseFloat(albItem.value)
          this.setData({ lastAlbuminVal: val.toFixed(1), lastRisk: val < 28 ? 'danger' : val < 35 ? 'warning' : 'success' })
        }
      },
    })
  },
  onRiskTip()      { this.setData({ showRiskPop: true }) },
  onCloseRiskPop() { this.setData({ showRiskPop: false }) },
  stopPop() {},
  _resolvePhase(phase) {
    const map = {
      pre:   { phaseIdx: 1, phaseText: '术前准备期', phaseTip: PHASES[0].tip },
      inhos: { phaseIdx: 2, phaseText: '住院期',     phaseTip: PHASES[1].tip },
      post:  { phaseIdx: 3, phaseText: '出院准备期', phaseTip: PHASES[2].tip },
      home:  { phaseIdx: 4, phaseText: '居家恢复期', phaseTip: PHASES[3].tip },
    }
    return map[phase] || map.pre
  },
  _getGreeting() {
    const h = new Date().getHours()
    if (h < 6) return '夜深了'; if (h < 11) return '早上好'
    if (h < 13) return '中午好'; if (h < 18) return '下午好'
    return '晚上好'
  },
  _getToday() {
    const d = new Date()
    return d.getFullYear() + '年' + (d.getMonth()+1) + '月' + d.getDate() + '日'
  },
  goAssessment() { wx.switchTab({ url: '/pages/assessment/index' }) },
  goAction()     { wx.switchTab({ url: '/pages/action/index' }) },
  goFaq()        { wx.switchTab({ url: '/pages/faq/index' }) },
  goQa()         { wx.navigateTo({ url: '/pages/qa/index' }) },
  goFillInfo()   { getApp().globalData._autoEditProfile = true; wx.switchTab({ url: '/pages/profile/index' }) },
})
