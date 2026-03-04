// pages/faq/index.js
const SYMPTOM_DATA = [
  {
    id: 'nausea', icon: '🤢', name: '恶心呕吐', brief: '肝移植术后常见消化道反应',
    category: 'digest', risk: 'medium', riskText: '中危',
    causes:    ['抗排斥药物（他克莫司）刺激胃肠道', '胆道功能未完全恢复', '肝功能尚在恢复期，胆汁分泌减少'],
    diet:      ['少量多餐，每次进食量不超过200ml', '选择清淡易消化食物：稀粥、面条、藕粉', '进食后保持坐位30分钟，避免立即平卧'],
    lifestyle: ['饭后散步10分钟有助消化', '卧床时床头抬高15-30°减少反流', '避免油腻、辛辣、过甜食物'],
    warning:   ['呕吐持续超过24小时无缓解', '呕吐物含血丝或咖啡色液体', '伴发热（>38°C）或腹痛']
  },
  {
    id: 'diarrhea', icon: '💧', name: '腹泻', brief: '免疫抑制药物相关常见症状',
    category: 'digest', risk: 'medium', riskText: '中危',
    causes:    ['他克莫司/霉酚酸酯药物副作用', '肠道菌群失调', '乳糖不耐受（术后暂时性）'],
    diet:      ['采用BRAT饮食：香蕉、米饭、苹果泥、白吐司', '补充电解质：口服补液盐（ORS溶液）', '避免乳制品、高纤维食物暂停2-3天'],
    lifestyle: ['记录大便次数、性状', '保持肛周清洁干燥', '腹部保暖，避免受凉'],
    warning:   ['每日大便次数≥6次', '大便含血或黏液', '伴发热或腹痛持续加重']
  },
  {
    id: 'edema', icon: '🦵', name: '水肿', brief: '低白蛋白血症或肾功能下降所致',
    category: 'kidney', risk: 'high', riskText: '高危',
    causes:    ['血清白蛋白＜30g/L导致胶体渗透压下降', '他克莫司/环孢素引起肾小球滤过率下降', '下腔静脉/门静脉血流尚未完全恢复'],
    diet:      ['严格限盐：每日摄入食盐≤3g', '高蛋白饮食：每日1.0-1.2g/kg体重蛋白质', '限水：每日总入量=前日尿量+500ml'],
    lifestyle: ['休息时抬高双下肢高于心脏水平', '每日同一时间称体重，记录入量与出量', '避免久坐久站，每1小时活动5分钟'],
    warning:   ['一天内体重增加>1kg', '双腿水肿按压凹陷不回弹', '伴气促、端坐呼吸']
  },
  {
    id: 'fatigue', icon: '😴', name: '乏力疲劳', brief: '营养摄入不足或贫血所致',
    category: 'general', risk: 'low', riskText: '低危',
    causes:    ['术后食欲下降导致热量摄入不足', '血红蛋白＜100g/L（贫血）', '睡眠质量差，夜间多梦'],
    diet:      ['保证总热量：每日≥25kcal/kg体重', '补铁食物：猪血、猪肝、菠菜、红枣', '补充B族维生素：全谷物、蛋类、瘦肉'],
    lifestyle: ['白天午睡≤30分钟', '循序渐进恢复活动：床边站立→室内行走→户外散步', '保持规律作息，固定起床时间'],
    warning:   ['乏力持续加重，无法完成日常自理', '头晕眼花、心悸、面色苍白', '嗜睡或意识模糊']
  },
  {
    id: 'fever', icon: '🌡️', name: '发热', brief: '感染或急性排斥反应的预警信号',
    category: 'urgent', risk: 'high', riskText: '高危',
    causes:    ['细菌/真菌感染（免疫力低下时高风险）', '急性T细胞介导的排斥反应', '药物热副作用'],
    diet:      ['发热期间增加饮水至2000-2500ml/天', '清淡流质为主：藕粉、米汤、蜂蜜水', '退热出汗后及时补充电解质'],
    lifestyle: ['每4小时测量体温并记录', '体温<39°C可物理降温：温水湿敷额头', '保持室内通风，穿宽松棉质衣物'],
    warning:   ['体温>38.5°C且持续超过12小时', '伴寒战、剧烈头痛、腰痛', '体温>39°C或退热后再次发热']
  },
  {
    id: 'jaundice', icon: '🟡', name: '黄疸', brief: '胆道并发症或排斥反应的重要体征',
    category: 'urgent', risk: 'high', riskText: '高危',
    causes:    ['胆管狭窄或胆道吻合口漏', '急性/慢性排斥反应损害肝细胞', '缺血性胆道病变'],
    diet:      ['极低脂饮食：每日脂肪摄入＜20g', '严禁酒精、咖啡、浓茶', '增加新鲜蔬菜'],
    lifestyle: ['避免强烈日晒，皮肤瘙痒可用炉甘石洗剂', '保持大便通畅', '避免服用任何非处方中草药'],
    warning:   ['眼白或皮肤明显发黄，进行性加重', '大便呈白陶土色', '小便颜色如浓茶或酱油色']
  },
  {
    id: 'constipation', icon: '🌀', name: '便秘', brief: '阿片类止痛药或活动减少所致',
    category: 'digest', risk: 'low', riskText: '低危',
    causes:    ['术后镇痛药物（吗啡类）减慢肠蠕动', '卧床时间长，缺乏有效活动', '液体摄入不足'],
    diet:      ['增加膳食纤维：燕麦、红薯、芹菜、黑木耳', '每日饮水量≥1500ml，晨起一杯温水', '适量食用火龙果、猕猴桃等润肠水果'],
    lifestyle: ['每日腹部顺时针按摩15分钟', '尽早下床活动，每次步行15分钟', '养成定时如厕习惯'],
    warning:   ['超过3天无大便且腹部膨胀', '排便时剧烈腹痛', '使用开塞露无效']
  },
  {
    id: 'weightloss', icon: '⚖️', name: '体重下降', brief: '蛋白质-热量双重营养不良的标志',
    category: 'nutrition', risk: 'medium', riskText: '中危',
    causes:    ['术后食欲不振导致长期热量摄入不足', '蛋白质分解代谢旺盛（术后应激状态）', '消化吸收功能下降'],
    diet:      ['每日热量目标：基础代谢×1.3-1.5活动因子', '营养密度加强：米饭中拌入蛋清或营养粉', '口服营养补充剂（如安素）'],
    lifestyle: ['每周记录2次体重（晨起排便后空腹）', '饭前散步15分钟适度增加食欲', '营养科复诊间隔不超过2周'],
    warning:   ['1周内体重下降>2kg', '进食后持续腹胀、早饱', '近1个月体重累计下降>5%']
  }
]

