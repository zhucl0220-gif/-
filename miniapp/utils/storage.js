// utils/storage.js — 本地存储工具

const KEYS = {
  CONSENT_DONE:    'consent_done',
  CONSENT_VERSION: 'consent_version',
  CONSENT_TIME:    'consent_time',
  PATIENT_INFO:    'patient_info',
  PATIENT_PHASE:   'patient_phase',
  PATIENT_ID:      'patient_id',
  DIET_RECORDS:    'diet_records_local',
  QA_HISTORY:      'qa_history',
}

const storage = {
  KEYS,

  get(key) {
    try { return wx.getStorageSync(key) } catch { return null }
  },

  set(key, value) {
    try { wx.setStorageSync(key, value) } catch {}
  },

  remove(key) {
    try { wx.removeStorageSync(key) } catch {}
  },

  // 患者信息
  getPatientInfo() { return this.get(KEYS.PATIENT_INFO) || {} },
  setPatientInfo(info) {
    this.set(KEYS.PATIENT_INFO, info)
    const app = getApp()
    app.globalData.patientInfo = info
  },

  // 当前阶段
  getPhase() { return this.get(KEYS.PATIENT_PHASE) || 'pre_surgery' },
  setPhase(phase) {
    this.set(KEYS.PATIENT_PHASE, phase)
    const app = getApp()
    app.globalData.patientPhase = phase
  },

  // 本地饮食记录缓存（离线）
  getDietRecords() { return this.get(KEYS.DIET_RECORDS) || [] },
  addDietRecord(record) {
    const records = this.getDietRecords()
    records.unshift({ ...record, id: Date.now(), created_local: true })
    if (records.length > 200) records.splice(200)
    this.set(KEYS.DIET_RECORDS, records)
  },

  // 问答历史
  getQaHistory() { return this.get(KEYS.QA_HISTORY) || [] },
  addQaRecord(item) {
    const history = this.getQaHistory()
    history.unshift({ ...item, ts: new Date().toISOString() })
    if (history.length > 50) history.splice(50)
    this.set(KEYS.QA_HISTORY, history)
  },
}

module.exports = storage
