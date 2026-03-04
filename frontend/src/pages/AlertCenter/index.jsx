/**
 * AlertCenter/index.jsx — AD-12 ~ AD-13 预警中心
 * ────────────────────────────────────────────────────────────────────
 * 顶部汇总卡片：高危患者数 | 危急预警数 | 未处理预警数 | 今日新增
 * 过滤栏：严重程度 | 状态 | 患者搜索
 * 表格：高亮异常指标行，操作列含"查看患者"和"标记已处理"
 * ────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import {
  Row, Col, Card, Statistic, Table, Tag, Button, Space, Badge,
  Typography, Select, Input, Tooltip, Modal, Popconfirm, Form,
  message, Alert, Divider, Spin,
} from 'antd'
import {
  WarningOutlined, CheckCircleOutlined, ReloadOutlined,
  UserOutlined, ScanOutlined, ClockCircleOutlined,
  FireOutlined, AlertOutlined, ExclamationCircleOutlined,
  ArrowUpOutlined, ArrowDownOutlined, SearchOutlined,
} from '@ant-design/icons'
import styles from './AlertCenter.module.css'

const { Text, Title } = Typography
const { Search } = Input

const BASE = '/api/v1'

// ── 视觉常量 ──────────────────────────────────────────────────────────────────
const SEVERITY_CONFIG = {
  critical: { color: '#FF4D4F', bg: '#FFF2F0', border: '#FFCCC7', label: '危急', tagColor: 'red',    icon: <FireOutlined /> },
  warning:  { color: '#FA8C16', bg: '#FFFBE6', border: '#FFD591', label: '警告', tagColor: 'orange', icon: <WarningOutlined /> },
  info:     { color: '#1677FF', bg: '#E6F0FF', border: '#BAD4FB', label: '提示', tagColor: 'blue',   icon: <ExclamationCircleOutlined /> },
}

const STATUS_CONFIG = {
  active:       { label: '待处理', tagColor: 'red',    dot: 'error'   },
  acknowledged: { label: '已处理', tagColor: 'green',  dot: 'success' },
  resolved:     { label: '已解除', tagColor: 'default', dot: 'default' },
}

const PHASE_COLORS = {
  pre_assessment:   'blue',
  pre_operation:    'purple',
  early_post_op:    'red',
  recovery:         'orange',
  rehabilitation:   'cyan',
  long_term_follow: 'green',
}

// ══════════════════════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════════════════════

export default function AlertCenter() {
  const navigate = useNavigate()

  // ── 数据 state ────────────────────────────────────────────────────────────
  const [alerts,    setAlerts]    = useState([])
  const [summary,   setSummary]   = useState(null)
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(false)
  const [scanning,  setScanning]  = useState(false)

  // ── 过滤 state ────────────────────────────────────────────────────────────
  const [statusFilter,   setStatusFilter]   = useState('active')
  const [severityFilter, setSeverityFilter] = useState([])
  const [searchText,     setSearchText]     = useState('')
  const [page,           setPage]           = useState(1)
  const [pageSize,       setPageSize]       = useState(20)

  // ── 处理弹窗 state ────────────────────────────────────────────────────────
  const [ackModal,      setAckModal]      = useState(false)
  const [ackTarget,     setAckTarget]     = useState(null)   // { id, patient_name, message }
  const [ackLoading,    setAckLoading]    = useState(false)
  const [ackForm]       = Form.useForm()

  // ── 加载数据 ──────────────────────────────────────────────────────────────
  const fetchAlerts = useCallback(async (pg = page, ps = pageSize) => {
    setLoading(true)
    try {
      const params = {
        status:    statusFilter,
        page:      pg,
        page_size: ps,
      }
      if (severityFilter.length) params.severity = severityFilter
      const res = await axios.get(`${BASE}/alerts`, { params })
      setAlerts(res.data.alerts || [])
      setTotal(res.data.total  || 0)
      setSummary(res.data.summary || null)
    } catch (err) {
      message.error('加载预警失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setLoading(false)
    }
  }, [statusFilter, severityFilter, page, pageSize])

  useEffect(() => { fetchAlerts(1, pageSize); setPage(1) }, [statusFilter, severityFilter])  // eslint-disable-line
  useEffect(() => { fetchAlerts(page, pageSize) }, [page, pageSize])                          // eslint-disable-line

  // ── 手动扫描 ──────────────────────────────────────────────────────────────
  const handleScan = async () => {
    setScanning(true)
    try {
      const res = await axios.post(`${BASE}/alerts/scan`)
      message.success(res.data.message)
      fetchAlerts(1, pageSize)
      setPage(1)
    } catch (err) {
      message.error('扫描失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setScanning(false)
    }
  }

  // ── 打开处理弹窗 ──────────────────────────────────────────────────────────
  const openAckModal = (record) => {
    setAckTarget(record)
    ackForm.resetFields()
    setAckModal(true)
  }

  // ── 提交确认操作 ──────────────────────────────────────────────────────────
  const handleAcknowledge = async () => {
    let values
    try { values = await ackForm.validateFields() } catch { return }
    setAckLoading(true)
    try {
      await axios.patch(`${BASE}/alerts/${ackTarget.id}/acknowledge`, {
        doctor_id:    values.doctor_id,
        resolve_note: values.resolve_note || '',
      })
      message.success(`预警已标记为"已处理"`)
      setAckModal(false)
      fetchAlerts(page, pageSize)
    } catch (err) {
      message.error('操作失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setAckLoading(false)
    }
  }

  // ── 前端本地搜索过滤 ──────────────────────────────────────────────────────
  const filteredAlerts = searchText
    ? alerts.filter(a =>
        a.patient_name?.includes(searchText) ||
        a.metric_label?.includes(searchText) ||
        a.message?.includes(searchText)
      )
    : alerts

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      {/* ── 页面标题栏 ──────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <AlertOutlined style={{ color: '#FF4D4F', marginRight: 8 }} />
            预警中心
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            自动扫描检验指标阈值异常 · AI 风险评估触发依据
          </Text>
        </div>
        <Space>
          <Button
            icon={<ScanOutlined />}
            loading={scanning}
            onClick={handleScan}
          >
            立即扫描
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => fetchAlerts(page, pageSize)}>
            刷新
          </Button>
        </Space>
      </div>

      {/* ── 汇总卡片 ────────────────────────────────────────────────────── */}
      <SummaryCards summary={summary} loading={loading} />

      {/* ── 过滤栏 ──────────────────────────────────────────────────────── */}
      <div className={styles.filterBar}>
        <Space wrap>
          <Select
            value={statusFilter}
            onChange={v => setStatusFilter(v)}
            style={{ width: 130 }}
            options={[
              { label: '未处理', value: 'active'       },
              { label: '已处理', value: 'acknowledged' },
              { label: '全部',   value: 'all'          },
            ]}
          />
          <Select
            mode="multiple"
            placeholder="严重程度"
            value={severityFilter}
            onChange={setSeverityFilter}
            style={{ minWidth: 180 }}
            allowClear
            options={[
              { label: '🔴 危急', value: 'critical' },
              { label: '🟠 警告', value: 'warning'  },
              { label: '🔵 提示', value: 'info'     },
            ]}
          />
          <Search
            placeholder="搜索患者名 / 指标"
            allowClear
            style={{ width: 220 }}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 <b>{total}</b> 条预警{searchText ? `（本地过滤后 ${filteredAlerts.length} 条）` : ''}
        </Text>
      </div>

      {/* ── 预警表格 ────────────────────────────────────────────────────── */}
      <AlertTable
        dataSource={filteredAlerts}
        loading={loading}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps) }}
        onAcknowledge={openAckModal}
        onViewPatient={pid => navigate(`/assessment?patient=${pid}`)}
      />

      {/* ── 处理确认弹窗 ─────────────────────────────────────────────────── */}
      <Modal
        open={ackModal}
        title={
          <Space>
            <CheckCircleOutlined style={{ color: '#52C41A' }} />
            标记预警为"已处理"
          </Space>
        }
        okText="确认处理"
        cancelText="取消"
        onOk={handleAcknowledge}
        onCancel={() => setAckModal(false)}
        confirmLoading={ackLoading}
        width={520}
      >
        {ackTarget && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={ackTarget.patient_name}
            description={ackTarget.message}
            style={{ marginBottom: 16, fontSize: 13 }}
          />
        )}
        <Form form={ackForm} layout="vertical">
          <Form.Item
            name="doctor_id"
            label="处理医生"
            rules={[{ required: true, message: '请填写医生姓名' }]}
            initialValue="李医生"
          >
            <Input placeholder="如：李主任" prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item name="resolve_note" label="处理备注（可选）">
            <Input.TextArea
              rows={3}
              placeholder="如：已嘱患者加强蛋白质补充，预约2周后复查白蛋白"
              maxLength={200}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// 子组件：汇总卡片
