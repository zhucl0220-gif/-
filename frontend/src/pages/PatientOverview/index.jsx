/**
 * PatientOverview.jsx — 患者全景概览
 * ═══════════════════════════════════════════════════════════════
 * 风格：Light Clean（白底 / 细线边框 / 蓝色强调色 #1677FF）
 * 布局：左侧患者列表 + 右侧详情面板（三段：基本信息 / 趋势图 / 智能助手）
 *
 * 依赖：
 *   npm install antd @ant-design/icons dayjs
 *   图表（按需替换占位符）：
 *     方案A  npm install echarts echarts-for-react
 *     方案B  npm install recharts
 * ═══════════════════════════════════════════════════════════════
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import axios from 'axios'
import {
  Input, List, Tag, Avatar, Button, Tooltip, Spin, Empty,
  Divider, Typography, Badge, Select, Space, Tabs, Table, Descriptions,
} from 'antd'
import {
  SearchOutlined, UserOutlined, SendOutlined, RobotOutlined,
  ExperimentOutlined, HeartOutlined, AlertOutlined, ReloadOutlined,
  MoreOutlined, FileTextOutlined, TrophyOutlined,
  CalendarOutlined, ScheduleOutlined, MedicineBoxOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import styles from './PatientOverview.module.css'

const { Text, Title, Paragraph } = Typography
const { Option } = Select

// ══════════════════════════════════════════════════════════════════
// 常量 & 配置
// ══════════════════════════════════════════════════════════════════

/** 风险等级样式映射 */
const RISK_CONFIG = {
  HIGH:   { color: '#FF4D4F', bg: '#FFF1F0', border: '#FFCCC7', label: '高风险', icon: <AlertOutlined /> },
  MEDIUM: { color: '#FA8C16', bg: '#FFF7E6', border: '#FFD591', label: '中风险', icon: <ExperimentOutlined /> },
  LOW:    { color: '#52C41A', bg: '#F6FFED', border: '#B7EB8F', label: '低风险', icon: <TrophyOutlined /> },
}

/** 移植阶段标签 */
const PHASE_LABELS = {
  PRE_ASSESSMENT:   { label: '术前评估', color: 'blue' },
  PRE_OPERATION:    { label: '等待手术', color: 'geekblue' },
  EARLY_POST_OP:    { label: '术后早期', color: 'orange' },
  RECOVERY:         { label: '恢复期',   color: 'gold' },
  REHABILITATION:   { label: '康复期',   color: 'cyan' },
  LONG_TERM_FOLLOW: { label: '长期随访', color: 'green' },
}

/** 化验指标定义（用于趋势图图例） */
const LAB_METRICS = [
  { key: 'albumin',     label: '白蛋白 (g/L)',    color: '#1677FF', normalRange: [35, 55] },
  { key: 'alt',         label: 'ALT (U/L)',        color: '#FF7A45', normalRange: [7, 40]  },
  { key: 'prealbumin',  label: '前白蛋白 (mg/L)',  color: '#36CFC9', normalRange: [200, 400] },
  { key: 'creatinine',  label: '肌酐 (μmol/L)',    color: '#9254DE', normalRange: [44, 106] },
]

// ══════════════════════════════════════════════════════════════════
// API 工具函数
// ══════════════════════════════════════════════════════════════════

/**
 * 将后端 API 返回的患者对象 + 可选 summary 数据
 * 转换为子组件所需的内部格式
 */
function buildLabTrend(recent_labs) {
  if (!recent_labs?.length) {
    return { dates: [], albumin: [], alt: [], prealbumin: [], creatinine: [] }
  }
  // recent_labs 按日期降序，反转为时间升序
  const labs = [...recent_labs].reverse()
  const result = { dates: [], albumin: [], alt: [], prealbumin: [], creatinine: [] }

  labs.forEach(lab => {
    // 截取 "MM-DD"
    result.dates.push(lab.report_date ? lab.report_date.slice(5) : '—')
    const items = lab.structured_items || []

    const findVal = (keywords) => {
      const item = items.find(it => keywords.some(k => (it.name || '').includes(k)))
      return item != null ? Number(item.value) : null
    }

    result.albumin.push(
      findVal(['白蛋白(ALB)', 'ALB']) ??
      items.find(it => (it.name||'').includes('白蛋白') && !(it.name||'').includes('前'))?.value ?? null
    )
    result.alt.push(findVal(['丙氨酸', 'ALT', 'alt']))
    result.prealbumin.push(findVal(['前白蛋白', 'PA']))
    result.creatinine.push(findVal(['肌酐', 'Cr', 'CREA']))
  })
  return result
}

