Page({
  data: {
    today: '',
    mealTypes: [
      { label: '早餐', value: 'breakfast', emoji: '🌅', done: true },
      { label: '午餐', value: 'lunch', emoji: '☀️', done: false },
      { label: '晚餐', value: 'dinner', emoji: '🌙', done: false },
      { label: '加餐', value: 'snack', emoji: '🥤', done: false },
    ],
    records: [
      { id: 1, meal_type: '早餐', record_date: '今天', score: 95 },
      { id: 2, meal_type: '午餐', record_date: '昨天', score: 85 },
      { id: 3, meal_type: '晚餐', record_date: '昨天', score: 70 },
    ]
  },
  onLoad() {
    const d = new Date()
    this.setData({ today: `${d.getMonth() + 1}月${d.getDate()}日` })
  },
  recordMeal(e) {
    wx.showToast({ title: `记录${e.currentTarget.dataset.type}`, icon: 'success' })
  }
})
