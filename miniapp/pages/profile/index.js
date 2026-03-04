// pages/profile/index.js — MP-28~30 阿福管家风
const app = getApp()
const api = require('../../utils/api')
const storage = require('../../utils/storage')

const BASIC_FIELDS = [
  { key: 'name',    label: '姓名',      placeholder: '请输入姓名' },
  { key: 'age',     label: '年龄',      placeholder: '如：45', inputType: 'number' },
  { key: 'gender',  label: '性别',      type: 'picker', options: ['男', '女'], pickerIdx: 0 },
  { key: 'height',  label: '身高(cm)',  placeholder: '如：170', inputType: 'digit' },
  { key: 'weight',  label: '体重(kg)',  placeholder: '如：65', inputType: 'digit' },
  { key: 'phone',   label: '联系电话',  placeholder: '请输入手机号', inputType: 'number' },
]
const SURGERY_FIELDS = [
  { key: 'primary_disease', label: '原发疾病', placeholder: '如：乙肝肝硬化' },
  { key: 'surgery_date',    label: '手术日期', type: 'date' },
  { key: 'donor_type',      label: '供体类型', placeholder: '如：活体/DCD' },
  { key: 'discharge_date',  label: '出院日期', type: 'date' },
]
// 白蛋白正常区间 g/L
const ALB_NORMAL = [35, 55]

