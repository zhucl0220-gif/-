Page({
  data: {
    questions: [
      {
        id: 1,
        question: '近3个月体重是否下降？',
        options: [{ label: '否', value: 0 }, { label: '下降1-5kg', value: 1 }, { label: '下降>5kg', value: 2 }],
        selected: null
      },
      {
        id: 2,
        question: '进食量是否减少？',
        options: [{ label: '未减少', value: 0 }, { label: '减少25-50%', value: 1 }, { label: '减少>50%', value: 2 }],
        selected: null
      },
      {
        id: 3,
        question: '近期活动情况？',
        options: [{ label: '正常活动', value: 0 }, { label: '轻度受限', value: 1 }, { label: '卧床为主', value: 2 }],
        selected: null
      },
    ]
  },
  select(e) {
    const { qid, val } = e.currentTarget.dataset
    const questions = this.data.questions.map(q => q.id === qid ? { ...q, selected: val } : q)
    this.setData({ questions })
  },
  submit() {
    wx.navigateTo({ url: '/pages/screening/report' })
  }
})
