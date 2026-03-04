// utils/api.js — API 请求封装

const app = getApp()

/**
 * 通用 API 请求
 */
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', data, showLoading = false } = options
    if (showLoading) wx.showLoading({ title: '加载中...', mask: true })

    wx.request({
      url: `${app.globalData.apiBase}${url}`,
      method,
      data,
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (showLoading) wx.hideLoading()
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(res)
        }
      },
      fail(err) {
        if (showLoading) wx.hideLoading()
        console.error('[API]', url, err)
        reject(err)
      },
    })
  })
}

// ── 患者相关 ────────────────────────────────────────────────────
const api = {
  // 获取患者信息
  getPatient(patientId) {
    return request(`/patients/${patientId}`)
  },

  // 提交化验指标（手动录入）
  submitLabRecord(patientId, data) {
    return request('/lab', { method: 'POST', data: { patient_id: patientId, ...data } })
  },

  // 获取营养方案
  getNutritionPlan(patientId) {
    return request(`/nutrition/plan/${patientId}`)
  },

  // 提交饮食打卡
  submitDietRecord(data) {
    return request('/diet/records', { method: 'POST', data })
  },

  // 获取饮食打卡记录
  getDietRecords(patientId, params = {}) {
    const query = new URLSearchParams({ patient_id: patientId, ...params }).toString()
    return request(`/diet/records?${query}`)
  },

  // 提交 AI 问答
  askAgent(question, patientId) {
    return request('/agent/query', {
      method: 'POST',
      data: { query: question, patient_id: patientId, triggered_by: 'user' },
    })
  },

  // 提交知情同意
  submitConsent(data) {
    return request('/consent/sign', { method: 'POST', data })
  },

  // 获取历史化验趋势
  getLabHistory(patientId) {
    return request(`/lab/patient/${patientId}`)
  },

  // 食物图片 OCR 识别
  ocrFood(filePath) {
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${app.globalData.apiBase}/diet/ocr-food`,
        filePath,
        name: 'image',
        success(res) {
          try {
            const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
            resolve(data)
          } catch {
            reject(new Error('解析失败'))
          }
        },
        fail: reject,
      })
    })
  },
}

module.exports = api
