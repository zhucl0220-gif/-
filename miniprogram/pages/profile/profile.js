Page({
  data: {
    userInfo: {
      name: '张伟',
      phaseText: '术后早期（0-7天）'
    }
  },
  navTo(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  }
})
