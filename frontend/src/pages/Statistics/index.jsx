/**
 * Statistics/index.jsx
 * 统计报表大屏（AD-18 ~ AD-21）
 *
 * 布局：
 *   ┌─────────────────── 页头 + 导出按钮 ───────────────────┐
 *   │  KPI ×4                                               │
 *   ├──────────────────────────────────────────────────────┤
 *   │  [饼图] 患者阶段分布   [环形图] 营养风险等级分布        │
 *   ├──────────────────────────────────────────────────────┤
 *   │  [柱状图/折线图] 近30天 Agent 功能使用趋势（全宽）      │
 *   └──────────────────────────────────────────────────────┘
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Typography, Button, Space, Spin, Tooltip, message,
  Dropdown, Tag, Divider,
} from 'antd'
import {
  BarChartOutlined, DownloadOutlined, ReloadOutlined,
  TeamOutlined, AlertOutlined, CheckCircleOutlined,
  RobotOutlined, CaretDownOutlined,
} from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'
import dayjs from 'dayjs'
import styles from './Statistics.module.css'

const { Title, Text } = Typography
const API = '/api/v1/statistics'

// ── 移植阶段顺序与颜色 ──────────────────────────────────────────────────────
const PHASE_COLORS = [
  '#5470C6', '#91CC75', '#FAC858', '#EE6666',
  '#73C0DE', '#3BA272',
]

// ── 风险等级颜色 ─────────────────────────────────────────────────────────────
const RISK_COLORS = {
  critical: '#FF4D4F',
  high:     '#FA8C16',
  medium:   '#FADB14',
  safe:     '#52C41A',
}

// ── Agent 任务类型颜色 ────────────────────────────────────────────────────────
const TASK_COLORS = {
  lab_analysis:    '#5470C6',
  nutrition_plan:  '#91CC75',
  web_search:      '#FAC858',
  code_execution:  '#EE6666',
  diet_evaluation: '#73C0DE',
  general_qa:      '#3BA272',
}

// ── 导出目标选项 ──────────────────────────────────────────────────────────────
const EXPORT_TARGETS = [
  { key: 'patients',    label: '患者全景数据 (Excel)', icon: '👥' },
  { key: 'lab_results', label: '检验结果汇总 (Excel)', icon: '🧪' },
  { key: 'diet_records', label: '饮食打卡记录 (Excel)', icon: '🥗' },
  { key: 'alerts',      label: '风险预警记录 (Excel)', icon: '⚠️' },
]


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 图表 Option Builders
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildPhaseOption(data) {
  const pieSeries = data.map((d, i) => ({
    name:  d.label,
    value: d.count,
  }))

  return {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}人 ({d}%)',
    },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { fontSize: 12 },
    },
    color: PHASE_COLORS,
    series: [
      {
        name: '患者阶段',
        type: 'pie',
        radius: ['0%', '65%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: true,
        label: {
          show: true,
          formatter: '{b}\n{c}人',
          fontSize: 11,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0,0,0,0.15)',
          },
        },
        data: pieSeries,
      },
    ],
  }
}

function buildRiskOption(data) {
  const donutData = data.map(d => ({
    name:      d.label,
    value:     d.count,
    itemStyle: { color: RISK_COLORS[d.level] || '#666' },
  }))

  return {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}人 ({d}%)',
    },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { fontSize: 12 },
      formatter: (name) => {
        const item = data.find(d => d.label === name)
        return `${name}  ${item ? item.count + '人' : ''}`
      },
    },
    series: [
      {
        name: '风险等级',
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: false,
        padAngle: 3,
        itemStyle: { borderRadius: 6 },
        label: {
          show: true,
          position: 'center',
          formatter: () => {
            const total = data.reduce((s, d) => s + d.count, 0)
            return `{total|${total}}\n{sub|总患者}`
          },
          rich: {
            total: { fontSize: 28, fontWeight: 700, color: '#1A1A1A', lineHeight: 36 },
            sub:   { fontSize: 12, color: '#8C8C8C', lineHeight: 18 },
          },
        },
        emphasis: {
          label: { show: false },
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.1)' },
        },
        data: donutData,
      },
    ],
  }
}

function buildTrendOption(trendData, taskLabels) {
  if (!trendData || trendData.length === 0) {
    return { title: { text: '暂无数据', left: 'center', top: 'center' } }
  }

  const dates = trendData.map(d => d.date.slice(5))  // MM-DD
  const taskTypes = Object.keys(TASK_COLORS)

  const series = taskTypes.map((tt) => ({
    name: taskLabels?.[tt] || tt,
    type: 'bar',
    stack: 'total',
    barMaxWidth: 28,
    itemStyle: { color: TASK_COLORS[tt], borderRadius: tt === taskTypes[taskTypes.length - 1] ? [3, 3, 0, 0] : 0 },
    data: trendData.map(d => d[tt] || 0),
    emphasis: { focus: 'series' },
  }))

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const date = trendData[params[0].dataIndex]?.date || ''
        let html = `<div style="font-weight:600;margin-bottom:6px">${date}</div>`
        params.forEach(p => {
          if (p.value > 0) {
            html += `<div>${p.marker}${p.seriesName}: <b>${p.value}</b> 次</div>`
          }
        })
        const total = params.reduce((s, p) => s + (p.value || 0), 0)
        html += `<div style="margin-top:6px;font-weight:600;color:#1677FF">合计: ${total} 次</div>`
        return html
      },
    },
    legend: {
      top: 0,
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { fontSize: 12 },
      data: taskTypes.map(tt => taskLabels?.[tt] || tt),
    },
    grid: { top: 40, bottom: 40, containLabel: true },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: '#E8E8E8' } },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        color: '#595959',
        interval: 2,
      },
    },
    yAxis: {
      type: 'value',
      name: '调用次数',
      nameTextStyle: { fontSize: 11, color: '#8C8C8C' },
      splitLine: { lineStyle: { color: '#F0F0F0' } },
      axisLabel: { fontSize: 11, color: '#595959' },
      minInterval: 1,
    },
    series,
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      {
        type: 'slider',
        bottom: 0,
        height: 18,
        start: 0,
        end: 100,
        borderColor: 'transparent',
        backgroundColor: '#F0F0F0',
        fillerColor: 'rgba(22,119,255,0.12)',
        handleStyle: { color: '#1677FF' },
        textStyle: { fontSize: 10 },
      },
    ],
  }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KPI 卡片
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function KpiCard({ icon, iconBg, value, label, sub }) {
  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiIcon} style={{ background: iconBg }}>
        {icon}
      </div>
      <div className={styles.kpiBody}>
        <div className={styles.kpiValue}>{value ?? '—'}</div>
        <div className={styles.kpiLabel}>{label}</div>
        {sub && <div className={styles.kpiSub}>{sub}</div>}
      </div>
    </div>
  )
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主页面
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function Statistics() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API}/dashboard`)
      setStats(res.data)
      setLastUpdated(dayjs().format('YYYY-MM-DD HH:mm:ss'))
    } catch (e) {
      message.error('加载统计数据失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  // 触发导出并自动下载
  const handleExport = async (target) => {
    setExporting(true)
    const labelMap = Object.fromEntries(EXPORT_TARGETS.map(t => [t.key, t.label]))
    try {
      const res = await axios.post(`${API}/export`, { target, fmt: 'excel' })
      const { download_url, filename, row_count } = res.data

      // 触发浏览器下载
      const link = document.createElement('a')
      link.href = download_url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      message.success(`${labelMap[target]} 已导出！共 ${row_count} 条记录`)
    } catch (e) {
      const detail = e?.response?.data?.detail || '导出失败，请稍后重试'
      message.error(detail)
    } finally {
      setExporting(false)
    }
  }

  // 导出下拉菜单
  const exportMenuItems = EXPORT_TARGETS.map(t => ({
    key:   t.key,
    label: `${t.icon} ${t.label}`,
    onClick: () => handleExport(t.key),
  }))

  if (loading) {
    return (
      <div className={styles.pageWrapper}>
        <div className={styles.loadingWrapper}>
          <Spin size="large" tip="正在加载统计数据..." />
        </div>
      </div>
    )
  }

  const kpi = stats?.kpi || {}
  const phaseData = stats?.phase_distribution || []
  const riskData  = stats?.risk_distribution  || []
  const trendData = stats?.usage_trend_30d    || []
  const taskLabels = stats?.task_labels       || {}

  return (
    <div className={styles.pageWrapper}>

      {/* ── 页头 ─────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div>
          <Title level={4} className={styles.pageTitle}>
            <BarChartOutlined style={{ marginRight: 8, color: '#1677FF' }} />
            统计报表
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            协和医院肝移植中心 · 数据概览与导出
          </Text>
        </div>

        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchStats}
            loading={loading}
          >
            刷新数据
          </Button>
          <Dropdown
            menu={{ items: exportMenuItems }}
            placement="bottomRight"
            trigger={['click']}
          >
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={exporting}
            >
              导出数据 <CaretDownOutlined />
            </Button>
          </Dropdown>
        </Space>
      </div>

      {/* ── KPI 行 ────────────────────────────────────────────── */}
      <div className={styles.kpiRow}>
        <KpiCard
          icon={<TeamOutlined style={{ color: '#1677FF', fontSize: 24 }} />}
          iconBg="rgba(22, 119, 255, 0.1)"
          value={kpi.total_patients}
          label="在管患者总数"
          sub="全阶段在管"
        />
        <KpiCard
          icon={<AlertOutlined style={{ color: '#FF4D4F', fontSize: 24 }} />}
          iconBg="rgba(255, 77, 79, 0.1)"
          value={kpi.active_alerts}
          label="活跃风险预警"
          sub="待医生处理"
        />
        <KpiCard
          icon={<CheckCircleOutlined style={{ color: '#52C41A', fontSize: 24 }} />}
          iconBg="rgba(82, 196, 26, 0.1)"
          value={kpi.avg_compliance != null ? `${kpi.avg_compliance}分` : '—'}
          label="近30天平均依从性"
          sub="饮食打卡均分"
        />
        <KpiCard
          icon={<RobotOutlined style={{ color: '#722ED1', fontSize: 24 }} />}
          iconBg="rgba(114, 46, 209, 0.1)"
          value={kpi.total_agent_tasks_30d}
          label="近30天 AI 调用次数"
          sub="Agent 任务总量"
        />
      </div>

      {/* ── 图表行（1/2 宽） ─────────────────────────────────── */}
      <div className={styles.chartsRow}>

        {/* 患者阶段分布 — 饼图 */}
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>
            <span style={{ color: '#1677FF' }}>●</span>
            患者阶段分布
          </div>
          <div className={styles.chartSub}>各移植阶段在管患者占比</div>
          {phaseData.length > 0 ? (
            <ReactECharts
              option={buildPhaseOption(phaseData)}
              style={{ height: 280 }}
              notMerge
            />
          ) : (
            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#BFBFBF' }}>
              暂无数据
            </div>
          )}
        </div>

        {/* 风险等级分布 — 环形图 */}
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>
            <span style={{ color: '#FF4D4F' }}>●</span>
            营养风险等级分布
          </div>
          <div className={styles.chartSub}>基于活跃预警推导的风险分层</div>
          {riskData.length > 0 ? (
            <>
              <ReactECharts
                option={buildRiskOption(riskData)}
                style={{ height: 240 }}
                notMerge
              />
              {/* 风险等级图例说明 */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                {riskData.map(d => (
                  <Tag
                    key={d.level}
                    color={RISK_COLORS[d.level]}
                    style={{ borderRadius: 6, padding: '2px 10px' }}
                  >
                    {d.label} {d.count}人
                  </Tag>
                ))}
              </div>
            </>
          ) : (
            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#BFBFBF' }}>
              暂无数据
            </div>
          )}
        </div>
      </div>

      {/* ── 功能使用趋势（全宽） ─────────────────────────────── */}
      <div className={styles.chartFullRow}>
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>
            <span style={{ color: '#722ED1' }}>●</span>
            核心功能使用趋势（近 30 天）
          </div>
          <div className={styles.chartSub}>
            Agent 各功能每日调用次数分布；可拖拽底部滑块缩放时间范围
          </div>
          <ReactECharts
            option={buildTrendOption(trendData, taskLabels)}
            style={{ height: 320 }}
            notMerge
          />
        </div>
      </div>

      {/* ── 数据更新时间 ─────────────────────────────────────── */}
      {lastUpdated && (
        <div className={styles.updateTime}>
          数据更新时间：{lastUpdated}
        </div>
      )}
    </div>
  )
}
