Page({
  data: {
    messages: [
      {
        id: 1,
        type: 'ai',
        icon: '🤖',
        title: 'AI营养分析完成',
        content: '您的最新化验已分析完毕，白蛋白偏低，建议增加蛋白质摄入。',
        time: '10分钟前'
      },
      {
        id: 2,
        type: 'notice',
        icon: '📢',
        title: '复查提醒',
        content: '您已术后7天，请按计划前往化验复查肝功能指标。',
        time: '1小时前'
      },
      {
        id: 3,
        type: 'diet',
        icon: '🥗',
        title: '饮食打卡提醒',
        content: '今日午餐还未打卡，记得记录哦！',
        time: '12:00'
      },
    ]
  }
})
