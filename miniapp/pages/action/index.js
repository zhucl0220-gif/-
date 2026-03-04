
// pages/action/index.js
const app = getApp()
const storage = require('../../utils/storage')

const GOAL_GROUPS_MAP = {
  pre: [
    { title: '热量与蛋白质目标', goals: [
      { label: '每日总热量', desc: '为手术储备能量', target: '25~30 kcal/kg' },
      { label: '蛋白质摄入', desc: '补充手术消耗', target: '1.2~1.5 g/kg' },
    ]},
    { title: '微营养素', goals: [
      { label: '锌', desc: '促进伤口愈合', target: '10~15 mg/日' },
      { label: '维生素C', desc: '提高免疫力', target: '200~500 mg/日' },
    ]},
  ],
  inhos: [
    { title: '住院期热量目标', goals: [
      { label: '每日总热量', desc: '促进康复', target: '30~35 kcal/kg' },
      { label: '蛋白质摄入', desc: '修复手术损伤', target: '1.5~2.0 g/kg' },
    ]},
    { title: '液体管理', goals: [
      { label: '每日液体摄入', desc: '遵医嘱控制总液体', target: '1500~2000 mL' },
    ]},
  ],
  post: [
    { title: '出院过渡期目标', goals: [
      { label: '每日总热量', desc: '逐步恢复正常饮食', target: '30 kcal/kg' },
      { label: '蛋白质摄入', desc: '维持肌肉量', target: '1.2~1.5 g/kg' },
    ]},
  ],
  home: [
    { title: '居家长期目标', goals: [
      { label: '每日总热量', desc: '维持健康体重', target: '25~30 kcal/kg' },
      { label: '蛋白质摄入', desc: '保持肌肉量', target: '1.0~1.2 g/kg' },
      { label: '盐分控制',   desc: '减少肾脏负担', target: '< 5 g/日' },
    ]},
  ],
}

const MEALS = [
  { key: 'breakfast', name: '早餐', icon: '🌅' },
  { key: 'lunch',     name: '午餐', icon: '☀' },
  { key: 'dinner',    name: '晚餐', icon: '🌙' },
  { key: 'snack',     name: '加餐', icon: '🍎' },
]

const MEDICATIONS = [
  { name: '他克莫司（FK506）', dose: '遵医嘱（mg）', time: '08:00 / 20:00', taken: false, takenAt: '', warn: true,
    warnTip: '高警戒药物：血药浓度窗窄4%，漏服可能导致排斥反应。服药期间严禁西柚/西柚汁。' },
  { name: '吗替麦考酚酯（MMF）', dose: '遵医嘱（mg）', time: '08:00 / 20:00', taken: false, takenAt: '', warn: true,
    warnTip: '注意：应在饭前1小时或饭后2小时空腹服用。不可研碎或分割胶囊。' },
  { name: '甲泼尼龙（Pred）', dose: '遵医嘱（mg）', time: '08:00', taken: false, takenAt: '', warn: false, warnTip: '' },
]

const MED_TIPS = [
  '他克莫司必须每12小时按时服用，建议设置手机闹钟提醒。',
  '服免疫抑制剂期间严格禁止饮用西柚汁或食用西柚，可能引起药物浓度骤升。',
  '服药后出现手抖、头痛、视觉模糊，请尽快联系主治医生。',
  '外出就餐时注意食物卫生，避免生鱼片、生蛋等生食。',
  '定期检测FK506血药浓度，数值异常请及时就诊。',
]

const RING_COLORS = {
  cal:     { stroke: '#00C7B2', bg: '#E6FBF9' },
  protein: { stroke: '#52C41A', bg: '#F6FFED' },
  water:   { stroke: '#1890FF', bg: '#E6F7FF' },
}

const RING_SIZE = 100

