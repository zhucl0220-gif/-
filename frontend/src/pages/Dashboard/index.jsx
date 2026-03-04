import React, { useState, useEffect } from 'react'
import { Row, Col, Card, Statistic, Typography, Tag, List, Avatar, Badge, Progress, Divider } from 'antd'
import {
  TeamOutlined, ExperimentOutlined, RobotOutlined,
  ArrowUpOutlined, ArrowDownOutlined, WarningOutlined,
  CheckCircleOutlined, ClockCircleOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'

const { Title, Text } = Typography

// Mock 数据
const STATS = [
  { title: '在院患者',  value: 24,  suffix: '人', icon: <TeamOutlined />,        color: '#1677FF', trend: +2  },
  { title: '本周化验',  value: 87,  suffix: '份', icon: <ExperimentOutlined />,   color: '#52C41A', trend: +12 },
  { title: 'AI 任务',   value: 156, suffix: '次', icon: <RobotOutlined />,        color: '#722ED1', trend: +34 },
  { title: '高风险患者',value: 6,   suffix: '人', icon: <WarningOutlined />,      color: '#FF4D4F', trend: -1  },
]

const RECENT_TASKS = [
  { id: 'T001', patient: '张建国', type: '白蛋白趋势分析',    status: 'completed', ts: '10分钟前',  tokens: 1240 },
  { id: 'T002', patient: '陈淑芬', type: '术前营养风险评估',  status: 'completed', ts: '32分钟前',  tokens: 2180 },
  { id: 'T003', patient: '王秀英', type: '饮食方案生成',      status: 'running',   ts: '刚刚',      tokens: null },
  { id: 'T004', patient: '刘德华', type: 'WebSearch 循证检索',status: 'completed', ts: '1小时前',   tokens: 890  },
  { id: 'T005', patient: '赵明华', type: '化验单 OCR 解析',   status: 'failed',    ts: '2小时前',   tokens: null },
]

const RISK_PATIENTS = [
  { name: '张建国', phase: '术后早期', albumin: 28.5, risk: 'HIGH',   days: 7  },
  { name: '陈淑芬', phase: '等待手术', albumin: 22.1, risk: 'HIGH',   days: null },
  { name: '李文博', phase: '恢复期',   albumin: 31.2, risk: 'MEDIUM', days: 28 },
  { name: '周小燕', phase: '术后早期', albumin: 29.8, risk: 'HIGH',   days: 5  },
]

const STATUS_CONFIG = {
  completed: { color: '#52C41A', bg: '#F6FFED', label: '已完成', icon: <CheckCircleOutlined /> },
  running:   { color: '#1677FF', bg: '#E6F4FF', label: '运行中', icon: <ClockCircleOutlined /> },
  failed:    { color: '#FF4D4F', bg: '#FFF1F0', label: '失败',   icon: <WarningOutlined /> },
}

const RISK_COLOR = { HIGH: '#FF4D4F', MEDIUM: '#FA8C16', LOW: '#52C41A' }

export default function Dashboard() {
  const [time, setTime] = useState(dayjs().format('YYYY-MM-DD HH:mm:ss'))
  useEffect(() => {
    const t = setInterval(() => setTime(dayjs().format('YYYY-MM-DD HH:mm:ss')), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{ padding: 24 }}>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>控制台</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>协和医院 肝移植中心营养管理系统</Text>
        </div>
        <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 13 }}>{time}</Text>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]}>
        {STATS.map(s => (
          <Col xs={12} sm={12} md={6} key={s.title}>
            <Card
              bordered={false}
              style={{ borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
              bodyStyle={{ padding: '18px 20px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Statistic
                  title={<span style={{ fontSize: 13, color: '#8C8C8C' }}>{s.title}</span>}
                  value={s.value}
                  suffix={s.suffix}
                  valueStyle={{ fontSize: 28, fontWeight: 700, color: '#1A1A1A' }}
                />
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: s.color + '15',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, color: s.color,
                }}>
                  {s.icon}
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {s.trend > 0
                  ? <Text style={{ color: '#52C41A' }}><ArrowUpOutlined /> 较昨日 +{s.trend}</Text>
                  : <Text style={{ color: '#FF4D4F' }}><ArrowDownOutlined /> 较昨日 {s.trend}</Text>
                }
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* AI 任务日志 */}
        <Col xs={24} lg={14}>
          <Card
            title={<span style={{ fontSize: 14, fontWeight: 600 }}>🤖 最近 AI 任务</span>}
            bordered={false}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>今日共 {RECENT_TASKS.length} 次</Text>}
            style={{ borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
            bodyStyle={{ padding: '0 0 8px' }}
          >
            <List
              dataSource={RECENT_TASKS}
              renderItem={task => {
                const s = STATUS_CONFIG[task.status]
                return (
                  <List.Item
                    style={{ padding: '10px 20px', borderBottom: '1px solid #F5F5F5' }}
                    extra={
                      <div style={{ textAlign: 'right' }}>
                        <Tag
                          style={{
                            color: s.color, background: s.bg,
                            border: `1px solid ${s.color}30`,
                            borderRadius: 12, fontSize: 12,
                          }}
                        >
                          {s.icon} {s.label}
                        </Tag>
                        <div style={{ fontSize: 11, color: '#BFBFBF', marginTop: 2 }}>
                          {task.tokens ? `${task.tokens} tokens` : '—'}
                        </div>
                      </div>
                    }
                  >
                    <List.Item.Meta
                      avatar={<Avatar size={32} style={{ background: '#E6F4FF', color: '#1677FF', fontSize: 13 }}>
                        {task.patient[0]}
                      </Avatar>}
                      title={<Text style={{ fontSize: 13, fontWeight: 500 }}>{task.patient} · {task.type}</Text>}
                      description={<Text type="secondary" style={{ fontSize: 12 }}>{task.id} · {task.ts}</Text>}
                    />
                  </List.Item>
                )
              }}
            />
          </Card>
        </Col>

        {/* 高风险患者 */}
        <Col xs={24} lg={10}>
          <Card
            title={<span style={{ fontSize: 14, fontWeight: 600 }}>⚠️ 高风险患者监控</span>}
            bordered={false}
            style={{ borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
            bodyStyle={{ padding: '8px 20px 16px' }}
          >
            {RISK_PATIENTS.map((p, i) => (
              <div key={i}>
                <div style={{ padding: '10px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar size={36} style={{ background: RISK_COLOR[p.risk] + '20', color: RISK_COLOR[p.risk], fontWeight: 600 }}>
                    {p.name[0]}
                  </Avatar>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</Text>
                      <Tag color={p.risk === 'HIGH' ? 'red' : 'orange'} style={{ borderRadius: 10, fontSize: 11 }}>
                        {p.risk === 'HIGH' ? '高风险' : '中风险'}
                      </Tag>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{p.phase}</Text>
                      {p.days != null && <Text type="secondary" style={{ fontSize: 12 }}>· 术后第{p.days}天</Text>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: '#8C8C8C' }}>白蛋白</Text>
                      <Progress
                        percent={Math.round((p.albumin / 55) * 100)}
                        size="small"
                        strokeColor={p.albumin < 30 ? '#FF4D4F' : p.albumin < 35 ? '#FA8C16' : '#52C41A'}
                        showInfo={false}
                        style={{ flex: 1 }}
                      />
                      <Text style={{ fontSize: 12, fontWeight: 600, color: p.albumin < 30 ? '#FF4D4F' : '#FA8C16' }}>
                        {p.albumin} g/L
                      </Text>
                    </div>
                  </div>
                </div>
                {i < RISK_PATIENTS.length - 1 && <Divider style={{ margin: '0' }} />}
              </div>
            ))}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
