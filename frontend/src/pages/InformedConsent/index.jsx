/**
 * InformedConsent/index.jsx — 知情同意合规审计
 * 功能:
 *   · 表格展示所有患者的签署记录
 *   · "查看详情" → Drawer（Descriptions 展示元数据 + PDF 预览按钮）
 * API:
 *   GET /api/v1/consent/records
 *   GET /api/v1/consent/records/{id}/detail
 */

import React, { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import {
  Table, Tag, Button, Input, Select, Space, Typography,
  Tooltip, Badge, Statistic, Row, Col, Divider, Empty,
  Drawer, Descriptions, Spin, message, Alert,
} from 'antd'
import {
  FileProtectOutlined, SearchOutlined, ReloadOutlined,
  FilePdfOutlined, CheckCircleOutlined, ClockCircleOutlined,
  StopOutlined, EyeOutlined, DownloadOutlined, InfoCircleOutlined,
  SafetyCertificateOutlined, UserOutlined, FieldTimeOutlined,
  GlobalOutlined, MobileOutlined, LockOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import styles from './InformedConsent.module.css'

const { Text, Title } = Typography
const { Option } = Select

// ── 状态配置 ──────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  signed:  { label: '已生效', color: 'success', icon: <CheckCircleOutlined /> },
  pending: { label: '待签署', color: 'warning', icon: <ClockCircleOutlined /> },
  revoked: { label: '已撤销', color: 'error',   icon: <StopOutlined />       },
}

// ── 文件类型图标颜色 ──────────────────────────────────────────────────────────
const DOC_COLOR = {
  '营养干预知情同意书':             '#1677FF',
  '肝移植患者营养干预知情同意书':   '#1677FF',
  '个人信息授权书':                 '#52C41A',
  '肝移植手术同意书':               '#FA8C16',
}

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：详情 Drawer
// ─────────────────────────────────────────────────────────────────────────────

function DetailDrawer({ open, record, onClose }) {
  const [detail,  setDetail]  = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !record) return
    setDetail(null)
    setLoading(true)
    axios.get(`/api/v1/consent/records/${record.id}/detail`)
      .then(res => setDetail(res.data?.data || res.data))
      .catch(() => setDetail(record))   // 降级：直接用列表数据
      .finally(() => setLoading(false))
  }, [open, record])

  const d = detail || record || {}
  const statusCfg = STATUS_CONFIG[d.status] || { label: d.status, color: 'default', icon: null }

  return (
    <Drawer
      title={
        <Space>
          <FileProtectOutlined style={{ color: '#1677FF' }} />
          <span>同意书详情</span>
          {d.document_name && (
            <Tag
              style={{
                background: DOC_COLOR[d.document_name] ? '#E6F4FF' : undefined,
                color: DOC_COLOR[d.document_name] || undefined,
                border: 'none', borderRadius: 10, fontWeight: 500,
              }}>
              {d.document_name}
            </Tag>
          )}
        </Space>
      }
      width={520}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: '24px 24px 80px' } }}
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={() => {
          setDetail(null); setLoading(true)
          axios.get(`/api/v1/consent/records/${record?.id}/detail`)
            .then(res => setDetail(res.data?.data || res.data))
            .finally(() => setLoading(false))
        }} />
      }
    >
      <Spin spinning={loading}>

        {/* 有效性横幅 */}
        {d.signature_valid !== undefined && (
          <Alert
            type={d.signature_valid ? 'success' : (d.status === 'revoked' ? 'error' : 'warning')}
            icon={<SafetyCertificateOutlined />}
            showIcon
            message={
              <Text strong>
                {d.signature_valid ? '签名有效 · 符合法律效力' : '签名暂未生效'}
              </Text>
            }
            description={d.audit_note}
            style={{ marginBottom: 24, borderRadius: 10 }}
          />
        )}

        {/* 元数据描述 */}
        <Descriptions
          column={1}
          bordered
          size="small"
          labelStyle={{ width: 120, color: '#595959', fontWeight: 500 }}
          contentStyle={{ color: '#1A1A1A' }}
        >
          <Descriptions.Item
            label={<><FileProtectOutlined style={{ marginRight: 4 }} />协议名称</>}
          >
            <Text strong>{d.document_name || '—'}</Text>
          </Descriptions.Item>

          <Descriptions.Item
            label={<><LockOutlined style={{ marginRight: 4 }} />签署版本</>}
          >
            <Tag style={{ borderRadius: 10 }}>{d.version || '—'}</Tag>
            {d.is_latest_version && (
              <Tag color="green" style={{ borderRadius: 10, marginLeft: 6 }}>最新版本</Tag>
            )}
          </Descriptions.Item>

          <Descriptions.Item
            label={<><UserOutlined style={{ marginRight: 4 }} />患者姓名</>}
          >
            {d.patient_name || '—'}
          </Descriptions.Item>

          <Descriptions.Item
            label={<><FieldTimeOutlined style={{ marginRight: 4 }} />签署时间</>}
          >
            {d.signed_at
              ? dayjs(d.signed_at).format('YYYY-MM-DD HH:mm:ss')
              : <Text type="secondary">尚未签署</Text>}
          </Descriptions.Item>

          <Descriptions.Item label="协议状态">
            <Tag color={statusCfg.color} icon={statusCfg.icon} style={{ borderRadius: 12 }}>
              {statusCfg.label}
            </Tag>
          </Descriptions.Item>

          <Descriptions.Item
            label={<><GlobalOutlined style={{ marginRight: 4 }} />签署 IP</>}
          >
            <Text code style={{ fontSize: 12 }}>{d.ip_address || '—'}</Text>
          </Descriptions.Item>

          <Descriptions.Item
            label={<><MobileOutlined style={{ marginRight: 4 }} />签署设备</>}
          >
            {d.device_info || '微信小程序'}
          </Descriptions.Item>

          <Descriptions.Item label="有效期">
            {d.valid_from
              ? `${d.valid_from} 起 · ${d.valid_until || '长期有效'}`
              : <Text type="secondary">—</Text>}
          </Descriptions.Item>

          {d.remarks && (
            <Descriptions.Item label="备注">
              <Text type="secondary">{d.remarks}</Text>
            </Descriptions.Item>
          )}
        </Descriptions>

        {/* PDF 预览按钮 */}
        <div className={styles.drawerPdfBtn}>
          <Button
            type="primary"
            size="large"
            icon={<FilePdfOutlined />}
            block
            disabled={!d.pdf_url}
            onClick={() => d.pdf_url && window.open(
              d.pdf_url.startsWith('http') ? d.pdf_url : `http://127.0.0.1:8000${d.pdf_url}`,
              '_blank'
            )}
            style={{
              height: 52,
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              background: d.pdf_url
                ? 'linear-gradient(135deg, #FF4D4F 0%, #CF1322 100%)'
                : undefined,
              border: 'none',
            }}
          >
            📄&nbsp; 预览电子同意书 PDF
          </Button>
          {!d.pdf_url && (
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginTop: 8, fontSize: 12 }}>
              患者尚未完成签署，PDF 尚未生成
            </Text>
          )}
        </div>

      </Spin>
    </Drawer>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