// ══════════════════════════════════════════════════════════════════════════════

function SummaryCards({ summary, loading }) {
  const cards = [
    {
      title:       '当前高危患者数',
      value:       summary?.high_risk_patients ?? '--',
      suffix:      '人',
      color:       '#FF4D4F',
      bg:          '#FFF2F0',
      icon:        <FireOutlined style={{ fontSize: 28, color: '#FF4D4F' }} />,
      tooltip:     '存在危急级别预警的患者去重数量',
    },
    {
      title:       '危急预警',
      value:       summary?.critical_count ?? '--',
      suffix:      '条',
      color:       '#FF4D4F',
      bg:          '#FFF2F0',
      icon:        <AlertOutlined style={{ fontSize: 28, color: '#FF4D4F' }} />,
      tooltip:     '指标严重偏离正常范围，需立即干预',
    },
    {
      title:       '未处理预警',
      value:       summary?.total_active ?? '--',
      suffix:      '条',
      color:       '#FA8C16',
      bg:          '#FFFBE6',
      icon:        <ClockCircleOutlined style={{ fontSize: 28, color: '#FA8C16' }} />,
      tooltip:     '所有状态为"待处理"的预警合计',
    },
    {
      title:       '今日新增预警',
      value:       summary?.new_today ?? '--',
      suffix:      '条',
      color:       '#1677FF',
      bg:          '#E6F0FF',
      icon:        <ExclamationCircleOutlined style={{ fontSize: 28, color: '#1677FF' }} />,
      tooltip:     '今天 00:00 后触发的新预警',
    },
  ]

  return (
    <Row gutter={16} className={styles.summaryRow}>
      {cards.map((c, i) => (
        <Col span={6} key={i}>
          <Tooltip title={c.tooltip}>
            <Card
              style={{ background: c.bg, border: `1px solid ${c.color}30`, borderRadius: 12 }}
              bodyStyle={{ padding: '16px 20px' }}
            >
              <Row justify="space-between" align="middle">
                <Col>
                  <Text style={{ fontSize: 12, color: '#8C8C8C' }}>{c.title}</Text>
                  <div style={{ marginTop: 4 }}>
                    {loading ? (
                      <Spin size="small" />
                    ) : (
                      <span style={{ fontSize: 30, fontWeight: 700, color: c.color, lineHeight: 1 }}>
                        {c.value}
                      </span>
                    )}
                    {!loading && (
                      <Text style={{ fontSize: 13, color: '#8C8C8C', marginLeft: 4 }}>{c.suffix}</Text>
                    )}
                  </div>
                </Col>
                <Col>{c.icon}</Col>
              </Row>
            </Card>
          </Tooltip>
        </Col>
      ))}
    </Row>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// 子组件：预警表格
// ══════════════════════════════════════════════════════════════════════════════

function AlertTable({ dataSource, loading, total, page, pageSize, onPageChange, onAcknowledge, onViewPatient }) {
  const columns = [
    // 严重程度
    {
      title:  '级别',
      dataIndex: 'severity',
      width:  72,
      render: sev => {
        const cfg = SEVERITY_CONFIG[sev] || SEVERITY_CONFIG.info
        return (
          <Tag
            color={cfg.tagColor}
            icon={cfg.icon}
            style={{ fontWeight: 600, fontSize: 12 }}
          >
            {cfg.label}
          </Tag>
        )
      },
      filters: [
        { text: '危急', value: 'critical' },
        { text: '警告', value: 'warning'  },
        { text: '提示', value: 'info'     },
      ],
      onFilter: (value, record) => record.severity === value,
    },

    // 患者信息
    {
      title:  '患者',
      width:  130,
      render: (_, row) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{row.patient_name}</Text>
          <br />
          <Tag
            color={PHASE_COLORS[row.patient_phase] || 'default'}
            style={{ fontSize: 11, marginTop: 2 }}
          >
            {row.patient_phase_label || row.patient_phase || '--'}
          </Tag>
        </div>
      ),
    },

    // 预警类型
    {
      title: '类型',
      dataIndex: 'alert_type_label',
      width: 110,
      render: (text, row) => (
        <Text style={{ fontSize: 12 }}>{text}</Text>
      ),
    },

    // 指标 + 值
    {
      title: '检验指标 / 当前值',
      width: 220,
      render: (_, row) => {
        if (!row.metric_name) {
          return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        }
        const sev = SEVERITY_CONFIG[row.severity] || SEVERITY_CONFIG.info
        const isBelow = row.direction === 'below'
        const arrow = isBelow
          ? <ArrowDownOutlined style={{ color: '#FF4D4F' }} />
          : <ArrowUpOutlined   style={{ color: '#FF4D4F' }} />

        return (
          <div className={styles.metricCell} style={{ borderLeft: `3px solid ${sev.color}` }}>
            <Text style={{ fontSize: 12, color: '#8C8C8C' }}>{row.metric_label}</Text>
            <div>
              <Text
                strong
                style={{ fontSize: 18, color: sev.color, lineHeight: 1.2 }}
              >
                {row.metric_value ?? '--'}
              </Text>
              <Text style={{ fontSize: 12, color: '#8C8C8C', marginLeft: 3 }}>
                {row.unit}
              </Text>
              {arrow}
            </div>
            <Text style={{ fontSize: 11, color: '#8C8C8C' }}>
              阈值：{row.threshold_value} {row.unit}
            </Text>
          </div>
        )
      },
    },

    // 预警消息
    {
      title:      '预警详情',
      dataIndex:  'message',
      render:     text => (
        <Text style={{ fontSize: 12, color: '#595959' }} ellipsis={{ tooltip: text }}>
          {text}
        </Text>
      ),
    },

    // 状态
    {
      title:  '状态',
      width:  90,
      dataIndex: 'status',
      render: status => {
        const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.active
        return (
          <Badge
            status={cfg.dot}
            text={<Text style={{ fontSize: 12 }}>{cfg.label}</Text>}
          />
        )
      },
    },

    // 触发时间
    {
      title:  '触发时间',
      width:  130,
      dataIndex: 'created_at',
      render: v => v ? (
        <div>
          <Text style={{ fontSize: 12 }}>{dayjs(v).format('MM-DD HH:mm')}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(v).fromNow?.() || ''}</Text>
        </div>
      ) : '--',
      sorter: (a, b) => new Date(a.created_at) - new Date(b.created_at),
      defaultSortOrder: 'descend',
    },

    // 操作
    {
      title:  '操作',
      width:  170,
      fixed:  'right',
      render: (_, row) => (
        <Space size={6}>
          <Button
            size="small"
            type="link"
            icon={<UserOutlined />}
            onClick={() => onViewPatient(row.patient_id)}
          >
            查看患者
          </Button>
          {row.status === 'active' && (
            <Button
              size="small"
              type="primary"
              ghost
              icon={<CheckCircleOutlined />}
              onClick={() => onAcknowledge(row)}
            >
              标记已处理
            </Button>
          )}
          {row.status === 'acknowledged' && (
            <Tooltip title={`已由 ${row.acknowledged_by || '--'} 处理\n${row.resolve_note || ''}`}>
              <Tag color="green" icon={<CheckCircleOutlined />} style={{ cursor: 'help' }}>
                已处理
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Table
      className={styles.alertTable}
      dataSource={dataSource}
      columns={columns}
      rowKey="id"
      loading={loading}
      size="middle"
      scroll={{ x: 1200 }}
      pagination={{
        current:    page,
        pageSize:   pageSize,
        total:      total,
        showTotal:  n => `共 ${n} 条`,
        showSizeChanger: true,
        pageSizeOptions: ['10', '20', '50'],
        onChange:   onPageChange,
      }}
      rowClassName={row => {
        if (row.severity === 'critical') return styles.criticalRow
        if (row.severity === 'warning')  return styles.warningRow
        return ''
      }}
      locale={{ emptyText: '暂无预警记录（可点击"立即扫描"触发检测）' }}
    />
  )
}
