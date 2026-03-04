/**
 * LabManagement.jsx — 化验管理
 * ═══════════════════════════════════════════════════════════════
 * 布局：左侧患者选择 + 右侧（上：趋势折线图 / 下：化验明细表）
 *
 * API:
 *   GET /api/v1/patients?page_size=100          → 填充患者下拉
 *   GET /api/v1/lab/{patient_id}/history?limit=6 → 趋势图数据
 * ═══════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import axios from 'axios'
import ReactECharts from 'echarts-for-react'
import {
  Select, Tag, Avatar, Spin, Empty, Table,
  Typography, Tooltip, Button, Badge, Divider, Space,
} from 'antd'
import {
  UserOutlined, ExperimentOutlined, ReloadOutlined,
  AlertOutlined, TrophyOutlined, RiseOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import styles from './LabManagement.module.css'

const { Text, Title } = Typography

// ══════════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════════

const RISK_CONFIG = {
  high:    { color: '#FF4D4F', bg: '#FFF1F0', label: '高风险', icon: <AlertOutlined /> },
  medium:  { color: '#FA8C16', bg: '#FFF7E6', label: '中风险', icon: <ExperimentOutlined /> },
  low:     { color: '#52C41A', bg: '#F6FFED', label: '低风险', icon: <TrophyOutlined /> },
  unknown: { color: '#8C8C8C', bg: '#FAFAFA', label: '未评估', icon: <ExperimentOutlined /> },
}

const PHASE_LABELS = {
  pre_assessment:   '术前评估',
  pre_operation:    '等待手术',
  early_post_op:    '术后早期',
  recovery:         '恢复期',
  rehabilitation:   '康复期',
  long_term_follow: '长期随访',
}

/** 折线图系列配置 */
const SERIES_CONFIG = [
  { key: 'albumin',    name: '白蛋白 (g/L)',   color: '#1677FF', yAxis: 0, normalMin: 35, normalMax: 55 },
  { key: 'prealbumin', name: '前白蛋白 (mg/L)', color: '#36CFC9', yAxis: 1, normalMin: 200, normalMax: 400 },
  { key: 'alt',        name: 'ALT (U/L)',       color: '#FF7A45', yAxis: 2, normalMin: 7,  normalMax: 40  },
  { key: 'ast',        name: 'AST (U/L)',       color: '#9254DE', yAxis: 2, normalMin: 13, normalMax: 35  },
  { key: 'tbil',       name: '总胆红素 (μmol/L)', color: '#FAAD14', yAxis: 3, normalMin: 3.4, normalMax: 17.1 },
  { key: 'creatinine', name: '肌酐 (μmol/L)',  color: '#F759AB', yAxis: 3, normalMin: 44, normalMax: 106 },
  { key: 'hemoglobin', name: '血红蛋白 (g/L)', color: '#52C41A', yAxis: 0, normalMin: 120, normalMax: 160 },
]

/** 默认选中的指标（初始只显示两个，其余可勾选） */
const DEFAULT_VISIBLE = ['albumin', 'prealbumin']

