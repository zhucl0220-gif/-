// pages/consent/index.js — 知情同意强制流程 (MP-01 ~ MP-05) · 阿福管家重构版

const CONSENT_DOCS = [
  {
    short: '信息保护',
    title: '个人信息保护声明',
    checkLabel: '我已认真阅读并理解本声明内容，同意上述条款',
    content: `一、信息收集范围
本系统在您使用过程中收集以下信息：
1. 基本个人信息：姓名、性别、出生日期、联系方式；
2. 健康信息：原发疾病、手术日期、体重、身高、BMI；
3. 检验数据：您主动上传的检验单及手动录入的健康指标；
4. 使用行为数据：页面访问记录、功能使用频率。

二、信息使用目的
所收集信息仅用于：
1. 为您提供个性化的营养管理指导服务；
2. 辅助医疗团队了解您的营养状态变化；
3. 生成营养评估报告，供您本人及主治医生查阅；
4. 系统功能改进与医学研究（匿名脱敏后使用）。

三、信息安全保障
1. 我们采用 AES-256 加密传输和存储您的健康数据；
2. 服务器部署于符合国家等级保护三级要求的云平台；
3. 未经您的书面授权，不向任何第三方提供您的可识别个人信息；
4. 数据保留期限为您最后一次使用系统后 10 年。

四、您的权利
您有权随时：
1. 查阅、下载您的个人数据；
2. 要求更正不准确的信息；
3. 申请注销账户并删除个人数据（医疗档案监管期限内除外）；
4. 撤回对数据处理的同意（不影响撤回前的处理合法性）。

五、联系方式
如您对本声明有任何疑问，请联系：
医院信息科 / 患者服务中心
邮箱：privacy@hospital.example.com`,
  },
  {
    short: '数据授权',
    title: '医疗健康数据使用授权',
    checkLabel: '我同意授权本系统处理我的医疗健康数据',
    content: `一、授权目的
您授权协和医院肝移植团队及本营养管理系统使用您的医疗健康数据，用于以下目的：
1. 生成个性化营养评估报告及营养行动方案；
2. 计算营养风险分级（低/中/高风险）；
3. 追踪营养干预效果，优化后续管理方案；
4. 汇总统计分析（去标识化），用于临床科研。

二、授权数据类型
本次授权涵盖以下数据的处理：
1. 您录入的健康指标：体重、白蛋白、前白蛋白、血压等；
2. 您上传的检验单图片及识别结果；
3. 您填写的营养评估量表数据；
4. 您的饮食打卡记录及 AI 问答内容；
5. 系统生成的营养报告及风险评估结果。

三、授权期限
本授权自您签署时起生效，至您主动撤回授权或销户为止。您可在"个人中心 → 数据管理"中随时撤回授权。

四、数据共享范围
1. 您的主治医生及营养科医师可查阅您的全量数据；
2. 经脱敏处理后的数据可用于学术研究；
3. 不向商业机构销售或提供您的个人健康数据。

五、您的知情权
我们承诺，如数据使用目的发生重大变更，将提前以显著方式告知您，并重新获取您的授权。`,
  },
  {
    short: '免责声明',
    title: '健康教育与非诊疗免责声明',
    checkLabel: '我理解并同意此声明，知晓系统内容不构成医疗诊断',
    content: `重要提示：请仔细阅读本声明，这是您之所以能安全使用本系统的重要基础。

一、系统定位
本系统（"肝移植营养管理小程序"）是一款面向肝移植患者的健康教育与营养管理辅助工具，属于非医疗器械类健康管理软件。

二、服务性质声明
1. 本系统提供的所有内容，包括营养建议、饮食方案、风险提示及 AI 问答，均属于健康教育信息，不构成医疗诊断、处方或治疗建议；
2. AI 智能问答功能基于肝移植营养知识库，仅用于科普与教育目的，其回答不能替代医生的临床判断；
3. 系统生成的营养风险分级结果为辅助参考，最终诊疗方案应以主治医生的临床判断为准。

三、使用限制
以下情形请立即联系医生或拨打急救电话，本系统无法为紧急医疗情况提供处置建议：
1. 急性腹痛、发热超过 38.5°C；
2. 移植器官区域疼痛或肿胀；
3. 明显的黄疸、皮肤或眼白变黄；
4. 意识模糊、昏迷倾向；
5. 任何您认为需要立即就医的情况。

四、免责范围
在法律允许的最大范围内，本院及系统运营方对以下情形不承担责任：
1. 因用户未遵医嘱或自行调整治疗方案所产生的不良后果；
2. 因网络中断、设备故障等不可抗力导致的数据丢失；
3. 用户将系统内容用于非个人健康管理目的所产生的纠纷。

五、鼓励与督促
我们鼓励您将系统内容与您的主治医生共同讨论，在专业指导下制定个人化的营养管理计划。`,
  },
]

const app = getApp()

