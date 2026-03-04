import React, { useState, useEffect } from 'react'
import {
  Card, Table, Tag, Button, Space, Select, Tabs, Switch, Modal,
  Form, Input, Typography, Row, Col, Statistic, Badge, message,
  Tooltip,
} from 'antd'
import {
  SendOutlined, BellOutlined, SettingOutlined, HistoryOutlined,
} from '@ant-design/icons'
import axios from 'axios'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

const TYPE_OPTS = [
  { value: '', label: '全部类型' },
  { value: 'lab_abnormal', label: '化验异常提醒' },
  { value: 'nutrition_reminder', label: '营养打卡提醒' },
  { value: 'followup_reminder', label: '随访提醒' },
  { value: 'consent_expiry', label: '同意书到期' },
  { value: 'medication_alert', label: '用药依从预警' },
  { value: 'system', label: '系统通知' },
]

const STATUS_OPTS = [
  { value: '', label: '全部状态' },
  { value: 'sent', label: '已发送' },
  { value: 'delivered', label: '已送达' },
  { value: 'read', label: '已读' },
  { value: 'failed', label: '失败' },
]

const CHANNEL_OPTS = [
  { value: 'weapp', label: '小程序' },
  { value: 'sms', label: '短信' },
  { value: 'email', label: '邮件' },
]

