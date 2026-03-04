/**
 * AiLog/index.jsx — AI 助手执行日志（时间轴展示）
 * ════════════════════════════════════════════════════════════
 * 展示 Agent 每次任务的完整"思考过程"：
 *   - 每条任务展开为 ReAct 步骤时间线
 *   - 工具调用图标 + 耗时 + 输出摘要
 *   - 最终答案高亮卡片
 * ════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import {
  Timeline, Tag, Button, Spin, Empty, Tooltip,
  Typography, Badge, Select, Switch, Collapse,
  Avatar, Divider, Card, Tabs, Row, Col, Statistic, Rate,
} from 'antd'
import ReactECharts from 'echarts-for-react'
import {
  RobotOutlined, DatabaseOutlined, SearchOutlined,
  CodeOutlined, SyncOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ClockCircleOutlined, ThunderboltOutlined,
  ReloadOutlined, UserOutlined, BulbOutlined, FileTextOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import styles from './AiLog.module.css'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const { Text, Title, Paragraph } = Typography
const { Option } = Select

// ══════════════════════════════════════════════════════════════════
// 常量配置
// ══════════════════════════════════════════════════════════════════

/** 工具 → 图标 + 颜色 + 描述的映射 */
const ACTION_CONFIG = {
  db_get_patient_info:  { icon: <DatabaseOutlined />, color: '#1677FF', label: '查询患者档案' },
  db_get_recent_labs:   { icon: <DatabaseOutlined />, color: '#1677FF', label: '查询化验记录' },
  run_python:           { icon: <CodeOutlined />,     color: '#722ED1', label: 'Python 沙箱' },
  web_search:           { icon: <SearchOutlined />,   color: '#FA8C16', label: 'WebSearch' },
  llm_synthesis:        { icon: <RobotOutlined />,    color: '#13C2C2', label: 'LLM 综合分析' },
  intent_parse:         { icon: <BulbOutlined />,     color: '#52C41A', label: '意图解析' },
  default:              { icon: <ApiOutlined />,      color: '#8C8C8C', label: '工具调用' },
}

const STATUS_CONFIG = {
  completed: { color: 'success', icon: <CheckCircleOutlined />,  label: '已完成' },
  failed:    { color: 'error',   icon: <CloseCircleOutlined />,  label: '失败' },
  running:   { color: 'processing', icon: <SyncOutlined spin />, label: '执行中' },
  queued:    { color: 'warning', icon: <ClockCircleOutlined />,  label: '排队中' },
}

const TASK_TYPE_LABEL = {
  lab_analysis:      '化验分析',
  nutrition_advice:  '营养建议',
  risk_assessment:   '风险评估',
  report_generation: '报告生成',
  general_query:     '通用问询',
}

// ══════════════════════════════════════════════════════════════════
// Mock 数据（API 无数据时使用）
// ══════════════════════════════════════════════════════════════════

