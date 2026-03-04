import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import AICopilot from '@/components/AICopilot/index'
import { Layout, Menu, Avatar, Badge, Typography, Tooltip, Divider } from 'antd'
import {
  TeamOutlined, ExperimentOutlined, HeartOutlined,
  FileProtectOutlined, RobotOutlined, DashboardOutlined,
  BellOutlined, BellFilled, SettingOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  LineChartOutlined, AlertOutlined, DatabaseOutlined, BarChartOutlined,
} from '@ant-design/icons'
import PatientOverview from '@/pages/PatientOverview/index'
import Dashboard from '@/pages/Dashboard/index'
import LabManagement from '@/pages/LabManagement/index'
import AiLog from '@/pages/AiLog/index'
import NutritionPlan from '@/pages/NutritionPlan/index'
import InformedConsent from '@/pages/InformedConsent/index'
import NutritionAssessment from '@/pages/NutritionAssessment/index'
import AlertCenter from '@/pages/AlertCenter/index'
import KnowledgeBase from '@/pages/KnowledgeBase/index'
import Statistics from '@/pages/Statistics/index'
import SystemSettings from '@/pages/SystemSettings/index'


const { Sider, Header, Content } = Layout
const { Text } = Typography

// ── 导航菜单配置 ────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { key: '/',            icon: <DashboardOutlined />,  label: '控制台' },
  { key: '/patients',   icon: <TeamOutlined />,         label: '患者档案' },
  { key: '/assessment', icon: <LineChartOutlined />,    label: '营养评估' },
  { key: '/lab',        icon: <ExperimentOutlined />,   label: '检验单管理' },
  { key: '/nutrition',  icon: <HeartOutlined />,        label: '营养方案' },
  { key: '/alerts',     icon: <AlertOutlined style={{ color: '#FF4D4F' }} />, label: '预警中心' },
  { key: '/knowledge',  icon: <DatabaseOutlined style={{ color: '#722ED1' }} />, label: '知识库管理' },
  { key: '/statistics', icon: <BarChartOutlined style={{ color: '#13C2C2' }} />, label: '统计报表' },
  { key: '/consent',    icon: <FileProtectOutlined />,  label: '知情同意' },
  { key: '/agent',      icon: <RobotOutlined />,        label: 'AI 助手日志' },
  { key: '/settings',   icon: <SettingOutlined style={{ color: '#8C8C8C' }} />, label: '系统设置' },
]

function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ── 左侧导航 ──────────────────────────────────────────────── */}
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={220}
        style={{
          background: '#fff',
          borderRight: '1px solid #E8E8E8',
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0, top: 0, bottom: 0,
          zIndex: 100,
        }}
      >
        {/* Logo 区 */}
        <div style={{
          height: 56,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 16px',
          borderBottom: '1px solid #F0F0F0',
          gap: 10,
          overflow: 'hidden',
        }}>
          <span style={{ fontSize: 22 }}>🏥</span>
          {!collapsed && (
            <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap', color: '#1677FF' }}>
              肝移植营养系统
            </Text>
          )}
        </div>

        {/* 菜单 */}
        <BrowserRouter>
          <SideNav collapsed={collapsed} />
        </BrowserRouter>
      </Sider>
    </Layout>
  )
}

// 把路由相关逻辑单独提取，保证 NavLink 在 BrowserRouter 内部
function SideNav({ collapsed }) {
  return (
    <>
      <Menu
        mode="inline"
        style={{ border: 'none', marginTop: 8 }}
        items={NAV_ITEMS.map(item => ({
          key:   item.key,
          icon:  item.icon,
          label: (
            <NavLink
              to={item.key}
              style={({ isActive }) => ({
                color: isActive ? '#1677FF' : 'inherit',
                fontWeight: isActive ? 600 : 400,
              })}
            >
              {item.label}
            </NavLink>
          ),
        }))}
      />
    </>
  )
}

