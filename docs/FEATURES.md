# autoWriter-desktop · 功能清单

> 当前版本：**v0.1.0** · 最后更新：2026-08-28

本文档汇总 autoWriter-desktop 已实现的所有功能，作为开发追踪和用户了解产品能力的单一真实来源。

---

## 目录

- [1. 核心能力一览](#1-核心能力一览)
- [2. 创作流程](#2-创作流程)
- [3. Agent 与模型](#3-agent-与模型)
- [4. Skills 系统](#4-skills-系统)
- [5. 图片生成](#5-图片生成)
- [6. 文章管理](#6-文章管理)
- [7. 系统与基础设施](#7-系统与基础设施)
- [8. 设计系统](#8-设计系统)
- [9. 开发与测试](#9-开发与测试)
- [10. 待规划功能](#10-待规划功能)

---

## 1. 核心能力一览

| 模块 | 能力 | 状态 |
|---|---|---|
| 仪表盘 | KPI 卡片 + 最近编辑 + 快速开始 + 首次引导 | ✅ |
| 写文章 | 三步流程（主题→大纲→正文）+ 实时流式日志 | ✅ |
| 多 Agent | pi / Claude Code / opencode / Codex CLI 切换 | ✅ |
| 任务队列 | 并发上限 + 串行同类 + 实时取消 + 队列徽章 | ✅ |
| Skills | 5 人设 × 4 渠道 × 3 图像模板 | ✅ |
| 图片生成 | 多 Provider + 自动 fallback + 双层 prompt 扩写 | ✅ |
| 图库 | 元数据管理 + 文章关联 + 标签检索 | ✅ |
| 文章管理 | 排程发布 + 状态跟踪 + Markdown 编辑 | ✅ |
| 选题中心 | 热点 / RSS / 我的选题库 | ✅ |
| 博主源 | 订阅 + RSS 抓取 | 🚧 部分（schema + UI） |
| 提示词模板 | 实时编辑保存 | ✅ |
| 数据加密 | API Key AES-256-GCM | ✅ |
| 离线优先 | 本地 SQLite，无云同步 | ✅ |
| 自定义协议 | `aw-img://` 安全渲染本地图片 | ✅ |

---

## 2. 创作流程

### 2.1 三步生成

```
Step 1: 主题 / 参考        Step 2: 大纲（可编辑）      Step 3: 正文 + 配图
┌─────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ 输入关键词       │      │ AI 生成大纲       │      │ 基于大纲生成正文   │
│ 可选粘贴参考文   │ ───► │ 显示可编辑 textarea │ ───► │ Markdown 渲染     │
│ 可选 URL 抓取   │      │ [已修订] 检测       │      │ 支持 [[配图]] 占位 │
└─────────────────┘      └──────────────────┘      └──────────────────┘
```

### 2.2 关键特性

- **流式输出**：Agent CLI 的 stdout / stderr 实时推送，渲染到日志面板
- **可取消**：点击「取消」按钮发送 SIGTERM，2 秒未退自动 SIGKILL
- **任务队列**：多次点击自动排队（同类串行，不同类可并行）
- **草稿保存**：localStorage 自动保存当前 query/outline 设置，刷新不丢
- **二次润色**：正文生成后可发起指令式润色（让语言更犀利 / 压缩到 1500 字 等）
- **导出**：Markdown / DOCX / PDF / HTML / PNG 五种格式

### 2.3 URL 抓取

支持微信公众号 / 知乎专栏 / 一般新闻站。Electron 内置 Chromium 渲染，绕开反爬限制。

- 单击「抓取」按钮 → 自动检测正文（Readability 算法）
- 抓取后自动提炼写作框架（Step 1 → Step 2 直接跳转）

---

## 3. Agent 与模型

### 3.1 支持的 CLI

| CLI | 安装 | 速度 | 中文支持 | 适用场景 |
|---|---|---|---|---|
| **Claude Code** (`claude`) | `npm i -g @anthropic-ai/claude-code` | ⭐⭐⭐⭐ | 优秀 | 默认推荐 |
| **pi** (`pi`) | npm 全局安装 | ⭐⭐⭐⭐⭐ | 优秀 | 速度快 |
| **opencode** (`opencode`) | [opencode.ai](https://opencode.ai) | ⭐⭐⭐ | 良好 | 开源 |
| **Codex CLI** (`codex`) | `npm i -g @openai/codex` | ⭐⭐⭐⭐ | 一般 | 英文为主 |

> ⚠️ CLI 需在系统 PATH 中能被 `child_process.spawn` 调用。设置页可一键检测。

### 3.2 模型配置

- 每个 CLI 可指定具体模型（Claude: `claude-sonnet-4-5` / `claude-opus-4-1`；opencode: 调用 `opencode models` 列出可用）
- 全局设置存 localStorage，跨会话保留
- 切换 CLI 后模型字段独立保留

---

## 4. Skills 系统

Skills 是 markdown 文件，运行时被注入到 Agent 的 system prompt 中。

### 4.1 文件位置

```
src/skills/
├── personas/          # 人设（写作风格）
│   ├── authentic_seeder/    SKILL.md
│   ├── cold_analyst/        SKILL.md
│   ├── knowledge_mentor/    SKILL.md
│   ├── viral_copywriter/    SKILL.md
│   └── warm_storyteller/    SKILL.md
├── channels/          # 渠道（平台格式约束）
│   ├── toutiao/
│   ├── wechat/        # 公众号
│   ├── xiaohongshu/   # 小红书
│   └── zhihu/
└── image/             # 图像 prompt 扩写模板（craft 系列）
    ├── craft-standard.md
    ├── craft-flux.md
    └── config.js
```

### 4.2 Frontmatter 格式

```markdown
---
name: warm_storyteller
displayName: 温暖叙事者
description: 适合生活故事、情感共鸣类内容
tags: [story, life, emotional]
---

正文 markdown...
```

### 4.3 内置人设

| 名称 | 风格 | 适用 |
|---|---|---|
| authentic_seeder | 真实种草 | 测评、好物 |
| cold_analyst | 冷静分析 | 数据、行业 |
| knowledge_mentor | 知识导师 | 教程、科普 |
| viral_copywriter | 爆款写手 | 流量、标题党 |
| warm_storyteller | 温暖叙事 | 情感、故事 |

### 4.4 内置渠道

| 渠道 | 字数 | 风格 |
|---|---|---|
| 公众号 (wechat) | 1500-3000 | 长图文 |
| 小红书 (xiaohongshu) | 300-800 | emoji 多 / 短段落 |
| 头条 (toutiao) | 1000-2000 | 标题党 / 吸睛 |
| 知乎 (zhihu) | 2000+ | 长文 / 论据扎实 |

---

## 5. 图片生成

### 5.1 支持的 Provider

| Provider | 是否需要 Key | 模型 | 价格 |
|---|---|---|---|
| Pollinations | ❌ 免费 | flux / turbo / kontext | $0 |
| Tensor.Art | ✅ | 多种 | 按 token |
| Ideogram | ✅ | ideogram-v2 | 按张 |

> 设置页可启用 / 禁用 / 调整优先级（数字越小越优先）。

### 5.2 双层 prompt 扩写

```
用户输入（口语化）
   ↓
craft-standard.md     ← 第一层：通用扩写（场景/光线/构图）
   ↓
craft-{model}.md      ← 第二层：模型专属优化（Flux 关键词 / SDXL 权重）
   ↓
最终 prompt → Provider API
```

### 5.3 自动 Fallback

如果首选 Provider 失败，自动尝试下一个启用的 Provider，保证成功率。

### 5.4 占位符机制

正文中的 `[[配图:具体场景描述@pic1]]` 占位符：
- 渲染时显示为虚线框 + 「点击生成配图」
- 点击触发 AI 生成 + 自动存图 + 替换占位
- 关联存到 `article_images` 表，可二次替换

---

## 6. 文章管理

### 6.1 文章状态机

```
draft ──► outline ──► generating ──► done ──► scheduled ──► published
   │                    │                                  │
   └──── deleted ───────┴──────────── failed ←──────────────┘
```

### 6.2 排程发布（schema 已就位，调度器待实现）

- 字段：`scheduled_at`（毫秒时间戳）
- IPC：`article:schedule` / `article:unschedule`
- 当前手动触发；自动调度器在 P0 路线图（见 §10）

### 6.3 编辑器

基于 Tiptap 3：
- Markdown 渲染（`react-markdown` + `remark-gfm`）
- 支持：标题 / 列表 / 引用 / 代码块 / 表格 / 链接 / 图片
- 图片懒加载（IPC 读 dataURL，绕开 CSP）

### 6.4 导出格式

| 格式 | 引擎 | 用途 |
|---|---|---|
| Markdown | 原样 | 公众号复制粘贴 |
| DOCX | docx.js | 投递编辑 |
| PDF | jsPDF + html2canvas | 存档 |
| HTML | 原样 | 网页发布 |
| PNG | html2canvas | 预览分享 |

---

## 7. 系统与基础设施

### 7.1 数据存储

- **数据库**：SQLite（better-sqlite3）→ `userData/autoWriter.db`
- **图片**：`userData/uploads/`
- **配置**：`localStorage.aw_settings`

### 7.2 Schema（v1）

```
article_drafts         文章主表
  ├─ title, outline, content
  ├─ status, style, length
  ├─ keywords, reference_source
  ├─ word_count, generation_time
  ├─ model, provider, platform
  ├─ parent_id（系列文章支持）
  └─ scheduled_at, published_at, publish_error

images                 图库主表（独立存储，多文章可复用）
article_images         文章-图片关联（placeholder → image）

image_providers        图片生成 Provider 配置
image_models           Provider 下的模型列表

provider_settings      文本生成 Provider 配置（兼容旧版）

rss_sources            RSS 订阅
rss_items              RSS 抓取条目
```

### 7.3 安全

- API Key 使用 **AES-256-GCM** 加密存储
- 自定义协议 `aw-img://` 限制只能访问 `userData/uploads/` 目录，防路径穿越
- contextBridge 严格暴露 API，无 `nodeIntegration`
- IPC handler 白名单（生产模式隐藏 `test:*` hooks）

### 7.4 任务队列（v0.1.0 新增）

```
electron/queue.cjs
  TaskQueue
    - maxConcurrent: 2    全局并发上限
    - perTypeConcurrent: 1 同类串行
    - historyLimit: 50    历史保留
    - abort signal: AbortController
    - event emitter: state / cancel
```

特性：
- pending 任务立即取消（不出队）
- running 任务触发 AbortSignal → SIGTERM → 2s 后 SIGKILL
- 实时 UI 徽章（顶栏）+ 详细面板（点击展开）

---

## 8. 设计系统

详见 [DESIGN.md](../DESIGN.md) 与 [DESIGN.tokens.json](../DESIGN.tokens.json)。

### 8.1 颜色

- **主色**：翡翠绿 `#10b981`（行动 / 创作）
- **辅色**：琥珀橙 `#f59e0b`（配置 / 调整）
- **系统**：蓝 `#5e8bff`（数据 / 系统）
- **洞察**：紫 `#8b5cf6`（提示词 / 知识）
- **危险**：红 `#ef4444`

### 8.2 字体

| 用途 | 字体 |
|---|---|
| 界面 | Inter + 系统中文回退 |
| 正文 / Markdown | Noto Serif SC |
| 代码 / 数字 | JetBrains Mono |

### 8.3 间距

基础单位 **4px**，token 体系：`--space-1` (4px) 到 `--space-12` (48px)。

### 8.4 组件

| 组件 | 用途 |
|---|---|
| `<Card>` | 内容容器，支持 `icon` + `accent` 变体 |
| `<Empty>` | 空状态，支持 Lucide 图标 |
| `<PageHeader>` | 页面标题，支持 `actions` |
| `<Sidebar>` | 3 组导航 + 底部统计卡 |
| `<Stepper>` | 多步骤流程 |
| `<QueueBadge>` | 队列实时徽章（顶栏浮动） |

---

## 9. 开发与测试

### 9.1 命令

```bash
npm install              # 安装
npm run dev              # 开发（Vite + Electron 热重载）
npm run build            # 生产构建（Renderer）
npm run build:mac        # macOS DMG
npm run build:win        # Windows 安装包
npm run build:linux      # Linux AppImage
npm run test             # 单元 + E2E
npm run test:unit        # vitest
npm run test:e2e         # playwright + electron
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
```

### 9.2 测试覆盖

| 套件 | 数量 | 覆盖 |
|---|---|---|
| 单元（vitest） | 26 | skills / prompts / queue |
| E2E（playwright） | 3 | IPC 注册表 / IPC handler / UI smoke |
| 测试钩子 | 5 channels | `test:list-channels` / `test:invoke` / `test:reset-db` / `test:userdata` / `test:exec-sql` |

### 9.3 项目结构

```
autoWriter-desktop/
├── electron/              # 主进程
│   ├── main.cjs           # 入口 + BrowserWindow
│   ├── preload.cjs        # contextBridge 暴露
│   ├── ipc.cjs            # IPC handlers
│   ├── agent.cjs          # Agent CLI 客户端
│   ├── queue.cjs          # 任务队列（v0.1 新增）
│   ├── db.cjs             # better-sqlite3 单例
│   ├── schema.sql         # 表结构
│   ├── skills.cjs         # Skills 加载
│   ├── prompts.cjs        # 模板管理
│   ├── fetcher.cjs        # URL 抓取
│   └── image-providers.cjs # Provider 实现
├── src/                   # 渲染进程
│   ├── App.tsx            # 主入口 + 路由
│   ├── components/        # 通用组件
│   ├── pages/             # 页面（7 个）
│   ├── prompts/           # prompt 模板
│   ├── skills/            # Skills 文件
│   ├── utils/             # 工具
│   ├── types.ts           # 类型 + electronAPI
│   ├── index.css          # 设计系统 CSS
│   └── toast.ts           # 全局 toast
├── tests/
│   ├── unit/              # vitest
│   └── e2e/               # playwright
├── docs/
│   └── FEATURES.md        # 本文件
├── DESIGN.md              # 设计规范
├── DESIGN.tokens.json     # 设计 token
└── package.json
```

---

## 10. 待规划功能

> 来自与 `autosocialX` 的 gap 分析。优先级基于「日常使用频次 × 实现成本」。

| P | 功能 | 说明 | 估时 |
|---|---|---|---|
| **P0** | 调度器 | 定时扫描 `scheduled_at`，到点自动调用 publisher | S |
| **P0** | RSS 抓取 | 用 `rss-parser` 填充 `rss_items` 表 | S |
| **P0** | PersonaHub | 在 WritePage 内置人设管理 UI | S |
| **P1** | MCP 客户端 | 集成 `@modelcontextprotocol/sdk`，让 Agent 调用外部工具 | M |
| **P1** | Dashboard 完善 | 文章趋势图 + 队列图 + Token 消耗统计 | M |
| **P1** | Publisher | 公众号 playwright 发布；其他平台 stub | L |
| **P2** | ReAct Engine | 把 subprocess shim 替换为真正的 Reason→Act→Observe 循环 | XL |
| **P2** | 暗色模式 | `[data-theme="dark"]` 全套覆盖 | M |
| **P2** | 文章系列 | 共享背景研究 + 角色表的系列写作 | L |
| **P3** | 多端同步 | 可选加密云同步（端到端） | XL |
| **P3** | i18n locale | 英文 UI | S |

---

**文档维护**：每次新增/修改功能请同步更新本文件对应章节。
