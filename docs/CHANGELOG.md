# autoWriter-desktop · Changelog & Roadmap

> 单一文档追踪：**已完成方案** + **关键设计决策** + **后续计划（带勾选框）**
> 代码基线：`develop` 分支 · 51 单元测试 / 3 E2E 全过

---

## 📋 待办清单（勾选式）

### P0 · 立即做（影响用户感知）

- [ ] **本地更新 / 死代码修复** — `saveDraft` / `loadDraft` 定义了但 0 调用点，「刷新不丢」功能没生效；启用 + debounce 1.5s
- [ ] **localStorage 统一封装** — 抽 `src/utils/storage.ts`，5 文件 11 处直接 `JSON.parse` 收敛到 `getAgentSettings()` / `getImageSettings()` 等具名 API
- [ ] **`aw_open_article` 去 localStorage 化** — CustomEvent 已经够用，删 localStorage 中转步骤
- [ ] **V2 内容发现 / SourcesPage 真实化** — 当前 22 行空壳，扩成博主 CRUD + 内容列表 + 热度筛选
- [ ] **V2 内容发现 / 爆款分析页** — 内容详情 + AI 拆解 + 6 卡片（与现有 AnalysisPanel 复用）

### P1 · 本周做（产品能力补齐）

- [ ] **V2 内容发现 / 选题中心** — 真实选题列表 + 详情 + 6 视角扩写
- [ ] **V2 内容发现 / 仪表盘 5 模块** — 今日热点 / 今日新增选题 / 待创作 / 最近文章 / Agent 状态
- [ ] **调度器扩展 / 真实抓取** — `sync-bloggers` 目前只更新 `last_synced_at`，接入 RSSHub / playwright 抓取
- [ ] **Publisher · 公众号** — playwright + 草稿模式自动发布
- [ ] **自动保存 debounce** — 防止每次 onChange 写一次卡顿（依赖 saveDraft 启用）

### P2 · 下个 sprint（基础设施 + UX）

- [ ] **暗色模式** — `[data-theme="dark"]` 块；DESIGN.md 提及未实现
- [ ] **ReAct Engine** — 替换 spawn shim，Reason→Act→Observe 多步
- [ ] **MCP 客户端** — `@modelcontextprotocol/sdk` 集成
- [ ] **React ErrorBoundary** — 组件 throw 时避免整页空白
- [ ] **RSS 抓取** — `rss-parser` + scheduler
- [ ] **Schema 版本字段** — localStorage 加 `v` 字段 + migration
- [ ] **类型守卫 + 错误日志** — localStorage parse 失败时 console.warn
- [ ] **inline-style 大清理** — ArticlesPage 93 处、ImagesPage 96 处（task 长期）

### P3 · 长期（不紧急）

- [ ] **内容知识库** — RAG / 全文检索
- [ ] **AI 分身** — 用户风格学习
- [ ] **多端加密同步** — 端到端云同步
- [ ] **i18n locale** — 英文 UI
- [ ] **发布 workflow** — `.github/workflows/release.yml` 自动构建安装包
- [ ] **CHANGELOG 自动生成** — conventional commits + release-it

### 已完成 ✓

- [x] **后台调度器** — Scheduler 类 + 3 内置任务 + 14 测试 · commit `d24b169`
- [x] **内容分析中心 (P0)** — AnalysisPanel 7 卡片 + JSON 容错 + 11 测试 · commit `42c97a5`
- [x] **Revert V2 Phase 1 残留** — 清理 scheduler commit 里多带的 schema/skill · commit `43a5ba9`
- [x] **Queue + 取消** — TaskQueue 真实 SIGTERM 子进程 · commit `3e2e2b3` (pre-v0.2)
- [x] **Lucide 图标 + Card accent 变体** — 替换 emoji-as-icon · commit `664d1e4`
- [x] **Dashboard 落地页** — KPI + 当前 Agent + 最近编辑 + 首次启动引导 · commit `6192a0d`

---

## 📦 v0.2.0 · 2026-08-28（已交付）

### 🆕 后台调度器（Scheduler）

**Commit**: `d24b169`

**是什么**：在 Electron 主进程常驻一个 `setInterval` 循环，每 60s 扫描一次注册的 handler，自动执行周期任务。

**架构**：

