# autoWriter-desktop

> autoWriter 的桌面版 — Electron + React + TS
> 仿 autosocialX 布局，但走 autoWriter 业务线

[![Electron](https://img.shields.io/badge/Electron-44-3B87C4?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5_strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-1C3D6E?style=flat-square)](LICENSE)

## 📚 文档导航

| 想了解… | 看这里 |
|---|---|
| 功能矩阵 / 路线图 / 架构 | [**FEATURES.md**](./docs/FEATURES.md) |
| 怎么用 / 常见问题 | [**USER_GUIDE.md**](./docs/USER_GUIDE.md) |
| 设计规范 / Token | [DESIGN.md](./DESIGN.md) · [DESIGN.tokens.json](./DESIGN.tokens.json) |
| 设计 review 报告 | [../autosocialX gap analysis 笔记] _(本仓库外)_ |

---

## 快速开始

```bash
cd autoWriter-desktop
npm install
npm run dev
```

首次启动会：
1. 启 Vite dev server (http://localhost:5173)
2. Electron 主进程加载 Vite URL
3. 自动打开 DevTools

**前置要求**：至少安装一个 Agent CLI（Claude Code / pi / opencode / Codex）。详见 [USER_GUIDE §1.2](./docs/USER_GUIDE.md#12-安装-agent-cli)。

---

## 项目结构

```
autoWriter-desktop/
├── electron/              # 主进程（Node.js）
│   ├── main.cjs           # 入口 + BrowserWindow + 测试钩子
│   ├── preload.cjs        # contextBridge 暴露
│   ├── ipc.cjs            # 全部 IPC handler
│   ├── agent.cjs          # Agent CLI 客户端（spawn + 流式）
│   ├── queue.cjs          # 任务队列（v0.1 新增）
│   ├── db.cjs             # better-sqlite3 单例
│   ├── schema.sql         # 表结构
│   ├── skills.cjs         # Skills 加载器
│   ├── prompts.cjs        # 模板管理
│   ├── fetcher.cjs        # URL 抓取
│   └── image-providers.cjs # 多 Provider 图片生成
├── src/                   # 渲染进程（React + TS）
│   ├── App.tsx            # 主入口 + 路由
│   ├── pages/             # 7 个页面
│   │   ├── DashboardPage.tsx     ⌘0
│   │   ├── WritePage.tsx         ⌘1
│   │   ├── ArticlesPage.tsx      ⌘2
│   │   ├── TopicsPage.tsx        ⌘3
│   │   ├── SourcesPage.tsx       ⌘4
│   │   ├── ImagesPage.tsx        ⌘5
│   │   └── SettingsPage.tsx      ⌘6
│   ├── components/        # 通用组件
│   │   ├── Sidebar.tsx
│   │   ├── Card.tsx       # 支持 icon + accent 变体
│   │   ├── PageHeader.tsx
│   │   ├── Stepper.tsx
│   │   ├── Empty.tsx
│   │   ├── RichEditor.tsx
│   │   ├── ImageLibraryGrid.tsx
│   │   └── QueueBadge.tsx # 顶栏队列徽章
│   ├── prompts/           # AI prompt 模板
│   ├── skills/            # Skills 文件（personas + channels）
│   ├── utils/             # 工具（导出、平台适配）
│   ├── types.ts           # 类型 + electronAPI 声明
│   └── index.css          # 设计系统 CSS
├── tests/
│   ├── unit/              # vitest（26 用例）
│   └── e2e/               # playwright + electron
├── docs/
│   ├── FEATURES.md        # 功能矩阵
│   └── USER_GUIDE.md      # 使用说明
├── DESIGN.md              # 设计规范
├── DESIGN.tokens.json     # 设计 token JSON
├── electron-builder.json
├── playwright.config.ts
├── vite.config.ts
├── vitest.config.ts
└── package.json
```

## 当前状态（v0.1.0 · 2026-08-28）

### ✅ 已完成

- **核心架构**：Electron 44 + React 18 + TS 5（strict）+ Vite 5
- **数据库**：SQLite（better-sqlite3），AES-256-GCM 加密 API Key
- **写作流程**：三步生成（主题→大纲→正文）+ 二次润色 + 5 种导出格式
- **多 Agent**：Claude Code / pi / opencode / Codex CLI 一键切换
- **任务队列** ⭐：并发控制 + 同类串行 + 实时取消 + 顶栏徽章
- **Skills**：5 人设 × 4 渠道 + 双层图像 prompt 扩写
- **图片生成**：3 Provider（Pollinations / Tensor.Art / Ideogram）+ 自动 fallback
- **图库**：独立存储 + 文章复用 + 标签检索
- **测试**：26 单元用例 + 3 E2E + 5 测试钩子
- **设计系统**：翡翠绿主色 + 6 Card accent 变体 + Lucide 图标
- **Dashboard**：KPI 卡 + 最近编辑 + 队列副本 + 首次启动引导

### ⏳ 路线图

详见 [FEATURES.md §10](./docs/FEATURES.md#10-待规划功能)。优先级：

- **P0**：调度器（自动扫描 scheduled_at）、RSS 抓取、PersonaHub
- **P1**：MCP 客户端、Publisher（公众号 playwright）、Dashboard 图表
- **P2**：ReAct Engine（替换 subprocess shim）、暗色模式、文章系列

## 设计原则

1. **本地优先**：不依赖云端，所有数据 SQLite 存本地，隐私可控
2. **Skills 文件化**：markdown 文件管理 prompt，Git 友好
3. **Electron 内置 Chromium**：用 BrowserWindow 抓网页，比 Chrome 扩展更无感
4. **仿 autosocialX 布局**：3 组分类侧边栏 + 玻璃质感
5. **设计系统先于组件**：DESIGN.md + tokens.json 是单一真实来源

## 与 autoWriter 云端版的关系

| 模块 | 云端版 | 桌面版 |
|------|--------|--------|
| Skills | ✅ SKILL.md | ✅ SKILL.md |
| Persona | ✅ SKILL.md | ✅ SKILL.md |
| RSS 同步 | ✅ 后端 + UI | 🚧 schema + UI（抓取待做） |
| 调度器 | ✅ 60s 轮询 | 🚧 schema 就位 / 调度器待做 |
| 抓公众号 | ⚠️ Chrome 扩展（手动） | ✅ BrowserWindow 内置抓取 |
| Provider | ✅ | ✅ 多 Provider |
| 主题切换 | ✅ light + dark | ✅ light（dark 待做） |
| 任务队列 | ✅ | ✅ v0.1 新增 |

云端版**不需要废弃**——用户可以选择：
- **云端**：多人协作 / 跨设备 / 不需要本地安装
- **桌面**：本地隐私 / 公众号抓取更可靠 / 完全离线浏览

## 开发命令

```bash
npm install              # 安装依赖
npm run dev              # 开发模式（Vite + Electron）
npm run build            # 生产构建 renderer
npm run build:mac        # macOS DMG
npm run build:win        # Windows 安装包
npm run build:linux      # Linux AppImage
npm run test             # 单元 + E2E
npm run test:unit        # vitest only
npm run test:e2e         # playwright + electron
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
```

## 贡献

1. Fork → 创建 feature branch (`git checkout -b feature/amazing`)
2. 修改 → commit (`git commit -m 'feat: add amazing feature'`)
3. 推送 → 提 PR
4. 等待 CODEOWNERS（@xp630）review

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)（待创建）。

## 许可证

MIT © 2026 xp630