function deriveRiskKey(risk_level) {
  if (risk_level === 'high')   return 'HIGH'
  if (risk_level === 'medium') return 'MEDIUM'
  if (risk_level === 'low')    return 'LOW'
  return 'MEDIUM'
}

/**
 * 将 API 患者数据（+ 可选 summary）规范化为子组件使用的 shape
 */
function normalizePatient(p, summary = null) {
  const phaseKey = (p.current_phase || '').toUpperCase()

  // 计算术后天数
  let postOpDays = null
  if (p.transplant_date) {
    const d = dayjs().diff(dayjs(p.transplant_date), 'day')
    postOpDays = d >= 0 ? d : null
  }

  // 获取风险等级：优先来自 summary 最新化验，其次来自列表接口
  let riskKey = deriveRiskKey(p.risk_level)
  let lastLabDate = '暂无'
  let labTrend = { dates: [], albumin: [], alt: [], prealbumin: [], creatinine: [] }

  if (summary?.recent_labs?.length) {
    const latestLab = summary.recent_labs[0]
    const ar = latestLab.analysis_result || {}
    if (ar.risk_level) riskKey = deriveRiskKey(ar.risk_level)
    lastLabDate = latestLab.report_date?.slice(0, 10) || '暂无'
    labTrend = buildLabTrend(summary.recent_labs)
  }

  return {
    id:               p.id,
    name:             p.name,
    sex:              p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未知',
    age:              p.age,
    risk:             riskKey,
    phase:            phaseKey || 'PRE_ASSESSMENT',
    postOpDays,
    primaryDiagnosis: p.diagnosis || '—',
    weight:           p.weight_kg,
    height:           p.height_cm,
    bmi:              p.bmi,
    bedNo:            '—',
    attendingDoctor:  '—',
    lastLabDate,
    labTrend,
    // 保留原始数据供扩展
    _raw:    p,
    _summary: summary,
  }
}


// ══════════════════════════════════════════════════════════════════
// 子组件：化验趋势图（SVG 折线占位符）
// ══════════════════════════════════════════════════════════════════
// 替换为正式图表：
//   方案A（ECharts）：
//     import ReactECharts from 'echarts-for-react'
//     const option = { xAxis:{data:trend.dates}, series:[{data:trend.albumin,...}] }
//     return <ReactECharts option={option} style={{height:240}} />
//
//   方案B（Recharts）：
//     import {LineChart,Line,XAxis,YAxis,Tooltip,ResponsiveContainer} from 'recharts'
//     const data = trend.dates.map((d,i)=>({date:d,albumin:trend.albumin[i],...}))
//     return <ResponsiveContainer height={240}><LineChart data={data}>...</LineChart></ResponsiveContainer>
// ─────────────────────────────────────────────────────────────────

