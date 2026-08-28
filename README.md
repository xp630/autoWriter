# autoWriter-desktop

> autoWriter 的桌面版 — Electron + React + TS
> 仿 autosocialX 布局，但走 autoWriter 业务线

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

## 项目结构

```
autoWriter-desktop/
├── electron/             # 主进程
│   ├── main.cjs          # Electron 入口 + BrowserWindow
│   └── preload.cjs       # 安全的 contextBridge 暴露
├── src/                  # React 前端
│   ├── App.tsx           # 路由 + 全局 layout
│   ├── index.css         # 设计 tokens + 组件 CSS
│   ├── components/       # 通用组件
│   │   ├── Sidebar.tsx
│   │   ├── PageHeader.tsx
│   │   ├── Stepper.tsx
│   │   ├── Card.tsx
│   │   └── Empty.tsx
│   └── pages/            # 页面
│       ├── WritePage.tsx       # 写文章主流程
│       ├── ArticlesPage.tsx    # 我的文章
│       ├── TopicsPage.tsx      # 选题中心
│       ├── SourcesPage.tsx     # 博主源
│       └── SettingsPage.tsx    # 设置
├── docs/                 # 文档
└── build/                # 图标 / 资源
```

## 当前状态（2026-08-26）

✅ 完成：
- Electron + React + TS + Vite 骨架
- 5 个示例页面（写文章 / 我的文章 / 选题中心 / 博主源 / 设置）
- 设计 tokens（清新薄荷绿 + 天蓝）
- 侧边栏 3 组分类

⏳ 待做：
- IPC 通信接 SQLite
- Skills/Persona 系统接入（从 ../autoWriter/src/skills/ 复制）
- playwright-mcp 集成（解决公众号抓取）
- 调度器 / RSS / Provider 配置

## 设计原则

1. **本地优先**：不依赖云端，所有数据 SQLite 存本地
2. **Skills 文件化**：复制 autoWriter 的 SKILL.md 系统
3. **Electron 内置 Chromium**：用 Electron 自带的 BrowserWindow 抓网页，比 Chrome 扩展更无感
4. **仿 autosocialX 布局**：3 组分类侧边栏 + 玻璃质感

## 与 autoWriter 云端版的关系

| 模块 | 云端版 | 桌面版 |
|------|--------|--------|
| Skills | ✅ SKILL.md | 复制粘贴 |
| Persona | ✅ SKILL.md | 复制粘贴 |
| RSS 同步 | ✅ 后端 + UI | 待做 |
| 调度器 | ✅ 60s 轮询 | 待做 |
| 抓公众号 | ⚠️ Chrome 扩展（手动）| ⏳ playwright（自动） |
| Provider | ✅ | 待做 |
| 主题切换 | ✅ light + dark | ⏳ 待做 |

云端版**不需要废弃**——用户可以选择：
- 云端：多人协作 / 跨设备
- 桌面：本地隐私 / 公众号抓取更可靠