/**
 * SystemSettings — 系统设置页
 * ─────────────────────────────────────────────────────────────────────────────
 * 4 个 Tab:
 *   Tab 1  账号权限   — 占位（RBAC 迭代）
 *   Tab 2  操作日志   — AgentTask 分页列表（类型 + 状态筛选）
 *   Tab 3  协议模板   — Markdown 文档编辑 + 版本号
 *   Tab 4  大模型工具   — 所有注册 Tool 的卡片 + 分类 Tabs + 筛选表格
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Avatar, Badge, Button, Card, Col, Descriptions, Input, message, Modal,
  Row, Select, Space, Spin, Switch, Table, Tag, Tabs, Tooltip,
  Typography, Statistic,
} from 'antd'
import {
  ApiOutlined, AppstoreOutlined, CheckCircleOutlined, CodeOutlined,
  DatabaseOutlined, EditOutlined, EyeOutlined, FireOutlined,
  LockOutlined, MinusCircleOutlined, ReloadOutlined,
  RobotOutlined, SaveOutlined, SearchOutlined, SettingOutlined, SyncOutlined,
  ThunderboltOutlined, ToolOutlined, UnorderedListOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import dayjs from 'dayjs'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input
const { Option } = Select

const API = '/api/v1/system'

// ── 工具类型色彩映射（与后端保持一致） ────────────────────────────────────────
const TYPE_COLOR = {
  retrieval: 'blue',
  compute:   'green',
  file_ops:  'orange',
  write:     'volcano',
  external:  'purple',
}

// ── 任务状态映射 ──────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  queued:    'default',
  running:   'processing',
  completed: 'success',
  failed:    'error',
}
const STATUS_LABELS = {
  queued:    '排队中',
  running:   '执行中',
  completed: '已完成',
  failed:    '失败',
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 1 — 账号权限（占位）
// ═════════════════════════════════════════════════════════════════════════════
function AccountTab() {
  return (
    <Card bordered={false}>
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#8C8C8C' }}>
        <LockOutlined style={{ fontSize: 64, marginBottom: 16 }} />
        <Title level={4} style={{ color: '#8C8C8C' }}>账号权限管理</Title>
        <Paragraph type="secondary">
          RBAC 多角色权限系统 · 即将推出（下一迭代）
        </Paragraph>
      </div>
    </Card>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 2 — 操作日志
// ═════════════════════════════════════════════════════════════════════════════
function LogsTab() {
  const [loading, setLoading]   = useState(false)
  const [data, setData]         = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [taskType, setTaskType] = useState(null)
  const [status, setStatus]     = useState(null)

  const fetchLogs = useCallback(async (pg = page, ps = pageSize, tt = taskType, st = status) => {
    setLoading(true)
    try {
      const params = { page: pg, page_size: ps }
      if (tt) params.task_type = tt
      if (st) params.status = st
      const { data: res } = await axios.get(`${API}/operation-logs`, { params })
      setData(res.items || [])
      setTotal(res.total || 0)
    } catch {
      message.error('日志加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, taskType, status])

  useEffect(() => { fetchLogs() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const columns = [
    {
      title: '时间', dataIndex: 'created_at', width: 170,
      render: v => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '任务类型', dataIndex: 'task_type', width: 130,
      render: v => <Tag>{v || '-'}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: v => (
        <Badge status={STATUS_COLORS[v] || 'default'} text={STATUS_LABELS[v] || v || '-'} />
      ),
    },
    {
      title: '患者', dataIndex: 'patient_name', width: 100,
      render: v => v || <Text type="secondary">（系统）</Text>,
    },
    {
      title: '使用模型', dataIndex: 'llm_model', ellipsis: true, width: 150,
      render: v => <Text code>{v || '-'}</Text>,
    },
    {
      title: 'Token', dataIndex: 'total_tokens', width: 80, align: 'right',
      render: v => v ?? '-',
    },
    {
      title: '耗时(s)', dataIndex: 'duration_ms', width: 85, align: 'right',
      render: v => v != null ? (v / 1000).toFixed(2) : '-',
    },
    {
      title: '触发来源', dataIndex: 'triggered_by', width: 100,
      render: v => v ? <Tag>{v}</Tag> : <Text type="secondary">-</Text>,
    },
  ]

  return (
    <Card
      bordered={false}
      title={
        <Space>
          <UnorderedListOutlined />
          <span>操作日志</span>
          <Text type="secondary" style={{ fontSize: 12 }}>（Agent 任务记录）</Text>
        </Space>
      }
      extra={
        <Space>
          <Select
            allowClear placeholder="任务类型"
            style={{ width: 130 }}
            value={taskType}
            onChange={v => { setTaskType(v); fetchLogs(1, pageSize, v, status) }}
          >
            {[
              { value: 'lab_analysis',    label: '检验单解读' },
              { value: 'nutrition_plan',  label: '营养方案生成' },
              { value: 'web_search',      label: '网络搜索' },
              { value: 'code_execution',  label: '代码沙箱' },
              { value: 'diet_evaluation', label: '饮食评估' },
              { value: 'general_qa',      label: '通用问答' },
            ].map(t => (
              <Option key={t.value} value={t.value}>{t.label}</Option>
            ))}
          </Select>
          <Select
            allowClear placeholder="状态"
            style={{ width: 100 }}
            value={status}
            onChange={v => { setStatus(v); fetchLogs(1, pageSize, taskType, v) }}
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <Option key={k} value={k}>{v}</Option>
            ))}
          </Select>
          <Button icon={<ReloadOutlined />} onClick={() => fetchLogs()}>刷新</Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        size="small"
        scroll={{ x: 900 }}
        pagination={{
          current: page, pageSize, total,
          showSizeChanger: true,
          showTotal: t => `共 ${t} 条`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); fetchLogs(p, ps) },
        }}
      />
    </Card>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 3 — 协议模板
// ═════════════════════════════════════════════════════════════════════════════
const TEMPLATE_LABELS = {
  privacy_policy:   '个人信息保护声明',
  informed_consent: '营养干预知情同意书',
  data_sharing:     '数据共享授权声明',
}

function TemplatesTab() {
  const [loading, setLoading]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [templates, setTemplates] = useState([])
  const [selected, setSelected]   = useState('privacy_policy')
  const [draft, setDraft]         = useState('')
  const dirty = useRef(false)

  const current = templates.find(t => t.key === selected)

  const fetchTemplates = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/consent-templates`)
      setTemplates(data.items || [])
    } catch {
      message.error('模板加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTemplates() }, [])

  useEffect(() => {
    if (current) { setDraft(current.content); dirty.current = false }
  }, [current])

  const handleSelect = (key) => {
    if (dirty.current) {
      Modal.confirm({
        title: '未保存的修改',
        content: '切换模板将丢失当前编辑内容，是否继续？',
        onOk: () => { setSelected(key); dirty.current = false },
      })
    } else {
      setSelected(key)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data } = await axios.put(`${API}/consent-templates/${selected}`, {
        content: draft, updated_by: '管理员',
      })
      message.success(`已保存（版本 ${data.version}）`)
      dirty.current = false
      await fetchTemplates()
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Spin spinning={loading}>
      <Row gutter={16}>
        {/* 左侧模板列表 */}
        <Col span={6}>
          <Card size="small" title="协议文档" style={{ height: '100%' }}>
            {templates.map(t => (
              <div
                key={t.key}
                onClick={() => handleSelect(t.key)}
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  borderRadius: 6,
                  marginBottom: 4,
                  background: selected === t.key ? '#E6F4FF' : 'transparent',
                  border: selected === t.key ? '1px solid #91CAFF' : '1px solid transparent',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ fontWeight: selected === t.key ? 600 : 400, fontSize: 13 }}>
                  {TEMPLATE_LABELS[t.key] || t.key}
                </div>
                <div style={{ fontSize: 11, color: '#8C8C8C', marginTop: 2 }}>
                  版本 {t.version} · {t.updated_at ? dayjs(t.updated_at).format('MM-DD HH:mm') : '-'}
                </div>
              </div>
            ))}
          </Card>
        </Col>

        {/* 右侧编辑区 */}
        <Col span={18}>
          <Card
            size="small"
            title={
              <Space>
                <EditOutlined />
                <span>{current ? (TEMPLATE_LABELS[current.key] || current.key) : '—'}</span>
                {current && (
                  <Tag color="blue">v{current.version}</Tag>
                )}
              </Space>
            }
            extra={
              <Button
                type="primary" icon={<SaveOutlined />}
                loading={saving}
                onClick={handleSave}
                disabled={!draft}
              >
                保存
              </Button>
            }
          >
            <TextArea
              value={draft}
              onChange={e => { setDraft(e.target.value); dirty.current = true }}
              rows={22}
              style={{ fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
              placeholder="Markdown 格式的协议内容..."
            />
            <div style={{ marginTop: 8, fontSize: 12, color: '#8C8C8C' }}>
              支持 Markdown 格式 · 字数：{draft.length}
            </div>
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 4 — 大模型工具
// ═════════════════════════════════════════════════════════════════════════════
// 风险等级颜色
// ── 工具台颜色 / 图标映射 ─────────────────────────────────────────────────────
const TOOL_RISK_COLOR   = { '低': 'success', '中': 'warning', '高': 'error' }
const TOOL_RISK_ICON    = { '低': null, '中': <ThunderboltOutlined />, '高': <FireOutlined /> }
const TOOL_CAT_COLOR    = { '系统工具': 'blue', '场景工具': 'cyan', 'API工具': 'purple' }
const TOOL_CAT_ICON     = {
  '系统工具': <DatabaseOutlined />,
  '场景工具': <AppstoreOutlined />,
  'API工具':  <ApiOutlined />,
}
const TOOL_STATUS_PROPS = {
  '已启用': { color: 'success', icon: <CheckCircleOutlined /> },
  '未启用': { color: 'default', icon: <MinusCircleOutlined /> },
}
const TOOL_PARAM_COLORS = ['#52c41a', '#1677ff', '#faad14', '#f5222d']
const TOOL_CAT_ALL      = 'all'

function ToolboxTab() {
  const [toolsList,      setToolsList]      = useState([])
  const [loading,        setLoading]        = useState(false)
  const [searchText,     setSearchText]     = useState('')
  const [filterCategory, setFilterCategory] = useState(TOOL_CAT_ALL)
  const [filterAgent,    setFilterAgent]    = useState(null)
  const [filterStatus,   setFilterStatus]   = useState(null)
  const [agentOptions,   setAgentOptions]   = useState([])
  const [,               setDetailTool]     = useState(null)

  const fetchTools = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/tools`)
      const items = data.items || []
      setToolsList(items)
      const agentSet = new Map()
      items.forEach(t => {
        if (t.affiliated_agent && t.affiliated_agent !== '-')
          agentSet.set(t.affiliated_agent, t.affiliated_agent)
      })
      setAgentOptions([...agentSet.keys()].sort().map(a => ({ value: a, label: a })))
    } catch {
      message.error('工具列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTools() }, [fetchTools])

  // 统计（不随筛选变化）
  const stats = useMemo(() => ({
    totalCount:    toolsList.length,
    systemCount:   toolsList.filter(t => t.category === '系统工具').length,
    scenarioCount: toolsList.filter(t => t.category === '场景工具').length,
    apiCount:      toolsList.filter(t => t.category === 'API工具').length,
    enabledCount:  toolsList.filter(t => t.status === '已启用').length,
  }), [toolsList])

  // 实时过滤
  const filteredTools = useMemo(() => {
    const kw = searchText.trim().toLowerCase()
    return toolsList.filter(t => {
      if (filterCategory !== TOOL_CAT_ALL && t.category !== filterCategory) return false
      if (filterAgent  && t.affiliated_agent !== filterAgent)  return false
      if (filterStatus && t.status           !== filterStatus) return false
      if (kw) {
        const hay = [t.name, t.label, t.description, t.affiliated_agent, t.module_label]
          .join(' ').toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    })
  }, [toolsList, filterCategory, filterAgent, filterStatus, searchText])

  const resetFilters = () => {
    setSearchText('')
    setFilterCategory(TOOL_CAT_ALL)
    setFilterAgent(null)
    setFilterStatus(null)
  }

  // 统计卡片配置
  const statCards = [
    { key: TOOL_CAT_ALL,  title: '工具总数', value: stats.totalCount,    icon: <ToolOutlined style={{ fontSize: 26, color: '#1677ff' }} />, bg: '#e6f4ff', sub: `已启用 ${stats.enabledCount}` },
    { key: '系统工具',    title: '系统工具', value: stats.systemCount,   icon: <DatabaseOutlined style={{ fontSize: 26, color: '#52c41a' }} />, bg: '#f6ffed', sub: '基础运行支撑' },
    { key: '场景工具',    title: '场景工具', value: stats.scenarioCount, icon: <AppstoreOutlined style={{ fontSize: 26, color: '#faad14' }} />, bg: '#fffbe6', sub: '业务场景专用' },
    { key: 'API工具',     title: 'API 工具', value: stats.apiCount,      icon: <ApiOutlined style={{ fontSize: 26, color: '#722ed1' }} />, bg: '#f9f0ff', sub: '外部接口集成' },
  ]

  // 表格列
  const columns = [
    {
      title: '工具名称', key: 'name', width: 210, fixed: 'left',
      render: (_, r) => (
        <Space direction="vertical" size={1}>
          <Text strong style={{ fontSize: 13 }}>{r.label || r.name}</Text>
          <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.name}</Text>
        </Space>
      ),
    },
    {
      title: '类别', key: 'category', width: 115,
      render: (_, r) => (
        <Tag icon={TOOL_CAT_ICON[r.category]} color={TOOL_CAT_COLOR[r.category] || 'default'}>
          {r.category}
        </Tag>
      ),
    },
    {
      title: '描述', key: 'description', ellipsis: { showTitle: false },
      render: (_, r) => (
        <Tooltip title={r.description} placement="topLeft">
          <Text ellipsis style={{ maxWidth: 240, display: 'block', fontSize: 12 }}>
            {r.description || '—'}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '所属 Agent', dataIndex: 'affiliated_agent', width: 165,
      render: v => (
        <Space size={5}>
          <RobotOutlined style={{ color: '#1677ff' }} />
          <Text style={{ fontSize: 12 }}>{v || '—'}</Text>
        </Space>
      ),
    },
    {
      title: '参数数', dataIndex: 'parameter_count', width: 75, align: 'center',
      render: v => {
        const n = Number(v) || 0
        return (
          <Avatar
            size={26}
            style={{ backgroundColor: TOOL_PARAM_COLORS[Math.min(n - 1, 3)] ?? '#d9d9d9', fontSize: 12, fontWeight: 700 }}
          >{n}</Avatar>
        )
      },
    },
    {
      title: '风险等级', dataIndex: 'risk_level', width: 95, align: 'center',
      render: v => <Tag icon={TOOL_RISK_ICON[v] ?? null} color={TOOL_RISK_COLOR[v] || 'default'}>{v || '—'}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', width: 100, align: 'center',
      render: v => {
        const cfg = TOOL_STATUS_PROPS[v] ?? TOOL_STATUS_PROPS['未启用']
        return <Tag icon={cfg.icon} color={cfg.color}>{v || '未启用'}</Tag>
      },
    },
    {
      title: '操作', key: 'action', width: 72, align: 'center', fixed: 'right',
      render: (_, r) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetailTool(r)}>详情</Button>
      ),
    },
  ]

  // Tabs 选项（带角标）
  const toolTabItems = [
    { key: TOOL_CAT_ALL, label: <Space size={4}><span>全部</span><Badge count={stats.totalCount} showZero color="#1677ff" size="small" /></Space> },
    { key: '系统工具',   label: <Space size={4}><DatabaseOutlined /><span>系统工具</span><Badge count={stats.systemCount}   showZero color="#52c41a" size="small" /></Space> },
    { key: '场景工具',   label: <Space size={4}><AppstoreOutlined /><span>场景工具</span><Badge count={stats.scenarioCount} showZero color="#faad14" size="small" /></Space> },
    { key: 'API工具',    label: <Space size={4}><ApiOutlined /><span>API 工具</span><Badge count={stats.apiCount}      showZero color="#722ed1" size="small" /></Space> },
  ]

  return (
    <div>
      {/* 统计卡片 */}
      <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
        {statCards.map(c => (
          <Col xs={24} sm={12} md={6} key={c.key}>
            <Card
              hoverable
              onClick={() => setFilterCategory(c.key)}
              styles={{ body: { padding: '14px 18px' } }}
              style={{
                borderRadius: 10, cursor: 'pointer',
                border: filterCategory === c.key ? '1.5px solid #1677ff' : '1px solid #f0f0f0',
                boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
              }}
            >
              <Row justify="space-between" align="middle">
                <Col>
                  <Text type="secondary" style={{ fontSize: 12 }}>{c.title}</Text>
                  <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.3 }}>{c.value}</div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{c.sub}</Text>
                </Col>
                <Col>
                  <div style={{ width: 46, height: 46, borderRadius: 10, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {c.icon}
                  </div>
                </Col>
              </Row>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Tabs + 筛选 + 表格 */}
      <Card style={{ borderRadius: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }} styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '0 20px', borderBottom: '1px solid #f0f0f0' }}>
          <Tabs activeKey={filterCategory} onChange={setFilterCategory} items={toolTabItems} style={{ marginBottom: 0 }} />
        </div>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #f5f5f5', background: '#fafafa' }}>
          <Row gutter={[10, 8]} align="middle">
            <Col xs={24} sm={8} md={6}>
              <Input.Search
                placeholder="名称 / 描述 / Agent..."
                allowClear
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              />
            </Col>
            <Col xs={12} sm={6} md={5}>
              <Select
                placeholder="按 Agent 筛选" allowClear value={filterAgent}
                onChange={setFilterAgent} options={agentOptions} style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} sm={5} md={4}>
              <Select
                placeholder="启用状态" allowClear value={filterStatus}
                onChange={setFilterStatus} style={{ width: '100%' }}
                options={[{ value: '已启用', label: '✅ 已启用' }, { value: '未启用', label: '⭕ 未启用' }]}
              />
            </Col>
            <Col><Button onClick={resetFilters}>重置</Button></Col>
            <Col><Button icon={<ReloadOutlined />} onClick={fetchTools} loading={loading}>刷新</Button></Col>
            <Col flex="auto" style={{ textAlign: 'right' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 <Text strong>{filteredTools.length}</Text> 条
                {filteredTools.length < stats.totalCount && <Text type="secondary">（总 {stats.totalCount} 条）</Text>}
              </Text>
            </Col>
          </Row>
        </div>
        <Table
          rowKey="name" loading={loading} dataSource={filteredTools} columns={columns}
          scroll={{ x: 1050 }} size="middle"
          pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10','20','50'], showTotal: t => `共 ${t} 条`, style: { padding: '10px 20px' } }}
        />
      </Card>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 主页面
// ═════════════════════════════════════════════════════════════════════════════
const TAB_ITEMS = [
  {
    key:      'account',
    label:    <span><LockOutlined />账号权限</span>,
    children: <AccountTab />,
  },
  {
    key:      'logs',
    label:    <span><UnorderedListOutlined />操作日志</span>,
    children: <LogsTab />,
  },
  {
    key:      'templates',
    label:    <span><EditOutlined />协议模板</span>,
    children: <TemplatesTab />,
  },
  {
    key:      'toolbox',
    label:    <span><RobotOutlined />大模型工具</span>,
    children: <ToolboxTab />,
  },
]

export default function SystemSettings() {
  return (
    <div style={{ padding: '24px 28px', minHeight: 'calc(100vh - 56px)', background: '#F5F7FA' }}>
      {/* 页头 */}
      <div style={{ marginBottom: 20 }}>
        <Space>
          <SettingOutlined style={{ fontSize: 22, color: '#1677FF' }} />
          <Title level={4} style={{ margin: 0 }}>系统设置</Title>
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
          管理系统参数、大模型工具启用状态、协议模板及操作日志。
        </Paragraph>
      </div>

      <Tabs
        defaultActiveKey="toolbox"
        type="card"
        items={TAB_ITEMS}
        style={{ background: 'transparent' }}
      />
    </div>
  )
}
