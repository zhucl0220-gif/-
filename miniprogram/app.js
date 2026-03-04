// app.js — 小程序全局逻辑
// 负责：登录态管理、全局 globalData、API 基础配置

// 开发环境：指向本机后端（需在开发者工具中勾选"不校验合法域名"）
// 生产环境：替换为实际 HTTPS 域名
const BASE_URL = 'http://127.0.0.1:8000/api/v1'

App({

  globalData: {
    userInfo:        null,
    patientId:       null,
    consentUnlocked: null,   // null=未知, true=已解锁, false=未签署
    baseUrl:         BASE_URL,
  },

  onLaunch(options) {
    this._silentLogin()
  },

  // ── 静默登录（微信 OpenID 获取）──────────────────────────────
  _silentLogin() {
    wx.login({
      success: (loginRes) => {
        this.request({
          url: '/auth/wxlogin',
          method: 'POST',
          data: { code: loginRes.code },
        }).then((res) => {
          if (res.data?.patient_id) {
            this.globalData.patientId       = res.data.patient_id
            this.globalData.userInfo        = res.data.user_info
            this.globalData.consentUnlocked = res.data.consent_unlocked
            wx.setStorageSync('token', res.data.access_token)
          }
        }).catch((e) => {
          console.warn('[App] 登录请求失败，进入访客模式', e)
        })
      },
      fail: (e) => {
        console.warn('[App] wx.login 失败，进入访客模式', e)
      }
    })
  },

  // ── 全局请求封装 ─────────────────────────────────────────────
  request({ url, method = 'GET', data = {} }) {
    const token = wx.getStorageSync('token')
    return new Promise((resolve, reject) => {
      wx.request({
        url:    this.globalData.baseUrl + url,
        method,
        data,
        header: {
          'Content-Type':  'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res)
          } else if (res.statusCode === 401) {
            // Token 过期，重新登录
            this._silentLogin()
            reject(new Error('Unauthorized'))
          } else {
            reject(new Error(res.data?.detail || '请求失败'))
          }
        },
        fail: reject,
      })
    })
  },
})