const MOCK_LOGS = {
  total: 3,
  items: [
    {
      task_id: 'mock-001',
      patient_name: '张伟',
      query: '请分析该患者最近白蛋白趋势，判断营养风险',
      task_type: 'lab_analysis',
      status: 'completed',
      created_at: '2026-03-03T10:01:00+00:00',
      started_ts: '10:01:00',
      duration_ms: 3420,
      total_tokens: 1284,
      steps: [
        { step: 1, thought: '解析医生提问，识别关键实体：患者张伟，指标：白蛋白，任务类型：趋势分析', action: 'intent_parse', action_input: {}, duration_ms: null, output_brief: 'intent=trend_analysis, metric=albumin' },
        { step: 2, thought: '查询数据库获取患者档案，确认当前移植阶段和体重等基础信息', action: 'db_get_patient_info', action_input: { patient_id: '...' }, duration_ms: 42, output_brief: '张伟，60岁，early_post_op，体重 68.5 kg' },
        { step: 3, thought: '获取最近 5 次化验记录，提取白蛋白值序列', action: 'db_get_recent_labs', action_input: { n: 5 }, duration_ms: 68, output_brief: '[28.2, 30.1, 31.5, 32.2, 31.8] g/L' },
        { step: 4, thought: '调用 Python 沙箱计算线性趋势斜率，判断是否持续下降', action: 'run_python', action_input: { code: 'import numpy as np; np.polyfit(...)' }, duration_ms: 120, output_brief: 'slope=+0.9 g/L/次，is_declining=False' },
        { step: 5, thought: '白蛋白低于 35 g/L 参考下限，搜索最新循证营养支持建议', action: 'web_search', action_input: { query: '低白蛋白血症肝移植营养支持指南 2024' }, duration_ms: 880, output_brief: '找到 3 条相关文献摘要' },
        { step: 6, thought: '已收集所有上下文，调用 LLM 综合生成最终建议报告', action: 'llm_synthesis', action_input: {}, duration_ms: 2310, output_brief: '生成建议报告，含营养补充方案' },
      ],
      final_answer: '张伟患者白蛋白（32.2 g/L）低于正常下限（35 g/L），近 5 次检测呈缓慢上升趋势（+0.9 g/L/次）。建议：①每日蛋白质摄入提升至 1.5~2.0 g/kg/d（约 100~136 g/天）；②优先选择支链氨基酸比例高的肝病专用配方；③每 3 天复查白蛋白和前白蛋白。',
      error: null,
    },
    {
      task_id: 'mock-002',
      patient_name: '陈小梅',
      query: '术前营养评估，生成 NRS-2002 评分报告',
      task_type: 'risk_assessment',
      status: 'completed',
      created_at: '2026-03-03T09:45:00+00:00',
      started_ts: '09:45:00',
      duration_ms: 2180,
      total_tokens: 876,
      steps: [
        { step: 1, thought: '识别任务类型为 NRS-2002 营养风险筛查', action: 'intent_parse', action_input: {}, duration_ms: null, output_brief: 'intent=risk_screening, tool=NRS2002' },
        { step: 2, thought: '获取患者基本信息：BMI、ALP、白蛋白等关键指标', action: 'db_get_patient_info', action_input: {}, duration_ms: 35, output_brief: 'BMI=19.4, ALB=30.5 g/L, pre_op' },
        { step: 3, thought: '调用 Python 计算 NRS-2002 总分', action: 'run_python', action_input: { code: 'score = bmi_score + disease_score + age_score' }, duration_ms: 95, output_brief: 'NRS-2002 总分=4，营养风险（≥3）' },
        { step: 4, thought: '搜索术前营养干预循证建议', action: 'web_search', action_input: { query: '肝移植术前营养支持 ESPEN 2023' }, duration_ms: 740, output_brief: '检索到 ESPEN 肝病营养指南核心要点' },
        { step: 5, thought: '综合评估结果生成报告', action: 'llm_synthesis', action_input: {}, duration_ms: 1310, output_brief: '报告已生成' },
      ],
      final_answer: 'NRS-2002 评分 4 分（≥3 分为营养风险），建议术前启动营养干预：①能量目标 1.2~1.5 倍静息代谢率（约 1800~2200 kcal/天）；②高蛋白饮食 1.2~1.5 g/kg/d；③考虑术前 7~14 天口服营养补充（ONS）。',
      error: null,
    },
    {
      task_id: 'mock-003',
      patient_name: '刘洋',
      query: '长期随访阶段营养状态综合评估',
      task_type: 'general_query',
      status: 'failed',
      created_at: '2026-03-03T09:12:00+00:00',
      started_ts: '09:12:00',
      duration_ms: 540,
      total_tokens: 0,
      steps: [
        { step: 1, thought: '尝试获取患者最近化验记录', action: 'db_get_recent_labs', action_input: { n: 5 }, duration_ms: 38, output_brief: '返回 0 条记录（数据库无最新数据）' },
        { step: 2, thought: '数据不足，尝试调用 web_search 补充背景知识', action: 'web_search', action_input: {}, duration_ms: 502, output_brief: 'API 超时' },
      ],
      final_answer: '',
      error: 'WebSearch API 请求超时（502 Bad Gateway），任务已回滚。',
    },
  ],
}

// ══════════════════════════════════════════════════════════════════
// 子组件：单个步骤 Timeline 项
// ══════════════════════════════════════════════════════════════════

