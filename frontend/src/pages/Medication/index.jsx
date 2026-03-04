import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Table, Tag, Button, Space, Select, Typography, Row, Col,
  Statistic, Badge, Modal, Form, Input, Tabs, Drawer, message,
  Tooltip, Alert, Progress,
} from 'antd'
import {
  MedicineBoxOutlined, WarningOutlined, CheckCircleOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import ReactECharts from 'echarts-for-react'

const { Title, Text } = Typography
const { TextArea } = Input

const SEVERITY_OPTS = [
  { value: '', label: '全部级别' },
  { value: 'high', label: '高危' },
  { value: 'medium', label: '中危' },
]

export default function Medication() {
  const [activeTab, setActiveTab] = useState('overview')
  const [patients, setPatients] = useState([])
  const [medications, setMedications] = useState([])
  const [medTotal, setMedTotal] = useState(0)
  const [medLoading, setMedLoading] = useState(false)

  const [alerts, setAlerts] = useState([])
  const [alertTotal, setAlertTotal] = useState(0)
  const [unhandledCount, setUnhandledCount] = useState(0)
  const [alertLoading, setAlertLoading] = useState(false)
  const [severityFilter, setSeverityFilter] = useState('')

  const [trendDrawer, setTrendDrawer] = useState({ open: false, patientId: null, patientName: '' })
  const [trendData, setTrendData] = useState(null)
  const [handleModal, setHandleModal] = useState({ open: false, alert: null })
  const [handleForm] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const fetchMedications = async () => {
    setMedLoading(true)
    try {
      const res = await axios.get('/api/v1/medication/list')
      setMedications(res.data.items || [])
      setMedTotal(res.data.total || 0)
    } catch { setMedications([]) }
    finally { setMedLoading(false) }
  }

  const fetchAlerts = useCallback(async () => {
    setAlertLoading(true)
    try {
      const params = { is_handled: false }
      if (severityFilter) params.severity = severityFilter
      const res = await axios.get('/api/v1/medication/alerts', { params })
      setAlerts(res.data.items || [])
      setAlertTotal(res.data.total || 0)
      setUnhandledCount(res.data.unhandled || 0)
    } catch { setAlerts([]) }
    finally { setAlertLoading(false) }
  }, [severityFilter])

  const fetchTrend = async (patientId) => {
    try {
      const res = await axios.get(`/api/v1/medication/levels/${patientId}`, { params: { days: 30 } })
      setTrendData(res.data)
    } catch { setTrendData(null) }
  }

  useEffect(() => {
    axios.get('/api/v1/patients').then(r => setPatients(r.data.items || r.data || [])).catch(() => {})
    fetchMedications()
    fetchAlerts()
  }, [])
  useEffect(() => { fetchAlerts() }, [severityFilter])

  const openTrend = (patientId, patientName) => {
    setTrendDrawer({ open: true, patientId, patientName })
    fetchTrend(patientId)
  }

  const handleAlertSubmit = async () => {
    const values = await handleForm.validateFields()
    setSubmitting(true)
    try {
      await axios.patch(`/api/v1/medication/alerts/${handleModal.alert.id}/handle`, null, {
        params: { notes: values.notes },
      })
      message.success('预警已处理')
      setHandleModal({ open: false, alert: null })
      fetchAlerts()
    } catch { message.error('操作失败') }
    finally { setSubmitting(false) }
  }

  const getTrendOption = () => {
    if (!trendData) return {}
    const dates = trendData.records.map(r => r.date).reverse()
    const levels = trendData.records.map(r => r.fk506_level).reverse()
    return {
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11, rotate: 30 } },
      yAxis: { type: 'value', name: 'ng/mL', min: 0, max: 20 },
      series: [
        {
          name: 'FK506浓度', type: 'line', data: levels, smooth: true,
          lineStyle: { color: '#1677ff', width: 2 },
          itemStyle: { color: '#1677ff' },
          markArea: {
            silent: true,
            data: [[
              { yAxis: trendData.target_min, itemStyle: { color: 'rgba(82,196,26,0.1)' } },
              { yAxis: trendData.target_max },
            ]],
          },
          markLine: {
            data: [
              { yAxis: trendData.target_min, label: { formatter: '下限 {c}' }, lineStyle: { color: '#52c41a', type: 'dashed' } },
              { yAxis: trendData.target_max, label: { formatter: '上限 {c}' }, lineStyle: { color: '#52c41a', type: 'dashed' } },
            ],
          },
        },
      ],
    }
  }

  const overviewColumns = [
    {
      title: '患者', dataIndex: 'patient_name', width: 110,
      render: (v, r) => <Space direction="vertical" size={0}>
        <Text strong style={{ fontSize: 13 }}>{v}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{r.patient_no}</Text>
      </Space>,
    },
    {
      title: '最新FK506 (ng/mL)', dataIndex: 'latest_fk506', width: 150,
      render: (v, r) => {
        if (!v) return <Text type="secondary">未检测</Text>
        const ok = r.in_range
        return (
          <Space>
            <Badge color={ok ? 'green' : 'red'} />
            <Text style={{ color: ok ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>{v}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>{r.latest_date}</Text>
          </Space>
        )
      },
    },
    {
      title: '7日依从率', dataIndex: 'compliance_7d', width: 120,
      render: v => (
        <Progress percent={v} size="small" strokeColor={v >= 80 ? '#52c41a' : v >= 60 ? '#faad14' : '#ff4d4f'} />
      ),
      sorter: (a, b) => a.compliance_7d - b.compliance_7d,
    },
    {
      title: '预警数', dataIndex: 'alert_count', width: 80,
      render: v => v > 0 ? <Badge count={v} color="red" /> : <Text type="secondary">无</Text>,
    },
    { title: '当前阶段', dataIndex: 'current_phase', width: 120,
      render: v => <Tag style={{ fontSize: 11 }}>{v || '—'}</Tag> },
    {
      title: '操作', width: 100, fixed: 'right',
      render: (_, r) => (
        <Button size="small" icon={<LineChartOutlined />}
          onClick={() => openTrend(r.patient_id, r.patient_name)}>趋势</Button>
      ),
    },
  ]

  const alertColumns = [
    {
      title: '患者', dataIndex: 'patient_name', width: 110,
      render: (v, r) => <Space direction="vertical" size={0}>
        <Text strong style={{ fontSize: 13 }}>{v}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{r.patient_no}</Text>
      </Space>,
    },
    {
      title: '风险等级', dataIndex: 'severity_label', width: 100,
      render: (_, r) => <Tag color={r.severity_color}>{r.severity_label}</Tag>,
    },
    { title: '预警原因', dataIndex: 'reason', ellipsis: true },
    {
      title: '当前均值 (ng/mL)', dataIndex: 'current_avg', width: 150,
      render: v => v ? <Text style={{ fontWeight: 600 }}>{v}</Text> : '—',
    },
    { title: '发生日期', dataIndex: 'created_date', width: 110 },
    {
      title: '操作', width: 90, fixed: 'right',
      render: (_, r) => (
        <Button size="small" type="primary"
          onClick={() => { setHandleModal({ open: true, alert: r }); handleForm.resetFields() }}>
          处理
        </Button>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: '#F5F7FA' }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>用药依从性管理</Title>
        <Text type="secondary">AD-40 ~ AD-41 · FK506血药浓度监控与服药依从性预警</Text>
      </div>

      {unhandledCount > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={`当前有 ${unhandledCount} 条依从性预警未处理`}
          style={{ marginBottom: 16, borderRadius: 8 }}
          action={<Button size="small" type="link" onClick={() => setActiveTab('alerts')}>查看预警</Button>}
        />
      )}

      {/* 统计 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        {[
          { title: '监控患者数', value: medTotal, color: '#1677ff' },
          { title: '未处理预警', value: unhandledCount, color: unhandledCount > 0 ? '#ff4d4f' : '#52c41a' },
          { title: '平均依从率', value: medications.length ? Math.round(medications.reduce((s, m) => s + m.compliance_7d, 0) / medications.length) : 0, suffix: '%', color: '#722ed1' },
        ].map((s, i) => (
          <Col key={i} span={8}>
            <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: '12px 16px' }}>
              <Statistic title={s.title} value={s.value} suffix={s.suffix}
                valueStyle={{ color: s.color, fontSize: 22 }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ borderRadius: 10 }}>
        <Tabs activeKey={activeTab} onChange={setActiveTab}
          items={[
            {
              key: 'overview', label: <Space><MedicineBoxOutlined />患者总览</Space>,
              children: (
                <Table dataSource={medications} columns={overviewColumns} rowKey="patient_id"
                  loading={medLoading} scroll={{ x: 800 }}
                  pagination={{ total: medTotal, pageSize: 20, showTotal: t => `共 ${t} 名患者` }}
                  size="middle" />
              ),
            },
            {
              key: 'alerts', label: (
                <Space>
                  <WarningOutlined />
                  依从预警
                  {unhandledCount > 0 && <Badge count={unhandledCount} size="small" />}
                </Space>
              ),
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Select style={{ width: 130 }} value={severityFilter} options={SEVERITY_OPTS}
                      onChange={setSeverityFilter} />
                  </Space>
                  <Table dataSource={alerts} columns={alertColumns} rowKey="id"
                    loading={alertLoading} scroll={{ x: 750 }}
                    pagination={{ total: alertTotal, pageSize: 20, showTotal: t => `共 ${t} 条` }}
                    size="middle" />
                </>
              ),
            },
          ]}
        />
      </Card>

      {/* FK506 趋势 Drawer */}
      <Drawer
        title={`FK506 血药浓度趋势 — ${trendDrawer.patientName}`}
        open={trendDrawer.open}
        onClose={() => setTrendDrawer({ open: false, patientId: null, patientName: '' })}
        width={580}
      >
        {trendData && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Row gutter={12}>
              {[
                { title: '目标范围', value: `${trendData.target_min}~${trendData.target_max}`, suffix: 'ng/mL' },
                { title: '均值', value: trendData.avg_level, suffix: 'ng/mL' },
                { title: '达标率', value: trendData.compliance_rate, suffix: '%' },
              ].map((s, i) => (
                <Col key={i} span={8}>
                  <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: '8px 12px' }}>
                    <Statistic title={s.title} value={s.value} suffix={s.suffix}
                      valueStyle={{ fontSize: 16 }} />
                  </Card>
                </Col>
              ))}
            </Row>
            <Card size="small" title="近30日浓度趋势（目标区间 5-10 ng/mL）" style={{ borderRadius: 8 }}>
              <ReactECharts option={getTrendOption()} style={{ height: 260 }} />
            </Card>
          </Space>
        )}
      </Drawer>

      {/* 处理预警 Modal */}
      <Modal title="处理依从预警" open={handleModal.open}
        onOk={handleAlertSubmit} onCancel={() => setHandleModal({ open: false, alert: null })}
        confirmLoading={submitting} okText="确认处理">
        <Text>患者：<strong>{handleModal.alert?.patient_name}</strong></Text><br />
        <Text>原因：{handleModal.alert?.reason}</Text>
        <Form form={handleForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="notes" label="处理说明">
            <TextArea rows={3} placeholder="记录处理措施（如：调整剂量、通知患者等）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
