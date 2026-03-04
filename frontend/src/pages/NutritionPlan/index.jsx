/**
 * NutritionPlan/index.jsx — 营养方案页
 * 布局:
 *   顶部  患者选择 + 当前阶段 Badge + 查看详情按钮
 *   中部  目标仪表盘（Progress 圆环）
 *   下部  饮食建议 List + 饮食禁忌 + 补充剂
 *   Drawer 详情：Card①营养量化目标  Card②饮食执行建议
 */

import React, { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import {
  Select, Spin, Empty, Tag, Progress, List, Avatar,
  Button, Tooltip, Divider, Typography, Badge, Card,
  Row, Col, Space, Drawer, Statistic,
} from 'antd'
import {
  HeartOutlined, UserOutlined, ThunderboltOutlined,
  CheckCircleOutlined, WarningOutlined, RobotOutlined,
  ReloadOutlined, InfoCircleOutlined, StopOutlined,
  MedicineBoxOutlined, BulbOutlined, ExclamationCircleOutlined,
  FileTextOutlined, BarChartOutlined, ForkOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import styles from './NutritionPlan.module.css'

const { Text, Title, Paragraph } = Typography
const { Option } = Select

// ── 阶段配置 ─────────────────────────────────────────────────────────────────
const PHASE_LABELS = {
  pre_assessment:   { label: '术前评估期', color: 'blue'   },
  pre_operation:    { label: '等待手术期', color: 'purple' },
  early_post_op:    { label: '术后早期',   color: 'red'    },
  recovery:         { label: '恢复期',     color: 'orange' },
  rehabilitation:   { label: '康复期',     color: 'cyan'   },
  long_term_follow: { label: '长期随访',   color: 'green'  },
}

// ── 各阶段食材 & 误区（前端常量，用于规则方案 Drawer）──────────────────────────
const PHASE_FOODS = {
  pre_assessment: {
    foods_good:      ['鸡蛋白（优质蛋白）', '低脂牛奶', '豆腐', '鸡胸肉', '绿叶蔬菜', '燕麦'],
    foods_avoid:     ['动物内脏', '腌制食品', '高糖饮料', '生冷海鲜', '酒精'],
    common_mistakes: ['多吃补品反而加重肝脏代谢负担', '忽略限盐 → 腹水加重', '蛋白质不足 → 术前营养不良'],
  },
  pre_operation: {
    foods_good:      ['乳清蛋白粉', 'BCAA 饮料', '鱼肉', '鸡蛋', '全麦面包', '新鲜水果（非西柚）'],
    foods_avoid:     ['高钠腌菜', '酒精饮料', '高铜食物（猪肝、坚果）', '生食'],
    common_mistakes: ['术前大量进补升高转氨酶', '忽略 BCAA 补充', '误以为术前应少吃'],
  },
  early_post_op: {
    foods_good:      ['肝病专用肠内营养制剂', '稀粥/米汤', '豆腐脑', '蒸蛋羹'],
    foods_avoid:     ['固体食物（排气前禁止）', '高糖食物', '产气食物（豆类、洋葱）', '浓缩果汁'],
    common_mistakes: ['过早进食固体食物 → 吻合口瘘风险', '忌纤素反而拖慢恢复', '忽略血糖监测（目标 7.8-10 mmol/L）'],
  },
  recovery: {
    foods_good:      ['清蒸鱼', '低脂牛奶', '嫩豆腐', '蒸南瓜', '米饭（软饭）', '苹果、梨'],
    foods_avoid:     ['⚠️ 西柚/杨橙（极度危险，干扰他克莫司）', '生食', '高脂油炸食品', '高钾食物（香蕉）'],
    common_mistakes: ['西柚口味饮料也可能含真实西柚成分', '低估蛋白质需求（≥1.5g/kg）', '随意停口服营养补充'],
  },
  rehabilitation: {
    foods_good:      ['深海鱼（三文鱼、鳕鱼）', '橄榄油', '全谷物', '各类蔬菜 ≥400g/天', '坚果（少量）'],
    foods_avoid:     ['⚠️ 西柚/杨橙（持续禁止）', '高嘌呤食物', '含糖饮料', '高钠速食'],
    common_mistakes: ['3个月后不再避西柚（终身）', '忽略钙质补充 → 骨质疏松', '蛋白质过量担心肾脏（1.2g/kg 安全）'],
  },
  long_term_follow: {
    foods_good:      ['地中海饮食：蔬菜、全谷物、橄榄油', '每周深海鱼 ≥2次', '低脂乳制品（钙源）'],
    foods_avoid:     ['⚠️ 西柚/杨橙（终身无例外）', '精制糖与甜点', '含糖饮料', '深加工食品'],
    common_mistakes: ['停用钙+VitD → 骨折风险升高', '忽略体重管理 → 代谢综合征', '随意减少随访频率'],
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：目标仪表圆环
// ─────────────────────────────────────────────────────────────────────────────

function TargetGauge({ title, value, unit, max, color, icon, hint }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className={styles.gaugeCard}>
      <Progress
        type="circle"
        percent={pct}
        size={100}
        strokeColor={color}
        trailColor="#F0F0F0"
        strokeWidth={8}
        format={() => (
          <div className={styles.gaugeCenter}>
            <span className={styles.gaugeValue}>{value}</span>
            <span className={styles.gaugeUnit}>{unit}</span>
          </div>
        )}
      />
      <div className={styles.gaugeLabel}>
        <span className={styles.gaugeIcon} style={{ color }}>{icon}</span>
        {title}
      </div>
      {hint && (
        <Tooltip title={hint}>
          <span className={styles.gaugeHint}>
            <InfoCircleOutlined style={{ fontSize: 11, color: '#BFBFBF' }} />
          </span>
        </Tooltip>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：能量分配横条
// ─────────────────────────────────────────────────────────────────────────────

function EnergyBar({ targets }) {
  const { energy, protein_kcal, fat_kcal, carb_kcal } = targets
  if (!energy) return null
  const items = [
    { label: '蛋白质', kcal: protein_kcal, color: '#1677FF' },
    { label: '脂肪',   kcal: fat_kcal,     color: '#FA8C16' },
    { label: '碳水',   kcal: carb_kcal,    color: '#52C41A' },
  ]
  return (
    <div className={styles.energyBar}>
      <div className={styles.energyBarLabel}>
        <Text type="secondary" style={{ fontSize: 12 }}>热量分配</Text>
        <Text strong style={{ fontSize: 12 }}>{energy} kcal/天</Text>
      </div>
      <div className={styles.energyBarTrack}>
        {items.map(it => (
          <Tooltip key={it.label}
            title={`${it.label}：${it.kcal} kcal (${Math.round(it.kcal / energy * 100)}%)`}>
            <div className={styles.energyBarSeg} style={{
              width: `${Math.round(it.kcal / energy * 100)}%`, background: it.color,
            }} />
          </Tooltip>
        ))}
      </div>
      <div className={styles.energyBarLegend}>
        {items.map(it => (
          <span key={it.label} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: it.color }} />
            {it.label} {Math.round(it.kcal / energy * 100)}%
          </span>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：详情 Drawer
// ─────────────────────────────────────────────────────────────────────────────

function PlanDetailDrawer({ open, plan, onClose }) {
  const [detail,  setDetail]  = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !plan) return
    setDetail(null)

    if (plan.plan_id) {
      // DB 方案 → 拉取完整详情（含食材 & 误区）
      setLoading(true)
      axios.get(`/api/v1/nutrition/plans/${plan.plan_id}/detail`)
        .then(res => setDetail(res.data))
        .catch(() => setDetail(null))
        .finally(() => setLoading(false))
    }
    // 规则方案：由 plan 对象 + PHASE_FOODS 常量驱动，无需额外请求
  }, [open, plan])

  if (!plan) return null

  // 合并数据：DB 详情优先，否则降级到本地
  const food = detail || {}
  const phase = plan.phase || 'recovery'
  const phaseFoods = PHASE_FOODS[phase] || {}

  const foods_good      = food.foods_good      || phaseFoods.foods_good      || []
  const foods_avoid     = food.foods_avoid     || phaseFoods.foods_avoid     || []
  const common_mistakes = food.common_mistakes || phaseFoods.common_mistakes || []

  const energy  = plan.targets?.energy  || 0
  const protein = plan.targets?.protein || 0
  const fat_g   = food.targets?.fat_g   || (plan.targets?.fat_kcal  ? Math.round(plan.targets.fat_kcal  / 9) : null)
  const carb_g  = food.targets?.carb_g  || (plan.targets?.carb_kcal ? Math.round(plan.targets.carb_kcal / 4) : null)

  const phaseInfo = PHASE_LABELS[phase] || { label: plan.phase_label, color: 'default' }

  return (
    <Drawer
      title={
        <Space>
          <FileTextOutlined style={{ color: '#1677FF' }} />
          <span>营养方案详情</span>
          <Tag color={phaseInfo.color} style={{ borderRadius: 10, fontWeight: 600 }}>
            {plan.phase_label || phaseInfo.label}
          </Tag>
        </Space>
      }
      width={560}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: 20, background: '#F5F7FA' } }}
    >
      <Spin spinning={loading}>
        <Space direction="vertical" style={{ width: '100%' }} size={16}>

          {/* ── Card 1：营养量化目标 ─────────────────────────────────────────── */}
          <Card
            title={
              <Space>
                <BarChartOutlined style={{ color: '#FA8C16' }} />
                <Text strong>营养量化目标</Text>
              </Space>
            }
            bordered={false}
            style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}
            styles={{ body: { paddingTop: 16 } }}
          >
            {/* 主指标：大字号 */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={12}>
                <div className={styles.targetBigNum}>
                  <span className={styles.targetBigVal} style={{ color: '#FA8C16' }}>
                    {energy}
                  </span>
                  <span className={styles.targetBigUnit}>kcal / 天</span>
                  <Text type="secondary" style={{ fontSize: 12, marginTop: 2 }}>目标总热量</Text>
                  {plan.targets?.kcal_per_kg && (
                    <Text style={{ fontSize: 11, color: '#BFBFBF' }}>
                      ({plan.targets.kcal_per_kg} kcal/kg)
                    </Text>
                  )}
                </div>
              </Col>
              <Col span={12}>
                <div className={styles.targetBigNum}>
                  <span className={styles.targetBigVal} style={{ color: '#1677FF' }}>
                    {protein}
                  </span>
                  <span className={styles.targetBigUnit}>g / 天</span>
                  <Text type="secondary" style={{ fontSize: 12, marginTop: 2 }}>目标蛋白质</Text>
                  {plan.targets?.protein_per_kg && (
                    <Text style={{ fontSize: 11, color: '#BFBFBF' }}>
                      ({plan.targets.protein_per_kg} g/kg)
                    </Text>
                  )}
                </div>
              </Col>
            </Row>

            {/* 次指标：脂肪 & 碳水 */}
            <Row gutter={12}>
              {fat_g !== null && (
                <Col span={12}>
                  <div className={styles.targetSmall}>
                    <Text type="secondary" style={{ fontSize: 12 }}>脂肪目标</Text>
                    <Text strong style={{ color: '#722ED1' }}>{fat_g} g/天</Text>
                  </div>
                </Col>
              )}
              {carb_g !== null && (
                <Col span={12}>
                  <div className={styles.targetSmall}>
                    <Text type="secondary" style={{ fontSize: 12 }}>碳水目标</Text>
                    <Text strong style={{ color: '#52C41A' }}>{carb_g} g/天</Text>
                  </div>
                </Col>
              )}
            </Row>

            {/* 热量分配迷你横条 */}
            {energy > 0 && plan.targets?.protein_kcal && (
              <div style={{ marginTop: 12 }}>
                <EnergyBar targets={plan.targets} />
              </div>
            )}
          </Card>

          {/* ── Card 2：饮食执行建议 ─────────────────────────────────────────── */}
          <Card
            title={
              <Space>
                <ForkOutlined style={{ color: '#52C41A' }} />
                <Text strong>饮食执行建议</Text>
              </Space>
            }
            bordered={false}
            style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}
            styles={{ body: { paddingTop: 8 } }}
          >
            {/* 宜吃食物 */}
            {foods_good.length > 0 && (
              <div className={styles.foodSection}>
                <div className={styles.foodSectionTitle} style={{ color: '#52C41A' }}>
                  <CheckCircleOutlined /> 宜吃食物
                </div>
                <List
                  size="small"
                  dataSource={foods_good}
                  renderItem={item => (
                    <List.Item className={styles.foodItem}>
                      <span className={styles.foodDot} style={{ background: '#52C41A' }} />
                      <Text style={{ fontSize: 13 }}>{item}</Text>
                    </List.Item>
                  )}
                />
              </div>
            )}

            <Divider style={{ margin: '12px 0' }} />

            {/* 忌口食物 */}
            {foods_avoid.length > 0 && (
              <div className={styles.foodSection}>
                <div className={styles.foodSectionTitle} style={{ color: '#FF4D4F' }}>
                  <StopOutlined /> 忌口食物
                </div>
                <List
                  size="small"
                  dataSource={foods_avoid}
                  renderItem={item => (
                    <List.Item className={styles.foodItem}>
                      <span className={styles.foodDot} style={{ background: '#FF4D4F' }} />
                      <Text style={{ fontSize: 13, color: '#CF1322' }}>{item}</Text>
                    </List.Item>
                  )}
                />
              </div>
            )}

            <Divider style={{ margin: '12px 0' }} />

            {/* 常见误区 */}
            {common_mistakes.length > 0 && (
              <div className={styles.foodSection}>
                <div className={styles.foodSectionTitle} style={{ color: '#FA8C16' }}>
                  <WarningOutlined /> 常见误区
                </div>
                <List
                  size="small"
                  dataSource={common_mistakes}
                  renderItem={(item, idx) => (
                    <List.Item className={styles.foodItem} style={{ alignItems: 'flex-start' }}>
                      <Avatar size={18}
                        style={{ background: '#FFF7E6', color: '#FA8C16', fontSize: 11,
                                 flexShrink: 0, marginTop: 2 }}>
                        {idx + 1}
                      </Avatar>
                      <Text style={{ fontSize: 13, color: '#874D00', flex: 1 }}>{item}</Text>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Card>

          {/* 来源说明 */}
          <div style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {plan.rule_based
                ? '数据来源：移植阶段规则引擎'
                : `数据来源：AI Agent 生成 · ${plan.generated_by || ''}`}
            </Text>
          </div>

        </Space>
      </Spin>
    </Drawer>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

export default function NutritionPlan() {
  const [patients,    setPatients]    = useState([])
  const [selectedId,  setSelectedId]  = useState(null)
  const [plan,        setPlan]        = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [patListLoad, setPatListLoad] = useState(false)
  const [generating,  setGenerating]  = useState(false)
  const [error,       setError]       = useState(null)
  const [detailOpen,  setDetailOpen]  = useState(false)

  // ── 加载患者列表 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setPatListLoad(true)
    axios.get('/api/v1/patients', { params: { page_size: 100 } })
      .then(res => {
        const items = res.data.items || []
        setPatients(items)
        if (items.length) setSelectedId(items[0].id)
      })
      .finally(() => setPatListLoad(false))
  }, [])

  // ── 加载营养方案 ─────────────────────────────────────────────────────────────
  const fetchPlan = useCallback(() => {
    if (!selectedId) return
    setLoading(true)
    setError(null)
    setPlan(null)
    axios.get(`/api/v1/nutrition/plan/${selectedId}`)
      .then(res => setPlan(res.data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [selectedId])

  useEffect(() => { fetchPlan() }, [fetchPlan])

  // ── 生成新方案（Agent 占位）────────────────────────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true)
    await new Promise(r => setTimeout(r, 1500))
    setGenerating(false)
    fetchPlan()
  }

  const phaseInfo = plan ? PHASE_LABELS[plan.phase] || { label: plan.phase_label, color: 'default' } : null

  return (
    <div className={styles.root}>

      {/* ── 顶部操作栏 ─────────────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <HeartOutlined className={styles.pageIcon} />
          <div>
            <Title level={4} style={{ margin: 0 }}>营养方案</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>基于移植阶段的个性化营养目标</Text>
          </div>
        </div>

        <div className={styles.toolbarRight}>
          <Select
            loading={patListLoad}
            value={selectedId}
            onChange={setSelectedId}
            placeholder="选择患者"
            style={{ width: 160 }}
            suffixIcon={<UserOutlined />}
            showSearch
            optionFilterProp="label"
          >
            {patients.map(p => (
              <Option key={p.id} value={p.id} label={p.name}>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <Tag style={{ marginLeft: 6, fontSize: 11 }}
                  color={(PHASE_LABELS[p.current_phase] || {}).color || 'default'}>
                  {(PHASE_LABELS[p.current_phase] || {}).label || p.current_phase}
                </Tag>
              </Option>
            ))}
          </Select>

          <Tooltip title="刷新方案">
            <Button icon={<ReloadOutlined />} onClick={fetchPlan} loading={loading} size="small" />
          </Tooltip>

          {/* 查看详情按钮 */}
          {plan && (
            <Tooltip title="查看食材推荐、忌口列表及常见误区">
              <Button
                icon={<FileTextOutlined />}
                onClick={() => setDetailOpen(true)}
                style={{ borderColor: '#1677FF', color: '#1677FF' }}
              >
                查看详情
              </Button>
            </Tooltip>
          )}

          <Tooltip title="用 AI Agent 综合化验数据生成精细方案（即将上线）">
            <Button
              type="primary"
              icon={<RobotOutlined />}
              onClick={handleGenerate}
              loading={generating}
              className={styles.generateBtn}
            >
              生成新方案
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* ── 主内容区 ─────────────────────────────────────────────────────────────── */}
      <Spin spinning={loading} tip="加载营养方案…">
        {error ? (
          <div className={styles.errorBox}>
            <ExclamationCircleOutlined style={{ fontSize: 24, color: '#FF4D4F' }} />
            <Text type="danger">加载失败：{error}</Text>
            <Button size="small" onClick={fetchPlan}>重试</Button>
          </div>
        ) : !plan ? (
          <Empty description="请选择患者" style={{ padding: '80px 0' }} />
        ) : (
          <div className={styles.content}>

            {/* 阶段标题卡片 */}
            <div className={styles.phaseCard}
              style={{ borderLeftColor: plan.phase_color || '#1677FF' }}>
              <div className={styles.phaseLeft}>
                <Tag color={phaseInfo?.color || 'blue'}
                  style={{ fontSize: 13, padding: '3px 12px', borderRadius: 20, fontWeight: 600 }}>
                  {plan.phase_label}
                </Tag>
                {plan.patient_name && (
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    患者：<strong>{plan.patient_name}</strong>
                    {plan.weight_kg && `  · 体重 ${plan.weight_kg} kg`}
                  </Text>
                )}
              </div>
              <div className={styles.phaseRight}>
                {plan.rule_based ? (
                  <Badge status="default"
                    text={<Text style={{ fontSize: 12, color: '#8C8C8C' }}>规则引擎生成</Text>} />
                ) : (
                  <Badge status="processing"
                    text={<Text style={{ fontSize: 12, color: '#1677FF' }}>
                      AI 方案 · {plan.generated_by}
                    </Text>} />
                )}
                {plan.targets?.kcal_per_kg && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {plan.targets.kcal_per_kg} kcal/kg · {plan.targets.protein_per_kg} g/kg 蛋白
                  </Text>
                )}
              </div>
            </div>

            {/* 目标仪表盘 */}
            <div className={styles.gaugeSection}>
              <div className={styles.sectionTitle}>
                <ThunderboltOutlined style={{ color: '#FA8C16' }} />
                <span>每日营养目标</span>
              </div>
              <div className={styles.gaugeRow}>
                <TargetGauge title="目标热量"   value={plan.targets?.energy  || 0} unit="kcal" max={3000} color="#FA8C16" icon={<ThunderboltOutlined />} hint={`基于 ${plan.targets?.kcal_per_kg} kcal/kg 计算`} />
                <TargetGauge title="目标蛋白质" value={plan.targets?.protein || 0} unit="g"    max={150}  color="#1677FF" icon={<MedicineBoxOutlined />} hint={`基于 ${plan.targets?.protein_per_kg} g/kg 计算`} />
                <TargetGauge title="脂肪来源"   value={plan.targets?.fat_kcal  || 0} unit="kcal" max={1000} color="#722ED1" icon={<HeartOutlined />} hint="占总热量约 30%" />
                <TargetGauge title="碳水来源"   value={plan.targets?.carb_kcal || 0} unit="kcal" max={2000} color="#52C41A" icon={<BulbOutlined />}  hint="占总热量约 50%" />
              </div>
              <EnergyBar targets={plan.targets || {}} />
            </div>

            {/* 下部三列 */}
            <Row gutter={16} className={styles.bottomRow}>
              <Col xs={24} md={12} lg={12}>
                <div className={styles.listCard}>
                  <div className={styles.listCardTitle}>
                    <CheckCircleOutlined style={{ color: '#52C41A' }} />
                    <span>饮食建议</span>
                    <Tag color="green" style={{ marginLeft: 'auto', fontSize: 11 }}>
                      {plan.suggestions?.length || 0} 条
                    </Tag>
                  </div>
                  <Divider style={{ margin: '8px 0 12px' }} />
                  <List
                    dataSource={plan.suggestions || []}
                    renderItem={(item, idx) => (
                      <List.Item className={styles.adviceItem}>
                        <Avatar size={22}
                          style={{ background: '#E6F4FF', color: '#1677FF', fontSize: 11, flexShrink: 0 }}>
                          {idx + 1}
                        </Avatar>
                        <Text style={{ fontSize: 13, flex: 1 }}>{item}</Text>
                      </List.Item>
                    )}
                  />
                </div>
              </Col>
              <Col xs={24} md={12} lg={12}>
                <div className={styles.listCard} style={{ marginBottom: 16 }}>
                  <div className={styles.listCardTitle}>
                    <StopOutlined style={{ color: '#FF4D4F' }} />
                    <span>禁忌事项</span>
                  </div>
                  <Divider style={{ margin: '8px 0 12px' }} />
                  <List
                    dataSource={plan.restrictions || []}
                    renderItem={item => (
                      <List.Item className={styles.adviceItem}>
                        <WarningOutlined style={{ color: '#FF4D4F', flexShrink: 0 }} />
                        <Text style={{ fontSize: 13, color: '#CF1322', flex: 1 }}>{item}</Text>
                      </List.Item>
                    )}
                  />
                </div>
                <div className={styles.listCard}>
                  <div className={styles.listCardTitle}>
                    <MedicineBoxOutlined style={{ color: '#1677FF' }} />
                    <span>推荐补充剂</span>
                  </div>
                  <Divider style={{ margin: '8px 0 12px' }} />
                  <div className={styles.tagGroup}>
                    {(plan.supplements || []).map((s, i) => (
                      <Tag key={i} color="blue"
                        style={{ marginBottom: 8, borderRadius: 12, fontSize: 12 }}>
                        {s}
                      </Tag>
                    ))}
                  </div>
                </div>
              </Col>
            </Row>

            {plan.notes && (
              <div className={styles.notesCard}>
                <InfoCircleOutlined style={{ color: '#1677FF' }} />
                <Text style={{ fontSize: 13 }}>{plan.notes}</Text>
              </div>
            )}

          </div>
        )}
      </Spin>

      {/* ── 详情 Drawer ─────────────────────────────────────────────────────────── */}
      <PlanDetailDrawer
        open={detailOpen}
        plan={plan}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  )
}

