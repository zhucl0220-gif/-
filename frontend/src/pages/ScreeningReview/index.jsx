import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Table, Tag, Button, Space, Select, Modal, Form, Input,
  Typography, Row, Col, Statistic, Drawer, List, Tooltip, Badge,
  Popconfirm, message,
} from 'antd'
import {
  UserAddOutlined, CheckOutlined, CloseOutlined, ClockCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import axios from 'axios'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

const STATUS_OPTS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已入组' },
  { value: 'rejected', label: '未通过' },
  { value: 'waitlisted', label: '候补等待' },
]

export default function ScreeningReview() {
  const [records, setRecords] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState({})
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [reviewModal, setReviewModal] = useState({ open: false, record: null, action: null })
  const [reviewForm] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const fetchRecords = useCallback(async (pg = 1) => {
    setLoading(true)
    try {
      const params = { page: pg, page_size: 20 }
      if (statusFilter) params.status = statusFilter
      const res = await axios.get('/api/v1/screening/list', { params })
      setRecords(res.data.items || [])
      setTotal(res.data.total || 0)
      setSummary(res.data.summary || {})
    } catch { setRecords([]) }
    finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { fetchRecords(1); setPage(1) }, [statusFilter])

  const openReview = (record, action) => {
    setReviewModal({ open: true, record, action })
    reviewForm.resetFields()
  }

  const submitReview = async () => {
    const values = await reviewForm.validateFields()
    setSubmitting(true)
    try {
      const actionMap = { approve: 'approve', reject: 'reject', waitlist: 'waitlist' }
      const { record, action } = reviewModal
      await axios.patch(`/api/v1/screening/${record.id}/review`, null, {
        params: { action: actionMap[action], notes: values.notes },
      })
      message.success('审核完成')
      setReviewModal({ open: false, record: null, action: null })
      fetchRecords(page)
    } catch { message.error('操作失败') }
    finally { setSubmitting(false) }
  }

  const columns = [
    {
      title: '患者', dataIndex: 'patient_name', width: 120,
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{r.patient_no}</Text>
        </Space>
      ),
    },
    { title: '性别', dataIndex: 'gender', width: 60 },
    { title: '年龄', dataIndex: 'age', width: 70, render: v => v ? `${v} 岁` : '—' },
    {
      title: 'MELD 评分', dataIndex: 'meld_score', width: 100,
      render: v => <Text style={{ color: v >= 20 ? '#ff4d4f' : v >= 15 ? '#faad14' : '#52c41a' }}>{v}</Text>,
      sorter: (a, b) => a.meld_score - b.meld_score,
      defaultSortOrder: 'descend',
    },
    { title: '申请日期', dataIndex: 'submit_date', width: 110 },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (_, r) => <Badge status={r.status_color} text={r.status_label} />,
    },
    {
      title: '排除标志', dataIndex: 'exclusion_flags', width: 150,
      render: flags => flags?.length
        ? flags.map((f, i) => <Tag key={i} color="red" style={{ fontSize: 11 }}>{f}</Tag>)
        : <Text type="secondary" style={{ fontSize: 12 }}>无</Text>,
    },
    {
      title: '操作', width: 200, fixed: 'right',
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => { setSelected(r); setDrawerOpen(true) }}>详情</Button>
          {r.status === 'pending' && (
            <>
              <Button size="small" type="primary" icon={<CheckOutlined />}
                onClick={() => openReview(r, 'approve')}>入组</Button>
              <Button size="small" danger icon={<CloseOutlined />}
                onClick={() => openReview(r, 'reject')}>拒绝</Button>
            </>
          )}
          {r.status === 'pending' && (
            <Button size="small" icon={<ClockCircleOutlined />}
              onClick={() => openReview(r, 'waitlist')}>候补</Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: '#F5F7FA' }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>入组筛查管理</Title>
        <Text type="secondary">AD-29 ~ AD-30 · 患者入组资格审核与管理</Text>
      </div>

      {/* 汇总卡片 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        {[
          { label: '待审核', key: 'pending', color: '#1677ff' },
          { label: '已入组', key: 'approved', color: '#52c41a' },
          { label: '未通过', key: 'rejected', color: '#ff4d4f' },
          { label: '候补等待', key: 'waitlisted', color: '#faad14' },
        ].map(s => (
          <Col key={s.key} xs={12} sm={6}>
            <Card style={{ borderRadius: 10, cursor: 'pointer', borderColor: statusFilter === s.key ? s.color : undefined }}
              bodyStyle={{ padding: '12px 16px' }}
              onClick={() => setStatusFilter(statusFilter === s.key ? '' : s.key)}>
              <Statistic title={s.label} value={summary[s.key] || 0}
                valueStyle={{ color: s.color, fontSize: 22 }} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 筛选 */}
      <Card style={{ marginBottom: 12, borderRadius: 10 }} bodyStyle={{ padding: '10px 16px' }}>
        <Select style={{ width: 140 }} value={statusFilter} options={STATUS_OPTS}
          onChange={v => { setStatusFilter(v); setPage(1) }} />
      </Card>

      {/* 表格 */}
      <Card style={{ borderRadius: 10 }}>
        <Table dataSource={records} columns={columns} rowKey="id"
          loading={loading} scroll={{ x: 950 }}
          pagination={{ current: page, total, pageSize: 20,
            onChange: (p) => { setPage(p); fetchRecords(p) },
            showTotal: t => `共 ${t} 条` }}
          size="middle" />
      </Card>

      {/* 详情 Drawer */}
      <Drawer title={`筛查详情 — ${selected?.patient_name || ''}`}
        open={drawerOpen} onClose={() => setDrawerOpen(false)} width={440}>
        {selected && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Card size="small" title="基本信息" style={{ borderRadius: 8 }}>
              <Row gutter={8}>
                {[
                  ['患者姓名', selected.patient_name], ['患者编号', selected.patient_no],
                  ['性别', selected.gender], ['年龄', `${selected.age} 岁`],
                  ['MELD评分', selected.meld_score], ['状态', selected.status_label],
                ].map(([k, v]) => (
                  <Col key={k} span={12} style={{ marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>{k}</Text>
                    <div><Text strong>{v}</Text></div>
                  </Col>
                ))}
              </Row>
            </Card>
            <Card size="small" title="入组标准（满足项）" style={{ borderRadius: 8 }}>
              {selected.criteria_met.map((c, i) => (
                <Tag key={i} color="green" style={{ marginBottom: 4 }}>{c}</Tag>
              ))}
            </Card>
            {selected.exclusion_flags.length > 0 && (
              <Card size="small" title="排除标志" style={{ borderRadius: 8, borderColor: '#ff4d4f' }}>
                {selected.exclusion_flags.map((f, i) => (
                  <Tag key={i} color="red" style={{ marginBottom: 4 }}>{f}</Tag>
                ))}
              </Card>
            )}
            {selected.notes && (
              <Card size="small" title="备注" style={{ borderRadius: 8 }}>
                <Paragraph style={{ margin: 0, fontSize: 13 }}>{selected.notes}</Paragraph>
              </Card>
            )}
          </Space>
        )}
      </Drawer>

      {/* 审核 Modal */}
      <Modal
        title={reviewModal.action === 'approve' ? '确认入组' : reviewModal.action === 'reject' ? '拒绝入组' : '加入候补'}
        open={reviewModal.open}
        onOk={submitReview}
        onCancel={() => setReviewModal({ open: false, record: null, action: null })}
        confirmLoading={submitting}
        okText="确认"
        cancelText="取消"
        okButtonProps={{ danger: reviewModal.action === 'reject' }}
      >
        <Text>患者：<strong>{reviewModal.record?.patient_name}</strong></Text>
        <Form form={reviewForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="notes" label="审核备注">
            <TextArea rows={3} placeholder="请输入审核意见（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
