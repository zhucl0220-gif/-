/**
 * NutritionAssessment/index.jsx — AD-08 ~ AD-11 营养评估深化页
 * ────────────────────────────────────────────────────────────────────
 * 布局：左侧患者列表 | 右侧三栏 Tabs
 *   Tab 1 量表与报告  ── 各阶段量表历史 + NRS-2002 评分 + PDF 下载
 *   Tab 2 检验单档案  ── 检验记录卡片 + Lightbox 原图预览
 *   Tab 3 指标趋势图  ── ECharts 双 Y 轴折线图（体重 & 白蛋白）
 * ────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'
import dayjs from 'dayjs'
import {
  Layout, Row, Col, List, Avatar, Typography, Tag, Tabs, Table,
  Button, Spin, Empty, Card, Statistic, Badge, Space, Image,
  Modal, Tooltip, Divider, Select, Checkbox, message, Skeleton,
} from 'antd'
import {
  UserOutlined, ExperimentOutlined, LineChartOutlined,
  FileTextOutlined, DownloadOutlined, EyeOutlined, ReloadOutlined,
  CheckCircleOutlined, WarningOutlined, CloseCircleOutlined,
  RobotOutlined, MonitorOutlined, BulbOutlined,
} from '@ant-design/icons'
import styles from './NutritionAssessment.module.css'

const { Sider, Content } = Layout
const { Text, Title, Paragraph } = Typography
const { Option } = Select

const BASE = '/api/v1'

// ── 阶段颜色配置 ──────────────────────────────────────────────────────────────
const PHASE_COLORS = {
  pre_assessment:   'blue',
  pre_operation:    'purple',
  early_post_op:    'red',
  recovery:         'orange',
  rehabilitation:   'cyan',
  long_term_follow: 'green',
}

// ── 风险等级颜色 ──────────────────────────────────────────────────────────────
const RISK_COLORS = {
  '高风险 ⚠️': '#FF4D4F',
  '中风险':    '#FA8C16',
  '低风险':    '#52C41A',
}

// ── 可选趋势指标 ──────────────────────────────────────────────────────────────
const TREND_METRICS_OPTIONS = [
  { label: '体重 (weight)',    value: 'weight'        },
  { label: '白蛋白 (albumin)', value: 'albumin'       },
  { label: '总蛋白',           value: 'total_protein' },
  { label: '前白蛋白',         value: 'prealbumin'    },
  { label: '血红蛋白',         value: 'hemoglobin'    },
]

// ══════════════════════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════════════════════

export default function NutritionAssessment() {
  const [patients,        setPatients]        = useState([])
  const [loadingPatients, setLoadingPatients] = useState(false)
  const [selectedId,      setSelectedId]      = useState(null)

  // ── 三个 Tab 的数据 state ─────────────────────────────────────────────────
  const [history,      setHistory]      = useState(null)
  const [labData,      setLabData]      = useState(null)
  const [trendData,    setTrendData]    = useState(null)

  const [loadingH,  setLoadingH]  = useState(false)
  const [loadingL,  setLoadingL]  = useState(false)
  const [loadingT,  setLoadingT]  = useState(false)

  const [activeTab,     setActiveTab]     = useState('1')
  const [trendMetrics,  setTrendMetrics]  = useState(['weight', 'albumin'])
  const [pdfLoading,    setPdfLoading]    = useState({})         // planId → bool

  // Lightbox 状态
  const [lightboxSrc,   setLightboxSrc]   = useState(null)
  const [lightboxTitle, setLightboxTitle] = useState('')

  // ── 加载患者列表 ──────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingPatients(true)
    axios.get(`${BASE}/patients`, { params: { page_size: 100 } })
      .then(r => setPatients(r.data.items || []))
      .catch(() => message.error('无法加载患者列表'))
      .finally(() => setLoadingPatients(false))
  }, [])

  // ── 选择患者后加载对应数据 ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return
    fetchHistory(selectedId)
    fetchLabImages(selectedId)
    fetchTrends(selectedId, trendMetrics)
  }, [selectedId])     // eslint-disable-line react-hooks/exhaustive-deps

  // ── 趋势指标变化时重拉 ────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedId) fetchTrends(selectedId, trendMetrics)
  }, [trendMetrics])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 数据拉取函数 ──────────────────────────────────────────────────────────
  const fetchHistory = (pid) => {
    setLoadingH(true)
    axios.get(`${BASE}/assessment/${pid}/history`)
      .then(r => setHistory(r.data))
      .catch(() => message.error('无法加载评估历史'))
      .finally(() => setLoadingH(false))
  }

  const fetchLabImages = (pid) => {
    setLoadingL(true)
    axios.get(`${BASE}/assessment/${pid}/lab-images`)
      .then(r => setLabData(r.data))
      .catch(() => message.error('无法加载检验档案'))
      .finally(() => setLoadingL(false))
  }

  const fetchTrends = (pid, metrics) => {
    setLoadingT(true)
    axios.get(`${BASE}/assessment/${pid}/trends`, { params: { metrics } })
      .then(r => setTrendData(r.data))
      .catch(() => message.error('无法加载趋势数据'))
      .finally(() => setLoadingT(false))
  }

  // ── 生成 PDF 报告 ─────────────────────────────────────────────────────────
  const handleGeneratePdf = async (planId) => {
    if (!selectedId) return
    setPdfLoading(prev => ({ ...prev, [planId]: true }))
    try {
      const res = await axios.post(
        `${BASE}/assessment/${selectedId}/report/pdf`,
        { plan_id: planId },
      )
      const { pdf_url, filename } = res.data
      // 打开下载链接
      const link = document.createElement('a')
      link.href = pdf_url
      link.download = filename
      link.click()
      message.success(`报告已生成：${filename}`)
    } catch (err) {
      message.error('PDF 生成失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setPdfLoading(prev => ({ ...prev, [planId]: false }))
    }
  }

  // ── 当前选中患者信息 ──────────────────────────────────────────────────────
  const selectedPatient = patients.find(p => p.id === selectedId)

  return (
    <Layout style={{ height: 'calc(100vh - 56px)', background: '#F5F7FA' }}>
      {/* ── 左侧患者列表 ──────────────────────────────────────────────────── */}
      <Sider
        width={260}
        style={{
          background: '#fff',
          borderRight: '1px solid #EBEBEB',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className={styles.siderHeader}>
          <Text strong style={{ fontSize: 13 }}>患者列表</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>共 {patients.length} 人</Text>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loadingPatients ? (
            <div style={{ padding: 20 }}><Spin /></div>
          ) : (
            <List
              dataSource={patients}
              renderItem={p => (
                <List.Item
                  key={p.id}
                  className={`${styles.patientItem} ${selectedId === p.id ? styles.activePatient : ''}`}
                  onClick={() => setSelectedId(p.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        size={36}
                        style={{
                          background: selectedId === p.id ? '#1677FF' : '#E6F0FF',
                          color: selectedId === p.id ? '#fff' : '#1677FF',
                          fontSize: 14,
                        }}
                      >
                        {p.name?.[0] || '?'}
                      </Avatar>
                    }
                    title={
                      <Text style={{ fontSize: 13, fontWeight: selectedId === p.id ? 600 : 400 }}>
                        {p.name}
                      </Text>
                    }
                    description={
                      <Tag
                        color={PHASE_COLORS[p.current_phase] || 'default'}
                        style={{ fontSize: 11 }}
                      >
                        {p.phase_label || p.current_phase || '--'}
                      </Tag>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </div>
      </Sider>

      {/* ── 右侧详情面板 ───────────────────────────────────────────────────── */}
      <Content style={{ overflow: 'auto', padding: '0 0 24px 0' }}>
        {!selectedId ? (
          <div className={styles.emptyState}>
            <UserOutlined style={{ fontSize: 64, color: '#C0C0C0' }} />
            <Title level={4} style={{ color: '#8C8C8C', marginTop: 16 }}>
              请从左侧选择患者
            </Title>
            <Text type="secondary">选择后可查看营养评估详情、检验档案和趋势图表</Text>
          </div>
        ) : (
          <>
            {/* 患者信息 Banner */}
            <PatientBanner patient={selectedPatient} history={history} />

            {/* 三栏 Tabs */}
            <div style={{ padding: '0 24px' }}>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                size="large"
                items={[
                  {
                    key: '1',
                    label: (
                      <Space>
                        <FileTextOutlined />
                        量表与报告
                      </Space>
                    ),
                    children: (
                      <AssessmentHistoryTab
                        loading={loadingH}
                        data={history}
                        pdfLoading={pdfLoading}
                        onGeneratePdf={handleGeneratePdf}
                      />
                    ),
                  },
                  {
                    key: '2',
                    label: (
                      <Space>
                        <ExperimentOutlined />
                        检验单档案
                        {labData && <Badge count={labData.total} size="small" style={{ background: '#1677FF' }} />}
                      </Space>
                    ),
                    children: (
                      <LabArchiveTab
                        loading={loadingL}
                        data={labData}
                        onPreviewImage={(src, title) => { setLightboxSrc(src); setLightboxTitle(title) }}
                      />
                    ),
                  },
                  {
                    key: '3',
                    label: (
                      <Space>
                        <LineChartOutlined />
                        指标趋势图
                      </Space>
                    ),
                    children: (
                      <TrendChartTab
                        loading={loadingT}
                        data={trendData}
                        metrics={trendMetrics}
                        onMetricsChange={setTrendMetrics}
                        onRefresh={() => fetchTrends(selectedId, trendMetrics)}
                      />
                    ),
                  },
                ]}
              />
            </div>
          </>
        )}
      </Content>

      {/* Lightbox 模态 */}
      <Modal
        open={!!lightboxSrc}
        title={lightboxTitle}
        footer={null}
        onCancel={() => setLightboxSrc(null)}
        width="80vw"
        style={{ top: 20 }}
        centered
      >
        {lightboxSrc && (
          <Image
            src={lightboxSrc}
            alt={lightboxTitle}
            style={{ width: '100%', maxHeight: '75vh', objectFit: 'contain' }}
            preview={false}
          />
        )}
      </Modal>
    </Layout>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// 子组件：患者信息 Banner
// ══════════════════════════════════════════════════════════════════════════════

function PatientBanner({ patient, history }) {
  if (!patient) return null
  const bmi = history?.bmi
  const albumin = null   // 从趋势最新值获取，Banner 仅展示基本信息

  return (
    <div className={styles.banner}>
      <Row gutter={24} align="middle">
        <Col>
          <Avatar size={56} style={{ background: '#1677FF', fontSize: 22 }}>
            {patient.name?.[0] || '?'}
          </Avatar>
        </Col>
        <Col flex="1">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Title level={4} style={{ margin: 0 }}>{patient.name}</Title>
            <Tag color={PHASE_COLORS[patient.current_phase] || 'default'}>
              {patient.phase_label || patient.current_phase || '--'}
            </Tag>
            {patient.gender === 'male' && <Tag color="blue">男</Tag>}
            {patient.gender === 'female' && <Tag color="pink">女</Tag>}
          </div>
          <Space size={24} style={{ marginTop: 6 }} wrap>
            <Text type="secondary" style={{ fontSize: 12 }}>
              移植日期：{patient.transplant_date || '--'}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              身高：{patient.height_cm ? `${patient.height_cm} cm` : '--'}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              体重：{patient.weight_kg ? `${patient.weight_kg} kg` : '--'}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              BMI：{history?.bmi ? history.bmi.toFixed(1) : '--'}
            </Text>
          </Space>
        </Col>
        <Col>
          <NrsScoreMini assessments={history?.assessments} />
        </Col>
      </Row>
    </div>
  )
}

function NrsScoreMini({ assessments }) {
  const latest = assessments?.[0]
  if (!latest) return null
  const color = RISK_COLORS[latest.risk_level] || '#8C8C8C'
  return (
    <Card
      size="small"
      style={{ borderColor: color, minWidth: 160 }}
      bodyStyle={{ padding: '8px 16px' }}
    >
      <Statistic
        title={<Text style={{ fontSize: 11, color: '#8C8C8C' }}>最新 NRS-2002 评分</Text>}
        value={latest.nrs2002_score}
        suffix="分"
        valueStyle={{ color, fontSize: 24 }}
      />
      <Tag color={color === '#FF4D4F' ? 'red' : color === '#FA8C16' ? 'orange' : 'green'} style={{ marginTop: 2 }}>
        {latest.risk_level}
      </Tag>
    </Card>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// Tab 1 — 量表历史与报告
// ══════════════════════════════════════════════════════════════════════════════

function AssessmentHistoryTab({ loading, data, pdfLoading, onGeneratePdf }) {
  const columns = [
    {
      title:     '阶段',
      dataIndex: 'phase_label',
      width:     110,
      render: (text, row) => (
        <Tag color={PHASE_COLORS[row.phase] || 'default'}>{text}</Tag>
      ),
    },
    {
      title:     '评估日期',
      dataIndex: 'date',
      width:     110,
      render: v => v || '--',
    },
    {
      title:  'NRS-2002',
      width:  120,
      render: (_, row) => {
        const color = RISK_COLORS[row.risk_level] || '#8C8C8C'
        return (
          <Space direction="vertical" size={2}>
            <Text strong style={{ color, fontSize: 18 }}>{row.nrs2002_score}</Text>
            <Tag
              color={color === '#FF4D4F' ? 'red' : color === '#FA8C16' ? 'orange' : 'green'}
              style={{ fontSize: 11 }}
            >
              {row.risk_level}
            </Tag>
          </Space>
        )
      },
    },
    {
      title:  '营养目标',
      width:  170,
      render: (_, row) => (
        <Space direction="vertical" size={1}>
          <Text style={{ fontSize: 12 }}>
            能量：<b>{row.energy_kcal ?? '--'}</b> kcal/天
          </Text>
          <Text style={{ fontSize: 12 }}>
            蛋白：<b>{row.protein_g ?? '--'}</b> g/天
          </Text>
        </Space>
      ),
    },
    {
      title:  '生成来源',
      width:  90,
      render: (_, row) => (
        row.generated_by === 'agent'
          ? <Tag icon={<RobotOutlined />} color="geekblue">AI</Tag>
          : <Tag color="default">{row.generated_by || '--'}</Tag>
      ),
    },
    {
      title:  '状态',
      width:  70,
      render: (_, row) => (
        row.is_active
          ? <Badge status="processing" text={<Text style={{ fontSize: 12 }}>激活</Text>} />
          : <Badge status="default"    text={<Text style={{ fontSize: 12 }}>归档</Text>} />
      ),
    },
    {
      title:  '操作',
      width:  160,
      render: (_, row) => (
        <Button
          size="small"
          type="primary"
          ghost
          icon={<DownloadOutlined />}
          loading={!!pdfLoading[row.plan_id]}
          onClick={() => onGeneratePdf(row.plan_id)}
        >
          下载营养起点报告
        </Button>
      ),
    },
  ]

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>
  if (!data)   return <Empty description="暂无评估记录" style={{ margin: '48px 0' }} />

  return (
    <div>
      {/* 评估概览卡片 */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={6}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Statistic
              title="历史评估次数"
              value={data.assessments?.length || 0}
              suffix="次"
              valueStyle={{ color: '#1677FF' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Statistic
              title="当前体重"
              value={data.weight_kg || '--'}
              suffix="kg"
              valueStyle={{ color: '#1677FF' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Statistic
              title="BMI"
              value={data.bmi ? data.bmi.toFixed(1) : '--'}
              valueStyle={{
                color: data.bmi < 18.5 ? '#FF4D4F' : data.bmi > 28 ? '#FA8C16' : '#52C41A',
              }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Statistic
              title="当前阶段"
              value={data.current_phase || '--'}
              valueStyle={{ color: '#722ED1', fontSize: 14 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 量表历史表格 */}
      <Table
        dataSource={data.assessments || []}
        columns={columns}
        rowKey="plan_id"
        size="middle"
        pagination={{ pageSize: 10, showTotal: n => `共 ${n} 条` }}
        locale={{ emptyText: '暂无量表记录' }}
        rowClassName={row => row.is_active ? styles.activeRow : ''}
      />

      {/* 说明 */}
      <div className={styles.infoBox}>
        <BulbOutlined style={{ color: '#1677FF', marginRight: 6 }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          NRS-2002 评分为系统基于 BMI、白蛋白及移植阶段的自动估算，仅供临床参考，
          正式筛查请完成完整量表录入。评分 ≥ 3 分建议启动营养支持干预。
        </Text>
      </div>
    </div>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// Tab 2 — 检验单档案（含 Lightbox）
// ══════════════════════════════════════════════════════════════════════════════

function LabArchiveTab({ loading, data, onPreviewImage }) {
  const [expandedId, setExpandedId] = useState(null)

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>
  if (!data || !data.records?.length) return <Empty description="暂无检验记录" style={{ margin: '48px 0' }} />

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
        共 {data.total} 条检验记录，点击"查看原图"可放大预览。
      </Text>
      <div className={styles.labGrid}>
        {data.records.map(rec => (
          <LabRecordCard
            key={rec.id}
            record={rec}
            expanded={expandedId === rec.id}
            onToggle={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
            onPreviewImage={onPreviewImage}
          />
        ))}
      </div>
    </div>
  )
}

function LabRecordCard({ record, expanded, onToggle, onPreviewImage }) {
  const hasImage = !!record.image_url
  const abnormalCount = (record.items || []).filter(i => i.is_abnormal).length

  return (
    <Card
      size="small"
      className={styles.labCard}
      title={
        <Space size={8}>
          <ExperimentOutlined style={{ color: '#1677FF' }} />
          <Text strong style={{ fontSize: 13 }}>{record.report_type}</Text>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            {record.report_date || '--'}
          </Text>
          {record.phase_label && record.phase_label !== '--' && (
            <Tag color={PHASE_COLORS[record.phase] || 'default'} style={{ fontSize: 11 }}>
              {record.phase_label}
            </Tag>
          )}
        </Space>
      }
      extra={
        <Space>
          {abnormalCount > 0 && (
            <Tag color="red" icon={<WarningOutlined />}>
              {abnormalCount} 项异常
            </Tag>
          )}
          {record.is_analyzed && <Tag color="green" icon={<CheckCircleOutlined />}>已 AI 分析</Tag>}
          {hasImage && (
            <Button
              size="small"
              type="link"
              icon={<EyeOutlined />}
              onClick={() => onPreviewImage(record.image_url, `${record.report_type} · ${record.report_date || ''}`)}
            >
              查看原图
            </Button>
          )}
          <Button type="text" size="small" onClick={onToggle}>
            {expanded ? '收起' : '展开明细'}
          </Button>
        </Space>
      }
    >
      {/* AI 分析摘要 */}
      {record.analysis_summary && (
        <Paragraph
          type="secondary"
          style={{ fontSize: 12, marginBottom: expanded ? 8 : 0 }}
          ellipsis={{ rows: 2, expandable: false }}
        >
          <RobotOutlined style={{ marginRight: 4 }} />
          {record.analysis_summary}
        </Paragraph>
      )}

      {/* 展开：指标列表 */}
      {expanded && record.items?.length > 0 && (
        <Table
          dataSource={record.items}
          size="small"
          pagination={false}
          style={{ marginTop: 8 }}
          rowKey={(_, i) => i}
          rowClassName={row => row.is_abnormal ? styles.abnormalRow : ''}
          columns={[
            { title: '指标',     dataIndex: 'name',      width: 130 },
            {
              title: '结果',
              width: 90,
              render: (_, r) => (
                <Text style={{ color: r.is_abnormal ? '#FF4D4F' : undefined, fontWeight: r.is_abnormal ? 600 : 400 }}>
                  {r.value ?? '--'}
                </Text>
              ),
            },
            { title: '单位',       dataIndex: 'unit',      width: 70,  render: v => v || '--' },
            { title: '参考区间',   dataIndex: 'ref_range',  width: 120, render: v => v || '--' },
            {
              title: '状态',
              width: 70,
              render: (_, r) => r.is_abnormal
                ? <Tag color="red"   icon={<WarningOutlined />}>异常</Tag>
                : <Tag color="green" icon={<CheckCircleOutlined />}>正常</Tag>,
            },
          ]}
        />
      )}

      {/* 展开：AI 建议 */}
      {expanded && record.recommendations?.length > 0 && (
        <div style={{ marginTop: 10, background: '#F0F7FF', borderRadius: 6, padding: '8px 12px' }}>
          <Text style={{ fontSize: 12, color: '#1677FF' }}>
            <RobotOutlined style={{ marginRight: 4 }} />AI 营养建议
          </Text>
          {record.recommendations.map((r, i) => (
            <div key={i} style={{ fontSize: 12, marginTop: 4, color: '#595959' }}>· {r}</div>
          ))}
        </div>
      )}
    </Card>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// Tab 3 — 指标趋势折线图
// ══════════════════════════════════════════════════════════════════════════════

function TrendChartTab({ loading, data, metrics, onMetricsChange, onRefresh }) {
  const chartOption = buildChartOption(data, metrics)

  return (
    <div>
      {/* 工具栏 */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Space>
            <Text style={{ fontSize: 13 }}>显示指标：</Text>
            <Select
              mode="multiple"
              value={metrics}
              onChange={onMetricsChange}
              style={{ minWidth: 300 }}
              maxTagCount={3}
              options={TREND_METRICS_OPTIONS}
              placeholder="选择要展示的指标"
            />
          </Space>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} size="small">
            刷新
          </Button>
        </Col>
      </Row>

      {loading ? (
        <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>
      ) : !data || metrics.every(m => !data.metrics?.[m]?.series?.length) ? (
        <Empty
          description="暂无趋势数据（需上传含指标字段的检验记录）"
          style={{ margin: '60px 0' }}
        />
      ) : (
        <>
          {/* ECharts 图表 */}
          <div style={{ background: '#fff', borderRadius: 8, padding: '16px 8px', border: '1px solid #EBEBEB' }}>
            <ReactECharts
              option={chartOption}
              style={{ height: 400 }}
              notMerge
              lazyUpdate={false}
            />
          </div>

          {/* 指标统计卡片 */}
          <Row gutter={16} style={{ marginTop: 16 }}>
            {metrics.map(m => {
              const metricObj = data.metrics?.[m]
              if (!metricObj) return null
              const series = metricObj.series || []
              const latest = series[series.length - 1]
              const ref = metricObj.reference_range
              return (
                <Col span={6} key={m}>
                  <Card size="small" style={{ textAlign: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {TREND_METRICS_OPTIONS.find(o => o.value === m)?.label || m}
                    </Text>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#1677FF', marginTop: 4 }}>
                      {latest?.value ?? '--'}
                      <Text style={{ fontSize: 12, fontWeight: 400, marginLeft: 4, color: '#8C8C8C' }}>
                        {metricObj.unit}
                      </Text>
                    </div>
                    {ref && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        参考：{ref.min} ~ {ref.max} {metricObj.unit}
                      </Text>
                    )}
                    {series.length > 0 && (
                      <div style={{ fontSize: 11, color: '#8C8C8C', marginTop: 2 }}>
                        {series.length} 个数据点 · 最近：{latest?.date || '--'}
                      </div>
                    )}
                  </Card>
                </Col>
              )
            })}
          </Row>

          {/* 数据点说明 */}
          <div className={styles.infoBox} style={{ marginTop: 12 }}>
            <MonitorOutlined style={{ color: '#1677FF', marginRight: 6 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              数据点来源于检验单 structured_items 字段，
              如趋势图为空请前往"检验单管理"上传并解析化验单。
            </Text>
          </div>
        </>
      )}
    </div>
  )
}

// ── ECharts 配置构建器 ────────────────────────────────────────────────────────

const METRIC_AXIS_COLORS = [
  '#1677FF', '#52C41A', '#FA8C16', '#722ED1', '#EB2F96',
]

function buildChartOption(data, metrics) {
  if (!data) return {}

  const allDates = new Set()
  metrics.forEach(m => {
    const series = data.metrics?.[m]?.series || []
    series.forEach(p => allDates.add(p.date))
  })
  const sortedDates = [...allDates].sort()

  // 为每个指标构建一个 yAxis 和 series
  const yAxes = []
  const series = []
  const legend = []

  metrics.forEach((m, idx) => {
    const metricObj = data.metrics?.[m]
    if (!metricObj) return
    const seriesData = metricObj.series || []
    const dateValueMap = {}
    seriesData.forEach(p => { dateValueMap[p.date] = p.value })

    const color = METRIC_AXIS_COLORS[idx % METRIC_AXIS_COLORS.length]
    const label = TREND_METRICS_OPTIONS.find(o => o.value === m)?.label || m
    const unit  = metricObj.unit
    const ref   = metricObj.reference_range

    yAxes.push({
      type:          'value',
      name:          `${label} (${unit})`,
      nameTextStyle: { color, fontSize: 11 },
      axisLine:      { lineStyle: { color } },
      axisLabel:     { color, fontSize: 11 },
      splitLine:     { show: idx === 0 },
      position:      idx % 2 === 0 ? 'left' : 'right',
      offset:        Math.floor(idx / 2) * 60,
      min:           ref ? ref.min * 0.7 : undefined,
      max:           ref ? ref.max * 1.3 : undefined,
    })

    series.push({
      name:       label,
      type:       'line',
      yAxisIndex: idx,
      smooth:     true,
      symbol:     'circle',
      symbolSize: 7,
      lineStyle:  { color, width: 2.5 },
      itemStyle:  { color },
      areaStyle: idx === 0 ? { color: { type: 'linear', x:0,y:0,x2:0,y2:1, colorStops:[
        { offset: 0, color: color + '2A' },
        { offset: 1, color: color + '05' },
      ]}} : undefined,
      data: sortedDates.map(d => dateValueMap[d] ?? null),
      connectNulls: false,
      markLine: ref ? {
        silent: true,
        lineStyle: { color: color + '80', type: 'dashed', width: 1 },
        data: [
          { yAxis: ref.min, name: `${label}下限` },
          { yAxis: ref.max, name: `${label}上限` },
        ],
        label: { show: true, fontSize: 10, color: color + 'AA' },
      } : undefined,
    })

    legend.push(label)
  })

  return {
    backgroundColor: 'transparent',
    grid: { left: 60 + Math.floor((metrics.length - 1) / 2) * 60, right: 60 + Math.floor(metrics.length / 2) * 60, top: 48, bottom: 48 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: '#E8E8E8',
      borderWidth: 1,
      textStyle: { color: '#1A1A1A', fontSize: 12 },
      formatter: (params) => {
        const date = params[0]?.name || ''
        const lines = params
          .filter(p => p.value !== null && p.value !== undefined)
          .map(p => {
            const m  = metrics[p.seriesIndex]
            const unit = data.metrics?.[m]?.unit || ''
            return `<span style="color:${p.color}">●</span> ${p.seriesName}：<b>${p.value}</b> ${unit}`
          })
        return `<div style="font-size:12px"><b>${date}</b><br/>${lines.join('<br/>')}</div>`
      },
    },
    legend: { data: legend, top: 8, textStyle: { fontSize: 12 } },
    xAxis: {
      type:       'category',
      data:       sortedDates,
      axisLabel:  { rotate: 30, fontSize: 11 },
      axisLine:   { lineStyle: { color: '#D9D9D9' } },
      splitLine:  { show: false },
      boundaryGap: false,
    },
    yAxis:  yAxes,
    series: series,
    dataZoom: [
      { type: 'slider', bottom: 4, height: 20, startValue: sortedDates.length > 20 ? sortedDates.length - 20 : 0 },
      { type: 'inside' },
    ],
  }
}