Page({
  data: {
    steps: CONSENT_DOCS,
    currentStep: 0,
    checks: [false, false, false],
    hasSigned: false,
    signTime: '',
    submitting: false,
    signCtx: null,
    signPoints: [],
    isDrawing: false,
    signDataUrl: '',
  },

  onLoad() {
    // MP-04: 已完成者不重复触发
    const done = wx.getStorageSync('consent_done')
    const version = wx.getStorageSync('consent_version')
    if (done === true && version === '2025-v2') {
      wx.switchTab({ url: '/pages/home/index' })
    }
    this.setData({ signTime: this._now() })
  },

  onReady() {
    this._initCanvas()
  },

  _now() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  },

  // ── 滚动到底部 ─────────────────────────────────────────────
  onScrollToBottom() {
    // 滚动到底可选择性自动勾选（这里仅记录，不强制）
  },

  // ── 勾选确认 ───────────────────────────────────────────────
  onToggleCheck() {
    const checks = [...this.data.checks]
    checks[this.data.currentStep] = !checks[this.data.currentStep]
    this.setData({ checks })
  },

  // ── 上一步 ─────────────────────────────────────────────────
  onPrevStep() {
    const s = this.data.currentStep
    if (s > 0) this.setData({ currentStep: s - 1 })
  },

  // ── 下一步 ─────────────────────────────────────────────────
  onNextStep() {
    const s = this.data.currentStep
    if (!this.data.checks[s]) {
      wx.showToast({ title: '请先勾选确认', icon: 'none' })
      return
    }
    this.setData({ currentStep: s + 1 })
    if (s + 1 === 3) {
      setTimeout(() => this._initCanvas(), 300)
    }
  },

  // ── 初始化签名画布 ─────────────────────────────────────────
  _initCanvas() {
    const query = wx.createSelectorQuery().in(this)
    query.select('#signature-canvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0]) return
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getSystemInfoSync().pixelRatio
      canvas.width = res[0].width * dpr
      canvas.height = res[0].height * dpr
      ctx.scale(dpr, dpr)
      ctx.strokeStyle = '#1A1A1A'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      this._canvas = canvas
      this._ctx = ctx
      this._dpr = dpr
      this._canvasWidth = res[0].width
      this._canvasHeight = res[0].height
    })
  },

  // ── 手写签名事件 ───────────────────────────────────────────
  onSignStart(e) {
    this._isDrawing = true
    const { x, y } = e.touches[0]
    this._ctx && this._ctx.beginPath()
    this._lastX = x
    this._lastY = y
  },

  onSignMove(e) {
    if (!this._isDrawing || !this._ctx) return
    const { x, y } = e.touches[0]
    this._ctx.beginPath()
    this._ctx.moveTo(this._lastX, this._lastY)
    this._ctx.lineTo(x, y)
    this._ctx.stroke()
    this._lastX = x
    this._lastY = y
    if (!this.data.hasSigned) this.setData({ hasSigned: true })
  },

  onSignEnd() {
    this._isDrawing = false
  },

  // ── 清空重签 (MP-03) ───────────────────────────────────────
  onClearSign() {
    if (this._ctx && this._canvas) {
      this._ctx.clearRect(0, 0, this._canvasWidth, this._canvasHeight)
    }
    this.setData({ hasSigned: false })
  },

  // ── 提交同意书 ─────────────────────────────────────────────
  onSubmitConsent() {
    if (!this.data.hasSigned) {
      wx.showToast({ title: '请先完成手写签名', icon: 'none' })
      return
    }
    this.setData({ submitting: true })

    // 获取签名图片数据
    if (this._canvas) {
      wx.canvasToTempFilePath({
        canvas: this._canvas,
        success: (res) => {
          this._finishConsent(res.tempFilePath)
        },
        fail: () => {
          this._finishConsent(null)
        },
      })
    } else {
      this._finishConsent(null)
    }
  },

  _finishConsent(signatureFile) {
    const signTime = this._now()
    wx.setStorageSync('consent_done', true)
    wx.setStorageSync('consent_version', '2025-v2')
    wx.setStorageSync('consent_time', signTime)

    // 通知全局
    app.globalData.consentDone = true

    const patientId = app.globalData ? app.globalData.patientId : null

    // MP-05: 优先使用 uploadFile 发送签名图 → /consent/sign（律名 PDF 真实生成）
    if (signatureFile && patientId) {
      wx.uploadFile({
        url: app.globalData.apiBase + '/consent/sign',
        filePath: signatureFile,
        name: 'signature_image',
        formData: {
          patient_id:   patientId,
          consent_type: '肝移植患者营养干预知情同意书',
        },
        success: () => {},
        fail: () => {
          // 上传失败降级：使用 JSON 接口（后端仍会生成纯文本 PDF）
          this._reportConsentJson(patientId, '[signature_captured]')
        },
      })
    } else {
      // 无签名图或无 patientId 时降级到 JSON 接口
      this._reportConsentJson(patientId, signatureFile ? '[signature_captured]' : '[no_signature]')
    }

    this.setData({ submitting: false, currentStep: 4, signTime })
    wx.showToast({ title: '签署成功 ✓', icon: 'success', duration: 1500 })
    setTimeout(() => wx.switchTab({ url: '/pages/home/index' }), 1500)
  },

  // JSON 降级上报（无签名图 / 上传失败 备用）
  _reportConsentJson(patientId, signatureData) {
    wx.request({
      url: app.globalData.apiBase + '/consent/record',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: {
        patient_id:     patientId || null,
        document_name:  '肝移植患者营养干预知情同意书（2025版）',
        version:        '2025-v2',
        status:         'signed',
        signed_at:      new Date().toISOString(),
        device_info:    'WeChat MiniApp',
        signature_data: signatureData,
      },
      fail() {},
    })
  },

  onEnterApp() {
    wx.switchTab({ url: '/pages/home/index' })
  },
})