function LabTrendChart({ patient, activeMetric, onMetricChange }) {
  const { labTrend } = patient

  // 将折线数据归一化到 SVG 坐标系
  function buildPath(values) {
    if (!values?.length) return ''
    const W = 520, H = 160, PAD = { top: 10, right: 10, bottom: 10, left: 10 }
    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top  - PAD.bottom
    const min = Math.min(...values) * 0.9
    const max = Math.max(...values) * 1.1
    const pts = values.map((v, i) => {
      const x = PAD.left + (i / (values.length - 1)) * innerW
      const y = PAD.top  + innerH - ((v - min) / (max - min)) * innerH
      return `${x},${y}`
    })
    return 'M' + pts.join(' L')
  }

  function buildAreaPath(values) {
    const W = 520, H = 160, PAD = { top: 10, right: 10, bottom: 10, left: 10 }
    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top  - PAD.bottom
    const min = Math.min(...values) * 0.9
    const max = Math.max(...values) * 1.1
    const first = PAD.left
    const last  = PAD.left + innerW
    const bottom = PAD.top + innerH
    const pts = values.map((v, i) => {
      const x = PAD.left + (i / (values.length - 1)) * innerW
      const y = PAD.top  + innerH - ((v - min) / (max - min)) * innerH
      return `${x},${y}`
    })
    return `M${first},${bottom} L${pts.join(' L')} L${last},${bottom} Z`
  }

  const metric   = LAB_METRICS.find(m => m.key === activeMetric) || LAB_METRICS[0]
  const values   = labTrend[metric.key] || []
  const linePath = buildPath(values)
  const areaPath = buildAreaPath(values)
  const W = 520, H = 160

  return (
    <div className={styles.chartContainer}>
      {/* 指标选择器 */}
      <div className={styles.chartToolbar}>
        <Space size={6} wrap>
          {LAB_METRICS.map(m => (
            <button
              key={m.key}
              className={`${styles.metricBtn} ${activeMetric === m.key ? styles.metricBtnActive : ''}`}
              style={activeMetric === m.key ? { borderColor: m.color, color: m.color, background: m.color + '12' } : {}}
              onClick={() => onMetricChange(m.key)}
            >
              {m.label}
            </button>
          ))}
        </Space>
        <Tooltip title="接入 ECharts/Recharts 后替换此占位符">
          <span className={styles.chartPlaceholderBadge}>SVG 占位符</span>
        </Tooltip>
      </div>

      {/* SVG 折线图 */}
      <div className={styles.svgWrapper}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className={styles.sparkline}>
          <defs>
            <linearGradient id={`grad-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={metric.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={metric.color} stopOpacity="0"    />
            </linearGradient>
          </defs>
          {/* 参考网格线 */}
          {[0.25, 0.5, 0.75].map(pct => (
            <line
              key={pct}
              x1={10} y1={10 + pct * 140}
              x2={510} y2={10 + pct * 140}
              stroke="#F0F0F0" strokeWidth="1"
            />
          ))}
          {/* 面积渐变 */}
          <path d={areaPath} fill={`url(#grad-${metric.key})`} />
          {/* 折线 */}
          <path
            d={linePath}
            fill="none"
            stroke={metric.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* 数据点 */}
          {values.map((v, i) => {
            const x = 10 + (i / (values.length - 1)) * 500
            const min = Math.min(...values) * 0.9
            const max = Math.max(...values) * 1.1
            const y = 10 + 140 - ((v - min) / (max - min)) * 140
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="4" fill="#fff" stroke={metric.color} strokeWidth="2" />
                <text x={x} y={y - 10} fontSize="11" fill="#8C8C8C" textAnchor="middle">{v}</text>
              </g>
            )
          })}
        </svg>

        {/* X 轴日期 */}
        <div className={styles.xAxis}>
          {labTrend.dates.map((d, i) => (
            <span key={i} className={styles.xLabel}>{d}</span>
          ))}
        </div>
      </div>

      {/* 正常参考区间提示 */}
      <div className={styles.normalRange}>
        参考区间：{metric.normalRange[0]} – {metric.normalRange[1]}
        {' '}{metric.label.match(/\((.+?)\)/)?.[1] || ''}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 子组件：智能助手对话框
// ══════════════════════════════════════════════════════════════════

const QUICK_PROMPTS = [
  '帮我分析最近的白蛋白趋势',
  '评估该患者当前的营养风险等级',
  '根据化验结果推荐营养支持方案',
  '预测术后恢复进展',
]

function AgentChatPanel({ patient }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `您好，我是阿福营养智能助手。已加载 ${patient.name} 的患者档案，请问有什么需要我协助分析的？`,
      ts: dayjs().subtract(1, 'minute').format('HH:mm'),
    },
  ])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const chatEndRef               = useRef(null)

  // 滚动到最新消息
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 切换患者时重置对话
  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `您好，我是阿福营养智能助手。已加载 ${patient.name} 的患者档案，请问有什么需要我协助分析的？`,
      ts: dayjs().format('HH:mm'),
    }])
    setInput('')
  }, [patient.id])

  const sendMessage = useCallback(async (text) => {
    const query = (text || input).trim()
    if (!query || loading) return

    const userMsg = { role: 'user', content: query, ts: dayjs().format('HH:mm') }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      // ══════════════════════════════════════════════════════════
      // ▶ 接入点：调用后端 Agent 接口
      //
      //   POST /api/v1/tools/agent/query
      //   Body: {
      //     patient_id: patient.id,
      //     query:      query,
      //     context: {
      //       lab_trend:   patient.labTrend,
      //       phase:       patient.phase,
      //       risk:        patient.risk,
      //       weight:      patient.weight,
      //       post_op_days: patient.postOpDays,
      //     }
      //   }
      //   Response: { answer: string, tool_calls: [...], thinking_chain: [...] }
      //
      //   示例（取消注释使用）：
      //   const res = await fetch('/api/v1/tools/agent/query', {
      //     method: 'POST',
      //     headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      //     body: JSON.stringify({ patient_id: patient.id, query, context: {...} }),
      //   })
      //   const data = await res.json()
      //   replyContent = data.answer
      // ══════════════════════════════════════════════════════════

      // ── Mock 回复（联调前使用）──────────────────────────────
      await new Promise(r => setTimeout(r, 1200 + Math.random() * 800))
      const mockReplies = {
        '白蛋白': `根据 ${patient.name} 近 4 次化验记录，白蛋白水平呈${
          patient.labTrend.albumin.at(-1) > patient.labTrend.albumin[0] ? '【上升趋势】' : '【下降趋势】'
        }。最新值 ${patient.labTrend.albumin.at(-1)} g/L，${
          patient.labTrend.albumin.at(-1) < 30 ? '⚠️ 低于参考下限 35 g/L，提示营养不良风险较高，建议补充高蛋白营养制剂（1.5–2 g/kg/d）。' :
          patient.labTrend.albumin.at(-1) < 35 ? '接近参考下限，需持续关注。' : '已在正常范围内，继续维持现有营养方案。'
        }`,
        '风险': `综合评估 ${patient.name} 当前风险等级：${RISK_CONFIG[patient.risk].label}。主要依据：①白蛋白 ${patient.labTrend.albumin.at(-1)} g/L，②前白蛋白 ${patient.labTrend.prealbumin.at(-1)} mg/L，③处于${PHASE_LABELS[patient.phase].label}阶段，④BMI ${patient.bmi}。建议每 3 天复查营养相关指标。`,
        '营养': `针对 ${patient.name} 当前情况，推荐营养支持方案：\n1. 热量目标：${Math.round(patient.weight * 30)}–${Math.round(patient.weight * 35)} kcal/天\n2. 蛋白质：${(patient.weight * 1.5).toFixed(0)}–${(patient.weight * 2.0).toFixed(0)} g/天\n3. 优先肠内营养，可选用肝病专用配方（支链氨基酸增强型）\n4. 监测频率：每 3 天测体重，每周复查白蛋白、前白蛋白`,
      }
      const key = Object.keys(mockReplies).find(k => query.includes(k))
      const replyContent = key
        ? mockReplies[key]
        : `已收到您关于「${query}」的提问。[Mock 模式] 实际部署后将调用后端 LangChain Agent，整合 WebSearch 工具和 Python 沙箱进行深度分析，并返回结构化建议。`
      // ── Mock 结束 ────────────────────────────────────────────

      setMessages(prev => [...prev, {
        role:    'assistant',
        content: replyContent,
        ts:      dayjs().format('HH:mm'),
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: `⚠️ 请求失败：${err.message}。请检查网络或稍后重试。`,
        ts:      dayjs().format('HH:mm'),
        isError: true,
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, patient])

  return (
    <div className={styles.chatPanel}>
      {/* 标题栏 */}
      <div className={styles.chatHeader}>
        <RobotOutlined className={styles.chatIcon} />
        <span className={styles.chatTitle}>智能营养助手</span>
        <Badge status="processing" color="#1677FF" text="在线" className={styles.chatBadge} />
      </div>

      {/* 消息列表 */}
      <div className={styles.chatMessages}>
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`${styles.msgRow} ${msg.role === 'user' ? styles.msgRowUser : styles.msgRowAssistant}`}
          >
            {msg.role === 'assistant' && (
              <Avatar
                size={28}
                icon={<RobotOutlined />}
                style={{ background: '#1677FF', flexShrink: 0 }}
              />
            )}
            <div
              className={`${styles.msgBubble} ${
                msg.role === 'user' ? styles.msgBubbleUser : styles.msgBubbleAssistant
              } ${msg.isError ? styles.msgBubbleError : ''}`}
            >
              <pre className={styles.msgText}>{msg.content}</pre>
              <span className={styles.msgTime}>{msg.ts}</span>
            </div>
            {msg.role === 'user' && (
              <Avatar
                size={28}
                icon={<UserOutlined />}
                style={{ background: '#E6F4FF', color: '#1677FF', flexShrink: 0 }}
              />
            )}
          </div>
        ))}

        {loading && (
          <div className={`${styles.msgRow} ${styles.msgRowAssistant}`}>
            <Avatar size={28} icon={<RobotOutlined />} style={{ background: '#1677FF', flexShrink: 0 }} />
            <div className={`${styles.msgBubble} ${styles.msgBubbleAssistant} ${styles.typing}`}>
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* 快捷短语 */}
      <div className={styles.quickPrompts}>
        {QUICK_PROMPTS.map(q => (
          <button key={q} className={styles.quickBtn} onClick={() => sendMessage(q)}>
            {q}
          </button>
        ))}
      </div>

      {/* 输入框 */}
      <div className={styles.chatInputRow}>
        <Input
          className={styles.chatInput}
          placeholder="输入自然语言指令，例如：帮我分析一下他最近的白蛋白趋势…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onPressEnter={() => sendMessage()}
          disabled={loading}
          maxLength={300}
          allowClear
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={() => sendMessage()}
          loading={loading}
          disabled={!input.trim()}
          className={styles.sendBtn}
        >
          发送
        </Button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 子组件：患者基本信息卡片
// ══════════════════════════════════════════════════════════════════

function PatientInfoHeader({ patient }) {
  const risk  = RISK_CONFIG[patient.risk]
  const phase = PHASE_LABELS[patient.phase]

  return (
    <div className={styles.infoHeader}>
      {/* 左：头像 + 姓名 + 标签 */}
      <div className={styles.infoLeft}>
        <Avatar
          size={56}
          icon={<UserOutlined />}
          className={styles.patientAvatar}
          style={{ background: '#E6F4FF', color: '#1677FF' }}
        />
        <div className={styles.infoMeta}>
          <div className={styles.infoNameRow}>
            <Title level={4} style={{ margin: 0, lineHeight: 1.2 }}>{patient.name}</Title>
            {/* 风险等级 Tag */}
            <Tooltip title={`${risk.label}：综合化验结果及临床指标评级`}>
              <Tag
                icon={risk.icon}
                style={{
                  color:       risk.color,
                  background:  risk.bg,
                  borderColor: risk.border,
                  fontWeight:  600,
                  fontSize:    13,
                  padding:     '2px 10px',
                  borderRadius: 20,
                }}
              >
                {risk.label}
              </Tag>
            </Tooltip>
            <Tag color={phase.color} style={{ borderRadius: 20 }}>{phase.label}</Tag>
          </div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {patient.sex} · {patient.age} 岁 · {patient.primaryDiagnosis}
          </Text>
        </div>
      </div>

      {/* 右：关键指标网格 */}
      <div className={styles.infoMetrics}>
        <MetricCell label="床位" value={patient.bedNo} />
        <MetricCell label="主治医师" value={patient.attendingDoctor} />
        <MetricCell
          label="术后天数"
          value={patient.postOpDays != null ? `${patient.postOpDays} 天` : '未手术'}
          highlight={patient.postOpDays != null && patient.postOpDays <= 14}
        />
        <MetricCell
          label="BMI"
          value={patient.bmi}
          highlight={patient.bmi < 18.5 || patient.bmi > 28}
        />
        <MetricCell label="体重" value={`${patient.weight} kg`} />
        <MetricCell label="末次化验" value={patient.lastLabDate} />
      </div>
    </div>
  )
}

function MetricCell({ label, value, highlight }) {
  return (
    <div className={styles.metricCell}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.metricValue} ${highlight ? styles.metricValueAlert : ''}`}>
        {value}
      </span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 子组件：饮食打卡 Tab
// ══════════════════════════════════════════════════════════════════

const MEAL_TYPE_LABELS = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐', other: '其他',
}

function DietTab({ patientId }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (!patientId || fetched) return
    setLoading(true)
    axios.get('/api/v1/diet/records', { params: { patient_id: patientId, page_size: 50 } })
      .then(res => setRecords(res.data.items || []))
      .catch(() => setRecords([]))
      .finally(() => { setLoading(false); setFetched(true) })
  }, [patientId, fetched])

  // 切换患者时重置
  useEffect(() => { setFetched(false); setRecords([]) }, [patientId])

  const columns = [
    {
      title: '日期', dataIndex: 'record_date', width: 110,
      render: v => v ? dayjs(v).format('MM-DD') : '—',
    },
    {
      title: '餐次', dataIndex: 'meal_type', width: 80,
      render: v => <Tag color="blue">{MEAL_TYPE_LABELS[v] || v || '—'}</Tag>,
    },
    {
      title: '饮食内容', dataIndex: 'food_desc',
      render: (v, r) => v || r.description || r.items?.map?.(i => i.name)?.join('、') || '—',
      ellipsis: true,
    },
    {
      title: '估算热量(kcal)', dataIndex: 'energy_kcal', width: 130,
      render: v => v ? <span style={{ color: '#1677FF', fontWeight: 600 }}>{v}</span> : '—',
    },
    {
      title: '蛋白质(g)', dataIndex: 'protein_g', width: 100,
      render: v => v ?? '—',
    },
    {
      title: '依从情况', dataIndex: 'compliance',
      width: 100,
      render: v => {
        const m = { good: { label: '达标', color: 'success' }, partial: { label: '部分', color: 'warning' }, poor: { label: '未达标', color: 'error' } }
        const cfg = m[v]
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : '—'
      },
    },
  ]

  return (
    <Spin spinning={loading}>
      {records.length === 0 && !loading ? (
        <Empty description="暂无饮食打卡记录" style={{ padding: '48px 0' }} />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={records}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: t => `共 ${t} 条` }}
          scroll={{ x: 640 }}
        />
      )}
    </Spin>
  )
}

// ══════════════════════════════════════════════════════════════════
// 子组件：随访记录 Tab
// ══════════════════════════════════════════════════════════════════

function FollowupTab({ patientId }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (!patientId || fetched) return
    setLoading(true)
    axios.get('/api/v1/followup/plans', { params: { patient_id: patientId, page_size: 50 } })
      .then(res => setRecords(res.data.items || []))
      .catch(() => setRecords([]))
      .finally(() => { setLoading(false); setFetched(true) })
  }, [patientId, fetched])

  useEffect(() => { setFetched(false); setRecords([]) }, [patientId])

  const STATUS_FOLLOWUP = {
    planned:   { label: '待执行', color: 'default' },
    completed: { label: '已完成', color: 'success' },
    missed:    { label: '未随访', color: 'error' },
    cancelled: { label: '已取消', color: 'warning' },
  }
  const TYPE_LABELS = {
    phone: '电话随访', clinic: '门诊复查',
    home: '居家自评', wechat: '微信随访',
  }

  const columns = [
    {
      title: '计划日期', dataIndex: 'scheduled_date', width: 110,
      render: v => v ? dayjs(v).format('YYYY-MM-DD') : '—',
    },
    {
      title: '类型', dataIndex: 'follow_up_type', width: 100,
      render: v => TYPE_LABELS[v] || v || '—',
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: v => {
        const cfg = STATUS_FOLLOWUP[v] || { label: v || '—', color: 'default' }
        return <Tag color={cfg.color}>{cfg.label}</Tag>
      },
    },
    {
      title: '执行日期', dataIndex: 'completed_date', width: 110,
      render: v => v ? dayjs(v).format('MM-DD') : '—',
    },
    {
      title: '随访结果/摘要', dataIndex: 'notes',
      render: (v, r) => v || r.summary || r.result_notes || '—',
      ellipsis: true,
    },
    {
      title: '执行人', dataIndex: 'assigned_to', width: 90,
      render: v => v || '—',
    },
  ]

  return (
    <Spin spinning={loading}>
      {records.length === 0 && !loading ? (
        <Empty description="暂无随访记录" style={{ padding: '48px 0' }} />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={records}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: t => `共 ${t} 条` }}
          scroll={{ x: 640 }}
        />
      )}
    </Spin>
  )
}

// ══════════════════════════════════════════════════════════════════
// 子组件：用药记录 Tab
// ══════════════════════════════════════════════════════════════════

function MedicationTab({ patientId }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (!patientId || fetched) return
    setLoading(true)
    axios.get('/api/v1/medication/records', { params: { patient_id: patientId, page_size: 50 } })
      .then(res => setRecords(res.data.items || []))
      .catch(() => setRecords([]))
      .finally(() => { setLoading(false); setFetched(true) })
  }, [patientId, fetched])

  useEffect(() => { setFetched(false); setRecords([]) }, [patientId])

  const columns = [
    {
      title: '日期', dataIndex: 'taken_date', width: 110,
      render: v => v ? dayjs(v).format('MM-DD') : '—',
    },
    { title: '药品名称', dataIndex: 'drug_name', width: 140 },
    { title: '剂量', dataIndex: 'dose', width: 90, render: (v, r) => v ? `${v} ${r.unit || ''}` : '—' },
    { title: '给药途径', dataIndex: 'route', width: 90, render: v => v || '—' },
    {
      title: '服药状态', dataIndex: 'status', width: 90,
      render: v => {
        const m = { taken: { label: '已服', color: 'success' }, missed: { label: '漏服', color: 'error' }, skipped: { label: '跳过', color: 'warning' } }
        const cfg = m[v]
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : (v || '—')
      },
    },
    {
      title: '备注', dataIndex: 'notes', ellipsis: true,
      render: v => v || '—',
    },
  ]

  return (
    <Spin spinning={loading}>
      {records.length === 0 && !loading ? (
        <Empty description="暂无用药记录" style={{ padding: '48px 0' }} />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={records}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: t => `共 ${t} 条` }}
          scroll={{ x: 620 }}
        />
      )}
    </Spin>
  )
}

// ══════════════════════════════════════════════════════════════════
// 主组件：PatientOverview
// ══════════════════════════════════════════════════════════════════

export default function PatientOverview() {
  // ── 原始 API 数据 ─────────────────────────────────────────────
  const [rawPatients,    setRawPatients]    = useState([])
  const [summary,        setSummary]        = useState(null)   // {patient, recent_labs, active_plan, recent_diet}
  const [selectedId,     setSelectedId]     = useState(null)
  const [listLoading,    setListLoading]    = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [listError,      setListError]      = useState(null)

  // ── 过滤条件 ──────────────────────────────────────────────────
  const [search,      setSearch]      = useState('')
  const [riskFilter,  setRiskFilter]  = useState('ALL')
  const [activeMetric, setActiveMetric] = useState('albumin')
  const [activeTab,    setActiveTab]    = useState('overview')

  // 切换患者重置到概览 Tab
  useEffect(() => { setActiveTab('overview') }, [selectedId])

  // ── 获取患者列表 ──────────────────────────────────────────────
  const fetchPatients = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const res = await axios.get('/api/v1/patients', {
        params: { page: 1, page_size: 100 },
      })
      setRawPatients(res.data.items || [])
      // 默认选中第一个
      if (res.data.items?.length && !selectedId) {
        setSelectedId(res.data.items[0].id)
      }
    } catch (err) {
      setListError(err.message || '加载失败')
    } finally {
      setListLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchPatients() }, [fetchPatients])

  // ── 获取选中患者 summary ──────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return
    setSummaryLoading(true)
    setSummary(null)
    axios.get(`/api/v1/patients/${selectedId}/summary`)
      .then(res => setSummary(res.data))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false))
  }, [selectedId])

  // ── 规范化数据 ────────────────────────────────────────────────
  const normalizedList = rawPatients.map(p => normalizePatient(p))

  // 前端过滤（搜索 + 风险等级）
  const filteredPatients = normalizedList.filter(p => {
    const matchSearch = !search ||
      p.name.includes(search) ||
      p.primaryDiagnosis.includes(search) ||
      p.id.toLowerCase().includes(search.toLowerCase())
    const matchRisk = riskFilter === 'ALL' || p.risk === riskFilter
    return matchSearch && matchRisk
  })

  // 选中患者（含 summary 数据）
  const rawSelected = rawPatients.find(p => p.id === selectedId)
  const selectedPatient = rawSelected
    ? normalizePatient(rawSelected, summary)
    : (normalizedList[0] || null)

  // ── 渲染 ──────────────────────────────────────────────────────
  return (
    <div className={styles.root}>
      {/* ── 左侧：患者列表 ─────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        {/* 列表头 */}
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>患者列表</span>
          <Tooltip title="刷新">
            <Button
              type="text" size="small"
              icon={<ReloadOutlined spin={listLoading} />}
              onClick={fetchPatients}
            />
          </Tooltip>
        </div>

        {/* 搜索框 */}
        <div className={styles.searchRow}>
          <Input
            prefix={<SearchOutlined style={{ color: '#BFBFBF' }} />}
            placeholder="姓名 / 患者ID / 诊断"
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            className={styles.searchInput}
          />
        </div>

        {/* 风险筛选 */}
        <div className={styles.filterRow}>
          <Select
            value={riskFilter}
            onChange={setRiskFilter}
            size="small"
            style={{ width: '100%' }}
            variant="filled"
          >
            <Option value="ALL">全部风险</Option>
            <Option value="HIGH">
              <span style={{ color: RISK_CONFIG.HIGH.color }}>● 高风险</span>
            </Option>
            <Option value="MEDIUM">
              <span style={{ color: RISK_CONFIG.MEDIUM.color }}>● 中风险</span>
            </Option>
            <Option value="LOW">
              <span style={{ color: RISK_CONFIG.LOW.color }}>● 低风险</span>
            </Option>
          </Select>
        </div>

        {/* 患者列表 */}
        <Spin spinning={listLoading} tip="加载中…">
          {listError ? (
            <div style={{ padding: '24px 16px', color: '#FF4D4F', fontSize: 13 }}>
              ⚠️ {listError}
              <Button type="link" size="small" onClick={fetchPatients}>重试</Button>
            </div>
          ) : filteredPatients.length === 0 ? (
            <Empty description="暂无匹配患者" style={{ padding: '32px 0' }} />
          ) : (
            <List
              className={styles.patientList}
              dataSource={filteredPatients}
              renderItem={p => {
                const risk  = RISK_CONFIG[p.risk] || RISK_CONFIG.MEDIUM
                const phase = PHASE_LABELS[p.phase] || PHASE_LABELS.PRE_ASSESSMENT
                const isSelected = p.id === selectedId
                return (
                  <List.Item
                    className={`${styles.listItem} ${isSelected ? styles.listItemActive : ''}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <div className={styles.listItemInner}>
                      <div className={styles.listItemTop}>
                        <span className={styles.listItemName}>{p.name}</span>
                        <span
                          className={styles.riskDot}
                          style={{ background: risk.color }}
                          title={risk.label}
                        />
                      </div>
                      <div className={styles.listItemSub}>
                        <span className={styles.listItemId}>{p.age ? `${p.age}岁` : '—'}</span>
                        <Tag color={phase.color} style={{ fontSize: 11, padding: '0 6px', lineHeight: '18px' }}>
                          {phase.label}
                        </Tag>
                      </div>
                      <Text
                        type="secondary"
                        ellipsis
                        style={{ fontSize: 12, display: 'block', marginTop: 2 }}
                      >
                        {p.primaryDiagnosis}
                      </Text>
                    </div>
                  </List.Item>
                )
              }}
            />
          )}
        </Spin>

        {/* 列表底部统计 */}
        <div className={styles.sidebarFooter}>
          共 {filteredPatients.length} 位患者 ·{' '}
          <span style={{ color: RISK_CONFIG.HIGH.color }}>
            高风险 {filteredPatients.filter(p => p.risk === 'HIGH').length}
          </span>
        </div>
      </aside>

      {/* ── 右侧：详情面板 ─────────────────────────────────────── */}
      <main className={styles.detail}>
        {!selectedPatient ? (
          <Empty description="请从左侧选择患者" style={{ marginTop: 80 }} />
        ) : (
          <Spin spinning={summaryLoading} tip="加载患者详情…">
            {/* 常显顶部：患者基本信息 */}
            <section className={styles.detailCard} style={{ marginBottom: 0, borderRadius: '8px 8px 0 0' }}>
              <PatientInfoHeader patient={selectedPatient} />
            </section>

            {/* Tab 切换面板 */}
            <section className={styles.detailCard} style={{ flex: 1, borderRadius: '0 0 8px 8px', paddingTop: 0 }}>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                size="small"
                style={{ marginTop: -4 }}
                items={[
                  {
                    key: 'overview',
                    label: <span><ExperimentOutlined />&nbsp;概览</span>,
                    children: (
                      <div>
                        {/* 化验趋势 */}
                        <div className={styles.sectionHeader} style={{ marginBottom: 8 }}>
                          <ExperimentOutlined className={styles.sectionIcon} />
                          <span className={styles.sectionTitle}>化验趋势图</span>
                          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                            末次：{selectedPatient.lastLabDate}
                          </Text>
                        </div>
                        <Divider style={{ margin: '0 0 16px' }} />
                        {selectedPatient.labTrend.dates.length > 0 ? (
                          <LabTrendChart
                            patient={selectedPatient}
                            activeMetric={activeMetric}
                            onMetricChange={setActiveMetric}
                          />
                        ) : (
                          <Empty description="暂无化验数据" style={{ padding: '24px 0' }} />
                        )}

                        {/* 当前营养方案摘要 */}
                        {summary?.active_plan && (
                          <>
                            <Divider style={{ margin: '16px 0 12px' }} />
                            <div className={styles.sectionHeader} style={{ marginBottom: 8 }}>
                              <HeartOutlined className={styles.sectionIcon} />
                              <span className={styles.sectionTitle}>当前营养方案</span>
                            </div>
                            <div style={{ fontSize: 13, lineHeight: 1.8, padding: '0 4px' }}>
                              {summary.active_plan.plan_content?.title && (
                                <p><strong>方案名称：</strong>{summary.active_plan.plan_content.title}</p>
                              )}
                              {summary.active_plan.plan_content?.energy_kcal && (
                                <p><strong>热量目标：</strong>{summary.active_plan.plan_content.energy_kcal} kcal/天</p>
                              )}
                              {summary.active_plan.plan_content?.protein_g && (
                                <p><strong>蛋白质目标：</strong>{summary.active_plan.plan_content.protein_g} g/天</p>
                              )}
                              {summary.active_plan.plan_content?.notes && (
                                <p><strong>备注：</strong>{summary.active_plan.plan_content.notes}</p>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'diet',
                    label: <span><CalendarOutlined />&nbsp;饮食打卡</span>,
                    children: <DietTab patientId={selectedId} />,
                  },
                  {
                    key: 'followup',
                    label: <span><ScheduleOutlined />&nbsp;随访记录</span>,
                    children: <FollowupTab patientId={selectedId} />,
                  },
                  {
                    key: 'medication',
                    label: <span><MedicineBoxOutlined />&nbsp;用药记录</span>,
                    children: <MedicationTab patientId={selectedId} />,
                  },
                  {
                    key: 'agent',
                    label: <span><RobotOutlined />&nbsp;智能助手</span>,
                    children: <AgentChatPanel patient={selectedPatient} />,
                  },
                ]}
              />
            </section>
          </Spin>
        )}
      </main>
    </div>
  )
}