Page({
  data: {
    activeTab: 'goal',
    phaseText: '居家恢复期',
    goalGroups: GOAL_GROUPS_MAP.home,
    ringSize: RING_SIZE,
    dailyProgress: [
      { key: 'cal',     label: '热量',   pct: 0, val: '0', unit: 'kcal/天', target: 1800 },
      { key: 'protein', label: '蛋白质', pct: 0, val: '0', unit: 'g/天',    target: 70   },
      { key: 'water',   label: '饮水量', pct: 0, val: '0', unit: 'mL/天',   target: 1500 },
    ],
    weekDays: [], weekDoneCount: 0,
    meals: MEALS, mealData: {}, dietDrawer: false,
    currentMealKey: '', currentMeal: { key: '', name: '', icon: '' },
    dietInput: { foods: '', cal: '', protein: '' }, mealLoading: false,
    ocrLoading: false, ocrPhoto: '', ocrSuccess: false, ocrError: '',
    diaryNote: '', submitLoading: false,
    medications: MEDICATIONS, medTips: MED_TIPS,
  },

  onLoad() {
    const phase = storage.getPhase() || 'home'
    const phaseMap = { pre: '术前准备期', inhos: '住院期', post: '出院准备期', home: '居家恢复期' }
    this.setData({
      goalGroups: GOAL_GROUPS_MAP[phase] || GOAL_GROUPS_MAP.home,
      phaseText: phaseMap[phase] || '居家恢复期',
    })
    this._buildWeekBar()
    this._loadMedsStatus()
  },

  onShow() { this._buildWeekBar(); this._loadTodayProgress() },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    if (tab === 'goal') setTimeout(() => this._drawRings(), 80)
  },

  _loadTodayProgress() {
    const patientId = app.globalData.patientId
    if (!patientId) { this._drawRings(); return }
    wx.request({
      url: app.globalData.apiBase + '/patients/' + patientId + '/summary',
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          const d = res.data
          const prog = [
            { key:'cal',     label:'热量',   pct: Math.min(Math.round((d.calories||0)/1800*100),100), val: String(d.calories||0), unit:'kcal/天', target:1800 },
            { key:'protein', label:'蛋白质', pct: Math.min(Math.round((d.protein||0)/70*100),100),    val: String(d.protein||0),  unit:'g/天',    target:70   },
            { key:'water',   label:'饮水量', pct: Math.min(Math.round((d.water||0)/1500*100),100),    val: String(d.water||0),    unit:'mL/天',   target:1500 },
          ]
          this.setData({ dailyProgress: prog })
        }
      },
      complete: () => this._drawRings(),
    })
  },

  _drawRings() {
    const dp = this.data.dailyProgress
    dp.forEach(item => {
      const query = wx.createSelectorQuery()
      query.select('#ring-' + item.key).fields({ node: true, size: true }).exec(res => {
        if (!res[0] || !res[0].node) return
        const canvas = res[0].node
        const dpr = wx.getWindowInfo().pixelRatio
        const size = RING_SIZE * dpr
        canvas.width = size; canvas.height = size
        const ctx = canvas.getContext('2d')
        const cx = size/2, cy = size/2, r = size*0.38, lw = size*0.10
        const colors = RING_COLORS[item.key]
        const pct = item.pct / 100
        ctx.clearRect(0, 0, size, size)
        ctx.beginPath()
        ctx.arc(cx, cy, r, Math.PI*0.75, Math.PI*2.25)
        ctx.strokeStyle = colors.bg; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke()
        if (pct > 0) {
          const startAngle = Math.PI*0.75
          ctx.beginPath()
          ctx.arc(cx, cy, r, startAngle, startAngle + Math.PI*1.5*pct)
          ctx.strokeStyle = colors.stroke; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke()
        }
      })
    })
  },

  onRingTap() {},

  _buildWeekBar() {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const cache = (storage.getDietRecords ? storage.getDietRecords() : []) || []
    const wd = ['日','一','二','三','四','五','六']
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i)
      const dStr = d.toISOString().slice(0, 10)
      days.push({ date: dStr, dayNum: d.getDate(), label: wd[d.getDay()], done: cache.some(r => r.date === dStr), isToday: dStr === todayStr })
    }
    this.setData({ weekDays: days, weekDoneCount: days.filter(d => d.done).length })
  },

  onOpenDiet(e) {
    const key = e.currentTarget.dataset.key
    const meal = MEALS.find(m => m.key === key)
    const prev = { foods: this.data.mealData[key+'_foods']||'', cal: this.data.mealData[key+'_cal']||'', protein: this.data.mealData[key+'_protein']||'' }
    this.setData({ dietDrawer: true, currentMealKey: key, currentMeal: meal, dietInput: prev, ocrPhoto: '', ocrLoading: false, ocrSuccess: false, ocrError: '' })
  },
  onCloseDiet() { this.setData({ dietDrawer: false }) },

  onChoosePhoto(e) {
    const src = e.currentTarget.dataset.src  // 'camera' | 'album'
    const self = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [src],
      success(res) {
        const filePath = res.tempFiles[0].tempFilePath
        self.setData({ ocrPhoto: filePath, ocrLoading: false, ocrSuccess: false, ocrError: '' })
        self._doOcrRecognize(filePath)
      },
      fail() { wx.showToast({ title: '选择图片失败', icon: 'none' }) },
    })
  },

  _doOcrRecognize(filePath) {
    this.setData({ ocrLoading: true, ocrSuccess: false, ocrError: '' })
    const self = this
    wx.uploadFile({
      url: app.globalData.apiBase + '/diet/ocr-food',
      filePath,
      name: 'image',
      success(res) {
        try {
          const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
          if (data.foods) {
            self.setData({
              'dietInput.foods': data.foods,
              'dietInput.cal': data.calories_estimate ? String(data.calories_estimate) : self.data.dietInput.cal,
              'dietInput.protein': data.protein_estimate ? String(data.protein_estimate) : self.data.dietInput.protein,
              ocrSuccess: true, ocrError: '',
            })
          } else {
            self.setData({ ocrError: data.error || '识别失败，请重试', ocrSuccess: false })
          }
        } catch {
          self.setData({ ocrError: '识别失败，请重试', ocrSuccess: false })
        }
      },
      fail() { self.setData({ ocrError: '网络错误，请重试', ocrSuccess: false }) },
      complete() { self.setData({ ocrLoading: false }) },
    })
  },

  onRetryOcr() {
    const filePath = this.data.ocrPhoto
    if (filePath) this._doOcrRecognize(filePath)
  },
  onDietInput(e) { this.setData({ ['dietInput.' + e.currentTarget.dataset.field]: e.detail.value }) },

  onSubmitMeal() {
    const patientId = app.globalData.patientId
    if (!patientId) { wx.showToast({ title: '请先完善个人信息', icon: 'none' }); return }
    const { currentMealKey, dietInput } = this.data
    if (!dietInput.foods.trim()) { wx.showToast({ title: '请填写食物内容', icon: 'none' }); return }
    this.setData({ mealLoading: true })
    wx.request({
      url: app.globalData.apiBase + '/diet/records',
      method: 'POST',
      data: { patient_id: patientId, date: new Date().toISOString().slice(0,10), meal_type: currentMealKey, foods: dietInput.foods, calories: dietInput.cal ? parseFloat(dietInput.cal) : null, protein: dietInput.protein ? parseFloat(dietInput.protein) : null },
      success: (res) => {
        if (res.statusCode < 300) {
          const p = currentMealKey
          this.setData({ ['mealData.'+p+'_foods']: dietInput.foods, ['mealData.'+p+'_cal']: dietInput.cal||(res.data.calories?String(res.data.calories):''), ['mealData.'+p+'_protein']: dietInput.protein||'', ['mealData.'+p+'_done']: true, dietDrawer: false })
          wx.showToast({ title: '记录成功 ✓', icon: 'success' })
          if (res.data && res.data.today_totals) this._applyTotals(res.data.today_totals)
        } else { this._saveMealLocal() }
      },
      fail: () => this._saveMealLocal(),
      complete: () => this.setData({ mealLoading: false }),
    })
  },

  _saveMealLocal() {
    const { currentMealKey: p, dietInput } = this.data
    this.setData({ ['mealData.'+p+'_foods']: dietInput.foods, ['mealData.'+p+'_cal']: dietInput.cal, ['mealData.'+p+'_protein']: dietInput.protein, ['mealData.'+p+'_done']: true, dietDrawer: false })
    wx.showToast({ title: '已离线保存', icon: 'none' })
  },

  _applyTotals(totals) {
    const prog = this.data.dailyProgress.map(item => {
      const raw = totals[item.key] || totals[item.key === 'cal' ? 'calories' : item.key] || 0
      return { ...item, pct: Math.min(Math.round(raw/item.target*100),100), val: String(Math.round(raw)) }
    })
    this.setData({ dailyProgress: prog })
    setTimeout(() => this._drawRings(), 50)
  },

  onDiaryNote(e) { this.setData({ diaryNote: e.detail.value }) },

  onSubmitDiary() {
    const patientId = app.globalData.patientId
    if (!patientId) { wx.showToast({ title: '请先完善个人信息', icon: 'none' }); return }
    const totalCal = MEALS.reduce((s,m) => s+(parseFloat(this.data.mealData[m.key+'_cal']||0)||0), 0)
    const totalPro = MEALS.reduce((s,m) => s+(parseFloat(this.data.mealData[m.key+'_protein']||0)||0), 0)
    this.setData({ submitLoading: true })
    const payload = { patient_id: patientId, date: new Date().toISOString().slice(0,10), meals: Object.fromEntries(MEALS.map(m=>[m.key,{foods:this.data.mealData[m.key+'_foods']||'',calories:this.data.mealData[m.key+'_cal']||'',protein:this.data.mealData[m.key+'_protein']||''}])), note: this.data.diaryNote, total_calories: totalCal, total_protein: totalPro }
    wx.request({
      url: app.globalData.apiBase + '/diet/records',
      method: 'POST', data: payload,
      success: (res) => {
        wx.showToast({ title: res.statusCode < 300 ? '打卡成功 🎉' : '已离线保存', icon: res.statusCode < 300 ? 'success' : 'none' })
        try { if (storage.addDietRecord) storage.addDietRecord(payload) } catch {}
        this._buildWeekBar()
      },
      fail: () => { try { if (storage.addDietRecord) storage.addDietRecord(payload) } catch {}; wx.showToast({ title: '离线已保存', icon: 'none' }); this._buildWeekBar() },
      complete: () => this.setData({ submitLoading: false }),
    })
  },

  _loadMedsStatus() {
    const key = 'meds_' + new Date().toISOString().slice(0,10)
    const status = wx.getStorageSync(key) || {}
    this.setData({ medications: this.data.medications.map(m => ({ ...m, taken: !!status[m.name], takenAt: status[m.name]||'' })) })
  },

  onMedTaken(e) {
    const name = e.currentTarget.dataset.name
    const now = new Date()
    const timeStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0')
    const key = 'meds_' + now.toISOString().slice(0,10)
    const status = wx.getStorageSync(key) || {}
    status[name] = timeStr
    wx.setStorageSync(key, status)
    this.setData({ medications: this.data.medications.map(m => m.name===name ? {...m,taken:true,takenAt:timeStr} : m) })
    wx.showToast({ title: '已标记服药 ✓', icon: 'success' })
  },
})