```
┌─────────────────────────────────────────┐
│ Electron 主进程 (app.whenReady)             │
│                                          │
│  new Scheduler({ interval: 60_000 })      │
│    ├─ register('process-scheduled-articles', handler)
│    ├─ register('sync-bloggers',             handler)
│    └─ register('cleanup-stale-topics',      handler)
│                                          │
│  start()  →  setInterval(tick, 60s)        │
│             ↓                            │
│  tick()    →  串行执行所有 handler          │
│             ├─ 抛错被捕获为 ok:false       │
│             ├─ 重入保护（同任务未结束则跳过）│
│             └─ 历史保留 100 条            │
└─────────────────────────────────────────┘
```

**3 个内置任务**：

| 任务 | 做什么 | 触发条件 |
|---|---|---|
| `process-scheduled-articles` | 扫 `scheduled_at <= now` 的文章 → 自动标 published | 每 60s |
| `sync-bloggers` | 扫 `enabled=1` 且到期的博主 → 更新 `last_synced_at` | 每 60s（按 `sync_interval_hours`） |
| `cleanup-stale-topics` | 30 天未动作的 `to_write` 选题 → 改 `pending` | 每 60s |

**关键设计决策**：

1. **不用 `node-cron` 等三方库** — `setInterval` 足够，可控可测
2. **handler 抛错不阻断其他** — 一个任务挂了不影响其他任务
3. **单任务重入保护** — 上一次未结束就跳过，防止 60s 间隔 + 慢任务导致并发
4. **历史只内存保留** — 不入 DB，简单；进程重启清空
5. **handler 函数签名 `(db) => result`** — 纯函数，注入 db 便于测试

**UI**（Settings 页新增「后台调度器」卡片）：
- 状态 / 间隔 / 上次 tick 三宫格
- 每个已注册任务独立「立即跑」按钮
- 折叠式历史（最近 10 条）
- 整体启停切换

**测试**：`tests/unit/scheduler.test.ts` 14 个用例 — 生命周期、tick 串行、异常隔离、runNow、重入保护、disabled no-op、history 上限。

**文件清单**：
- `electron/scheduler.cjs` (new, 200 行)
- `electron/main.cjs`（app.whenReady 后启动）
- `electron/ipc.cjs`（5 个新 handler）
- `electron/preload.cjs`（5 个新 API）
- `src/types.ts`（SchedulerSnapshot / SchedulerHistoryEntry）
- `src/pages/SettingsPage.tsx`（SchedulerCard 组件）
- `src/index.css`（scheduler-*.css）
- `tests/unit/scheduler.test.ts`（new）

---

### 🆕 内容分析中心（P0）

**Commit**: `42c97a5`

**是什么**：用户在写文章页粘贴参考内容后，点「分析内容」按钮，AI 把参考文拆解为 7 个维度的结构化 JSON，渲染成卡片。

**完整使用流程**：

```
1. 写文章页 Step 1
   ↓
2. 粘贴 URL → 点「抓取」→ 正文填到参考文本框
   ↓ (或直接粘贴文本)
3. 点「分析内容」→ Loading → 7 卡片展示
   ↓
4. 看 主题 / 观点 / 爆点 / 结构 / 用户画像 / 可借鉴
   ↓
5. 点「生成大纲」→ 进入 Step 2（带分析上下文）
```

**7 个分析维度**（AnalysisPanel）：

| 卡片 | 内容 | 价值 |
|---|---|---|
| **基本信息** | 标题 / 平台 / 作者 / 来源 / 关键词 chips | 快速认出这是哪篇 |
| **主题** | 一级主题 + 分类 + 50字总结 | 一眼看穿文章核心 |
| **核心观点** | 3 条锐度观点（不是废话） | 拿来参考或挑战 |
| **爆点** | 主导情绪 + 核心冲突（X vs Y 格式）+ 传播原因 | 解释「为什么火」 |
| **结构** | 3-5 步文章骨架 | 复用框架 |
| **用户画像** | 目标用户 + 3 个关注点 | 决定要不要写给这群人 |
| **可借鉴** | 可借（√） / 不要复制（✗） | 防止抄袭、鼓励二次创作 |

**JSON 容错策略**（核心难点）：

Agent 输出 99% 是 markdown 代码块包裹的 JSON，偶尔是裸 JSON 或带废话。三层降级：

```ts
function parseAnalysisJson(text) {
  // 1) 直接 JSON.parse(trimmed)
  // 2) 提取 ```json ... ``` 代码块
  // 3) 截取第一个 { 到最后一个 } 区间
  // 都失败 → 保存 raw 到 error 字段供调试
}
```