export default function InformedConsent() {
  const [data,         setData]         = useState([])
  const [loading,      setLoading]      = useState(false)
  const [total,        setTotal]        = useState(0)
  const [isMock,       setIsMock]       = useState(false)
  const [page,         setPage]         = useState(1)
  const [pageSize,     setPageSize]     = useState(15)
  const [statusFilter, setStatusFilter] = useState(null)
  const [searchText,   setSearchText]   = useState('')

  // Drawer 状态
  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [drawerRecord, setDrawerRecord] = useState(null)

  const fetchRecords = useCallback(async (pg = page, ps = pageSize, sf = statusFilter) => {
    setLoading(true)
    try {
      const params = { page: pg, page_size: ps }
      if (sf) params.status_filter = sf
      const res = await axios.get('/api/v1/consent/records', { params })
      setData(res.data.items || [])
      setTotal(res.data.total || 0)
      setIsMock(res.data.is_mock || false)
    } catch (err) {
      message.error(`加载失败：${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, statusFilter])

  useEffect(() => { fetchRecords(page, pageSize, statusFilter) }, [page, pageSize, statusFilter])

  const stats = data.reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc },
    { signed: 0, pending: 0, revoked: 0 },
  )

  const filtered = searchText
    ? data.filter(r =>
        r.document_name?.includes(searchText) ||
        r.patient_name?.includes(searchText)
      )
    : data

  // ── 表格列定义 ───────────────────────────────────────────────────────────────
  const columns = [
    {
      title:     '文件名称',
      dataIndex: 'document_name',
      key:       'document_name',
      width:     210,
      render: (name) => (
        <div className={styles.docCell}>
          <FilePdfOutlined
            style={{ color: DOC_COLOR[name] || '#8C8C8C', fontSize: 18, flexShrink: 0 }}
          />
          <Text strong style={{ fontSize: 13 }}>{name}</Text>
        </div>
      ),
    },
    {
      title:     '患者姓名',
      dataIndex: 'patient_name',
      key:       'patient_name',
      width:     90,
      render: (name) => <Text style={{ fontSize: 13 }}>{name}</Text>,
    },
    {
      title:     '签署版本',
      dataIndex: 'version',
      key:       'version',
      width:     90,
      render: (v) => <Tag style={{ borderRadius: 10, fontSize: 11 }}>{v || '—'}</Tag>,
    },
    {
      title:     '签署时间',
      dataIndex: 'signed_at',
      key:       'signed_at',
      width:     150,
      sorter: (a, b) => {
        if (!a.signed_at) return 1
        if (!b.signed_at) return -1
        return new Date(a.signed_at) - new Date(b.signed_at)
      },
      render: (ts) =>
        ts ? (
          <div className={styles.timeCell}>
            <Text style={{ fontSize: 13 }}>{dayjs(ts).format('YYYY-MM-DD')}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(ts).format('HH:mm')}</Text>
          </div>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title:     '状态',
      dataIndex: 'status',
      key:       'status',
      width:     100,
      filters: [
        { text: '已生效', value: 'signed'  },
        { text: '待签署', value: 'pending' },
        { text: '已撤销', value: 'revoked' },
      ],
      onFilter: (value, record) => record.status === value,
      render: (status) => {
        const cfg = STATUS_CONFIG[status] || { label: status, color: 'default', icon: null }
        return (
          <Tag color={cfg.color} icon={cfg.icon} style={{ borderRadius: 12, fontWeight: 500 }}>
            {cfg.label}
          </Tag>
        )
      },
    },
    {
      title:  '操作',
      key:    'action',
      width:  160,
      render: (_, record) => (
        <Space size={4}>
          {/* 查看详情 → Drawer */}
          <Button
            type="link"
            size="small"
            icon={<SafetyCertificateOutlined />}
            onClick={() => { setDrawerRecord(record); setDrawerOpen(true) }}
            style={{ padding: '0 4px' }}
          >
            查看详情
          </Button>

          {record.pdf_url && (
            <>
              <Divider type="vertical" style={{ margin: 0 }} />
              <Tooltip title="预览 PDF">
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => window.open(
                    record.pdf_url.startsWith('http') ? record.pdf_url : `http://127.0.0.1:8000${record.pdf_url}`,
                    '_blank'
                  )}
                  style={{ padding: 0 }}
                />
              </Tooltip>
              <Tooltip title="下载 PDF">
                <Button
                  type="link"
                  size="small"
                  icon={<DownloadOutlined />}
                  style={{ padding: 0, color: '#52C41A' }}
                  onClick={() => {
                    const a = document.createElement('a')
                    a.href = record.pdf_url.startsWith('http')
                      ? record.pdf_url
                      : `http://127.0.0.1:8000${record.pdf_url}`
                    a.download = `${record.document_name}_${record.patient_name}.pdf`
                    a.click()
                  }}
                />
              </Tooltip>
            </>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div className={styles.root}>

      {/* ── 顶部标题栏 ─────────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <FileProtectOutlined className={styles.pageIcon} />
          <div>
            <Title level={4} style={{ margin: 0 }}>知情同意</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>合规审计 · 签署文件记录查询</Text>
          </div>
        </div>
        <div className={styles.headerRight}>
          {isMock && (
            <Tag icon={<InfoCircleOutlined />} color="blue" style={{ borderRadius: 12 }}>
              演示数据
            </Tag>
          )}
          <Tooltip title="刷新列表">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => fetchRecords(page, pageSize, statusFilter)}
              loading={loading}
              size="small"
            />
          </Tooltip>
        </div>
      </div>

      {/* ── 统计卡片 ─────────────────────────────────────────────────────────────── */}
      <Row gutter={16} className={styles.statsRow}>
        <Col xs={12} sm={6}>
          <div className={styles.statCard}>
            <Statistic title="文件总数" value={total}
              prefix={<FileProtectOutlined style={{ color: '#1677FF' }} />} />
          </div>
        </Col>
        <Col xs={12} sm={6}>
          <div className={styles.statCard}>
            <Statistic title="已生效" value={stats.signed}
              valueStyle={{ color: '#52C41A' }} prefix={<CheckCircleOutlined />} />
          </div>
        </Col>
        <Col xs={12} sm={6}>
          <div className={styles.statCard}>
            <Statistic title="待签署" value={stats.pending}
              valueStyle={{ color: '#FA8C16' }} prefix={<ClockCircleOutlined />} />
          </div>
        </Col>
        <Col xs={12} sm={6}>
          <div className={styles.statCard}>
            <Statistic title="已撤销" value={stats.revoked}
              valueStyle={{ color: '#FF4D4F' }} prefix={<StopOutlined />} />
          </div>
        </Col>
      </Row>

      {/* ── 筛选工具栏 ─────────────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <Input
          placeholder="搜索文件名称 / 患者姓名…"
          prefix={<SearchOutlined style={{ color: '#BFBFBF' }} />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          allowClear
          style={{ width: 260 }}
        />
        <Select
          placeholder="全部状态"
          value={statusFilter}
          onChange={val => { setStatusFilter(val); setPage(1) }}
          allowClear
          style={{ width: 120 }}
        >
          <Option value="signed">已生效</Option>
          <Option value="pending">待签署</Option>
          <Option value="revoked">已撤销</Option>
        </Select>
        <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
          共 {filtered.length} 条记录
        </Text>
      </div>

      {/* ── 数据表格 ─────────────────────────────────────────────────────────────── */}
      <div className={styles.tableWrap}>
        <Table
          rowKey="id"
          dataSource={filtered}
          columns={columns}
          loading={loading}
          size="middle"
          locale={{ emptyText: <Empty description="暂无签署记录" /> }}
          pagination={{
            current: page, pageSize, total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '15', '20', '50'],
            showQuickJumper: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps) },
          }}
          rowClassName={(rec) => rec.status === 'revoked' ? styles.rowRevoked : ''}
        />
      </div>

      {/* ── 详情 Drawer ─────────────────────────────────────────────────────────── */}
      <DetailDrawer
        open={drawerOpen}
        record={drawerRecord}
        onClose={() => setDrawerOpen(false)}
      />

    </div>
  )
}

