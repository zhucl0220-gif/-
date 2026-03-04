Page({
  data: {
    plan: {
      title: '肝移植术后恢复期营养方案',
      energy_kcal: 2000,
      protein_g: 100,
      fat_g: 55,
      carb_g: 270,
      meals: [
        { type: '早餐', desc: '小米粥200ml + 蒸鸡蛋1个 + 豆腐脑100g' },
        { type: '午餐', desc: '软米饭150g + 清蒸鲈鱼100g + 炒时蔬150g' },
        { type: '晚餐', desc: '面条150g + 鸡蓉豆腐汤 + 拌黄瓜100g' },
        { type: '加餐', desc: '口服营养补充剂200ml' },
      ],
      restrictions: ['低盐(<3g/天)', '避免生冷', '避免西柚', '避免高钾食物'],
      agent_notes: '注意免疫抑制剂与食物相互作用。以优质蛋白为主，少食多餐，每日蛋白质摄入目标100g。'
    }
  }
})
