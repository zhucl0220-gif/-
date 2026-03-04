// pages/report/index.js — 打印风报告详情
const app = getApp()
const api = require('../../utils/api')
const storage = require('../../utils/storage')

const PHASE_TEXT = { pre:'术前准备期', inhos:'住院期', post:'出院准备期', home:'居家恢复期' }
const RISK_MAP   = {
  low:    { text:'低风险',  level:'low' },
  medium: { text:'中风险', level:'medium' },
  high:   { text:'高风险', level:'high' },
}

const LAB_REFS = {
  '白蛋白':   { unit:'g/L',   min:35,  max:55  },
  '前白蛋白': { unit:'mg/L',  min:200, max:400 },
  '血红蛋白': { unit:'g/L',   min:110, max:160 },
  'BMI':      { unit:'kg/m²', min:18.5,max:24  },
}

const DIET_PLANS = {
  pre:   '术前阶段重点：高蛋白低钠饮食，每日蛋白质1.2~1.5g/kg，总热量25~30kcal/kg。优先选择：鸡蛋清、鱼肉、豆腐、酸奶。避免酒精、生食、腌制食品。',
  inhos: '住院阶段重点：从流质→半流质→软食逐步过渡，每日蛋白质1.5~2.0g/kg。严格控制液体总量，避免高渗食物引发腹泻。配合营养科制定EN/PN方案。',
  post:  '出院准备阶段：建立规律三餐，每日记录饮食摄入。蛋白质目标1.2~1.5g/kg，充足维生素D和钙补充。学习食物与药物相互作用知识。',
  home:  '居家长期管理：均衡饮食，控盐<5g/日，避免西柚/西柚汁。每日体重监测，每4~8周复查白蛋白和前白蛋白。出现营养指标下滑立即联系营养师。',
}

const SUGGESTIONS_MAP = {
  high: [
    '建议立即与营养师预约面诊，制定个性化强化营养方案',
    '增加口服营养补充剂（ONS）摄入，每日1~2次',
    '提高蛋白质供给至1.5~2.0g/体重kg/日',
    '每周复查前白蛋白，追踪营养改善情况',
    '避免空腹时间超过4小时，每2~3小时进食一次',
  ],
  medium: [
    '调整饮食结构，增加优质蛋白比例',
    '每日保证3次正餐+2次加餐',
    '补充维生素D（1000~2000 IU/日，遵医嘱）',
    '两周内复查白蛋白和体重',
  ],
  low: [
    '保持现有良好饮食习惯',
    '每月1次营养状态自我评估',
    '坚持每日饮食打卡，维持达标率>80%',
  ],
}

Page({
  data: {
    loading: true,
    report: null,
    checkedSuggests: {},
    checkedCount: 0,
  },

  onLoad(options) {
    this._loadReport(options.reportId)
  },

  onToggleSuggest(e) {
    const idx = e.currentTarget.dataset.idx
    const checked = Object.assign({}, this.data.checkedSuggests)
    checked[idx] = !checked[idx]
    const count = Object.values(checked).filter(Boolean).length
    this.setData({ checkedSuggests: checked, checkedCount: count })
  },

  onBack() { wx.navigateBack() },

  _loadReport(reportId) {
    const patientId  = app.globalData.patientId
    const patientInfo = storage.getPatientInfo() || {}
    const phase = storage.getPhase() || 'home'

    api.getNutritionPlan(patientId)
      .then(plan => {
        const riskLevel = plan ? (plan.risk_level || 'low') : 'low'
        const rm = RISK_MAP[riskLevel] || RISK_MAP.low
        api.getLabHistory(patientId)
          .then(data => {
            const records = data && data.records ? data.records : []
            const labItems = Object.entries(LAB_REFS).map(([name, ref]) => {
              const rec = records.find(r => r.indicator_name === name)
              if (!rec) return null
              const val = parseFloat(rec.value)
              // 数值映射到 0-100%（以参考范围扩展20%为全量程）
              const rangeSpan = (ref.max - ref.min)
              const axisMin   = ref.min - rangeSpan * 0.2
              const axisMax   = ref.max + rangeSpan * 0.2
              const axisRange = axisMax - axisMin
              const pct = Math.min(Math.max(((val - axisMin) / axisRange) * 100, 2), 98)
              // 正常区间在条轨上的位置
              const normalLeft  = ((ref.min - axisMin) / axisRange) * 100
              const normalWidth = ((ref.max - ref.min) / axisRange) * 100
              const status = val < ref.min ? 'danger' : val > ref.max ? 'warning' : 'success'
              return {
                name, value: val.toFixed(1), unit: ref.unit,
                pct: Math.round(pct),
                normalLeft: Math.round(normalLeft),
                normalWidth: Math.round(normalWidth),
                status,
                refMin: ref.min, refMax: ref.max,
              }
            }).filter(Boolean)

            const weight = patientInfo.weight
              || (records.find(r => r.indicator_name === '体重') || {}).value
              || null
            const height = patientInfo.height
            const bmi = weight && height
              ? (parseFloat(weight) / Math.pow(parseFloat(height)/100, 2)).toFixed(1)
              : null

            const report = {
              id: reportId,
              date: new Date().toISOString().slice(0, 10),
              patientName: patientInfo.name || '患者',
              phaseText: PHASE_TEXT[phase] || '居家恢复期',
              weight, bmi,
              riskLevel: rm.level, riskText: rm.text,
              nrsScore: plan ? plan.nrs_score : null,
              sgaGrade: plan ? plan.sga_grade : null,
              labItems,
              suggestions: SUGGESTIONS_MAP[riskLevel] || SUGGESTIONS_MAP.low,
              dietPlan: DIET_PLANS[phase] || DIET_PLANS.home,
            }
            this.setData({ report, loading: false })
          })
          .catch(() => this._buildFallbackReport(patientInfo, phase))
      })
      .catch(() => this._buildFallbackReport(patientInfo, phase))
  },

  _buildFallbackReport(info, phase) {
    const report = {
      id: 1,
      date: new Date().toISOString().slice(0,10),
      patientName: info.name || '患者',
      phaseText: PHASE_TEXT[phase] || '居家恢复期',
      weight: info.weight || null, bmi: null,
      riskLevel: 'low', riskText: '低风险',
      nrsScore: null, sgaGrade: null,
      labItems: [],
      suggestions: SUGGESTIONS_MAP.low,
      dietPlan: DIET_PLANS[phase] || DIET_PLANS.home,
    }
    this.setData({ report, loading: false })
  },
})