// ══════════════════════════════════════════════════════════════════
// ★ Mock 数据 — 与真实 API 响应结构完全一致，可直接用于前端测试
// ══════════════════════════════════════════════════════════════════
export const MOCK_HISTORY = {
  patient_id: 'mock-patient-001',
  patient_name: '张伟（Mock）',
  history: [
    {
      lab_id: 'lab-001',
      report_date: '2026-01-20',
      report_type: '常规肝功',
      risk_level: 'high',
      metrics: { albumin: 28.2, prealbumin: 110, alt: 120, ast: 95, tbil: 38.0, creatinine: 98, hemoglobin: 102 },
      structured_items: [
        { name: '白蛋白(ALB)',     value: 28.2,  unit: 'g/L',    reference: '35-55',   is_abnormal: true  },
        { name: '前白蛋白(PA)',    value: 110,   unit: 'mg/L',   reference: '200-400', is_abnormal: true  },
        { name: '谷丙转氨酶(ALT)', value: 120,   unit: 'U/L',    reference: '7-40',    is_abnormal: true  },
        { name: '谷草转氨酶(AST)', value: 95,    unit: 'U/L',    reference: '13-35',   is_abnormal: true  },
        { name: '总胆红素(TBIL)',  value: 38.0,  unit: 'μmol/L', reference: '3.4-17.1',is_abnormal: true  },
        { name: '肌酐(Cr)',        value: 98,    unit: 'μmol/L', reference: '44-106',  is_abnormal: false },
        { name: '血红蛋白(HB)',    value: 102,   unit: 'g/L',    reference: '120-160', is_abnormal: true  },
      ],
    },
    {
      lab_id: 'lab-002',
      report_date: '2026-02-05',
      report_type: '常规肝功',
      risk_level: 'high',
      metrics: { albumin: 30.0, prealbumin: 130, alt: 85, ast: 70, tbil: 28.0, creatinine: 102, hemoglobin: 108 },
      structured_items: [
        { name: '白蛋白(ALB)',     value: 30.0,  unit: 'g/L',    reference: '35-55',   is_abnormal: true  },
        { name: '前白蛋白(PA)',    value: 130,   unit: 'mg/L',   reference: '200-400', is_abnormal: true  },
        { name: '谷丙转氨酶(ALT)', value: 85,    unit: 'U/L',    reference: '7-40',    is_abnormal: true  },
        { name: '谷草转氨酶(AST)', value: 70,    unit: 'U/L',    reference: '13-35',   is_abnormal: true  },
        { name: '总胆红素(TBIL)',  value: 28.0,  unit: 'μmol/L', reference: '3.4-17.1',is_abnormal: true  },
        { name: '肌酐(Cr)',        value: 102,   unit: 'μmol/L', reference: '44-106',  is_abnormal: false },
        { name: '血红蛋白(HB)',    value: 108,   unit: 'g/L',    reference: '120-160', is_abnormal: true  },
      ],
    },
    {
      lab_id: 'lab-003',
      report_date: '2026-02-15',
      report_type: '常规肝功',
      risk_level: 'medium',
      metrics: { albumin: 32.2, prealbumin: 155, alt: 60, ast: 48, tbil: 21.0, creatinine: 95, hemoglobin: 109 },
      structured_items: [
        { name: '白蛋白(ALB)',     value: 32.2,  unit: 'g/L',    reference: '35-55',   is_abnormal: true  },
        { name: '前白蛋白(PA)',    value: 155,   unit: 'mg/L',   reference: '200-400', is_abnormal: true  },
        { name: '谷丙转氨酶(ALT)', value: 60,    unit: 'U/L',    reference: '7-40',    is_abnormal: true  },
        { name: '谷草转氨酶(AST)', value: 48,    unit: 'U/L',    reference: '13-35',   is_abnormal: true  },
        { name: '总胆红素(TBIL)',  value: 21.0,  unit: 'μmol/L', reference: '3.4-17.1',is_abnormal: true  },
        { name: '肌酐(Cr)',        value: 95,    unit: 'μmol/L', reference: '44-106',  is_abnormal: false },
        { name: '血红蛋白(HB)',    value: 109,   unit: 'g/L',    reference: '120-160', is_abnormal: true  },
      ],
    },
    {
      lab_id: 'lab-004',
      report_date: '2026-02-28',
      report_type: '常规肝功',
      risk_level: 'medium',
      metrics: { albumin: 33.8, prealbumin: 180, alt: 45, ast: 36, tbil: 16.5, creatinine: 88, hemoglobin: 113 },
      structured_items: [
        { name: '白蛋白(ALB)',     value: 33.8,  unit: 'g/L',    reference: '35-55',   is_abnormal: true  },
        { name: '前白蛋白(PA)',    value: 180,   unit: 'mg/L',   reference: '200-400', is_abnormal: true  },
        { name: '谷丙转氨酶(ALT)', value: 45,    unit: 'U/L',    reference: '7-40',    is_abnormal: true  },
        { name: '谷草转氨酶(AST)', value: 36,    unit: 'U/L',    reference: '13-35',   is_abnormal: true  },
        { name: '总胆红素(TBIL)',  value: 16.5,  unit: 'μmol/L', reference: '3.4-17.1',is_abnormal: false },
        { name: '肌酐(Cr)',        value: 88,    unit: 'μmol/L', reference: '44-106',  is_abnormal: false },
        { name: '血红蛋白(HB)',    value: 113,   unit: 'g/L',    reference: '120-160', is_abnormal: true  },
      ],
    },
    {
      lab_id: 'lab-005',
      report_date: '2026-03-03',
      report_type: '常规肝功',
      risk_level: 'low',
      metrics: { albumin: 36.5, prealbumin: 210, alt: 32, ast: 28, tbil: 12.0, creatinine: 82, hemoglobin: 120 },
      structured_items: [
        { name: '白蛋白(ALB)',     value: 36.5,  unit: 'g/L',    reference: '35-55',   is_abnormal: false },
        { name: '前白蛋白(PA)',    value: 210,   unit: 'mg/L',   reference: '200-400', is_abnormal: false },
        { name: '谷丙转氨酶(ALT)', value: 32,    unit: 'U/L',    reference: '7-40',    is_abnormal: false },
        { name: '谷草转氨酶(AST)', value: 28,    unit: 'U/L',    reference: '13-35',   is_abnormal: false },
        { name: '总胆红素(TBIL)',  value: 12.0,  unit: 'μmol/L', reference: '3.4-17.1',is_abnormal: false },
        { name: '肌酐(Cr)',        value: 82,    unit: 'μmol/L', reference: '44-106',  is_abnormal: false },
        { name: '血红蛋白(HB)',    value: 120,   unit: 'g/L',    reference: '120-160', is_abnormal: false },
      ],
    },
  ],
}

