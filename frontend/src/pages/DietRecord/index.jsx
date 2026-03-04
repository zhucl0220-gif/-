import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Table, Tag, Button, Space, Select, DatePicker, Drawer,
  Typography, Statistic, Row, Col, Progress, List, Avatar, Badge,
  Segmented, Tooltip, Empty, Spin,
} from 'antd'
import {
  CalendarOutlined, FireOutlined, ExperimentOutlined,
  RobotOutlined, PictureOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import dayjs from 'dayjs'

const { Title, Text, Paragraph } = Typography
const { RangePicker } = DatePicker

const MEAL_OPTS = [
  { value: '', label: '全部餐次' },
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'snack', label: '加餐' },
]

const MEAL_COLOR = {
  breakfast: 'orange', lunch: 'blue', dinner: 'purple', snack: 'cyan',
}

export default function DietRecord() {
  const [records, setRecords] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [patients, setPatients] = useState([])
  const [patientId, setPatientId] = useState(null)
  const [mealType, setMealType] = useState('')
  const [dateRange, setDateRange] = useState(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [compliance, setCompliance] = useState(null)
  const [complianceLoading, setComplianceLoading] = useState(false)

  const [view, setView] = useState('table')

  const fetchRecords = useCallback(async (pg = 1) => {
    setLoading(true)
    try {
      const params = { page: pg, page_size: 20 }
      if (patientId) params.patient_id = patientId
      if (mealType) params.meal_type = mealType
      if (dateRange) {
        params.start_date = dateRange[0].format('YYYY-MM-DD')
        params.end_date = dateRange[1].format('YYYY-MM-DD')
      }
      const res = await axios.get('/api/v1/diet/records', { params })
      setRecords(res.data.items || [])
      setTotal(res.data.total || 0)
    } catch {
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [patientId, mealType, dateRange])

  const fetchPatients = async () => {
    try {
      const res = await axios.get('/api/v1/patients')
      setPatients(res.data.items || res.data || [])
    } catch { setPatients([]) }
  }

  const fetchCompliance = async (pid) => {
    setComplianceLoading(true)
    try {
      const res = await axios.get(`/api/v1/diet/compliance/${pid}`)
      setCompliance(res.data)
    } catch { setCompliance(null) }
    finally { setComplianceLoading(false) }
  }

  useEffect(() => {
    fetchPatients()
    fetchRecords(1)
  }, [])

  useEffect(() => {
    fetchRecords(1)
    setPage(1)
  }, [patientId, mealType, dateRange])

  useEffect(() => {
    if (patientId) fetchCompliance(patientId)
    else setCompliance(null)
  }, [patientId])

  const openDetail = (record) => {
    setSelected(record)
    setDrawerOpen(true)
  }

  const columns = [
    {
      title: '患者', dataIndex: 'patient_name', width: 100,
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 13 }}>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{r.patient_no}</Text>
        </Space>
      ),
    },
    {
      title: '日期', dataIndex: 'record_date', width: 110,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text>,
      sorter: (a, b) => a.record_date.localeCompare(b.record_date),
      defaultSortOrder: 'descend',
    },
    {
      title: '餐次', dataIndex: 'meal_label', width: 80,
      render: (v, r) => <Tag color={MEAL_COLOR[r.meal_type] || 'default'}>{v}</Tag>,
    },
    {
      title: '热量 (kcal)', dataIndex: 'total_kcal', width: 110,
      render: (v) => {
        const ok = v >= 400 && v <= 700
        return (
          <Space>
            <FireOutlined style={{ color: ok ? '#52c41a' : '#ff4d4f' }} />
            <Text style={{ color: ok ? '#52c41a' : '#ff4d4f' }}>{v}</Text>
          </Space>
        )
      },
    },
    {
      title: '蛋白质 (g)', dataIndex: 'protein_g', width: 100,
      render: v => {
        const ok = v >= 15
        return <Text style={{ color: ok ? '#1677ff' : '#faad14' }}>{v}</Text>
      },
    },
    {
      title: '食物', dataIndex: 'food_items', width: 200,
      render: foods => (
        <Space size={4} wrap>
          {(foods || []).map((f, i) => (
            <Tag key={i} style={{ fontSize: 11 }}>{f.name}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'AI 反馈', dataIndex: 'ai_feedback', width: 200,
      render: (v) => v
        ? <Tooltip title={v}><Text style={{ fontSize: 12, color: '#1677ff' }} ellipsis>{v}</Text></Tooltip>
        : <Text type="secondary" style={{ fontSize: 12 }}>暂无反馈</Text>,
    },
    {
      title: '操作', width: 80, fixed: 'right',
      render: (_, r) => (
        <Button size="small" type="link" onClick={() => openDetail(r)}>详情</Button>
      ),
    },
  ]

  const statCards = compliance ? [
    { title: '依从率', value: compliance.compliance_rate, suffix: '%', color: compliance.compliance_rate >= 70 ? '#52c41a' : '#ff4d4f' },
    { title: '日均热量', value: compliance.avg_kcal, suffix: 'kcal', color: '#1677ff' },
    { title: '日均蛋白质', value: compliance.avg_protein_g, suffix: 'g', color: '#722ed1' },
    { title: '分析天数', value: compliance.days_analyzed, suffix: '天', color: '#fa8c16' },
  ] : []

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: '#F5F7FA' }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>饮食打卡管理</Title>
        <Text type="secondary">AD-26 ~ AD-28 · 患者饮食记录查看、AI反馈与依从性分析</Text>
      </div>

      {/* 筛选条 */}
      <Card style={{ marginBottom: 16, borderRadius: 10 }} bodyStyle={{ padding: '12px 16px' }}>
        <Space wrap>
          <Select
            style={{ width: 160 }}
            placeholder="选择患者"
            allowClear
            onChange={setPatientId}
            options={[...patients.map(p => ({ value: p.id, label: p.name }))]}
          />
          <Select
            style={{ width: 120 }}
            defaultValue=""
            options={MEAL_OPTS}
            onChange={setMealType}
          />
          <RangePicker
            onChange={setDateRange}
            presets={[
              { label: '近7天', value: [dayjs().subtract(7, 'd'), dayjs()] },
              { label: '近14天', value: [dayjs().subtract(14, 'd'), dayjs()] },
              { label: '近30天', value: [dayjs().subtract(30, 'd'), dayjs()] },
            ]}
          />
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'table', label: '列表视图' },
              { value: 'stats', label: '依从统计' },
            ]}
          />
        </Space>
      </Card>

      {/* 依从统计卡片（选择患者后显示） */}
      {compliance && (
        <Row gutter={12} style={{ marginBottom: 16 }}>
          {statCards.map((s, i) => (
            <Col key={i} xs={12} sm={6}>
              <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: '12px 16px' }}>
                <Statistic title={s.title} value={s.value} suffix={s.suffix}
                  valueStyle={{ color: s.color, fontSize: 22 }} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* 依从日历（stats视图 + 已选患者） */}
      {view === 'stats' && compliance && (
        <Card title="近14日依从情况" style={{ marginBottom: 16, borderRadius: 10 }}
          extra={<Text type="secondary">绿=达标 红=未达标</Text>}>
          <Spin spinning={complianceLoading}>
            <Row gutter={8} wrap>
              {(compliance.daily || []).map((d, i) => (
                <Col key={i} style={{ marginBottom: 8 }}>
                  <Tooltip title={`热量: ${d.total_kcal}kcal | 蛋白: ${d.total_protein_g}g`}>
                    <Card
                      size="small"
                      style={{
                        width: 80, textAlign: 'center', borderRadius: 8,
                        borderColor: d.kcal_ok && d.protein_ok ? '#52c41a' : '#ff4d4f',
                        background: d.kcal_ok && d.protein_ok ? '#f6ffed' : '#fff2f0',
                      }}
                      bodyStyle={{ padding: '6px 4px' }}
                    >
                      <Text style={{ fontSize: 11, display: 'block' }}>{d.date.slice(5)}</Text>
                      <Text style={{ fontSize: 11, color: '#666' }}>{d.meal_count} 餐</Text>
                      {d.kcal_ok && d.protein_ok
                        ? <CheckCircleOutlined style={{ color: '#52c41a', display: 'block' }} />
                        : <CloseCircleOutlined style={{ color: '#ff4d4f', display: 'block' }} />}
                    </Card>
                  </Tooltip>
                </Col>
              ))}
            </Row>
          </Spin>
        </Card>
      )}

      {/* 主表格 */}
      {view === 'table' && (
        <Card style={{ borderRadius: 10 }}>
          <Table
            dataSource={records}
            columns={columns}
            rowKey="id"
            loading={loading}
            scroll={{ x: 900 }}
            pagination={{
              current: page, total, pageSize: 20,
              onChange: (p) => { setPage(p); fetchRecords(p) },
              showTotal: t => `共 ${t} 条记录`,
            }}
            size="middle"
          />
        </Card>
      )}

      {/* 打卡详情 Drawer */}
      <Drawer
        title={`饮食记录详情 — ${selected?.patient_name || ''} ${selected?.record_date || ''} ${selected?.meal_label || ''}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
      >
        {selected && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            {/* 营养概要 */}
            <Card size="small" title="营养摄入" style={{ borderRadius: 8 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Statistic title="热量" value={selected.total_kcal} suffix="kcal"
                    valueStyle={{ fontSize: 18, color: '#fa8c16' }} />
                </Col>
                <Col span={12}>
                  <Statistic title="蛋白质" value={selected.protein_g} suffix="g"
                    valueStyle={{ fontSize: 18, color: '#1677ff' }} />
                </Col>
              </Row>
            </Card>

            {/* 食物清单 */}
            <Card size="small" title="食物明细" style={{ borderRadius: 8 }}>
              <List
                size="small"
                dataSource={selected.food_items || []}
                renderItem={item => (
                  <List.Item
                    extra={<Text type="secondary" style={{ fontSize: 12 }}>{item.kcal} kcal</Text>}
                  >
                    <Space>
                      <Text>{item.name}</Text>
                      <Tag style={{ fontSize: 11 }}>{item.amount} {item.unit}</Tag>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>

            {/* AI 反馈 */}
            <Card
              size="small"
              title={<Space><RobotOutlined style={{ color: '#1677ff' }} /><span>AI 营养反馈</span></Space>}
              style={{ borderRadius: 8, background: '#f0f5ff', border: '1px solid #adc6ff' }}
            >
              {selected.ai_feedback
                ? <Paragraph style={{ margin: 0, fontSize: 13 }}>{selected.ai_feedback}</Paragraph>
                : <Text type="secondary">暂无 AI 反馈</Text>
              }
            </Card>

            {/* 照片占位 */}
            {selected.photo_path && (
              <Card size="small" title={<Space><PictureOutlined /><span>饮食照片</span></Space>}
                style={{ borderRadius: 8 }}>
                <Text type="secondary">照片加载中...</Text>
              </Card>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  )
}
