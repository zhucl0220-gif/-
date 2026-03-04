// pages/index/index.js
// 首页 Dashboard 逻辑

const app = getApp()

Page({

  data: {
    // ── 用户信息 ──────────────────────────────────────────────
    userInfo: {
      name:   '张建国',
      avatar: '/assets/images/default_avatar.png',
    },
    hasNotification: true,

    // ── 术后天数与阶段 ────────────────────────────────────────
    transplantDate: '2026-02-16',
    postOpDays:     15,
    phaseDay:       8,           // 当前阶段内的第几天
    currentPhase: {
      label: '恢复期',
      tip:   '蛋白质摄入量需达到 1.2–1.5 g/kg/天，辅助伤口愈合。',
    },

    // ── 康复进度（0-100）─────────────────────────────────────
    progressPercent:  45,
    progressAnimate:  false,

    // ── 里程碑节点 ────────────────────────────────────────────
    milestones: [
      { id: 1, label: '术前评估', done: true,  active: false },
      { id: 2, label: 'ICU监护', done: true,  active: false },
      { id: 3, label: '恢复期',  done: false, active: true  },
      { id: 4, label: '康复期',  done: false, active: false },
      { id: 5, label: '长期随访', done: false, active: false },
    ],

    // ── 今日目标 ──────────────────────────────────────────────
    todayGoals: [
      { id: 1, label: '营养筛查', done: false },
      { id: 2, label: '饮食打卡', done: true  },
      { id: 3, label: '上传化验', done: false },
      { id: 4, label: '服药记录', done: true  },
    ],

    // ── 快捷入口：营养筛查 ────────────────────────────────────
    nutritionScreening: {
      done:     false,
      lastTime: '昨日 08:30',
    },

    // ── 快捷入口：化验单 ──────────────────────────────────────
    labResult: {
      hasNew:   true,
      lastTime: '3天前',
    },

    // ── 营养速览数据 ──────────────────────────────────────────
    nutritionStats: [
      {
        id: 1, icon: '🔥', label: '热量',
        value: '1240', unit: 'kcal', target: '1800',
        percent: 69, color: '#FF8C69', bgColor: '#FFF1EC',
      },
      {
        id: 2, icon: '🥩', label: '蛋白质',
        value: '56', unit: 'g', target: '85',
        percent: 66, color: '#4A90E2', bgColor: '#EBF3FF',
      },
      {
        id: 3, icon: '🥑', label: '脂肪',
        value: '38', unit: 'g', target: '60',
        percent: 63, color: '#2ECC71', bgColor: '#EAFAF1',
      },
      {
        id: 4, icon: '🍙', label: '碳水',
        value: '165', unit: 'g', target: '250',
        percent: 66, color: '#9B59B6', bgColor: '#F5EEF8',
      },
      {
        id: 5, icon: '💧', label: '饮水',
        value: '800', unit: 'ml', target: '1500',
        percent: 53, color: '#00C7B2', bgColor: '#E6FAF8',
      },
    ],

    // ── 医生消息 ──────────────────────────────────────────────
    doctorMsg: {
      name:    '李医生',
      role:    '主治营养师',
      avatar:  '/assets/images/doctor_avatar.png',
      content: '您好，今日检验结果中白蛋白偏低（31 g/L），建议适当增加蛋白质摄入，可参考最新营养方案。',
      time:    '09:15',
    },
  },

  // ══════════════════════════════════════════════════════════
  onLoad(options) {
    this._calcPostOpDays()
    this._loadUserInfo()
    this._checkConsentStatus()
  },

  onShow() {
    // 每次页面显示时刷新今日目标和营养数据
    this._refreshTodayData()
  },

  onReady() {
    // 页面渲染完成后触发进度条动画
    setTimeout(() => {
      this.setData({ progressAnimate: true })
    }, 300)
  },

  // ══════════════════════════════════════════════════════════
  // 私有方法
  // ══════════════════════════════════════════════════════════

  /** 计算术后天数 */
  _calcPostOpDays() {
    const transplantDate = this.data.transplantDate
    if (!transplantDate) return
    const transplant = new Date(transplantDate)
    const today      = new Date()
    const diffMs     = today - transplant
    const diffDays   = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays >= 0) {
      this.setData({ postOpDays: diffDays })
    }
  },

  /** 加载用户信息（实际从 app.globalData 或 API 获取） */
  _loadUserInfo() {
    const userInfo = app.globalData?.userInfo
    if (userInfo) {
      this.setData({ userInfo })
    }
  },

  /** 检查知情同意状态，未签署则跳转签署页 */
  _checkConsentStatus() {
    const isUnlocked = app.globalData?.consentUnlocked
    if (isUnlocked === false) {
      wx.navigateTo({ url: '/pages/consent/consent' })
    }
  },

  /** 刷新今日数据（营养速览、目标完成状态） */
  _refreshTodayData() {
    // TODO: 调用后端 API /api/v1/nutrition/today-summary
    // 此处用 mock 数据演示
  },

  // ══════════════════════════════════════════════════════════
  // 事件处理
  // ══════════════════════════════════════════════════════════

  onUserCardTap() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  onNutritionScreeningTap() {
    if (this.data.nutritionScreening.done) {
      wx.navigateTo({ url: '/pages/screening/report' })
    } else {
      wx.navigateTo({ url: '/pages/screening/screening' })
    }
  },

  onUploadLabTap() {
    wx.navigateTo({ url: '/pages/lab/upload' })
  },

  onViewAll() {
    // 暂无独立任务页，跳转到营养方案页
    wx.switchTab({ url: '/pages/nutrition/plan' })
  },

  onViewNutrition() {
    wx.navigateTo({ url: '/pages/nutrition/detail' })
  },

  onDoctorMsgTap() {
    wx.navigateTo({ url: '/pages/messages/messages' })
  },

  // 下拉刷新
  onPullDownRefresh() {
    this._calcPostOpDays()
    this._refreshTodayData()
    wx.stopPullDownRefresh()
  },
})