// ══════════════════════════════════════════════════════════════════
// 子组件：ECharts 趋势折线图
// ══════════════════════════════════════════════════════════════════

function LabTrendChart({ history, visibleMetrics, onChartClick }) {
  const dates = history.map(h => h.report_date)

  // 构建 ECharts option
  const option = useMemo(() => {
    const series = SERIES_CONFIG
      .filter(s => visibleMetrics.includes(s.key))
      .map(s => ({
        name: s.name,
        type: 'line',
        smooth: true,
        connectNulls: true,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { color: s.color, width: 2.5 },
        itemStyle: { color: s.color, borderColor: '#fff', borderWidth: 2 },
        label: {
          show: true,
          position: 'top',
          fontSize: 11,
          color: s.color,
          formatter: ({ value }) => value != null ? value : '',
        },
        data: history.map(h => h.metrics[s.key] ?? null),
        // 参考区间标记线
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          lineStyle: { type: 'dashed', color: s.color, opacity: 0.4 },
          data: [
            { yAxis: s.normalMin, name: `${s.name} 下限` },
            { yAxis: s.normalMax, name: `${s.name} 上限` },
          ],
        },
      }))

    return {
      backgroundColor: '#fff',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
        formatter: (params) => {
          const date = params[0]?.axisValue || ''
          const riskItem = history.find(h => h.report_date === date)
          const risk = riskItem ? RISK_CONFIG[riskItem.risk_level] || RISK_CONFIG.unknown : null
          let html = `<div style="font-weight:600;margin-bottom:6px">${date}`
          if (risk) html += ` <span style="color:${risk.color};font-size:12px">● ${risk.label}</span>`
          html += '</div>'
          params.forEach(p => {
            if (p.value != null) {
              html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color}"></span>
                <span style="flex:1;color:#595959">${p.seriesName}</span>
                <strong>${p.value}</strong>
              </div>`
            }
          })
          return html
        },
      },
      legend: {
        top: 8,
        right: 16,
        itemWidth: 20,
        itemHeight: 3,
        textStyle: { fontSize: 12, color: '#595959' },
      },
      grid: { top: 56, right: 20, bottom: 48, left: 20, containLabel: true },
      xAxis: {
        type: 'category',
        data: dates,
        axisTick: { alignWithLabel: true },
        axisLabel: { fontSize: 12, color: '#8C8C8C' },
        axisLine: { lineStyle: { color: '#E8E8E8' } },
      },
      yAxis: [
        { type: 'value', name: 'g/L',    nameTextStyle: { color: '#BFBFBF', fontSize: 11 }, axisLabel: { fontSize: 11, color: '#BFBFBF' }, splitLine: { lineStyle: { color: '#F5F5F5' } } },
        { type: 'value', name: 'mg/L',   nameTextStyle: { color: '#BFBFBF', fontSize: 11 }, axisLabel: { fontSize: 11, color: '#BFBFBF' }, splitLine: { show: false }, position: 'right' },
        { type: 'value', name: 'U/L',    nameTextStyle: { color: '#BFBFBF', fontSize: 11 }, axisLabel: { fontSize: 11, color: '#BFBFBF' }, splitLine: { show: false }, offset: 60, position: 'right' },
        { type: 'value', name: 'μmol/L', nameTextStyle: { color: '#BFBFBF', fontSize: 11 }, axisLabel: { fontSize: 11, color: '#BFBFBF' }, splitLine: { show: false }, offset: 120, position: 'right' },
      ],
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
      ],
      series,
    }
  }, [history, visibleMetrics])

  if (!history.length) return <Empty description="暂无化验数据" style={{ padding: '60px 0' }} />

  return (
    <ReactECharts
      option={option}
      style={{ height: 320, width: '100%' }}
      notMerge
      lazyUpdate
      onEvents={onChartClick ? { click: onChartClick } : undefined}
    />
  )
}

// ══════════════════════════════════════════════════════════════════
// 子组件：化验明细表
// ══════════════════════════════════════════════════════════════════

function LabItemsTable({ lab }) {
  if (!lab) return <Empty description="请在上方图表选择化验日期" style={{ padding: '32px 0' }} />

  const columns = [
    {
      title: '指标',
      dataIndex: 'name',
      width: 180,
      render: (text, row) => (
        <span>
          {text}
          {row.is_abnormal && (
            <Tag color="red" style={{ marginLeft: 6, fontSize: 11, padding: '0 4px', lineHeight: '18px' }}>
              异常
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: '检测值',
      dataIndex: 'value',
      width: 100,
      render: (val, row) => (
        <span style={{ color: row.is_abnormal ? '#FF4D4F' : '#262626', fontWeight: row.is_abnormal ? 600 : 400 }}>
          {val}
        </span>
      ),
    },
    { title: '单位',   dataIndex: 'unit',      width: 90 },
    { title: '参考区间', dataIndex: 'reference', width: 120 },
  ]

  const risk = RISK_CONFIG[lab.risk_level] || RISK_CONFIG.unknown
  const abnormalCount = (lab.structured_items || []).filter(i => i.is_abnormal).length

  return (
    <div>
      {/* 化验单头部信息 */}
      <div className={styles.labDetailHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={styles.labDate}>{lab.report_date}</span>
          <Tag style={{ color: risk.color, background: risk.bg, borderColor: risk.color, borderRadius: 12 }}>
            {risk.icon} {risk.label}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>{lab.report_type}</Text>
        </div>
        {abnormalCount > 0 && (
          <Text type="danger" style={{ fontSize: 12 }}>
            <AlertOutlined /> {abnormalCount} 项异常
          </Text>
        )}
      </div>

      <Table
        dataSource={(lab.structured_items || []).map((item, i) => ({ ...item, key: i }))}
        columns={columns}
        size="small"
        pagination={false}
        rowClassName={row => row.is_abnormal ? styles.abnormalRow : ''}
        scroll={{ y: 260 }}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 主组件：LabManagement
// ══════════════════════════════════════════════════════════════════

export default function LabManagement() {
  // ── 患者列表 ──────────────────────────────────────────────────────
  const [patients,         setPatients]         = useState([])
  const [patientsLoading,  setPatientsLoading]  = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState(null)

  // ── 化验历史 ──────────────────────────────────────────────────────
  const [historyData,    setHistoryData]    = useState(null)   // API 返回的完整 history 对象
  const [historyLoading, setHistoryLoading] = useState(false)
  const [useMock,        setUseMock]        = useState(false)  // 调试开关

  // ── 图表控制 ──────────────────────────────────────────────────────
  const [visibleMetrics, setVisibleMetrics] = useState(DEFAULT_VISIBLE)
  const [selectedLabId,  setSelectedLabId]  = useState(null)   // 点击图表后选中的化验

  // ══ 加载患者列表 ════════════════════════════════════════════════════
  const loadPatients = useCallback(async () => {
    setPatientsLoading(true)
    try {
      const res = await axios.get('/api/v1/patients', { params: { page_size: 100 } })
      const list = res.data.items || []
      setPatients(list)
      if (list.length && !selectedPatientId) {
        setSelectedPatientId(list[0].id)
      }
    } catch {
      setPatients([])
    } finally {
      setPatientsLoading(false)
    }
  }, []) // eslint-disable-line

  useEffect(() => { loadPatients() }, [loadPatients])

  // ══ 加载化验历史 ════════════════════════════════════════════════════
  useEffect(() => {
    if (useMock) {
      setHistoryData(MOCK_HISTORY)
      setSelectedLabId(MOCK_HISTORY.history.at(-1)?.lab_id || null)
      return
    }
    if (!selectedPatientId) return

    setHistoryLoading(true)
    setHistoryData(null)
    axios.get(`/api/v1/lab/${selectedPatientId}/history`, { params: { limit: 6 } })
      .then(res => {
        setHistoryData(res.data)
        setSelectedLabId(res.data.history?.at(-1)?.lab_id || null)
      })
      .catch(() => setHistoryData(null))
      .finally(() => setHistoryLoading(false))
  }, [selectedPatientId, useMock])

  // ── 选中患者信息 ───────────────────────────────────────────────────
  const selectedPatient = patients.find(p => p.id === selectedPatientId)
  const selectedLab     = historyData?.history?.find(h => h.lab_id === selectedLabId) || null
  const history         = historyData?.history || []

  // ── 处理图表点击 ───────────────────────────────────────────────────
  const onChartClick = useCallback((params) => {
    if (params.componentType !== 'series') return
    const date = params.name || history[params.dataIndex]?.report_date
    const lab = history.find(h => h.report_date === date)
    if (lab) setSelectedLabId(lab.lab_id)
  }, [history])

  // ── 指标多选控件 ───────────────────────────────────────────────────
  const MetricCheckboxes = (
    <div className={styles.metricToggles}>
      {SERIES_CONFIG.map(s => (
        <button
          key={s.key}
          className={`${styles.metricToggle} ${visibleMetrics.includes(s.key) ? styles.metricToggleActive : ''}`}
          style={visibleMetrics.includes(s.key)
            ? { borderColor: s.color, color: s.color, background: s.color + '12' }
            : {}}
          onClick={() => setVisibleMetrics(prev =>
            prev.includes(s.key) ? prev.filter(k => k !== s.key) : [...prev, s.key]
          )}
        >
          {s.name}
        </button>
      ))}
    </div>
  )

  // ── 渲染 ────────────────────────────────────────────────────────────
  return (
    <div className={styles.root}>

      {/* ── 左侧：患者选择面板 ─────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTitle}>
          <ExperimentOutlined /> 化验管理
        </div>

        {/* 患者下拉 */}
        <div className={styles.selectorWrap}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 6, display: 'block' }}>选择患者</Text>
          <Select
            showSearch
            loading={patientsLoading}
            value={selectedPatientId}
            onChange={setSelectedPatientId}
            optionFilterProp="label"
            placeholder="搜索或选择患者"
            style={{ width: '100%' }}
            options={patients.map(p => ({
              value: p.id,
              label: `${p.name}  ${p.age ? p.age + '岁' : ''}`,
              patient: p,
            }))}
            optionRender={opt => (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>{opt.data.patient?.name}</span>
                <Space size={4}>
                  {opt.data.patient?.age && <Text type="secondary" style={{ fontSize: 11 }}>{opt.data.patient.age}岁</Text>}
                  <Tag
                    style={{
                      fontSize: 10, padding: '0 4px', lineHeight: '16px',
                      color: RISK_CONFIG[opt.data.patient?.risk_level]?.color || '#8C8C8C',
                      background: RISK_CONFIG[opt.data.patient?.risk_level]?.bg || '#FAFAFA',
                      border: 'none',
                    }}
                  >
                    {RISK_CONFIG[opt.data.patient?.risk_level]?.label || '—'}
                  </Tag>
                </Space>
              </div>
            )}
          />
        </div>

        {/* 患者简要信息 */}
        {selectedPatient && (
          <div className={styles.patientCard}>
            <Avatar
              size={40}
              icon={<UserOutlined />}
              style={{ background: '#E6F4FF', color: '#1677FF', flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedPatient.name}</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {selectedPatient.gender === 'male' ? '男' : '女'} · {selectedPatient.age}岁
              </Text>
              <div style={{ marginTop: 4 }}>
                <Tag color="blue" style={{ fontSize: 11, padding: '0 4px' }}>
                  {PHASE_LABELS[selectedPatient.current_phase] || selectedPatient.current_phase}
                </Tag>
              </div>
            </div>
          </div>
        )}

        {/* 化验日期列表 */}
        <div style={{ marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
            历次化验（点击查看明细）
          </Text>
          {history.length === 0 && !historyLoading && (
            <Empty description="暂无化验记录" style={{ padding: '16px 0' }} />
          )}
          {[...history].reverse().map(lab => {
            const risk = RISK_CONFIG[lab.risk_level] || RISK_CONFIG.unknown
            const isActive = lab.lab_id === selectedLabId
            return (
              <div
                key={lab.lab_id}
                className={`${styles.labDateItem} ${isActive ? styles.labDateItemActive : ''}`}
                onClick={() => setSelectedLabId(lab.lab_id)}
              >
                <span className={styles.labDateText}>{lab.report_date}</span>
                <span
                  className={styles.riskDot}
                  style={{ background: risk.color }}
                  title={risk.label}
                />
              </div>
            )
          })}
        </div>

        {/* Mock 调试开关 */}
        <div className={styles.mockSwitch}>
          <button
            className={`${styles.mockBtn} ${useMock ? styles.mockBtnActive : ''}`}
            onClick={() => setUseMock(v => !v)}
          >
            {useMock ? '🧪 Mock模式（点击切换真实API）' : '📡 真实API（点击用Mock测试）'}
          </button>
        </div>
      </aside>

      {/* ── 右侧：图表 + 明细 ──────────────────────────────────────── */}
      <main className={styles.main}>
        {/* 顶栏 */}
        <div className={styles.mainHeader}>
          <div>
            <span className={styles.mainTitle}>化验趋势分析</span>
            {historyData && (
              <Text type="secondary" style={{ fontSize: 13, marginLeft: 10 }}>
                {historyData.patient_name} · 共 {history.length} 次化验
              </Text>
            )}
          </div>
          <Tooltip title="刷新化验数据">
            <Button
              type="text" size="small" icon={<ReloadOutlined />}
              loading={historyLoading}
              onClick={() => {
                if (useMock) { setHistoryData({ ...MOCK_HISTORY }); return }
                setSelectedPatientId(p => p)   // 触发 useEffect
              }}
            />
          </Tooltip>
        </div>

        {/* 指标选择器 */}
        {MetricCheckboxes}

        {/* 折线图 */}
        <div className={styles.chartCard}>
          <Spin spinning={historyLoading} tip="加载化验数据…">
            <LabTrendChart
              history={history}
              visibleMetrics={visibleMetrics}
              onChartClick={onChartClick}
            />
          </Spin>
        </div>

        {/* 点击图表或日期列表后显示的化验明细 */}
        <div className={styles.tableCard}>
          <div className={styles.sectionTitle}>
            <RiseOutlined style={{ marginRight: 6, color: '#1677FF' }} />
            化验明细
          </div>
          <Divider style={{ margin: '8px 0 12px' }} />
          <Spin spinning={historyLoading}>
            <LabItemsTable lab={selectedLab} />
          </Spin>
        </div>
      </main>
    </div>
  )
}