Page({
  data: {
    filteredItems: SYMPTOM_DATA,
    keyword: '',
    selectedItem: null,
    openDims: {},
    dims: []
  },

  onLoad() {
    this._selectItem(SYMPTOM_DATA[0])
  },

  _selectItem(item) {
    if (!item) return
    const dims = [
      { key: 'causes',    title: '🔍 可能原因', color: '#00C7B2', items: item.causes },
      { key: 'diet',      title: '🥗 饮食建议', color: '#52C41A', items: item.diet },
      { key: 'lifestyle', title: '🌿 生活方式', color: '#FA8C16', items: item.lifestyle },
      { key: 'warning',   title: '🚨 就医信号', color: '#FF4D4F', items: item.warning }
    ]
    this.setData({ selectedItem: item, dims, openDims: { 0: true } })
  },

  onSearch(e) {
    const kw = e.detail.value.trim()
    this.setData({
      keyword: kw,
      filteredItems: this._filter(kw),
      selectedItem: null,
      openDims: {},
      dims: []
    })
  },

  _filter(kw) {
    if (!kw) return SYMPTOM_DATA
    const k = kw.toLowerCase()
    return SYMPTOM_DATA.filter(s =>
      s.name.includes(k) || s.brief.includes(k) ||
      s.causes.join('').includes(k) || s.diet.join('').includes(k)
    )
  },

  onSelectSymptom(e) {
    const id = e.currentTarget.dataset.id
    this._selectItem(SYMPTOM_DATA.find(s => s.id === id))
  },

  onToggleDim(e) {
    const idx = e.currentTarget.dataset.idx
    const openDims = Object.assign({}, this.data.openDims)
    openDims[idx] = !openDims[idx]
    this.setData({ openDims })
  },

  onCloseDetail() {
    this.setData({ selectedItem: null, openDims: {}, dims: [] })
  }
})