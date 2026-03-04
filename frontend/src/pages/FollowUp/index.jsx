import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Table, Tag, Button, Space, Select, Typography, Row, Col,
  Statistic, Badge, Modal, Form, Input, Segmented, Calendar,
  message, Tooltip, List, Avatar,
} from 'antd'
import {
  ScheduleOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { TextArea } = Input

const STATUS_OPTS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待完成' },
  { value: 'overdue', label: '已逾期' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
]

const TYPE_OPTS = [
  { value: '', label: '全部类型' },
  { value: 'lab_check', label: '化验复查' },
  { value: 'nutrition_review', label: '营养评估' },
  { value: 'weight_record', label: '体重记录' },
  { value: 'outpatient', label: '门诊复诊' },
  { value: 'phone_followup', label: '电话随访' },
  { value: 'imaging', label: '影像检查' },
]

const STATUS_ICON = {
  pending: <ClockCircleOutlined style={{ color: '#1677ff' }} />,
  completed: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  overdue: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
  cancelled: <ClockCircleOutlined style={{ color: '#999' }} />,
}

export default function FollowUp() {
  const [tasks, setTasks] = useState([])
  const [total, setTotal] = useState(0)
  const [overdueCount, setOverdueCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [patients, setPatients] = useState([])
  const [patientId, setPatientId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [view, setView] = useState('table')
  const [calendarData, setCalendarData] = useState([])

  const [completeModal, setCompleteModal] = useState({ open: false, task: null })
  const [completeForm] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const fetchTasks = useCallback(async (pg = 1) => {
    setLoading(true)
    try {
      const params = { page: pg, page_size: 20 }
      if (patientId) params.patient_id = patientId
      if (statusFilter) params.status = statusFilter
      if (typeFilter) params.task_type = typeFilter
      const res = await axios.get('/api/v1/followup/tasks', { params })
      setTasks(res.data.items || [])
      setTotal(res.data.total || 0)
      setOverdueCount(res.data.overdue_count || 0)
      setPendingCount(res.data.pending_count || 0)
    } catch { setTasks([]) }
    finally { setLoading(false) }
  }, [patientId, statusFilter, typeFilter])

  const fetchCalendar = async () => {
    try {
      const now = dayjs()
      const res = await axios.get('/api/v1/followup/calendar', {
        params: { year: now.year(), month: now.month() + 1 },
      })
      setCalendarData(res.data.calendar || [])
    } catch {}
  }

  useEffect(() => {
    axios.get('/api/v1/patients').then(r => setPatients(r.data.items || r.data || [])).catch(() => {})
    fetchTasks(1)
    fetchCalendar()
  }, [])
  useEffect(() => { fetchTasks(1); setPage(1) }, [patientId, statusFilter, typeFilter])

  const handleComplete = async () => {
    const values = await completeForm.validateFields()
    setSubmitting(true)
    try {
      await axios.patch(`/api/v1/followup/tasks/${completeModal.task.id}/complete`, null, {
        params: { notes: values.notes },
      })
      message.success('任务已标记为完成')
      setCompleteModal({ open: false, task: null })
      fetchTasks(page)
    } catch { message.error('操作失败') }
    finally { setSubmitting(false) }
  }

  const cellRender = (date) => {
    const dateStr = date.format('YYYY-MM-DD')
    const dayData = calendarData.find(d => d.date === dateStr)
    if (!dayData) return null
    return (
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {dayData.tasks.slice(0, 3).map((t, i) => (
          <li key={i}>
            <Badge color={t.status === 'overdue' ? 'red' : t.status === 'completed' ? 'green' : 'blue'}
              text={<Text style={{ fontSize: 10 }}>{t.task_label}</Text>} />
          </li>
        ))}
        {dayData.tasks.length > 3 && <li><Text type="secondary" style={{ fontSize: 10 }}>+{dayData.tasks.length - 3} 项</Text></li>}
      </ul>
    )
  }

  const columns = [
    {
      title: '患者', dataIndex: 'patient_name', width: 100,
      render: (v, r) => <Space direction="vertical" size={0}>
        <Text strong style={{ fontSize: 13 }}>{v}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{r.patient_no}</Text>
      </Space>,
    },
    {
      title: '任务类型', dataIndex: 'task_label', width: 110,
      render: v => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '截止日期', dataIndex: 'due_date', width: 120,
      sorter: (a, b) => a.due_date.localeCompare(b.due_date),
      render: (v, r) => {
        const isOverdue = r.status === 'overdue'
        return <Text style={{ color: isOverdue ? '#ff4d4f' : undefined }}>{v}</Text>
      },
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (_, r) => (
        <Space>
          {STATUS_ICON[r.status]}
          <Badge status={r.status_color} text={r.status_label} />
        </Space>
      ),
    },
    { title: '负责人', dataIndex: 'assignee', width: 90 },
    {
      title: '当前阶段', dataIndex: 'current_phase', width: 110,
      render: v => <Tag style={{ fontSize: 11 }}>{v}</Tag>,
    },
    {
      title: '操作', width: 120, fixed: 'right',
      render: (_, r) => (
        <Space>
          {(r.status === 'pending' || r.status === 'overdue') && (
            <Button size="small" type="primary"
              onClick={() => { setCompleteModal({ open: true, task: r }); completeForm.resetFields() }}>
              完成
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: '#F5F7FA' }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>随访计划管理</Title>
        <Text type="secondary">AD-37 ~ AD-39 · 随访任务配置、执行与记录归档</Text>
      </div>

      {/* 统计 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        {[
          { title: '待完成任务', value: pendingCount, color: '#1677ff' },
          { title: '逾期任务', value: overdueCount, color: '#ff4d4f' },
          { title: '任务总数', value: total, color: '#52c41a' },
        ].map((s, i) => (
          <Col key={i} span={8}>
            <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: '12px 16px' }}>
              <Statistic title={s.title} value={s.value} valueStyle={{ color: s.color, fontSize: 22 }} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 筛选 + 视图切换 */}
      <Card style={{ marginBottom: 12, borderRadius: 10 }} bodyStyle={{ padding: '10px 16px' }}>
        <Space wrap>
          <Select style={{ width: 160 }} placeholder="选择患者" allowClear onChange={setPatientId}
            options={patients.map(p => ({ value: p.id, label: p.name }))} />
          <Select style={{ width: 120 }} value={statusFilter} options={STATUS_OPTS} onChange={setStatusFilter} />
          <Select style={{ width: 120 }} value={typeFilter} options={TYPE_OPTS} onChange={setTypeFilter} />
          <Segmented value={view} onChange={setView}
            options={[{ value: 'table', label: '列表' }, { value: 'calendar', label: '日历' }]} />
        </Space>
      </Card>

      {view === 'table' && (
        <Card style={{ borderRadius: 10 }}>
          <Table dataSource={tasks} columns={columns} rowKey="id"
            loading={loading} scroll={{ x: 850 }}
            pagination={{ current: page, total, pageSize: 20,
              onChange: p => { setPage(p); fetchTasks(p) },
              showTotal: t => `共 ${t} 条` }}
            size="middle"
            rowClassName={r => r.status === 'overdue' ? 'row-overdue' : ''} />
        </Card>
      )}

      {view === 'calendar' && (
        <Card style={{ borderRadius: 10 }}>
          <Calendar cellRender={cellRender} />
        </Card>
      )}

      {/* 完成确认 Modal */}
      <Modal title="标记任务完成"
        open={completeModal.open} onOk={handleComplete}
        onCancel={() => setCompleteModal({ open: false, task: null })}
        confirmLoading={submitting} okText="确认完成">
        <Text>任务：<strong>{completeModal.task?.task_label}</strong> — 患者：<strong>{completeModal.task?.patient_name}</strong></Text>
        <Form form={completeForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="notes" label="完成备注（可选）">
            <TextArea rows={2} placeholder="记录执行情况" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
