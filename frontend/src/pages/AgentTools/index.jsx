/**
 * AgentTools/index.jsx — 大模型工具查看台
 * 完整版：数据逻辑 + Ant Design UI
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import axios from 'axios'
import {
  Row, Col, Card, Tabs, Input, Select, Button, Table,
  Tag, Tooltip, Avatar, Space, Typography, message, Badge,
} from 'antd'
import {
  ToolOutlined, AppstoreOutlined, ApiOutlined, DatabaseOutlined,
  RobotOutlined, SearchOutlined, ReloadOutlined, EyeOutlined,
  CheckCircleOutlined, MinusCircleOutlined, ThunderboltOutlined,
  FireOutlined,
} from '@ant-design/icons'

const { Text } = Typography

// ── 常量 ─────────────────────────────────────────────────────────────────────
const API_URL = '/api/v1/system/tools'

const CATEGORY = {
  ALL:      'all',
  SYSTEM:   '系统工具',
  SCENARIO: '场景工具',
  API:      'API工具',
}

const RISK_COLOR = { '低': 'success', '中': 'warning', '高': 'error' }
const RISK_ICON  = { '低': null, '中': <ThunderboltOutlined />, '高': <FireOutlined /> }
const CAT_COLOR  = { '系统工具': 'blue', '场景工具': 'cyan', 'API工具': 'purple' }
const CAT_ICON   = {
  '系统工具': <DatabaseOutlined />,
  '场景工具': <AppstoreOutlined />,
  'API工具':  <ApiOutlined />,
}

const STATUS_PROPS = {
  '已启用': { color: 'success', icon: <CheckCircleOutlined /> },
  '未启用': { color: 'default', icon: <MinusCircleOutlined /> },
}

// 参数数量徽标颜色（1→绿, 2→蓝, 3→橙, 4+→红）
const PARAM_COLORS = ['#52c41a', '#1677ff', '#faad14', '#f5222d']

// ═════════════════════════════════════════════════════════════════════════════
export default function AgentTools() {

  // ── 数据状态 ─────────────────────────────────────────────────────────────────
  const [toolsList, setToolsList] = useState([])
  const [loading,   setLoading]   = useState(false)

  // ── 筛选状态 ─────────────────────────────────────────────────────────────────
  const [searchText,     setSearchText]     = useState('')
  const [filterCategory, setFilterCategory] = useState(CATEGORY.ALL)
  const [filterAgent,    setFilterAgent]    = useState(null)
  const [filterStatus,   setFilterStatus]   = useState(null)

  // ── 下拉选项（来自后端数据派生） ────────────────────────────────────────────────
  const [agentOptions, setAgentOptions] = useState([])

  // ── 详情预留（后续可接 Drawer） ───────────────────────────────────────────────
  const [, setDetailTool] = useState(null)

  // ── API 请求 ─────────────────────────────────────────────────────────────────
  const fetchTools = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(API_URL)
      const items = data.items || []
      setToolsList(items)

      const agentSet = new Map()
      items.forEach(t => {
        if (t.affiliated_agent && t.affiliated_agent !== '-') {
          agentSet.set(t.affiliated_agent, t.affiliated_agent)
        }
      })
      setAgentOptions([...agentSet.keys()].sort().map(a => ({ value: a, label: a })))
    } catch (err) {
      message.error('工具列表加载失败：' + (err.response?.data?.detail || err.message))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTools() }, [fetchTools])

  // ── 统计数据（顶部卡片，不随筛选变化） ───────────────────────────────────────────
  const stats = useMemo(() => ({
    totalCount:    toolsList.length,
    systemCount:   toolsList.filter(t => t.category === CATEGORY.SYSTEM).length,
    scenarioCount: toolsList.filter(t => t.category === CATEGORY.SCENARIO).length,
    apiCount:      toolsList.filter(t => t.category === CATEGORY.API).length,
    enabledCount:  toolsList.filter(t => t.status === '已启用').length,
  }), [toolsList])

  // ── 实时过滤 ─────────────────────────────────────────────────────────────────
  const filteredTools = useMemo(() => {
    const kw = searchText.trim().toLowerCase()
    return toolsList.filter(t => {
      if (filterCategory !== CATEGORY.ALL && t.category !== filterCategory) return false
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
    setFilterCategory(CATEGORY.ALL)
    setFilterAgent(null)
    setFilterStatus(null)
  }

  // ── 顶部统计卡片配置 ─────────────────────────────────────────────────────────
  const statCards = [
    {
      key: CATEGORY.ALL,
      title: '工具总数',
      value: stats.totalCount,
      icon: <ToolOutlined style={{ fontSize: 28, color: '#1677ff' }} />,
      bg: '#e6f4ff',
      sub: `已启用 ${stats.enabledCount}`,
    },
    {
      key: CATEGORY.SYSTEM,
      title: '系统工具',
      value: stats.systemCount,
      icon: <DatabaseOutlined style={{ fontSize: 28, color: '#52c41a' }} />,
      bg: '#f6ffed',
      sub: '基础运行支撑',
    },
    {
      key: CATEGORY.SCENARIO,
      title: '场景工具',
      value: stats.scenarioCount,
      icon: <AppstoreOutlined style={{ fontSize: 28, color: '#faad14' }} />,
      bg: '#fffbe6',
      sub: '业务场景专用',
    },
    {
      key: CATEGORY.API,
      title: 'API 工具',
      value: stats.apiCount,
      icon: <ApiOutlined style={{ fontSize: 28, color: '#722ed1' }} />,
      bg: '#f9f0ff',
      sub: '外部接口集成',
    },
  ]

  // ── 表格列定义 ───────────────────────────────────────────────────────────────
  const columns = [
    {
      title: '工具名称',
      key: 'name',
      width: 210,
      fixed: 'left',
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          <Text strong style={{ fontSize: 14 }}>{r.label || r.name}</Text>
          <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
            {r.name}
          </Text>
        </Space>
      ),
    },
    {
      title: '类别',
      key: 'category',
      width: 120,
      render: (_, r) => (
        <Tag icon={CAT_ICON[r.category]} color={CAT_COLOR[r.category] || 'default'}>
          {r.category}
        </Tag>
      ),
    },
    {
      title: '描述',
      key: 'description',
      ellipsis: { showTitle: false },
      render: (_, r) => (
        <Tooltip title={r.description} placement="topLeft">
          <Text ellipsis style={{ maxWidth: 260, display: 'block' }}>
            {r.description || '—'}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '所属 Agent',
      dataIndex: 'affiliated_agent',
      key: 'affiliated_agent',
      width: 170,
      render: v => (
        <Space size={6}>
          <RobotOutlined style={{ color: '#1677ff' }} />
          <Text>{v || '—'}</Text>
        </Space>
      ),
    },
    {
      title: '参数数',
      dataIndex: 'parameter_count',
      key: 'parameter_count',
      width: 80,
      align: 'center',
      render: v => {
        const n = Number(v) || 0
        return (
          <Avatar
            size={28}
            style={{
              backgroundColor: PARAM_COLORS[Math.min(n - 1, 3)] ?? '#d9d9d9',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {n}
          </Avatar>
        )
      },
    },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      key: 'risk_level',
      width: 100,
      align: 'center',
      render: v => (
        <Tag icon={RISK_ICON[v] ?? null} color={RISK_COLOR[v] || 'default'}>
          {v || '—'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      align: 'center',
      render: v => {
        const cfg = STATUS_PROPS[v] ?? STATUS_PROPS['未启用']
        return (
          <Tag icon={cfg.icon} color={cfg.color}>
            {v || '未启用'}
          </Tag>
        )
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'center',
      fixed: 'right',
      render: (_, r) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => setDetailTool(r)}
        >
          详情
        </Button>
      ),
    },
  ]

  // ── Tabs 选项（带数量角标） ──────────────────────────────────────────────────
  const tabItems = [
    {
      key: CATEGORY.ALL,
      label: (
        <Space size={4}>
          <span>全部</span>
          <Badge count={stats.totalCount} showZero color="#1677ff" size="small" />
        </Space>
      ),
    },
    {
      key: CATEGORY.SYSTEM,
      label: (
        <Space size={4}>
          <DatabaseOutlined />
          <span>系统工具</span>
          <Badge count={stats.systemCount} showZero color="#52c41a" size="small" />
        </Space>
      ),
    },
    {
      key: CATEGORY.SCENARIO,
      label: (
        <Space size={4}>
          <AppstoreOutlined />
          <span>场景工具</span>
          <Badge count={stats.scenarioCount} showZero color="#faad14" size="small" />
        </Space>
      ),
    },
    {
      key: CATEGORY.API,
      label: (
        <Space size={4}>
          <ApiOutlined />
          <span>API 工具</span>
          <Badge count={stats.apiCount} showZero color="#722ed1" size="small" />
        </Space>
      ),
    },
  ]

  // ══════════════════════════════════════════════════════════════════════════
  // ── JSX 渲染 ──────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ padding: 24, background: '#f5f7fa', minHeight: '100vh' }}>

      {/* ── 页头 ─────────────────────────────────────────────────── */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 20 }}>
        <Col>
          <Space align="center" size={10}>
            <RobotOutlined style={{ fontSize: 22, color: '#1677ff' }} />
            <span style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e' }}>
              大模型工具台
            </span>
            <Tag color="blue" style={{ marginLeft: 4 }}>Agent Tools</Tag>
          </Space>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              管理所有注册到 AI Agent 的工具函数，查看调用权限与风险等级
            </Text>
          </div>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} onClick={fetchTools} loading={loading}>
            刷新
          </Button>
        </Col>
      </Row>

      {/* ── 统计卡片 ──────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        {statCards.map(c => (
          <Col xs={24} sm={12} md={6} key={c.key}>
            <Card
              hoverable
              onClick={() => setFilterCategory(c.key)}
              styles={{ body: { padding: '18px 20px' } }}
              style={{
                borderRadius: 12,
                cursor: 'pointer',
                border: filterCategory === c.key
                  ? '1.5px solid #1677ff'
                  : '1px solid #f0f0f0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}
            >
              <Row justify="space-between" align="middle">
                <Col>
                  <Text type="secondary" style={{ fontSize: 13 }}>{c.title}</Text>
                  <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.3, color: '#1a1a2e' }}>
                    {c.value}
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{c.sub}</Text>
                </Col>
                <Col>
                  <div style={{
                    width: 52, height: 52, borderRadius: 12,
                    background: c.bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {c.icon}
                  </div>
                </Col>
              </Row>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── 主内容区 ──────────────────────────────────────────────── */}
      <Card
        style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: 0 } }}
      >
        {/* Tabs 分类 */}
        <div style={{ padding: '0 20px', borderBottom: '1px solid #f0f0f0' }}>
          <Tabs
            activeKey={filterCategory}
            onChange={key => { setFilterCategory(key) }}
            items={tabItems}
            style={{ marginBottom: 0 }}
          />
        </div>

        {/* 筛选栏 */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f5f5f5', background: '#fafafa' }}>
          <Row gutter={[10, 8]} align="middle">
            <Col xs={24} sm={9} md={7}>
              <Input.Search
                placeholder="搜索工具名称、描述、Agent..."
                allowClear
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onSearch={v => setSearchText(v)}
              />
            </Col>
            <Col xs={12} sm={6} md={5}>
              <Select
                placeholder="按 Agent 筛选"
                allowClear
                value={filterAgent}
                onChange={setFilterAgent}
                options={agentOptions}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} sm={5} md={4}>
              <Select
                placeholder="启用状态"
                allowClear
                value={filterStatus}
                onChange={setFilterStatus}
                style={{ width: '100%' }}
                options={[
                  { value: '已启用', label: '✅ 已启用' },
                  { value: '未启用', label: '⭕ 未启用' },
                ]}
              />
            </Col>
            <Col>
              <Button type="primary" icon={<SearchOutlined />}>搜索</Button>
            </Col>
            <Col>
              <Button onClick={resetFilters}>重置</Button>
            </Col>
            <Col flex="auto" style={{ textAlign: 'right' }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                共 <Text strong>{filteredTools.length}</Text> 条
                {filteredTools.length < stats.totalCount && (
                  <Text type="secondary">（总 {stats.totalCount} 条）</Text>
                )}
              </Text>
            </Col>
          </Row>
        </div>

        {/* 表格 */}
        <Table
          rowKey="name"
          loading={loading}
          dataSource={filteredTools}
          columns={columns}
          scroll={{ x: 1100 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: total => `共 ${total} 条`,
            style: { padding: '12px 20px' },
          }}
          size="middle"
          style={{ borderRadius: '0 0 12px 12px' }}
        />
      </Card>
    </div>
  )
}

export { CATEGORY }
