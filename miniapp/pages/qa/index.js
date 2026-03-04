// pages/qa/index.js
const OUT_OF_SCOPE_KEYWORDS = [
  '癌症', '肿瘤', '化疗', '放疗', '心脏病', '糖尿病', '高血压',
  '股票', '天气', '政治', '娱乐', '游戏', '新闻'
]
const QUICK_QUESTIONS = [
  '术后可以吃海鲜吗？',
  '服药期间能喝柚子汁吗？',
  '每天需要喝多少水？',
  '水肿了应该怎么吃？',
  '体重下降怎么补充营养？',
  '发烧了可以吃什么？'
]

Page({
  data: {
    messages: [],
    inputText: '',
    loading: false,
    scrollToId: '',
    quickQuestions: QUICK_QUESTIONS,
    msgCounter: 0
  },

  onLoad() {
    try {
      const history = wx.getStorageSync('qa_history') || []
      if (history.length) {
        // 恢复时 displayContent = content（已完整）
        const msgs = history.map(m => Object.assign({}, m, { displayContent: m.content }))
        this.setData({ messages: msgs, msgCounter: msgs.length })
      }
    } catch (e) {}
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  onSend() {
    const text = this.data.inputText.trim()
    if (!text || this.data.loading) return
    this.setData({ inputText: '' })
    this._doSend(text)
  },

  onQuickQ(e) {
    const text = e.currentTarget.dataset.text
    if (!text || this.data.loading) return
    this._doSend(text)
  },

  _doSend(text) {
    // 添加用户消息
    const userMsg = this._makeMsg('user', text)
    const msgs = [...this.data.messages, userMsg]
    this.setData({ messages: msgs, loading: true })
    this._scrollToBottom()

    // 客户端超范围预检
    if (this._checkOutOfScope(text)) {
      setTimeout(() => {
        const oosMsg = this._makeMsg('ai', '', true)
        const newMsgs = [...this.data.messages, oosMsg]
        this.setData({ messages: newMsgs, loading: false })
        this._scrollToBottom()
        this._saveHistory(newMsgs)
      }, 600)
      return
    }

    const app = getApp()
    const apiBase = app.globalData ? app.globalData.apiBase : 'http://127.0.0.1:8000/api/v1'
    const patientId = app.globalData ? app.globalData.patientId : null

    if (!patientId) {
      // 未建档时给出本地友好提示，不发起 API 请求
      this.setData({ loading: false })
      const tipMsg = this._makeMsg('ai', '您还未完善个人档案，AI 问答功能需要先在「我的」页面完成信息录入。')
      const newMsgs = [...this.data.messages, tipMsg]
      this.setData({ messages: newMsgs })
      this._scrollToBottom()
      return
    }

    wx.request({
      url: apiBase + '/agent/query',
      method: 'POST',
      data: { query: text, patient_id: patientId, triggered_by: 'user' },
      header: { 'Content-Type': 'application/json' },
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        this.setData({ loading: false })
        const d = res.data
        // 判断是否超范围
        if (d && (d.status === 'out_of_scope' || d.blocked === true)) {
          const oosMsg = this._makeMsg('ai', '', true)
          const newMsgs = [...this.data.messages, oosMsg]
          this.setData({ messages: newMsgs })
          this._scrollToBottom()
          this._saveHistory(newMsgs)
          return
        }
        const answer = (d && (d.answer || d.response || d.content)) || '暂时无法回答，请稍后再试。'
        const aiMsg = this._makeMsg('ai', answer)
        const newMsgs = [...this.data.messages, aiMsg]
        this.setData({ messages: newMsgs })
        this._scrollToBottom()
        this._saveHistory(newMsgs)
        // 打字机效果
        this._typewriter(aiMsg.id, answer)
      },
      fail: () => {
        this.setData({ loading: false })
        const errMsg = this._makeMsg('ai', '网络异常，请检查连接后重试。')
        const newMsgs = [...this.data.messages, errMsg]
        this.setData({ messages: newMsgs })
        this._scrollToBottom()
      }
    })
  },

  _typewriter(msgId, fullText) {
    let idx = 0
    const interval = setInterval(() => {
      idx += 2  // 每次显示2个字（中文加速）
      if (idx >= fullText.length) {
        idx = fullText.length
        clearInterval(interval)
      }
      const msgs = this.data.messages.map(m => {
        if (m.id === msgId) return Object.assign({}, m, { displayContent: fullText.slice(0, idx) })
        return m
      })
      this.setData({ messages: msgs })
      this._scrollToBottom()
    }, 40)
  },

  _checkOutOfScope(text) {
    return OUT_OF_SCOPE_KEYWORDS.some(kw => text.includes(kw))
  },

  _makeMsg(role, content, outOfScope = false) {
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
    const counter = this.data.msgCounter + 1
    this.setData({ msgCounter: counter })
    return { id: `msg_${counter}`, role, content, displayContent: '', outOfScope, time }
  },

  _scrollToBottom() {
    setTimeout(() => this.setData({ scrollToId: 'msg_anchor' }), 50)
  },

  _saveHistory(msgs) {
    try {
      // 只保存最近 30 条
      const save = msgs.slice(-30)
      wx.setStorageSync('qa_history', save)
    } catch (e) {}
  }
})