Page({
  data: {
    activeTab: 'info',
    editMode: false,
    saving: false,
    patientInfo: {},
    formData: {},
    basicFields: BASIC_FIELDS,
    surgeryFields: SURGERY_FIELDS,
    avatarChar: '患',
    phase: 'home',
    phaseText: '居家恢复期',
    riskLevel: 'low',
    riskText: '低风险',
    reports: [],
    weightHistory: [],
    chartEmpty: true,
    chartStats: [],
  },

  onLoad(options) {
    if (options.mode === 'edit') this.setData({ editMode: true, activeTab: 'info' })
    this._loadInfo()
    this._loadReports()
  },

  onShow() {
    this._loadInfo()
    const g = getApp().globalData
    if (g._autoEditProfile) {
      g._autoEditProfile = false
      this.setData({ editMode: true, formData: { ...this.data.patientInfo } })
    }
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    if (tab === 'trend') {
      // 等 canvas 节点渲染后再加载
      setTimeout(() => this._loadTrendData(), 80)
    }
  },

  _loadInfo() {
    const info = storage.getPatientInfo() || {}
    const phase = storage.getPhase() || 'home'
    const phaseMap = { pre:'术前准备期', inhos:'住院期', post:'出院准备期', home:'居家恢复期' }
    const char = info.name ? info.name.charAt(info.name.length - 1) : '患'
    this.setData({
      patientInfo: info,
      formData: { ...info },
      phase,
      phaseText: phaseMap[phase] || '居家恢复期',
      riskLevel: info.riskLevel || 'low',
      riskText: { low:'低风险', medium:'中风险', high:'高风险' }[info.riskLevel || 'low'],
      avatarChar: char,
    })
  },

  onEditInfo()   { this.setData({ editMode: true, formData: { ...this.data.patientInfo } }) },
  onCancelEdit() { this.setData({ editMode: false }) },

  onFormInput(e) {
    this.setData({ [`formData.${e.currentTarget.dataset.key}`]: e.detail.value })
  },
  onPickerChange(e) {
    const field = BASIC_FIELDS.find(f => f.key === e.currentTarget.dataset.key)
    if (field && field.options) {
      this.setData({ [`formData.${field.key}`]: field.options[e.detail.value] })
    }
  },
  onDateChange(e) {
    this.setData({ [`formData.${e.currentTarget.dataset.key}`]: e.detail.value })
  },

  onSaveInfo() {
    const data = this.data.formData
    if (!data.name) { wx.showToast({ title: '请填写姓名', icon: 'none' }); return }
    this.setData({ saving: true })
    storage.setPatientInfo(data)
    app.globalData.patientInfo = data
    if (data.phase) { storage.setPhase(data.phase); app.globalData.patientPhase = data.phase }
    setTimeout(() => {
      this.setData({ saving: false, editMode: false, patientInfo: data })
      this._loadInfo()
      wx.showToast({ title: '保存成功', icon: 'success' })
    }, 500)
  },

  _loadReports() {
    const patientId = app.globalData.patientId
    if (!patientId) return
    api.getNutritionPlan(patientId)
      .then(plan => {
        if (!plan) return
        const reports = [{
          id: plan.id || 1,
          title: '营养评估报告',
          date: (plan.created_at || '').slice(0, 10) || '最近一次',
          riskLevel: plan.risk_level || 'low',
          riskText: { low:'低风险', medium:'中风险', high:'高风险' }[plan.risk_level] || '低风险',
          summary: plan.summary || '系统已生成您的营养评估报告，点击查看详情。',
        }]
        this.setData({ reports })
      })
      .catch(() => {})
  },

  onOpenReport(e) {
    wx.navigateTo({ url: `/pages/report/index?reportId=${e.currentTarget.dataset.id}` })
  },

  // ── 趋势数据加载 ──
  _loadTrendData() {
    const patientId = app.globalData.patientId
    if (!patientId) { this.setData({ chartEmpty: true }); return }

    api.getLabHistory(patientId)
      .then(data => {
        const records = data && data.records ? data.records : []

        // 白蛋白序列
        const albRecords = records
          .filter(r => r.indicator_name === '白蛋白')
          .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
          .slice(-10)

        // 体重序列
        const weightRecords = records
          .filter(r => r.indicator_name === '体重')
          .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
          .slice(-10)

        if (albRecords.length === 0 && weightRecords.length === 0) {
          this.setData({ chartEmpty: true, weightHistory: [], chartStats: [] })
          return
        }

        this.setData({ chartEmpty: false })

        // 体重条形历史
        const maxW = Math.max(...weightRecords.map(r => parseFloat(r.value)), 1)
        const weightHistory = weightRecords.map(r => {
          const d = new Date(r.recorded_at)
          return {
            date: `${d.getMonth()+1}/${d.getDate()}`,
            value: parseFloat(r.value).toFixed(1),
            pct: Math.round(parseFloat(r.value) / maxW * 100),
          }
        })
        this.setData({ weightHistory })

        // 最新统计
        const chartStats = []
        if (albRecords.length) {
          const last = parseFloat(albRecords[albRecords.length-1].value)
          chartStats.push({
            label: '白蛋白', value: last.toFixed(1), unit: 'g/L',
            ref: `${ALB_NORMAL[0]}~${ALB_NORMAL[1]}`,
            status: last < ALB_NORMAL[0] ? 'danger' : last > ALB_NORMAL[1] ? 'warning' : 'success',
          })
        }
        if (weightRecords.length) {
          const last = parseFloat(weightRecords[weightRecords.length-1].value)
          chartStats.push({ label: '体重', value: last.toFixed(1), unit: 'kg', ref: '因人而异', status: 'success' })
        }
        // BMI
        const info = this.data.patientInfo
        if (info.weight && info.height) {
          const bmi = (parseFloat(info.weight) / Math.pow(parseFloat(info.height)/100, 2)).toFixed(1)
          const bmiN = parseFloat(bmi)
          chartStats.push({
            label: 'BMI', value: bmi, unit: 'kg/m²', ref: '18.5~24',
            status: bmiN < 18.5 ? 'danger' : bmiN > 24 ? 'warning' : 'success',
          })
        }
        this.setData({ chartStats })

        // 绘制 Canvas 图表
        this._drawDualChart(albRecords, weightRecords)
      })
      .catch(() => this.setData({ chartEmpty: true }))
  },

  // ── Canvas 2D 双折线绘制 ──
  _drawDualChart(albRecs, wtRecs) {
    const query = wx.createSelectorQuery().in(this)
    query.select('#dualChart').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) return
      const canvas = res[0].node
      const dpr = wx.getSystemInfoSync().pixelRatio
      const W = res[0].width  * dpr
      const H = res[0].height * dpr
      canvas.width  = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      const w = res[0].width
      const h = res[0].height

      const PAD = { top: 20, right: 24, bottom: 44, left: 48 }
      const CW = w - PAD.left - PAD.right
      const CH = h - PAD.top  - PAD.bottom

      // 清空
      ctx.clearRect(0, 0, w, h)

      // 收集所有日期轴（两序列合并后排序去重）
      const allDates = [...new Set([
        ...albRecs.map(r => r.recorded_at.slice(0,10)),
        ...wtRecs.map(r  => r.recorded_at.slice(0,10)),
      ])].sort()
      const N = allDates.length
      if (N === 0) return

      // xPos (0-indexed → pixel)
      const xPos = i => PAD.left + (N === 1 ? CW/2 : i / (N-1) * CW)

      // ── 白蛋白 Y 轴 (左) ──
      const albVals = albRecs.map(r => parseFloat(r.value))
      const albMin  = Math.min(...albVals, ALB_NORMAL[0]) - 3
      const albMax  = Math.max(...albVals, ALB_NORMAL[1]) + 3
      const toAlbY  = v => PAD.top + CH - ((v - albMin) / (albMax - albMin)) * CH

      // ── 体重 Y 轴 (右, 归一化到同高度) ──
      const wtVals = wtRecs.map(r => parseFloat(r.value))
      const wtMin  = wtVals.length ? Math.min(...wtVals) - 3 : 0
      const wtMax  = wtVals.length ? Math.max(...wtVals) + 3 : 1
      const toWtY  = v => PAD.top + CH - ((v - wtMin) / (wtMax - wtMin)) * CH

      // ── 正常区间绿色带 ──
      const y1 = toAlbY(ALB_NORMAL[1])
      const y2 = toAlbY(ALB_NORMAL[0])
      ctx.fillStyle = 'rgba(0,199,178,0.10)'
      ctx.fillRect(PAD.left, y1, CW, y2 - y1)
      // 上下虚线
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = 'rgba(0,199,178,0.45)'
      ctx.lineWidth = 1.5 / dpr
      ;[y1, y2].forEach(y => {
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + CW, y); ctx.stroke()
      })
      ctx.setLineDash([])

      // ── Y 轴标签（白蛋白，左侧）──
      ctx.fillStyle = '#aaa'
      ctx.font = `${22/dpr}px sans-serif`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const yTicks = 4
      for (let i = 0; i <= yTicks; i++) {
        const v = albMin + (albMax - albMin) * i / yTicks
        const y = toAlbY(v)
        ctx.fillText(v.toFixed(0), PAD.left - 6, y)
      }

      // ── X 轴标签 ──
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#aaa'
      const step = Math.max(1, Math.ceil(N / 5))
      allDates.forEach((d, i) => {
        if (i % step !== 0 && i !== N-1) return
        const parts = d.split('-')
        const label = `${parts[1]}/${parts[2]}`
        ctx.fillText(label, xPos(i), PAD.top + CH + 8)
      })

      // ── 绘折线函数 ──
      const drawLine = (recs, color, toY) => {
        if (recs.length === 0) return
        const pts = recs.map(r => {
          const di = allDates.indexOf(r.recorded_at.slice(0,10))
          return { x: xPos(di), y: toY(parseFloat(r.value)) }
        })
        // 渐变描边
        const grad = ctx.createLinearGradient(pts[0].x, 0, pts[pts.length-1].x, 0)
        grad.addColorStop(0, color + 'bb')
        grad.addColorStop(1, color)
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) {
          const cpx = (pts[i-1].x + pts[i].x) / 2
          ctx.bezierCurveTo(cpx, pts[i-1].y, cpx, pts[i].y, pts[i].x, pts[i].y)
        }
        ctx.strokeStyle = grad
        ctx.lineWidth = 3 / dpr
        ctx.lineJoin = 'round'
        ctx.stroke()
        // 数据点
        pts.forEach(pt => {
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, 5 / dpr, 0, Math.PI * 2)
          ctx.fillStyle = '#fff'
          ctx.fill()
          ctx.strokeStyle = color
          ctx.lineWidth = 2.5 / dpr
          ctx.stroke()
        })
      }

      drawLine(albRecs, '#00C7B2', toAlbY)
      drawLine(wtRecs,  '#FA8C16', toWtY)
    })
  },
})