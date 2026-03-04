// pages/consent/signature.js
// 手写签名页面逻辑
// ══════════════════════════════════════════════════════════════════
// 技术方案：Canvas 2D API（type="2d"，高性能新版接口）
//   - 不使用已废弃的 wx.createCanvasContext()
//   - 使用 wx.createSelectorQuery().select('#signatureCanvas').fields({node,size})
//   - 直接操作 Canvas Node 上的 2D Context
// ══════════════════════════════════════════════════════════════════

const app = getApp()
const API_BASE = 'https://your-api-domain.com/api/v1'  // 与 app.js 保持一致

Page({

  // ── 页面数据 ───────────────────────────────────────────────────
  data: {
    statusBarHeight: 0,

    // Canvas 尺寸（由 JS 测量后写入，保证 px 精确）
    canvasWidth:  0,
    canvasHeight: 0,

    // 签名状态
    isEmpty:  true,     // 画布是否为空（控制提交按钮和水印显示）

    // 笔迹配置
    penSize:  3,        // 当前笔粗（像素，会乘以 DPR）
    penColor: '#1A1A2E',
    penSizes: [
      { size: 2, label: '细' },
      { size: 3, label: '中' },
      { size: 5, label: '粗' },
    ],
    penColors: [
      { color: '#1A1A2E' },   // 深黑（默认）
      { color: '#00347A' },   // 深蓝
      { color: '#B71C1C' },   // 深红（适合正式签名）
    ],

    // 上传状态
    uploading:       false,
    uploadProgress:  0,
  },

  // ── 私有属性（不放 data，不触发视图更新）───────────────────────
  _canvas:   null,   // Canvas Node
  _ctx:      null,   // CanvasRenderingContext2D
  _dpr:      1,      // 设备像素比（devicePixelRatio）
  _painting: false,  // 当前是否正在绘制
  _lastX:    0,
  _lastY:    0,

  // ══════════════════════════════════════════════════════════════
  // 生命周期
  // ══════════════════════════════════════════════════════════════

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight,
    })
    this._dpr = systemInfo.pixelRatio || 1
    this._initCanvas()
  },

  // ══════════════════════════════════════════════════════════════
  // Canvas 初始化
  // ══════════════════════════════════════════════════════════════

  _initCanvas() {
    // 使用 SelectorQuery 获取 Canvas Node（type="2d" 必须用此方式）
    const query = wx.createSelectorQuery()
    query
      .select('#signatureCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          console.error('[Signature] Canvas 节点获取失败')
          return
        }

        const canvas = res[0].node
        const ctx    = canvas.getContext('2d')
        const dpr    = this._dpr

        // 将 CSS 像素换算为物理像素，保证高清屏不模糊
        const cssWidth  = res[0].width
        const cssHeight = Math.round(cssWidth * 0.45)    // 宽高比约 2.2:1

        canvas.width  = cssWidth  * dpr
        canvas.height = cssHeight * dpr
        ctx.scale(dpr, dpr)

        // 填充白底（上传时背景为白色，便于签名识别）
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, cssWidth, cssHeight)

        this._canvas = canvas
        this._ctx    = ctx

        // 通知视图更新画布显示尺寸（CSS 单位 px）
        this.setData({
          canvasWidth:  cssWidth,
          canvasHeight: cssHeight,
        })
      })
  },

  // ══════════════════════════════════════════════════════════════
  // 触摸事件：绘制笔迹
  // ══════════════════════════════════════════════════════════════

  onTouchStart(e) {
    if (!this._ctx) return
    const touch = e.changedTouches[0]
    this._painting = true
    this._lastX    = touch.x
    this._lastY    = touch.y

    const ctx = this._ctx
    ctx.beginPath()
    ctx.moveTo(touch.x, touch.y)

    // 点按时直接画一个实心圆（防止只点触无笔迹）
    ctx.arc(touch.x, touch.y, this.data.penSize / 2, 0, Math.PI * 2)
    ctx.fillStyle = this.data.penColor
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(touch.x, touch.y)

    // 标记非空
    if (this.data.isEmpty) {
      this.setData({ isEmpty: false })
    }
  },

  onTouchMove(e) {
    if (!this._ctx || !this._painting) return

    // 阻止页面滚动（catchtouchmove 已在 wxml 绑定，此处无需额外处理）
    const touch   = e.changedTouches[0]
    const ctx     = this._ctx
    const x       = touch.x
    const y       = touch.y

    // 贝塞尔曲线平滑（通过控制点取中点，使笔迹不锯齿）
    const midX = (this._lastX + x) / 2
    const midY = (this._lastY + y) / 2

    ctx.beginPath()
    ctx.moveTo(this._lastX, this._lastY)
    ctx.quadraticCurveTo(this._lastX, this._lastY, midX, midY)

    ctx.strokeStyle  = this.data.penColor
    ctx.lineWidth    = this.data.penSize
    ctx.lineCap      = 'round'
    ctx.lineJoin     = 'round'
    ctx.stroke()

    this._lastX = x
    this._lastY = y
  },

  onTouchEnd() {
    this._painting = false
  },

  // ══════════════════════════════════════════════════════════════
  // 工具栏：笔粗 / 笔色切换
  // ══════════════════════════════════════════════════════════════

  onPenSizeChange(e) {
    const size = e.currentTarget.dataset.size
    this.setData({ penSize: size })
  },

  onPenColorChange(e) {
    const color = e.currentTarget.dataset.color
    this.setData({ penColor: color })
  },

  // ══════════════════════════════════════════════════════════════
  // 重写：清空画布
  // ══════════════════════════════════════════════════════════════

  onClear() {
    wx.showModal({
      title:     '确认重写',
      content:   '清空后无法恢复，确定重新签名吗？',
      confirmText:    '重写',
      confirmColor:   '#E53935',
      cancelText:     '取消',
      success: (res) => {
        if (res.confirm) {
          this._clearCanvas()
        }
      },
    })
  },

  _clearCanvas() {
    if (!this._ctx) return
    const ctx    = this._ctx
    const width  = this.data.canvasWidth
    const height = this.data.canvasHeight

    ctx.clearRect(0, 0, width, height)
    // 重置白底
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)

    this.setData({ isEmpty: true })
  },

  // ══════════════════════════════════════════════════════════════
  // 提交：导出图片 → 上传后端
  // ══════════════════════════════════════════════════════════════

  onSubmit() {
    if (this.data.isEmpty) {
      wx.showToast({ title: '请先完成手写签名', icon: 'none' })
      return
    }
    if (this.data.uploading) return

    wx.showModal({
      title:       '确认提交签名',
      content:     '提交后将与知情同意书合成 PDF，具有法律效力，请确认签名正确。',
      confirmText: '确认提交',
      cancelText:  '返回修改',
      success: (res) => {
        if (res.confirm) {
          this._exportAndUpload()
        }
      },
    })
  },

  async _exportAndUpload() {
    this.setData({ uploading: true, uploadProgress: 10 })

    try {
      // ── Step 1: 将 Canvas 导出为本地临时文件 ──────────────────
      const tempFilePath = await this._exportCanvasImage()
      this.setData({ uploadProgress: 30 })

      // ── Step 2: 获取患者 ID（从全局或本地存储） ───────────────
      const patientId = app.globalData?.patientId || wx.getStorageSync('patient_id')
      if (!patientId) {
        throw new Error('未获取到患者信息，请重新登录')
      }
      this.setData({ uploadProgress: 45 })

      // ── Step 3: wx.uploadFile 上传到后端签署接口 ──────────────
      const uploadResult = await this._uploadSignature(tempFilePath, patientId)
      this.setData({ uploadProgress: 90 })

      // ── Step 4: 解析结果，更新全局解锁状态 ───────────────────
      const resData = JSON.parse(uploadResult.data)
      if (resData.code !== 201 && resData.code !== 200) {
        throw new Error(resData.message || '上传失败')
      }

      this.setData({ uploadProgress: 100 })

      // 更新全局知情同意状态
      if (app.globalData) {
        app.globalData.consentUnlocked = true
      }

      // 短暂停留后跳转到成功页
      setTimeout(() => {
        this.setData({ uploading: false })
        wx.redirectTo({
          url: `/pages/consent/success?pdf_url=${encodeURIComponent(resData.data?.pdf_url || '')}&signed_at=${encodeURIComponent(resData.data?.signed_at || '')}`,
        })
      }, 600)

    } catch (err) {
      console.error('[Signature] 上传失败：', err)
      this.setData({ uploading: false, uploadProgress: 0 })
      wx.showModal({
        title:        '上传失败',
        content:      err.message || '网络异常，请稍后重试',
        showCancel:   false,
        confirmText:  '我知道了',
        confirmColor: '#00C7B2',
      })
    }
  },

  // ── 导出 Canvas 为临时 PNG 文件 ───────────────────────────────
  _exportCanvasImage() {
    return new Promise((resolve, reject) => {
      if (!this._canvas) {
        reject(new Error('Canvas 未初始化'))
        return
      }
      wx.canvasToTempFilePath(
        {
          canvas:     this._canvas,
          fileType:   'png',
          quality:    1,        // 最高质量（PNG 无损此参数无效）
          success:    (res) => resolve(res.tempFilePath),
          fail:       (err) => reject(new Error(err.errMsg || '导出图片失败')),
        },
        this,   // 必须传入当前 Page 实例（旧版兼容）
      )
    })
  },

  // ── 上传临时文件到后端 /api/v1/consent/sign ───────────────────
  _uploadSignature(tempFilePath, patientId) {
    const token = wx.getStorageSync('token')

    return new Promise((resolve, reject) => {
      const uploadTask = wx.uploadFile({
        // ⚠️ 替换为实际后端地址
        url:      `${API_BASE}/consent/sign`,
        filePath: tempFilePath,
        name:     'signature_image',        // 必须与后端 UploadFile 参数名一致
        formData: {
          patient_id:   patientId,
          consent_type: '营养干预知情同意书',
        },
        header: {
          Authorization: token ? `Bearer ${token}` : '',
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res)
          } else {
            try {
              const body = JSON.parse(res.data)
              reject(new Error(body.detail || `服务器错误 ${res.statusCode}`))
            } catch {
              reject(new Error(`服务器错误 ${res.statusCode}`))
            }
          }
        },
        fail: (err) => {
          reject(new Error(err.errMsg || '网络请求失败'))
        },
      })

      // 监听上传进度，更新进度条（45% → 90% 区间）
      uploadTask.onProgressUpdate((res) => {
        const mapped = 45 + Math.round(res.progress * 0.45)
        this.setData({ uploadProgress: mapped })
      })
    })
  },

  // ══════════════════════════════════════════════════════════════
  // 导航
  // ══════════════════════════════════════════════════════════════

  onBack() {
    if (!this.data.isEmpty) {
      wx.showModal({
        title:     '放弃签名？',
        content:   '当前签名尚未提交，返回后将丢失，确定退出？',
        confirmText:    '放弃',
        confirmColor:   '#E53935',
        cancelText:     '继续签名',
        success: (res) => {
          if (res.confirm) wx.navigateBack()
        },
      })
    } else {
      wx.navigateBack()
    }
  },
})
