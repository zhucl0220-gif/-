/**
 * AICopilot.jsx — 全局 AI 智能体入口
 * ════════════════════════════════════════════════════════════════════
 * 功能：
 *  - 右下角悬浮按钮，点击弹出对话抽屉（Drawer）
 *  - 支持多轮对话 + Slot Filling（AI 主动反问补参数）
 *  - 工具链执行时展示实时思维链时间轴（Chain of Thought UI）
 *  - SSE 流式接收：工具步骤逐步推送，AI 回复逐字输出
 * ════════════════════════════════════════════════════════════════════
 */
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react'
import {
  Avatar, Badge, Button, Drawer, FloatButton, Input,
  Space, Tag, Timeline, Tooltip, Typography,
} from 'antd'
import {
  CheckCircleFilled,
  CloseOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  RobotOutlined,
  SearchOutlined,
  SendOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'

const { Text, Paragraph } = Typography

// ── 工具图标和标签映射 ──────────────────────────────────────────────────────
const TOOL_META = {
  get_patient_by_name:     { icon: <UserOutlined />,        label: '查找患者档案',    color: '#1677FF' },
  get_latest_lab_results:  { icon: <ExclamationCircleOutlined />, label: '获取化验结果', color: '#FA8C16' },
  get_diet_recent_summary: { icon: <DatabaseOutlined />,    label: '查询饮食记录',    color: '#52C41A' },
  generate_nutrition_plan: { icon: <ThunderboltOutlined />, label: 'AI 生成营养方案', color: '#722ED1' },
  save_nutrition_plan:     { icon: <CheckCircleFilled />,   label: '保存方案到数据库', color: '#13C2C2' },
  search_medical_knowledge:{ icon: <SearchOutlined />,      label: '搜索医学知识库',  color: '#EB2F96' },
}

// ── SSE 事件解析器 ──────────────────────────────────────────────────────────

// ── 快捷提示词 ─────────────────────────────────────────────────────────────
const QUICK_PROMPTS = [
  '帮我生成一份营养方案',
  '查看最新化验结果',
  '分析患者饮食依从性',
  '搜索肝移植营养指南',
]

// ══════════════════════════════════════════════════════════════════════════════
// 子组件：单条思维链步骤
// ══════════════════════════════════════════════════════════════════════════════
function CoTStep({ step }) {
  const meta = TOOL_META[step.tool] || { icon: <SyncOutlined />, label: step.tool, color: '#595959' }

  let dot, color
  if (step.status === 'running') {
    dot   = <LoadingOutlined style={{ color: meta.color }} />
    color = meta.color
  } else if (step.status === 'done') {
    dot   = <CheckCircleFilled style={{ color: '#52C41A', fontSize: 14 }} />
    color = '#52C41A'
  } else {
    dot   = <ExclamationCircleOutlined style={{ color: '#FF4D4F', fontSize: 14 }} />
    color = '#FF4D4F'
  }

  return {
    dot,
    color,
    children: (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Tag icon={meta.icon} color={meta.color} style={{ margin: 0, fontSize: 11 }}>
            {meta.label}
          </Tag>
          {step.status === 'running' && (
            <Text type="secondary" style={{ fontSize: 11 }}>执行中…</Text>
          )}
          {step.status === 'done' && step.ms && (
            <Text type="secondary" style={{ fontSize: 11 }}>{step.ms}ms ✓</Text>
          )}
          {step.status === 'error' && (
            <Text type="danger" style={{ fontSize: 11 }}>{step.error}</Text>
          )}
        </div>
        {step.status === 'done' && step.summary && (
          <div style={{
            marginTop: 4, padding: '4px 8px',
            background: '#F6FFED', borderRadius: 4, border: '1px solid #B7EB8F',
            fontSize: 11, color: '#389E0D', maxWidth: 360,
          }}>
            {step.summary}
          </div>
        )}
      </div>
    ),
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 子组件：消息气泡
// ══════════════════════════════════════════════════════════════════════════════
function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  const isThinking = msg.role === 'thinking'

  if (isThinking) {
    return (
      <div style={{ textAlign: 'center', padding: '4px 0' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          <SyncOutlined spin style={{ marginRight: 4 }} />
          {msg.content}
        </Text>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 8,
      alignItems: 'flex-start',
    }}>
      {/* 头像 */}
      <Avatar
        size={32}
        style={{
          background: isUser ? '#1677FF' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          flexShrink: 0,
          fontSize: 14,
        }}
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
      />

      {/* 气泡 */}
      <div style={{ maxWidth: '76%' }}>
        <div style={{
          padding: '10px 14px',
          borderRadius: isUser ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
          background: isUser
            ? 'linear-gradient(135deg, #1677FF, #4096FF)'
            : '#FFFFFF',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          border: isUser ? 'none' : '1px solid #F0F0F0',
          color: isUser ? '#fff' : '#141414',
          fontSize: 13,
          lineHeight: 1.65,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}>
          {/* 流式光标 */}
          {msg.streaming ? (
            <>
              {msg.content}
              <span style={{
                display: 'inline-block',
                width: 2, height: '1em',
                background: '#1677FF',
                marginLeft: 2,
                animation: 'blink 0.8s step-end infinite',
                verticalAlign: 'text-bottom',
              }} />
            </>
          ) : msg.content}
        </div>

        {/* 执行链时间轴（仅 AI 气泡，有步骤时显示） */}
        {!isUser && msg.steps && msg.steps.length > 0 && (
          <div style={{
            marginTop: 8,
            padding: '10px 12px',
            background: '#FAFAFA',
            border: '1px solid #F0F0F0',
            borderRadius: 8,
          }}>
            <Text style={{ fontSize: 11, color: '#8C8C8C', display: 'block', marginBottom: 6 }}>
              🔗 执行流程
            </Text>
            <Timeline style={{ marginBottom: 0 }} items={msg.steps.map(step => CoTStep({ step }))} />
          </div>
        )}

        {/* 时间戳 */}
        <Text style={{
          fontSize: 10, color: '#BFBFBF',
          display: 'block', marginTop: 3,
          textAlign: isUser ? 'right' : 'left',
        }}>
          {dayjs(msg.ts).format('HH:mm')}
        </Text>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════════════════════
export default function AICopilot() {
  const [open,      setOpen]      = useState(false)
  const [messages,  setMessages]  = useState([])      // { id, role, content, steps, streaming, ts }
  const [input,     setInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const [unread,    setUnread]    = useState(0)

  const scrollRef  = useRef(null)
  const abortRef   = useRef(null)   // AbortController
  const sessionId  = useRef(`session-${Date.now()}`)

  // ── 自动滚底 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // ── 初始欢迎语 ────────────────────────────────────────────────────────────
  useEffect(() => {
    setMessages([{
      id:      'welcome',
      role:    'assistant',
      content: '您好！我是肝移植营养 AI 助理 🤖\n\n我可以帮您：\n• 查询患者档案和化验结果\n• 生成并保存个性化营养方案\n• 搜索循证医学建议\n\n请描述您的需求，我来为您处理。',
      steps:   [],
      ts:      Date.now(),
    }])
  }, [])

  // ── 未读角标 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open && messages.length > 1) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.role === 'assistant' && lastMsg.id !== 'welcome') {
        setUnread(n => n + 1)
      }
    }
  }, [messages]) // eslint-disable-line

  const handleOpen = useCallback(() => {
    setOpen(true)
    setUnread(0)
  }, [])

  // ── 构建输出摘要（用于时间轴展示） ──────────────────────────────────────
  const buildStepSummary = useCallback((toolName, output) => {
    if (!output || output.error) return output?.error || ''
    switch (toolName) {
      case 'get_patient_by_name': {
        if (output.found && output.patient)
          return `找到：${output.patient.name}（${output.patient.current_phase}）`
        if (output.found && output.count > 1)
          return `找到 ${output.count} 位患者，需进一步确认`
        return output.message || '未找到患者'
      }
      case 'get_latest_lab_results':
        return output.found ? `获取到 ${output.count} 次化验记录` : (output.message || '暂无记录')
      case 'get_diet_recent_summary':
        return output.found
          ? `近7天平均热量 ${output.total_calories_avg} kcal，依从性 ${output.avg_compliance_pct}%`
          : (output.message || '暂无打卡')
      case 'generate_nutrition_plan':
        return output.success
          ? `方案已生成：${output.plan?.energy_kcal || '?'} kcal/天`
          : (output.error || '生成失败')
      case 'save_nutrition_plan':
        return output.success ? `已保存 → ${output.message}` : (output.error || '保存失败')
      case 'search_medical_knowledge':
        return output.found
          ? `获取到 ${output.snippets?.length || 0} 条文献摘要`
          : (output.message || '未检索到文献')
      default:
        return JSON.stringify(output).slice(0, 60)
    }
  }, [])

  // ── 发送消息 ──────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text) => {
    const userText = (text || input).trim()
    if (!userText || streaming) return
    setInput('')

    // 追加用户消息
    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: userText, ts: Date.now() }
    const aiMsgId = `a-${Date.now()}`
    const aiMsg   = { id: aiMsgId, role: 'assistant', content: '', steps: [], streaming: true, ts: Date.now() }

    setMessages(prev => [...prev, userMsg, aiMsg])
    setStreaming(true)

    // 构建发送给后端的消息历史（user/assistant 角色，排除 thinking/welcome 等内部消息）
    const history = [...messages, userMsg]
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .filter(m => m.id !== 'welcome')
      .map(m => ({ role: m.role, content: m.content || '' }))

    const abortCtrl = new AbortController()
    abortRef.current = abortCtrl

    let fullReply = ''
    let stepMap   = {}   // step index → step object

    const updateAiMsg = (updater) => {
      setMessages(prev => prev.map(m => m.id === aiMsgId ? updater(m) : m))
    }

    try {
      const resp = await fetch('http://127.0.0.1:8000/api/v1/agent/copilot', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: history, session_id: sessionId.current }),
        signal:  abortCtrl.signal,
      })

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`)
      }

      const reader  = resp.body.getReader()
      const decoder = new TextDecoder()
      let sseBuffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        sseBuffer += decoder.decode(value, { stream: true })
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop()        // 保留最后一行（可能是不完整的数据）
        const events = []
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { events.push(JSON.parse(line.slice(6))) } catch { /* 跳过格式错误 */ }
          }
        }

        for (const ev of events) {
          console.log('[SSE]', ev.type, ev)
          switch (ev.type) {
            case 'thinking':
              // 在气泡内显示思考文案（轻量提示，不加步骤）
              break

            case 'tool_start': {
              const step = {
                step:   ev.step,
                tool:   ev.tool,
                input:  ev.input,
                status: 'running',
                ms:     null,
                summary: '',
              }
              stepMap = { ...stepMap, [ev.step]: step }
              updateAiMsg(m => ({ ...m, steps: Object.values(stepMap) }))
              break
            }

            case 'tool_done': {
              const summary = buildStepSummary(ev.tool, ev.output)
              stepMap = {
                ...stepMap,
                [ev.step]: { ...stepMap[ev.step], status: 'done', ms: ev.ms, summary, output: ev.output },
              }
              updateAiMsg(m => ({ ...m, steps: Object.values(stepMap) }))
              break
            }

            case 'tool_error': {
              stepMap = {
                ...stepMap,
                [ev.step]: { ...stepMap[ev.step], status: 'error', ms: ev.ms, error: ev.error },
              }
              updateAiMsg(m => ({ ...m, steps: Object.values(stepMap) }))
              break
            }

            case 'reply_chunk':
              fullReply += ev.content
              updateAiMsg(m => ({ ...m, content: fullReply, streaming: true }))
              break

            case 'done':
              fullReply = ev.reply || fullReply
              updateAiMsg(m => ({ ...m, content: fullReply, streaming: false }))
              setStreaming(false)
              reader.cancel()
              return

            case 'error':
              updateAiMsg(m => ({
                ...m,
                content:   `⚠️ 发生错误：${ev.message}`,
                streaming: false,
              }))
              setStreaming(false)
              reader.cancel()
              return

            default:
              break
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        updateAiMsg(m => ({
          ...m,
          content:   `⚠️ 网络错误：${err.message}`,
          streaming: false,
        }))
      }
      setStreaming(false)
    }
  }, [input, messages, streaming, buildStepSummary])

  // ── 停止生成 ──────────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
    setMessages(prev => prev.map(m =>
      m.streaming ? { ...m, streaming: false, content: m.content + ' [已停止]' } : m
    ))
  }, [])

  // ── 清空对话 ──────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setMessages([{
      id:      'welcome',
      role:    'assistant',
      content: '对话已清空。有什么需要帮助的吗？',
      steps:   [],
      ts:      Date.now(),
    }])
    sessionId.current = `session-${Date.now()}`
  }, [])

  // ── 键盘发送（Enter） ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── 全局 blink 动画（CSS-in-JS） ─────────────────────────────────── */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        .copilot-input .ant-input {
          font-size: 13px !important;
        }
      `}</style>

      {/* ── 悬浮按钮 ─────────────────────────────────────────────────────── */}
      <Badge count={unread} size="small" offset={[-6, 6]}>
        <FloatButton
          icon={<RobotOutlined />}
          type="primary"
          tooltip="AI 助理"
          style={{ right: 24, bottom: 24, width: 52, height: 52 }}
          onClick={handleOpen}
        />
      </Badge>

      {/* ── 对话 Drawer ──────────────────────────────────────────────────── */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar
              size={30}
              style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
              icon={<RobotOutlined />}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>
                肝移植营养 AI 助理
              </div>
              <div style={{ fontSize: 11, color: '#8C8C8C', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                  background: streaming ? '#FAAD14' : '#52C41A',
                }} />
                {streaming ? '处理中…' : '在线'}
              </div>
            </div>
          </div>
        }
        placement="right"
        width={480}
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' } }}
        extra={
          <Space>
            <Tooltip title="清空对话">
              <Button
                type="text" size="small"
                icon={<CloseOutlined />}
                onClick={handleClear}
                disabled={streaming}
              />
            </Tooltip>
          </Space>
        }
      >
        {/* ── 消息区 ─────────────────────────────────────────────────────── */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 16px 8px',
            display: 'flex', flexDirection: 'column', gap: 16,
            background: '#F5F7FA',
          }}
        >
          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
        </div>

        {/* ── 快捷提示区（对话为空时） ───────────────────────────────────── */}
        {messages.length <= 1 && (
          <div style={{
            padding: '8px 16px',
            background: '#FAFAFA',
            borderTop: '1px solid #F0F0F0',
            display: 'flex', flexWrap: 'wrap', gap: 6,
          }}>
            {QUICK_PROMPTS.map(p => (
              <Tag
                key={p}
                style={{
                  cursor: 'pointer',
                  borderRadius: 12,
                  padding: '2px 10px',
                  fontSize: 12,
                  background: '#EFF6FF',
                  border: '1px solid #BAE0FF',
                  color: '#1677FF',
                }}
                onClick={() => handleSend(p)}
              >
                {p}
              </Tag>
            ))}
          </div>
        )}

        {/* ── 输入区 ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: '12px 16px',
          background: '#fff',
          borderTop: '1px solid #F0F0F0',
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Input.TextArea
              className="copilot-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入问题…（Enter 发送，Shift+Enter 换行）"
              autoSize={{ minRows: 1, maxRows: 5 }}
              disabled={streaming}
              style={{
                borderRadius: 10,
                resize: 'none',
                flex: 1,
                fontSize: 13,
              }}
            />
            {streaming ? (
              <Button
                danger
                type="primary"
                shape="circle"
                icon={<CloseOutlined />}
                onClick={handleStop}
                style={{ flexShrink: 0 }}
              />
            ) : (
              <Button
                type="primary"
                shape="circle"
                icon={<SendOutlined />}
                onClick={() => handleSend()}
                disabled={!input.trim()}
                style={{ flexShrink: 0 }}
              />
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
            AI 生成内容仅供参考，医疗决策请遵循临床规范
          </Text>
        </div>
      </Drawer>
    </>
  )
}
