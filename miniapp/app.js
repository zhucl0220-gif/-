// app.js — 肝移植营养管理小程序全局入口
// ================================================================
// 存储键常量
const STORAGE_KEY = {
  CONSENT_DONE:    'consent_done',      // 同意书已完成标志
  CONSENT_VERSION: 'consent_version',   // 同意书版本号
  CONSENT_TIME:    'consent_time',      // 签署时间戳
  PATIENT_INFO:    'patient_info',      // 患者基本信息
  PATIENT_PHASE:   'patient_phase',     // 当前移植阶段
  PATIENT_ID:      'patient_id',        // 患者 ID（登录后）
}

// 当前同意书版本（更改此值可触发重新签署）
const CURRENT_CONSENT_VERSION = '2024-v1'

// API 基础地址
const API_BASE = 'http://127.0.0.1:8000/api/v1'

App({
  globalData: {
    consentDone: false,
    patientInfo: null,
    patientPhase: null,
    patientId: null,
    apiBase: API_BASE,
    STORAGE_KEY,
    CURRENT_CONSENT_VERSION,
  },

  onLaunch() {
    // 检查同意书状态
    this._checkConsentStatus()

    // 读取缓存的患者信息
    const patientInfo = wx.getStorageSync(STORAGE_KEY.PATIENT_INFO)
    const patientPhase = wx.getStorageSync(STORAGE_KEY.PATIENT_PHASE)
    const patientId = wx.getStorageSync(STORAGE_KEY.PATIENT_ID)
    if (patientInfo) this.globalData.patientInfo = patientInfo
    if (patientPhase) this.globalData.patientPhase = patientPhase
    if (patientId) this.globalData.patientId = patientId
  },

  onShow() {
    // 每次激活时确保同意书已完成
    this._checkConsentStatus()
  },

  // ── 同意书检查 ──────────────────────────────────────────────
  _checkConsentStatus() {
    const consentDone = wx.getStorageSync(STORAGE_KEY.CONSENT_DONE)
    const consentVersion = wx.getStorageSync(STORAGE_KEY.CONSENT_VERSION)

    const valid = consentDone === true && consentVersion === CURRENT_CONSENT_VERSION
    this.globalData.consentDone = valid

    if (!valid) {
      // 同意书未完成或版本更新，强制跳转到同意书页面
      wx.reLaunch({ url: '/pages/consent/index' })
    }
    return valid
  },

  // ── 标记同意书完成 ─────────────────────────────────────────
  markConsentDone(signatureData) {
    const ts = new Date().toISOString()
    wx.setStorageSync(STORAGE_KEY.CONSENT_DONE, true)
    wx.setStorageSync(STORAGE_KEY.CONSENT_VERSION, CURRENT_CONSENT_VERSION)
    wx.setStorageSync(STORAGE_KEY.CONSENT_TIME, ts)
    this.globalData.consentDone = true

    // 提交到后台
    if (signatureData) {
      wx.request({
        url: `${API_BASE}/consent/sign`,
        method: 'POST',
        data: {
          document_name: '患者端综合知情同意书',
          version: CURRENT_CONSENT_VERSION,
          signature_data: signatureData,
          signed_at: ts,
          device_info: 'WeChat MiniApp',
        },
        fail() {},
      })
    }
  },

  // ── 全局 API 请求封装 ──────────────────────────────────────
  request(options) {
    const { url, method = 'GET', data, success, fail } = options
    const patientId = this.globalData.patientId

    wx.request({
      url: `${API_BASE}${url}`,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...(patientId ? { 'X-Patient-Id': String(patientId) } : {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          success && success(res.data)
        } else {
          fail && fail(res)
        }
      },
      fail(err) {
        console.error('[API Error]', url, err)
        fail && fail(err)
      },
    })
  },
})