11 个单元测试覆盖每条路径。

**关键设计决策**：

1. **走现有 agentQueue** — 不开新流水线，复用并发控制 + 取消支持 + 流式输出
2. **失败不丢数据** — 先 INSERT pending 记录，run 期间 `status='running'`，失败时 `status='failed' + error`
3. **Skill 隔离** — 新建 `src/skills/analysis/` 子目录，skills.cjs 扩展支持 `analysis` kind
4. **PRD §13 严格遵守** — 不修改写作流程 / Agent 队列 / 图片系统 / 导出系统；只新增能力
5. **「生成创作方向」按钮留位** — P1 阶段启用（基于分析的 6 视角扩写）

**Skill prompt 要求**（PRD §12）：
- 只理解不创作（不输出可发表的段落）
- 输出严格合法 JSON（无 markdown 围栏）
- 每个字段都要有具体内容（不写「未知」）
- 关键词 3-5 个、reasons 从固定清单选、adaptation 给具体建议

**文件清单**：
- `electron/analysis.cjs` (new, 90 行) — JSON 解析 / Skill 读取 / prompt 构造 / 入库
- `src/skills/analysis/content-analysis.md` (new, 70 行) — Skill prompt
- `src/components/AnalysisPanel.tsx` (new, 180 行) — 7 卡片渲染组件
- `electron/skills.cjs` — loadAllSkills() 返回 `{channels, personas, analysis}`
- `electron/schema.sql` — 新增 `content_analysis` 表 + 索引
- `electron/ipc.cjs` — 4 个新 handler（run / get / list / delete）
- `electron/preload.cjs` — 4 个新 API
- `src/types.ts` — ContentAnalysisResult / ContentAnalysisRecord
- `src/pages/WritePage.tsx` — 「分析内容」按钮 + 渲染 AnalysisPanel
- `src/index.css` — `.analysis-panel / .analysis-card / .adaptation-grid` 等
- `tests/unit/analysis.test.ts` (new) — 11 用例

---

### 🔧 v0.2.0 后续清理

#### Revert V2 Phase 1 残留

**Commit**: `43a5ba9`

**发生了什么**：上一个 Scheduler commit 里**多带了两个文件**：
- `electron/schema.sql` 追加的 V2 5 张表（bloggers / contents / comments / comment_analysis / topics / content_topics）
- `src/skills/analyzers/content-analyzer.md` skill 文件

**为什么 revert**：
- scheduler commit 是 P1 范围，不应混入 V2 内容
- schema 表是用 `CREATE IF NOT EXISTS`，加进来不破坏但污染
- skill 在 `analyzers/` 目录子目录不会被现有 skills.cjs 加载，留在那是死文件

**最终状态**：scheduler 完整保留，schema 回到 pre-scheduler 状态（last line 是原有 `idx_rss_items_unused`），`src/skills/analyzers/` 整个目录删除。

---

## 📊 测试矩阵

| 套件 | 用例数 | 覆盖 |
|---|---|---|
| `queue.test.ts` | 13 | 任务队列并发/取消 |
| `prompts.test.ts` | 7 | 模板变量替换 |
| `skills.test.ts` | 6 | frontmatter 解析 |
| `scheduler.test.ts` | 14 | 调度器生命周期/异常隔离/重入 |
| `analysis.test.ts` | 11 | JSON 容错 3 路径 |
| **总计** | **51 用例** | |

E2E：3 用例（IPC 注册表 / handler smoke / UI smoke）

---

## 📝 维护规则

每次完成 1 个 roadmap 项：
1. 在「已完成 ✓」区加上 `- [x] **标题** — 简短说明 · commit <hash>`
2. 在提交时引用本文档 section
3. 如果是 P0 重大功能，在「📦 版本日志」加完整小节（含架构图、决策、测试）

每累计 ≥ 3 commits 更新本文档一次。

---

## 🔗 相关文档

- `docs/FEATURES.md` — 能力矩阵（静态，长期稳定）
- `docs/USER_GUIDE.md` — 用户使用说明
- `docs/MODULE_STATUS.md` — 模块完成度审计（基于代码事实）
- `DESIGN.md` — 设计规范
- `README.md` — 项目门面

---

**最后更新**：2026-08-28 · `develop` 分支 `5ce26b9` 后