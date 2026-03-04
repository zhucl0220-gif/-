/**
 * KnowledgeBase/index.jsx
 * 知识库管理 CMS（AD-14 ~ AD-17）
 *
 * Tab 1 – 症状库管理       SymptomTab
 * Tab 2 – 营养规则与量表    RulesTab
 * Tab 3 – AI 知识图谱      QATab
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Tabs, Table, Button, Drawer, Form, Input, Select, Switch,
  Space, Tag, Tooltip, Popconfirm, message, Modal, Spin,
  Progress, Typography, Divider, Card, Row, Col, Badge,
  InputNumber, Empty, Alert,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  SyncOutlined, CheckCircleOutlined, ClockCircleOutlined,
  BookOutlined, ExperimentOutlined, RobotOutlined,
  BulbOutlined, MedicineBoxOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import styles from './KnowledgeBase.module.css'

const { TextArea } = Input
const { Text, Title } = Typography
const { Option } = Select

const API = '/api/v1/knowledge'

// 移植阶段选项
const PHASES = [
  { value: 'pre_assessment',   label: '术前评估期' },
  { value: 'pre_operation',    label: '术前准备期' },
  { value: 'early_post_op',    label: '术后早期（0–7天）' },
  { value: 'recovery',         label: '恢复期（8–30天）' },
  { value: 'rehabilitation',   label: '康复期（1–3月）' },
  { value: 'long_term_follow', label: '长期随访（>3月）' },
]

const PHASE_LABEL_MAP = Object.fromEntries(PHASES.map(p => [p.value, p.label]))

// 症状分类选项
const SYMPTOM_CATEGORIES = [
  '消化系统', '代谢异常', '感染/免疫', '心血管', '肾功能',
  '神经系统', '营养缺乏', '其他',
]

// QA 知识类别
const QA_CATEGORIES = [
  '营养评估', '膳食指导', '免疫抑制剂', '术后管理',
  '检验解读', '出院指导', '随访管理', '其他',
]

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 1: 症状字典管理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function SymptomTab() {
  const [symptoms, setSymptoms] = useState([])
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState(null)   // null = create mode
  const [filterCategory, setFilterCategory] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [form] = Form.useForm()

  const fetchSymptoms = useCallback(async () => {
    setLoading(true)
    try {
      const params = { active_only: false }
      if (filterCategory) params.category = filterCategory
      const res = await axios.get(`${API}/symptoms`, { params })
      setSymptoms(res.data.items || [])
    } catch (e) {
      message.error('加载症状列表失败')
    } finally {
      setLoading(false)
    }
  }, [filterCategory])

  useEffect(() => { fetchSymptoms() }, [fetchSymptoms])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      four_dim: { nutrition_impact: '', dietary_advice: '', warning_signs: '', follow_up_action: '' },
      phase_relevance: [],
      is_active: true,
    })
    setDrawerOpen(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue({
      symptom_name:    record.symptom_name,
      category:        record.category,
      is_active:       record.is_active,
      four_dim_nutrition_impact:  record.four_dim?.nutrition_impact || '',
      four_dim_dietary_advice:    record.four_dim?.dietary_advice || '',
      four_dim_warning_signs:     record.four_dim?.warning_signs || '',
      four_dim_follow_up_action:  record.four_dim?.follow_up_action || '',
      phase_relevance: Object.entries(record.phase_relevance || {}).filter(([, v]) => v).map(([k]) => k),
    })
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    try {
      const vals = await form.validateFields()
      const payload = {
        symptom_name: vals.symptom_name,
        category:     vals.category,
        is_active:    vals.is_active ?? true,
        four_dim: {
          nutrition_impact:  vals.four_dim_nutrition_impact || '',
          dietary_advice:    vals.four_dim_dietary_advice || '',
          warning_signs:     vals.four_dim_warning_signs || '',
          follow_up_action:  vals.four_dim_follow_up_action || '',
        },
        phase_relevance: Object.fromEntries(
          PHASES.map(p => [p.value, (vals.phase_relevance || []).includes(p.value)])
        ),
      }

      if (editing) {
        await axios.patch(`${API}/symptoms/${editing.id}`, payload)
        message.success('症状条目已更新')
      } else {
        await axios.post(`${API}/symptoms`, payload)
        message.success('症状条目已创建')
      }
      setDrawerOpen(false)
      fetchSymptoms()
    } catch (e) {
      if (e?.response?.data?.detail) message.error(e.response.data.detail)
    }
  }

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/symptoms/${id}`)
      message.success('已停用该症状条目')
      fetchSymptoms()
    } catch {
      message.error('操作失败')
    }
  }

  const filtered = symptoms.filter(s =>
    !searchText || s.symptom_name.includes(searchText) || s.category.includes(searchText)
  )

  const columns = [
    {
      title: '症状名称',
      dataIndex: 'symptom_name',
      width: 140,
      render: (v) => <Text strong>{v}</Text>,
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 110,
      render: (v) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '适用阶段',
      dataIndex: 'phase_relevance',
      render: (pr) => {
        const active = Object.entries(pr || {}).filter(([, v]) => v).map(([k]) => k)
        return active.length === 0
          ? <Text type="secondary">—</Text>
          : active.map(k => (
            <Tag key={k} color="geekblue" style={{ marginBottom: 2 }}>
              {PHASE_LABEL_MAP[k] || k}
            </Tag>
          ))
      },
    },
    {
      title: '营养影响（摘要）',
      dataIndex: 'four_dim',
      ellipsis: true,
      render: (fd) => fd?.nutrition_impact || <Text type="secondary">—</Text>,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v) => v
        ? <Badge status="success" text="启用" />
        : <Badge status="default" text="停用" />,
    },
    {
      title: '操作',
      width: 120,
      render: (_, record) => (
        <Space>
          <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm title="确认停用该症状条目？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="停用">
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索症状名称或分类"
          style={{ width: 240 }}
          allowClear
          onChange={e => setSearchText(e.target.value)}
        />
        <Select
          placeholder="按分类过滤"
          allowClear
          style={{ width: 160 }}
          onChange={setFilterCategory}
        >
          {SYMPTOM_CATEGORIES.map(c => <Option key={c} value={c}>{c}</Option>)}
        </Select>
        <Button icon={<SyncOutlined />} onClick={fetchSymptoms}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ marginLeft: 'auto' }}>
          新增症状
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        size="middle"
        pagination={{ pageSize: 15, showSizeChanger: false }}
        expandable={{
          expandedRowRender: (record) => (
            <div className={styles.fourDimGrid}>
              {[
                { key: 'nutrition_impact',  label: '营养影响', color: '#1677FF' },
                { key: 'dietary_advice',    label: '饮食建议', color: '#52C41A' },
                { key: 'warning_signs',     label: '预警信号', color: '#FA541C' },
                { key: 'follow_up_action',  label: '随访行动', color: '#722ED1' },
              ].map(dim => (
                <div key={dim.key} className={styles.dimCard}>
                  <div className={styles.dimLabel} style={{ color: dim.color }}>{dim.label}</div>
                  <div className={styles.dimValue}>{record.four_dim?.[dim.key] || '—'}</div>
                </div>
              ))}
            </div>
          ),
          rowExpandable: (record) => !!record.four_dim,
        }}
      />

      {/* 新建/编辑 Drawer */}
      <Drawer
        title={editing ? '编辑症状条目' : '新增症状条目'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={560}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleSave}>保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item name="symptom_name" label="症状名称" rules={[{ required: true }]}>
                <Input placeholder="如：恶心、腹水" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="category" label="分类" rules={[{ required: true }]}>
                <Select placeholder="选择分类">
                  {SYMPTOM_CATEGORIES.map(c => <Option key={c} value={c}>{c}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="phase_relevance" label="适用阶段（可多选）">
            <Select mode="multiple" placeholder="选择相关移植阶段">
              {PHASES.map(p => <Option key={p.value} value={p.value}>{p.label}</Option>)}
            </Select>
          </Form.Item>

          <Divider>四维营养解析</Divider>

          <Form.Item name="four_dim_nutrition_impact" label="营养影响">
            <TextArea rows={3} placeholder="该症状对营养吸收和代谢的影响..." />
          </Form.Item>
          <Form.Item name="four_dim_dietary_advice" label="饮食建议">
            <TextArea rows={3} placeholder="对应的饮食调整建议..." />
          </Form.Item>
          <Form.Item name="four_dim_warning_signs" label="预警信号">
            <TextArea rows={2} placeholder="需要立即就医的红色预警信号..." />
          </Form.Item>
          <Form.Item name="four_dim_follow_up_action" label="随访行动">
            <TextArea rows={2} placeholder="医护随访时需重点监测的指标或动作..." />
          </Form.Item>

          <Form.Item name="is_active" label="状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 2: 营养规则与量表配置
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function RulesTab() {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState({})
  const [forms] = useState(() => Object.fromEntries(PHASES.map(p => [p.value, null])) )
  // 每个阶段独立的 Form 实例
  const phaseForms = {}
  PHASES.forEach(p => {
    phaseForms[p.value] = Form.useForm()[0]
  })

  const fetchRules = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API}/rules`)
      const ruleMap = Object.fromEntries((res.data.items || []).map(r => [r.phase, r]))
      setRules(ruleMap)
    } catch {
      message.error('加载规则配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRules() }, [])

  // 载入表单初始值
  useEffect(() => {
    PHASES.forEach(p => {
      const r = rules[p.value]
      if (r && phaseForms[p.value]) {
        phaseForms[p.value].setFieldsValue({
          energy_kcal_per_kg:  r.energy_kcal_per_kg,
          protein_g_per_kg:    r.protein_g_per_kg,
          is_active:           r.is_active ?? true,
          rule_summary:        r.rule_content?.summary || '',
          template_fields:     r.assessment_template?.fields?.join('\n') || '',
        })
      }
    })
  }, [rules])

  const handleSavePhase = async (phase) => {
    const form = phaseForms[phase]
    if (!form) return
    try {
      const vals = await form.validateFields()
      setSaving(s => ({ ...s, [phase]: true }))
      const payload = {
        energy_kcal_per_kg: vals.energy_kcal_per_kg,
        protein_g_per_kg:   vals.protein_g_per_kg,
        is_active:          vals.is_active ?? true,
        updated_by:         '李主任',
        rule_content:       { summary: vals.rule_summary || '' },
        assessment_template: {
          fields: (vals.template_fields || '').split('\n').map(l => l.trim()).filter(Boolean),
        },
      }
      await axios.put(`${API}/rules/${phase}`, payload)
      message.success(`${PHASE_LABEL_MAP[phase]} 规则已保存`)
      fetchRules()
    } catch (e) {
      if (e?.response?.data?.detail) message.error(e.response.data.detail)
    } finally {
      setSaving(s => ({ ...s, [phase]: false }))
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>

  return (
    <div>
      <Alert
        type="info"
        showIcon
        message="营养规则配置"
        description="为每个移植阶段设定能量与蛋白目标、临床规则摘要和评估量表字段。AI 助手将自动引用这些规则生成营养方案。"
        style={{ marginBottom: 20 }}
      />
      {PHASES.map((phase, idx) => {
        const existing = rules[phase.value]
        return (
          <div key={phase.value} className={styles.rulePhaseCard}>
            <div className={styles.phaseTitle}>
              <ExperimentOutlined />
              <span>{phase.label}</span>
              {existing
                ? <Tag color="green" style={{ marginLeft: 8 }}>已配置</Tag>
                : <Tag color="orange" style={{ marginLeft: 8 }}>未配置</Tag>
              }
            </div>
            <Form form={phaseForms[phase.value]} layout="vertical">
              <Row gutter={24}>
                <Col span={7}>
                  <Form.Item name="energy_kcal_per_kg" label="推荐能量（kcal/kg/d）">
                    <InputNumber min={0} max={60} step={0.1} precision={1} style={{ width: '100%' }} placeholder="如 30.0" />
                  </Form.Item>
                </Col>
                <Col span={7}>
                  <Form.Item name="protein_g_per_kg" label="推荐蛋白（g/kg/d）">
                    <InputNumber min={0} max={4} step={0.1} precision={1} style={{ width: '100%' }} placeholder="如 1.5" />
                  </Form.Item>
                </Col>
                <Col span={5}>
                  <Form.Item name="is_active" label="规则状态" valuePropName="checked" initialValue={true}>
                    <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                  </Form.Item>
                </Col>
                <Col span={5} style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 24 }}>
                  <Button
                    type="primary"
                    loading={saving[phase.value]}
                    onClick={() => handleSavePhase(phase.value)}
                    style={{ width: '100%' }}
                  >
                    保存本阶段
                  </Button>
                </Col>
              </Row>
              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item name="rule_summary" label="规则摘要（AI 引用）">
                    <TextArea rows={4} placeholder="本阶段营养干预原则、禁忌、注意事项等..." />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="template_fields"
                    label="评估量表字段（每行一项）"
                    tooltip="AI 生成评估报告时将包含这些字段"
                  >
                    <TextArea
                      rows={4}
                      placeholder={`体重\nBMI\n白蛋白\n前白蛋白\nNRS 评分`}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </div>
        )
      })}
    </div>
  )
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 3: AI 知识图谱（Q&A）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function QATab() {
  const [qaList, setQaList] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(15)
  const [loading, setLoading] = useState(false)
  const [vectorizing, setVectorizing] = useState(false)
  const [vectorizeProgress, setVectorizeProgress] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [filterCategory, setFilterCategory] = useState(null)
  const [filterVectorized, setFilterVectorized] = useState(null)
  const [form] = Form.useForm()

  const fetchQA = useCallback(async (pg = page) => {
    setLoading(true)
    try {
      const params = { page: pg, page_size: pageSize }
      if (filterCategory) params.category = filterCategory
      if (filterVectorized !== null) params.vectorized = filterVectorized
      const res = await axios.get(`${API}/qa`, { params })
      setQaList(res.data.items || [])
      setTotal(res.data.total || 0)
    } catch {
      message.error('加载 Q&A 列表失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filterCategory, filterVectorized])

  useEffect(() => { fetchQA(page) }, [page, filterCategory, filterVectorized])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue({
      question:   record.question,
      answer:     record.answer,
      category:   record.category,
      phase_tags: record.phase_tags || [],
      source_doc: record.source_doc || '',
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    try {
      const vals = await form.validateFields()
      if (editing) {
        await axios.patch(`${API}/qa/${editing.id}`, vals)
        message.success('Q&A 条目已更新')
      } else {
        await axios.post(`${API}/qa`, vals)
        message.success('Q&A 条目已创建')
      }
      setModalOpen(false)
      fetchQA(1)
      setPage(1)
    } catch (e) {
      if (e?.response?.data?.detail) message.error(e.response.data.detail)
    }
  }

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/qa/${id}`)
      message.success('已删除')
      fetchQA(page)
    } catch {
      message.error('删除失败')
    }
  }

  const handleVectorizeAll = async () => {
    setVectorizing(true)
    setVectorizeProgress(0)
    try {
      // 模拟进度动画
      const tick = setInterval(() => {
        setVectorizeProgress(p => Math.min((p || 0) + Math.random() * 15, 90))
      }, 300)
      const res = await axios.post(`${API}/qa/vectorize`, {})
      clearInterval(tick)
      setVectorizeProgress(100)
      const cnt = res.data.vectorized_count || 0
      message.success(`向量化完成！共处理 ${cnt} 条记录`)
      setTimeout(() => setVectorizeProgress(null), 1500)
      fetchQA(page)
    } catch {
      message.error('向量化失败')
      setVectorizeProgress(null)
    } finally {
      setVectorizing(false)
    }
  }

  // 统计
  const vectorizedCount = qaList.filter(q => q.is_vectorized).length
  const pendingCount = qaList.filter(q => !q.is_vectorized).length

  const columns = [
    {
      title: '问题',
      dataIndex: 'question',
      ellipsis: true,
      render: (v) => <Text style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: '类别',
      dataIndex: 'category',
      width: 110,
      render: (v) => <Tag color="purple">{v}</Tag>,
    },
    {
      title: '适用阶段',
      dataIndex: 'phase_tags',
      width: 220,
      render: (tags) =>
        (tags || []).length === 0
          ? <Text type="secondary">—</Text>
          : tags.map(t => (
            <Tag key={t} color="cyan" style={{ marginBottom: 2 }}>
              {PHASE_LABEL_MAP[t] || t}
            </Tag>
          )),
    },
    {
      title: '向量化',
      dataIndex: 'is_vectorized',
      width: 100,
      render: (v) => v
        ? <span className={`${styles.vectorizedBadge} ${styles.done}`}><CheckCircleOutlined /> 已同步</span>
        : <span className={`${styles.vectorizedBadge} ${styles.pending}`}><ClockCircleOutlined /> 待同步</span>,
    },
    {
      title: '来源',
      dataIndex: 'source_doc',
      width: 130,
      ellipsis: true,
      render: (v) => v ? <Text type="secondary">{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: '操作',
      width: 120,
      render: (_, record) => (
        <Space>
          <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm title="确认删除该 Q&A？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // 展开行显示答案内容
  const expandedRowRender = (record) => (
    <div style={{ padding: '8px 16px', background: '#FAFAFA', borderRadius: 6 }}>
      <Text strong style={{ color: '#1677FF' }}>答案：</Text>
      <p style={{ margin: '4px 0 0', color: '#262626', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
        {record.answer}
      </p>
    </div>
  )

  return (
    <div>
      {/* 统计行 */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#1677FF' }}>{total}</div>
          <div className={styles.statLabel}>Q&A 总条目</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#52C41A' }}>{vectorizedCount}</div>
          <div className={styles.statLabel}>已向量化（当前页）</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#FA8C16' }}>{pendingCount}</div>
          <div className={styles.statLabel}>待向量化（当前页）</div>
        </div>
        <div className={styles.statCard} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={vectorizing}
            onClick={handleVectorizeAll}
            danger={false}
            style={{ background: '#722ED1', borderColor: '#722ED1' }}
          >
            一键向量化同步
          </Button>
        </div>
      </div>

      {/* 向量化进度条 */}
      {vectorizeProgress !== null && (
        <div className={styles.vectorizeProgress}>
          <RobotOutlined style={{ color: '#1677FF', fontSize: 18 }} />
          <Text style={{ minWidth: 160 }}>正在同步至大模型知识库...</Text>
          <Progress percent={Math.round(vectorizeProgress)} style={{ flex: 1 }} status="active" />
        </div>
      )}

      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select
          placeholder="按类别过滤"
          allowClear
          style={{ width: 160 }}
          onChange={setFilterCategory}
        >
          {QA_CATEGORIES.map(c => <Option key={c} value={c}>{c}</Option>)}
        </Select>
        <Select
          placeholder="向量化状态"
          allowClear
          style={{ width: 140 }}
          onChange={v => setFilterVectorized(v === undefined ? null : v)}
        >
          <Option value={true}>已向量化</Option>
          <Option value={false}>待向量化</Option>
        </Select>
        <Button icon={<SyncOutlined />} onClick={() => fetchQA(page)}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ marginLeft: 'auto' }}>
          新增 Q&A
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={qaList}
        rowKey="id"
        loading={loading}
        size="middle"
        expandable={{ expandedRowRender }}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p) => setPage(p),
          showTotal: (t) => `共 ${t} 条`,
        }}
      />

      {/* 新建/编辑 Modal */}
      <Modal
        title={editing ? '编辑 Q&A 条目' : '新增 Q&A 条目'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={700}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="question" label="问题" rules={[{ required: true, message: '请输入问题' }]}>
            <TextArea rows={3} placeholder="患者或医护可能提出的问题..." />
          </Form.Item>
          <Form.Item name="answer" label="答案" rules={[{ required: true, message: '请输入答案' }]}>
            <TextArea rows={6} placeholder="标准答案，支持换行格式..." />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="category" label="知识类别" rules={[{ required: true }]}>
                <Select placeholder="选择类别">
                  {QA_CATEGORIES.map(c => <Option key={c} value={c}>{c}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="source_doc" label="来源文档（可选）">
                <Input placeholder="如：肝移植营养指南2024.pdf" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="phase_tags" label="适用阶段（可多选）">
            <Select mode="multiple" placeholder="选择适用移植阶段">
              {PHASES.map(p => <Option key={p.value} value={p.value}>{p.label}</Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主页面组件
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function KnowledgeBase() {
  const tabItems = [
    {
      key: 'symptoms',
      label: (
        <span>
          <MedicineBoxOutlined />
          症状库管理
        </span>
      ),
      children: <SymptomTab />,
    },
    {
      key: 'rules',
      label: (
        <span>
          <BulbOutlined />
          营养规则与量表
        </span>
      ),
      children: <RulesTab />,
    },
    {
      key: 'qa',
      label: (
        <span>
          <RobotOutlined />
          AI 知识图谱
        </span>
      ),
      children: <QATab />,
    },
  ]

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.pageHeader}>
        <Title level={4} style={{ margin: 0 }}>
          <BookOutlined style={{ marginRight: 8, color: '#1677FF' }} />
          知识库管理
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          管理症状字典、阶段营养规则与 AI 知识图谱，为智能体提供权威知识支撑
        </Text>
      </div>

      <div className={styles.tabCard}>
        <Tabs
          defaultActiveKey="symptoms"
          items={tabItems}
          style={{ padding: '0 24px' }}
          tabBarStyle={{ marginBottom: 0, borderBottom: '1px solid #F0F0F0' }}
          tabBarGutter={32}
        />
      </div>
    </div>
  )
}
