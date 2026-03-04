import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Table, Tag, Button, Space, Select, Modal, Form, Input,
  Typography, Row, Col, Statistic, Drawer, InputNumber, Badge,
  message, Descriptions, Divider,
} from 'antd'
import {
  PlusOutlined, CheckOutlined, CloseOutlined, DiffOutlined,
} from '@ant-design/icons'
import axios from 'axios'

const { Title, Text } = Typography
const { TextArea } = Input

const PHASE_OPTS = [
  { value: '', label: '全部阶段' },
  { value: 'pre_surgery', label: '术前准备' },
  { value: 'surgery', label: '手术期' },
  { value: 'post_surgery_acute', label: '术后急性期' },
  { value: 'post_surgery_stable', label: '术后稳定期' },
  { value: 'long_term_care', label: '长期维护' },
  { value: 'rehabilitation', label: '康复随访' },
]

const REVIEW_OPTS = [
  { value: '', label: '全部状态' },
  { value: 'pending_review', label: '待审核' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已驳回' },
  { value: 'expired', label: '已过期' },
]

export default function PlanManagement() {
  const [plans, setPlans] = useState([])
  const [total, setTotal] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [patients, setPatients] = useState([])
  const [patientId, setPatientId] = useState(null)
  const [reviewStatus, setReviewStatus] = useState('')

  const [detailDrawer, setDetailDrawer] = useState({ open: false, plan: null })
  const [reviewModal, setReviewModal] = useState({ open: false, plan: null, action: null })
  const [createModal, setCreateModal] = useState(false)
  const [compareModal, setCompareModal] = useState({ open: false, data: null })

  const [reviewForm] = Form.useForm()
  const [createForm] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const fetchPlans = useCallback(async (pg = 1) => {
    setLoading(true)
    try {
      const params = { page: pg, page_size: 20 }
      if (patientId) params.patient_id = patientId
      if (reviewStatus) params.review_status = reviewStatus
      const res = await axios.get('/api/v1/plans/list', { params })
      setPlans(res.data.items || [])
      setTotal(res.data.total || 0)
      setPendingCount(res.data.pending_count || 0)
    } catch { setPlans([]) }
    finally { setLoading(false) }
  }, [patientId, reviewStatus])

  useEffect(() => {
    axios.get('/api/v1/patients').then(r => setPatients(r.data.items || r.data || [])).catch(() => {})
    fetchPlans(1)
  }, [])
  useEffect(() => { fetchPlans(1); setPage(1) }, [patientId, reviewStatus])

  const submitReview = async () => {
    const values = await reviewForm.validateFields()
    setSubmitting(true)
    try {
      const { plan, action } = reviewModal
      await axios.patch(`/api/v1/plans/${plan.id}/review`, null, {
        params: { action, notes: values.notes },
      })
      message.success(action === 'approve' ? '已批准方案' : '已驳回方案')
      setReviewModal({ open: false, plan: null, action: null })
      fetchPlans(page)
    } catch { message.error('操作失败') }
    finally { setSubmitting(false) }
  }

  const submitCreate = async () => {
    const values = await createForm.validateFields()
    setSubmitting(true)
    try {
      await axios.post('/api/v1/plans/create', null, { params: values })
      message.success('方案创建成功，已提交审核')
      setCreateModal(false)
      createForm.resetFields()
      fetchPlans(1)
    } catch { message.error('创建失败') }
    finally { setSubmitting(false) }
  }

  const handleCompare = async (plan) => {
    try {
      const res = await axios.get('/api/v1/plans/compare', {
        params: { plan_a_id: plan.id, plan_b_id: plan.id - 1 > 0 ? plan.id - 1 : plan.id },
      })
      setCompareModal({ open: true, data: res.data })
    } catch { message.error('对比加载失败') }
  }

  const columns = [
    {
      title: '患者', dataIndex: 'patient_name', width: 110,
      render: (v, r) => <Space direction="vertical" size={0}>
        <Text strong style={{ fontSize: 13 }}>{v}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{r.patient_no}</Text>
      </Space>,
    },
    { title: '阶段', dataIndex: 'phase_label', width: 110,
      render: v => <Tag color="blue">{v}</Tag> },
    { title: '版本', dataIndex: 'version', width: 60,
      render: v => <Tag>v{v}</Tag> },
    {
      title: '热量/蛋白质', width: 130,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{r.plan_content?.total_kcal} kcal</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>蛋白: {r.plan_content?.protein_g}g</Text>
        </Space>
      ),
    },
    {
      title: '审核状态', dataIndex: 'review_status', width: 110,
      render: (_, r) => <Badge status={r.review_status_color} text={r.review_status_label} />,
    },
    { title: '创建来源', dataIndex: 'generated_by', width: 140, ellipsis: true },
    { title: '有效期', dataIndex: 'valid_from', width: 120,
      render: (v, r) => <Text style={{ fontSize: 11 }}>{v} ~ {r.valid_until?.slice(5)}</Text> },
    {
      title: '操作', width: 200, fixed: 'right',
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => setDetailDrawer({ open: true, plan: r })}>详情</Button>
          <Button size="small" icon={<DiffOutlined />} onClick={() => handleCompare(r)}>对比</Button>
          {r.review_status === 'pending_review' && (
            <>
              <Button size="small" type="primary" icon={<CheckOutlined />}
                onClick={() => { setReviewModal({ open: true, plan: r, action: 'approve' }); reviewForm.resetFields() }}>批准</Button>
              <Button size="small" danger icon={<CloseOutlined />}
                onClick={() => { setReviewModal({ open: true, plan: r, action: 'reject' }); reviewForm.resetFields() }}>驳回</Button>
            </>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: '#F5F7FA' }}>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>营养方案管理</Title>
          <Text type="secondary">AD-34 ~ AD-36 · 方案审核、版本对比与手动创建</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModal(true)}>
          手动创建方案
        </Button>
      </div>

      {/* 汇总 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        {[
          { label: '待审核方案', value: pendingCount, color: '#1677ff' },
          { label: '方案总数', value: total, color: '#52c41a' },
        ].map((s, i) => (
          <Col key={i} span={6}>
            <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: '12px 16px' }}>
              <Statistic title={s.label} value={s.value} valueStyle={{ color: s.color, fontSize: 22 }} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 筛选 */}
      <Card style={{ marginBottom: 12, borderRadius: 10 }} bodyStyle={{ padding: '10px 16px' }}>
        <Space wrap>
          <Select style={{ width: 160 }} placeholder="选择患者" allowClear onChange={setPatientId}
            options={patients.map(p => ({ value: p.id, label: p.name }))} />
          <Select style={{ width: 130 }} value={reviewStatus} options={REVIEW_OPTS}
            onChange={setReviewStatus} />
        </Space>
      </Card>

      <Card style={{ borderRadius: 10 }}>
        <Table dataSource={plans} columns={columns} rowKey="id"
          loading={loading} scroll={{ x: 1000 }}
          pagination={{ current: page, total, pageSize: 20,
            onChange: p => { setPage(p); fetchPlans(p) },
            showTotal: t => `共 ${t} 条` }}
          size="middle"
          rowClassName={r => r.review_status === 'pending_review' ? 'row-highlight' : ''} />
      </Card>

      {/* 方案详情 Drawer */}
      <Drawer title={`方案详情 — ${detailDrawer.plan?.patient_name} v${detailDrawer.plan?.version}`}
        open={detailDrawer.open} onClose={() => setDetailDrawer({ open: false, plan: null })} width={440}>
        {detailDrawer.plan && (() => {
          const p = detailDrawer.plan
          const c = p.plan_content || {}
          return (
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="患者">{p.patient_name}</Descriptions.Item>
                <Descriptions.Item label="阶段">{p.phase_label}</Descriptions.Item>
                <Descriptions.Item label="版本">v{p.version}</Descriptions.Item>
                <Descriptions.Item label="状态"><Badge status={p.review_status_color} text={p.review_status_label} /></Descriptions.Item>
                <Descriptions.Item label="热量目标" span={2}>{c.total_kcal} kcal/天</Descriptions.Item>
                <Descriptions.Item label="蛋白质">{c.protein_g} g</Descriptions.Item>
                <Descriptions.Item label="脂肪">{c.fat_g} g</Descriptions.Item>
                <Descriptions.Item label="碳水化合物" span={2}>{c.carb_g} g</Descriptions.Item>
                <Descriptions.Item label="有效期" span={2}>{p.valid_from} ~ {p.valid_until}</Descriptions.Item>
                <Descriptions.Item label="创建来源" span={2}>{p.generated_by}</Descriptions.Item>
              </Descriptions>
              {c.highlights && (
                <Card size="small" title="方案要点" style={{ borderRadius: 8 }}>
                  <Space wrap>{c.highlights.map((h, i) => <Tag key={i} color="blue">{h}</Tag>)}</Space>
                </Card>
              )}
              {p.review_notes && (
                <Card size="small" title="审核意见" style={{ borderRadius: 8 }}>
                  <Text style={{ fontSize: 13 }}>{p.review_notes}</Text>
                </Card>
              )}
            </Space>
          )
        })()}
      </Drawer>

      {/* 审核 Modal */}
      <Modal title={reviewModal.action === 'approve' ? '批准营养方案' : '驳回营养方案'}
        open={reviewModal.open} onOk={submitReview} onCancel={() => setReviewModal({ open: false, plan: null, action: null })}
        confirmLoading={submitting} okText="确认"
        okButtonProps={{ danger: reviewModal.action === 'reject' }}>
        <Text>患者: <strong>{reviewModal.plan?.patient_name}</strong> — {reviewModal.plan?.phase_label} v{reviewModal.plan?.version}</Text>
        <Form form={reviewForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="notes" label="审核意见">
            <TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 手动创建 Modal */}
      <Modal title={<Space><PlusOutlined />手动创建营养方案</Space>}
        open={createModal} onOk={submitCreate} onCancel={() => setCreateModal(false)}
        confirmLoading={submitting} okText="提交审核" width={500}>
        <Form form={createForm} layout="vertical">
          <Form.Item name="patient_id" label="目标患者" rules={[{ required: true }]}>
            <Select options={patients.map(p => ({ value: p.id, label: `${p.name} (${p.patient_no})` }))} />
          </Form.Item>
          <Form.Item name="phase" label="方案阶段" rules={[{ required: true }]}>
            <Select options={PHASE_OPTS.filter(o => o.value)} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="total_kcal" label="总热量 (kcal)" initialValue={1800}>
                <InputNumber min={800} max={3500} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="protein_g" label="蛋白质 (g)" initialValue={70}>
                <InputNumber min={30} max={150} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fat_g" label="脂肪 (g)" initialValue={55}>
                <InputNumber min={20} max={120} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="carb_g" label="碳水化合物 (g)" initialValue={220}>
                <InputNumber min={100} max={400} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 版本对比 Modal */}
      <Modal title={<Space><DiffOutlined />方案版本对比</Space>}
        open={compareModal.open} onCancel={() => setCompareModal({ open: false, data: null })}
        footer={null} width={600}>
        {compareModal.data && (() => {
          const { plan_a, plan_b, diff_keys } = compareModal.data
          const keys = [
            { key: 'total_kcal', label: '总热量 (kcal)' },
            { key: 'protein_g', label: '蛋白质 (g)' },
            { key: 'fat_g', label: '脂肪 (g)' },
            { key: 'carb_g', label: '碳水化合物 (g)' },
          ]
          return (
            <Table size="small" pagination={false}
              dataSource={keys}
              columns={[
                { title: '指标', dataIndex: 'label', width: 150 },
                {
                  title: `版本 A (ID:${plan_a.id})`, dataIndex: 'key',
                  render: k => <Text style={{ color: diff_keys.includes(k) ? '#ff4d4f' : undefined }}>{plan_a[k]}</Text>,
                },
                {
                  title: `版本 B (ID:${plan_b.id})`, dataIndex: 'key',
                  render: k => <Text style={{ color: diff_keys.includes(k) ? '#52c41a' : undefined }}>{plan_b[k]}</Text>,
                },
                {
                  title: '差值', dataIndex: 'key',
                  render: k => {
                    const diff = (plan_b[k] || 0) - (plan_a[k] || 0)
                    return <Text type={diff > 0 ? 'success' : diff < 0 ? 'danger' : 'secondary'}>
                      {diff > 0 ? '+' : ''}{diff}
                    </Text>
                  },
                },
              ]}
              rowKey="key"
            />
          )
        })()}
      </Modal>
    </div>
  )
}