// ── 主应用（含路由） ─────────────────────────────────────────────────────────
export default function App() {
  const [collapsed, setCollapsed] = useState(false)
  const siderWidth = collapsed ? 80 : 220

  return (
    <BrowserRouter>
      <Layout style={{ minHeight: '100vh' }}>
        {/* 左侧边栏 */}
        <Sider
          collapsible
          collapsed={collapsed}
          trigger={null}
          width={220}
          collapsedWidth={80}
          style={{
            background: '#fff',
            borderRight: '1px solid #E8E8E8',
            overflow: 'auto',
            height: '100vh',
            position: 'fixed',
            left: 0, top: 0, bottom: 0,
            zIndex: 100,
          }}
        >
          {/* Logo */}
          <div style={{
            height: 56, display: 'flex', alignItems: 'center',
            padding: '0 20px', borderBottom: '1px solid #F0F0F0', gap: 10, overflow: 'hidden',
          }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>🏥</span>
            {!collapsed && (
              <Text strong style={{ fontSize: 13, whiteSpace: 'nowrap', color: '#1677FF' }}>
                肝移植营养系统
              </Text>
            )}
          </div>

          {/* 导航菜单 */}
          <Menu
            mode="inline"
            defaultSelectedKeys={['/']}
            style={{ border: 'none', marginTop: 8 }}
            items={NAV_ITEMS.map(item => ({
              key:  item.key,
              icon: item.icon,
              label:(
                <NavLink to={item.key} style={{ textDecoration: 'none' }}>
                  {item.label}
                </NavLink>
              ),
            }))}
          />

          {/* 底部折叠按钮 */}
          <div
            onClick={() => setCollapsed(!collapsed)}
            style={{
              position: 'absolute', bottom: 16, left: 0, right: 0,
              display: 'flex', justifyContent: 'center', cursor: 'pointer',
              color: '#8C8C8C', fontSize: 18,
            }}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
        </Sider>

        {/* 右侧主区域 */}
        <Layout style={{ marginLeft: siderWidth, transition: 'margin-left 0.2s' }}>

          {/* 顶部 Header */}
          <Header style={{
            background: '#fff',
            borderBottom: '1px solid #E8E8E8',
            padding: '0 24px',
            height: 56,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 99,
          }}>
            <Text style={{ fontSize: 15, fontWeight: 600, color: '#1A1A1A' }}>
              协和医院 · 肝移植中心
            </Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Tooltip title="通知">
                <Badge count={3} size="small">
                  <BellOutlined style={{ fontSize: 18, color: '#595959', cursor: 'pointer' }} />
                </Badge>
              </Tooltip>
              <Tooltip title="设置">
                <SettingOutlined style={{ fontSize: 18, color: '#595959', cursor: 'pointer' }} />
              </Tooltip>
              <Divider type="vertical" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <Avatar size={32} style={{ background: '#1677FF' }}>医</Avatar>
                <Text style={{ fontSize: 13 }}>李主任</Text>
              </div>
            </div>
          </Header>

          {/* 页面内容 */}
          <Content style={{ overflow: 'auto' }}>
            <Routes>
              <Route path="/"            element={<Dashboard />} />
              <Route path="/patients"    element={<PatientOverview />} />
              <Route path="/assessment"  element={<NutritionAssessment />} />
              <Route path="/lab"         element={<LabManagement />} />
              <Route path="/nutrition"   element={<NutritionPlan />} />
              <Route path="/alerts"      element={<AlertCenter />} />
              <Route path="/knowledge"   element={<KnowledgeBase />} />
              <Route path="/statistics"  element={<Statistics />} />
              <Route path="/consent"     element={<InformedConsent />} />
              <Route path="/agent"       element={<AiLog />} />
              <Route path="/settings"   element={<SystemSettings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
      {/* ── 全局 AI Copilot 悬浮入口（挂载在路由外层，全页面可见） ── */}
      <AICopilot />
    </BrowserRouter>
  )
}

// 未完成页面的占位符组件
function PlaceholderPage({ title, icon, desc }) {
  return (
    <div style={{
      height: '100%', minHeight: 'calc(100vh - 56px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12,
      color: '#8C8C8C',
    }}>
      <div style={{ fontSize: 64 }}>{icon}</div>
      <Text style={{ fontSize: 22, fontWeight: 600, color: '#1A1A1A' }}>{title}</Text>
      <Text type="secondary">{desc}（开发中）</Text>
    </div>
  )
}