export default function MessageCenter() {
  const [activeTab, setActiveTab] = useState('records')
  const [records, setRecords] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [templates, setTemplates] = useState([])
  const [stats, setStats] = useState({})
  const [patients, setPatients] = useState([])
  const [sendModal, setSendModal] = useState(false)
  const [sendForm] = Form.useForm()
  const [sending, setSending] = useState(false)

  const fetchRecords = async (pg = 1) => {
    setLoading(true)
    try {
      const params = { page: pg, page_size: 20 }
      if (typeFilter) params.msg_type = typeFilter
      if (statusFilter) params.status = statusFilter
      const res = await axios.get('/api/v1/messages/records', { params })
      setRecords(res.data.items || [])
      setTotal(res.data.total || 0)
    } catch { setRecords([]) }
    finally { setLoading(false) }
  }

  const fetchAll = async () => {
    try {
      const [tmplRes, statsRes, patRes] = await Promise.all([
        axios.get('/api/v1/messages/templates'),
        axios.get('/api/v1/messages/stats'),
        axios.get('/api/v1/patients'),
      ])
      setTemplates(tmplRes.data.items || [])
      setStats(statsRes.data || {})
      setPatients(patRes.data.items || patRes.data || [])
    } catch {}
  }

  useEffect(() => { fetchAll(); fetchRecords(1) }, [])
  useEffect(() => { fetchRecords(1); setPage(1) }, [typeFilter, statusFilter])

  const toggleTemplate = async (id, enabled) => {
    try {
      await axios.patch(`/api/v1/messages/templates/${id}`, null, { params: { enabled } })
      setTemplates(prev => prev.map(t => t.id === id ? { ...t, enabled } : t))
      message.success(enabled ? '已启用' : '已停用')
    } catch { message.error('操作失败') }
  }

  const handleSend = async () => {
    const values = await sendForm.validateFields()
    setSending(true)
    try {
      await axios.post('/api/v1/messages/send', null, { params: values })
      message.success('消息已发送')
      setSendModal(false)
      sendForm.resetFields()
      fetchRecords(1)
    } catch { message.error('发送失败') }
    finally { setSending(false) }
  }

  const recordColumns = [
    {
      title: '患者', dataIndex: 'patient_name', width: 100,
      render: (v, r) => <Space direction="vertical" size={0}>
        <Text strong style={{ fontSize: 13 }}>{v}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{r.patient_no}</Text>
      </Space>,
    },
    {
      title: '消息类型', dataIndex: 'type_label', width: 130,
      render: (v, r) => <Tag color={r.type_color}>{v}</Tag>,
    },
    {
      title: '渠道', dataIndex: 'channel_label', width: 80,
      render: v => <Tag>{v}</Tag>,
    },
    {
      title: '内容', dataIndex: 'content', ellipsis: true,
      render: v => <Tooltip title={v}><Text style={{ fontSize: 12 }} ellipsis>{v}</Text></Tooltip>,
    },
    {
      title: '状态', dataIndex: 'status_label', width: 80,
      render: (v, r) => <Badge status={r.status_color} text={v} />,
    },
    { title: '发送时间', dataIndex: 'send_time', width: 140 },
  ]

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: '#F5F7FA' }}>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>消息通知管理</Title>
          <Text type="secondary">AD-31 ~ AD-33 · 消息推送配置、发送记录与手动发送</Text>
        </div>
        <Button type="primary" icon={<SendOutlined />} onClick={() => setSendModal(true)}>
          手动发送消息
        </Button>
      </div>

      {/* 统计卡片 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        {[
          { title: '总发送量', value: stats.total_sent, color: '#1677ff' },
          { title: '送达量', value: stats.delivered, color: '#52c41a' },
          { title: '已读量', value: stats.read, color: '#722ed1' },
          { title: '阅读率', value: stats.read_rate, suffix: '%', color: '#fa8c16' },
        ].map((s, i) => (
          <Col key={i} xs={12} sm={6}>
            <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: '12px 16px' }}>
              <Statistic title={s.title} value={s.value} suffix={s.suffix}
                valueStyle={{ color: s.color, fontSize: 20 }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ borderRadius: 10 }}>
        <Tabs activeKey={activeTab} onChange={setActiveTab}
          items={[
            {
              key: 'records', label: <Space><HistoryOutlined />发送记录</Space>,
              children: (
                <>
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Select style={{ width: 160 }} value={typeFilter} options={TYPE_OPTS}
                      onChange={v => { setTypeFilter(v); setPage(1) }} />
                    <Select style={{ width: 120 }} value={statusFilter} options={STATUS_OPTS}
                      onChange={v => { setStatusFilter(v); setPage(1) }} />
                  </Space>
                  <Table dataSource={records} columns={recordColumns} rowKey="id"
                    loading={loading} scroll={{ x: 800 }}
                    pagination={{ current: page, total, pageSize: 20,
                      onChange: (p) => { setPage(p); fetchRecords(p) },
                      showTotal: t => `共 ${t} 条` }}
                    size="middle" />
                </>
              ),
            },
            {
              key: 'templates', label: <Space><SettingOutlined />推送规则配置</Space>,
              children: (
                <Table
                  dataSource={templates}
                  rowKey="id"
                  size="middle"
                  pagination={false}
                  columns={[
                    { title: '模板名称', dataIndex: 'name', width: 160 },
                    { title: '类型', dataIndex: 'type', width: 140,
                      render: v => <Tag>{v}</Tag> },
                    { title: '渠道', dataIndex: 'channel', width: 90,
                      render: v => <Tag>{v}</Tag> },
                    { title: '内容预览', dataIndex: 'content', ellipsis: true,
                      render: v => <Tooltip title={v}><Text ellipsis style={{ fontSize: 12 }}>{v}</Text></Tooltip> },
                    {
                      title: '启用状态', dataIndex: 'enabled', width: 100,
                      render: (v, r) => (
                        <Switch checked={v} checkedChildren="启用" unCheckedChildren="停用"
                          onChange={enabled => toggleTemplate(r.id, enabled)} />
                      ),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      {/* 手动发送 Modal */}
      <Modal title={<Space><SendOutlined />手动发送消息</Space>}
        open={sendModal} onOk={handleSend} onCancel={() => setSendModal(false)}
        confirmLoading={sending} okText="发送" cancelText="取消">
        <Form form={sendForm} layout="vertical">
          <Form.Item name="patient_id" label="目标患者" rules={[{ required: true }]}>
            <Select placeholder="选择患者"
              options={patients.map(p => ({ value: p.id, label: `${p.name} (${p.patient_no})` }))} />
          </Form.Item>
          <Form.Item name="msg_type" label="消息类型" rules={[{ required: true }]}>
            <Select options={TYPE_OPTS.filter(o => o.value)} />
          </Form.Item>
          <Form.Item name="channel" label="发送渠道" initialValue="weapp">
            <Select options={CHANNEL_OPTS} />
          </Form.Item>
          <Form.Item name="content" label="自定义内容（可选）">
            <TextArea rows={3} placeholder="留空则使用默认模板内容" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