function StepItem({ step, taskIdx }) {
  const cfg = ACTION_CONFIG[step.action] || ACTION_CONFIG.default

  return (
    <div className={styles.stepRow}>
      {/* 工具图标 */}
      <div className={styles.stepIcon} style={{ color: cfg.color, borderColor: cfg.color + '40' }}>
        {cfg.icon}
      </div>

      {/* 步骤内容 */}
      <div className={styles.stepBody}>
        {/* 步骤标题行 */}
        <div className={styles.stepTitle}>
          <Tag
            style={{
              color: cfg.color,
              background: cfg.color + '15',
              borderColor: cfg.color + '40',
              fontSize: 11,
              padding: '0 7px',
              borderRadius: 10,
              fontFamily: 'monospace',
            }}
          >
            {cfg.label}
          </Tag>
          {step.duration_ms != null && (
            <span className={styles.stepMs}>
              <ClockCircleOutlined style={{ fontSize: 11 }} /> {step.duration_ms} ms
            </span>
          )}
        </div>

        {/* Thought 文字 */}
        <div className={styles.stepThought}>{step.thought}</div>

        {/* 输出摘要 */}
        {step.output_brief && (
          <div className={styles.stepOutput}>
            <span className={styles.outputArrow}>↳</span>
            <span className={styles.outputText}>{step.output_brief}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 子组件：单条任务卡片
// ══════════════════════════════════════════════════════════════════

function TaskCard({ task, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.queued

  // 将 steps 构建为 Timeline items
  const timelineItems = task.steps.map((step, i) => {
    const cfg = ACTION_CONFIG[step.action] || ACTION_CONFIG.default
    return {
      key: i,
      dot: (
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: cfg.color + '15',
          border: `1.5px solid ${cfg.color}50`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: cfg.color, fontSize: 13,
        }}>
          {cfg.icon}
        </div>
      ),
      children: <StepItem step={step} taskIdx={i} />,
    }
  })

  // 最终答案的 Timeline item
  if (task.final_answer) {
    timelineItems.push({
      key: 'final',
      dot: (
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: '#E6FFFB',
          border: '2px solid #13C2C2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#13C2C2', fontSize: 14,
        }}>
          <FileTextOutlined />
        </div>
      ),
      children: (
        <div className={styles.finalAnswer}>
          <div className={styles.finalLabel}>最终建议</div>
          <Paragraph style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: '#1A1A1A' }}>
            {task.final_answer}
          </Paragraph>
        </div>
      ),
    })
  }

  // 失败时追加错误节点
  if (task.error) {
    timelineItems.push({
      key: 'error',
      color: 'red',
      dot: (
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: '#FFF1F0', border: '2px solid #FF4D4F',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#FF4D4F', fontSize: 14,
        }}>
          <CloseCircleOutlined />
        </div>
      ),
      children: (
        <div className={styles.errorBox}>
          <span className={styles.errorLabel}>执行失败</span>
          <span className={styles.errorMsg}>{task.error}</span>
        </div>
      ),
    })
  }

  return (
    <div className={styles.taskCard}>
      {/* 卡片头部 */}
      <div className={styles.taskHeader} onClick={() => setExpanded(v => !v)}>
        {/* 左：患者 + 查询文本 */}
        <div className={styles.taskLeft}>
          <Avatar
            size={32}
            icon={<UserOutlined />}
            style={{ background: '#E6F4FF', color: '#1677FF', flexShrink: 0 }}
          />
          <div className={styles.taskMeta}>
            <div className={styles.taskTitleRow}>
              <span className={styles.taskPatient}>{task.patient_name}</span>
              <Tag color="blue" style={{ fontSize: 11, borderRadius: 10 }}>
                {TASK_TYPE_LABEL[task.task_type] || task.task_type}
              </Tag>
              <Badge
                status={statusCfg.color}
                text={
                  <span style={{ fontSize: 12 }}>
                    {statusCfg.icon} {statusCfg.label}
                  </span>
                }
              />
            </div>
            <div className={styles.taskQuery}>"{task.query}"</div>
          </div>
        </div>

        {/* 右：时间 + 步骤数 + 耗时 */}
        <div className={styles.taskRight}>
          <Tooltip title={dayjs(task.created_at).format('YYYY-MM-DD HH:mm:ss')}>
            <span className={styles.taskTime}>
              <ClockCircleOutlined /> {task.started_ts}
            </span>
          </Tooltip>
          <span className={styles.taskSteps}>
            {task.steps.length} 步骤
          </span>
          {task.duration_ms != null && (
            <span className={styles.taskDuration}>
              <ThunderboltOutlined /> {(task.duration_ms / 1000).toFixed(2)}s
            </span>
          )}
          <span
            className={`${styles.expandBtn} ${expanded ? styles.expandBtnOpen : ''}`}
          >
            ▼
          </span>
        </div>
      </div>

      {/* 折叠内容：思考步骤时间线 */}
      {expanded && (
        <div className={styles.taskBody}>
          <Divider style={{ margin: '0 0 16px' }} />
          {task.steps.length === 0 ? (
            <Empty description="暂无思考步骤记录" style={{ padding: '16px 0' }} />
          ) : (
            <Timeline
              mode="left"
              items={timelineItems}
              className={styles.stepTimeline}
            />
          )}
          {task.total_tokens > 0 && (
            <div className={styles.tokenBadge}>
              消耗 Token：{task.total_tokens.toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// 主组件：AiLog
// ══════════════════════════════════════════════════════════════════

export default function AiLog() {
  const [logs,         setLogs]         = useState([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [useMock,      setUseMock]      = useState(false)
  const [autoRefresh,  setAutoRefresh]  = useState(false)
  const [patientFilter,setPatientFilter]= useState(null)
  const [patients,     setPatients]     = useState([])
  const [activeView,   setActiveView]   = useState('logs')
  const timerRef = useRef(null)

  const fetchPatients = async () => {
    try {
      const res = await axios.get('/api/v1/patients')
      setPatients(res.data.items || res.data || [])
    } catch {}
  }

  const fetchLogs = useCallback(async () => {
    if (useMock) {
      setLogs(MOCK_LOGS.items)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get('/api/v1/agent/logs', {
        params: { limit: 30, patient_id: patientFilter || undefined },
      })
      const items = res.data.items || []
      if (items.length === 0 && !patientFilter) {
        // 生产数据为空时，自动切换到 Mock 展示
        setLogs(MOCK_LOGS.items)
        setUseMock(true)
      } else {
        setLogs(items)
      }
    } catch (err) {
      setError(err.message)
      // API 失败时降级到 Mock
      setLogs(MOCK_LOGS.items)
    } finally {
      setLoading(false)
    }
  }, [useMock, patientFilter])

  // 初始加载
  useEffect(() => { fetchLogs(); fetchPatients() }, [fetchLogs])

  // 自动刷新（10 秒）
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(fetchLogs, 10_000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [autoRefresh, fetchLogs])

  const statusStats = {
    completed: logs.filter(t => t.status === 'completed').length,
    failed:    logs.filter(t => t.status === 'failed').length,
    running:   logs.filter(t => t.status === 'running').length,
  }

  return (
    <div className={styles.root}>
      {/* ── 页面头部 ───────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <RobotOutlined className={styles.headerIcon} />
          <div>
            <Title level={4} style={{ margin: 0 }}>AI 助手日志</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              ReAct 思考链 · 工具调用记录 · 实时可审计
            </Text>
          </div>
          <Select
            style={{ width: 140, marginLeft: 16 }}
            placeholder="筛选患者"
            allowClear
            size="small"
            value={patientFilter}
            onChange={v => setPatientFilter(v || null)}
            options={patients.map(p => ({ value: p.id, label: p.name }))}
          />
          <Tabs
            size="small"
            activeKey={activeView}
            onChange={setActiveView}
            style={{ marginLeft: 12 }}
            items={[
              { key: 'logs', label: '日志列表' },
              { key: 'stats', label: '统计分析' },
            ]}
          />
        </div>

        <div className={styles.headerRight}>
          {/* 统计徽标 */}
          <div className={styles.statRow}>
            <span className={styles.statItem} style={{ color: '#52C41A' }}>
              <CheckCircleOutlined /> {statusStats.completed} 已完成
            </span>
            <span className={styles.statItem} style={{ color: '#FF4D4F' }}>
              <CloseCircleOutlined /> {statusStats.failed} 失败
            </span>
            {statusStats.running > 0 && (
              <span className={styles.statItem} style={{ color: '#1677FF' }}>
                <SyncOutlined spin /> {statusStats.running} 执行中
              </span>
            )}
          </div>

          {/* 演示模式切换 */}
          <Tooltip title="开启后显示内置演示数据">
            <div className={styles.switchRow}>
              <Text style={{ fontSize: 12, color: '#8C8C8C' }}>演示模式</Text>
              <Switch
                size="small"
                checked={useMock}
                onChange={v => { setUseMock(v); setLogs([]) }}
              />
            </div>
          </Tooltip>

          {/* 自动刷新 */}
          <Tooltip title="每 10 秒自动刷新">
            <div className={styles.switchRow}>
              <Text style={{ fontSize: 12, color: '#8C8C8C' }}>自动刷新</Text>
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
            </div>
          </Tooltip>

          {/* 刷新按钮 */}
          <Button
            icon={<ReloadOutlined spin={loading} />}
            onClick={fetchLogs}
            loading={loading}
            size="small"
          >
            刷新
          </Button>
        </div>
      </div>

      {/* ── API 错误提示 ────────────────────────────────────────── */}
      {error && !useMock && (
        <div className={styles.errorBanner}>
          ⚠️ API 连接失败（{error}）— 当前展示内置演示数据
        </div>
      )}

      {/* ── 统计分析 Tab ────────────────────────────────────────── */}
      {activeView === 'stats' && (() => {
        const typeCount = Object.keys(TASK_TYPE_LABEL).map(k => ({
          name: TASK_TYPE_LABEL[k],
          value: logs.filter(l => l.task_type === k).length,
        })).filter(x => x.value > 0)
        const avgDuration = logs.filter(l => l.duration_ms).reduce((s, l) => s + l.duration_ms, 0) / Math.max(logs.filter(l => l.duration_ms).length, 1)
        const successRate = Math.round(logs.filter(l => l.status === 'completed').length / Math.max(logs.length, 1) * 100)
        const pieOption = {
          tooltip: { trigger: 'item' },
          legend: { bottom: 0, fontSize: 11 },
          series: [{ name: '问诊类型', type: 'pie', radius: ['40%', '70%'],
            data: typeCount, label: { fontSize: 11 } }],
        }
        return (
          <div style={{ padding: '0 24px 24px' }}>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              {[
                { title: '总问诊量', value: logs.length, color: '#1677ff' },
                { title: '成功率', value: successRate, suffix: '%', color: '#52c41a' },
                { title: '平均耗时', value: (avgDuration / 1000).toFixed(1), suffix: 's', color: '#722ed1' },
                { title: '失败次数', value: statusStats.failed, color: '#ff4d4f' },
              ].map((s, i) => (
                <Col key={i} span={6}>
                  <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: '12px 16px' }}>
                    <Statistic title={s.title} value={s.value} suffix={s.suffix}
                      valueStyle={{ color: s.color, fontSize: 22 }} />
                  </Card>
                </Col>
              ))}
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Card title="问诊类型分布" style={{ borderRadius: 10 }}>
                  <ReactECharts option={pieOption} style={{ height: 280 }} />
                </Card>
              </Col>
              <Col span={12}>
                <Card title="近期问诊记录摘要" style={{ borderRadius: 10 }}>
                  {logs.slice(0, 5).map((l, i) => (
                    <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{l.patient_name}</span>
                        <span style={{ fontSize: 11, color: '#999' }}>{l.started_ts}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>"{l.query?.slice(0, 40)}..."</div>
                      <div style={{ marginTop: 4 }}>
                        <Rate disabled defaultValue={l.status === 'completed' ? 4 : 2} count={5} style={{ fontSize: 12 }} />
                      </div>
                    </div>
                  ))}
                </Card>
              </Col>
            </Row>
          </div>
        )
      })()}

      {/* ── 日志列表 ─────────────────────────────────────────────── */}
      {activeView !== 'stats' && (
        <div className={styles.logList}>
          <Spin spinning={loading} tip="加载日志…">
            {logs.length === 0 ? (
              <Empty
                image={<RobotOutlined style={{ fontSize: 64, color: '#D9D9D9' }} />}
                description="暂无 Agent 执行记录"
                style={{ padding: '80px 0' }}
              />
            ) : (
              logs.map((task, idx) => (
                <TaskCard
                  key={task.task_id}
                  task={task}
                  defaultExpanded={idx === 0}
                />
              ))
            )}
          </Spin>
        </div>
      )}
    </div>
  )
}
