# autoWriter-desktop · Changelog & Implementation Log

> 本文档追踪已完成的方案、关键设计决策、待修复的已知问题。
> 代码状态基线：`develop` 分支 · 62 单元测试 / 3 E2E 全过

---

## 📦 v0.2.0 · 2026-08-28

### 🆕 后台调度器（Scheduler）

**Commit**: `d24b169 feat(scheduler): 后台调度器 — setInterval 周期任务 + 3 个内置任务`

**是什么**：在 Electron 主进程常驻一个 `setInterval` 循环，每 60s 扫描一次注册的 handler，自动执行周期任务。

**为什么需要**：
- 之前 `article_drafts.scheduled_at` 字段存在但**无人扫描**，排程文章永远不会自动发布
- 之前内容发现能力完全没有基础设施
- 之前主题清理、博主同步等需求无处下手

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

**测试**：`tests/unit/scheduler.test.ts` 14 个用例：
- 生命周期（start/stop/enable/disable/interval 校验）
- tick 串行执行 + 顺序写入 history
- 异常隔离（一个 handler 抛错不影响其他）
- 手动 runNow + 重入保护
- disabled 状态 tick 为 no-op
- history 超过 historyLimit 自动丢弃

**文件**：
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

**Commit**: `42c97a5 feat(analysis): P0 内容分析中心 — AI 拆解参考内容`

**是什么**：用户在写文章页粘贴参考内容后，点「分析内容」按钮，AI 把参考文拆解为 7 个维度的结构化 JSON，渲染成卡片。

**为什么需要**：之前用户输入参考文后**直接进写作**，缺一步「为什么这篇值得写」「我从什么角度创作」的判断辅助。

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
| **核心观点** | 3 条条 锐度观点（不是废话） | 拿来参考或挑战 |
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

**文件**：
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

## 🔧 v0.2.0 后续清理

### Revert V2 Phase 1 残留

**Commit**: `43a5ba9 revert: drop V2 Phase 1 leftovers from scheduler commit`

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

| 时间 | 套件 | 用例数 | 覆盖 |
|---|---|---|---|
| v0.1.0 | `queue.test.ts` | 13 | 任务队列并发/取消 |
| v0.1.0 | `prompts.test.ts` | 7 | 模板变量替换 |
| v0.1.0 | `skills.test.ts` | 6 | frontmatter 解析 |
| v0.2.0 | `scheduler.test.ts` | 14 | 调度器生命周期/异常隔离/重入 |
| v0.2.0 | `analysis.test.ts` | 11 | JSON 容错 3 路径 |
| **总计** | **5 套件** | **51 用例** | |

E2E：3 用例（IPC 注册表 / handler smoke / UI smoke）

---

## 🐛 已知问题 / 待办审计

### 1. localStorage 更新逻辑混乱（**未修复**，P0-P1）

**来源**：`docs/CHANGELOG.md`（本文件）§ 「待办审计」 / 此前对话 review

**问题**：
- 🔴 **死代码**：`WritePage.tsx:19-26` 定义了 `saveDraft` / `loadDraft` 但全文件 0 个调用点。「刷新不丢」功能实际没生效
- 🟡 **5 个文件 11 处直接 `JSON.parse(localStorage.getItem(...))`**：WritePage / DashboardPage / ArticlesPage / ImagesPage / RichEditor 重复解析同一组 key
- 🟡 **无统一封装**：4 个 localStorage key 散落，无常量集中、无类型守卫、无 schema 版本
- 🟡 **aw_open_article 多此一举**：CustomEvent 已经够用，localStorage 中转是冗余
- 🟢 **缺 debounce**：如启用 `saveDraft`，每次 onChange 都写会卡
- 🟢 **类型不安全**：`JSON.parse(...)` 后直接 `.provider` 访问，无 runtime 校验

**修复路径**：

| 优先级 | 项 | 估时 |
|---|---|---|
| P0 | 启用 `saveDraft` / `loadDraft`（修死代码）+ debounce | 30 min |
| P0 | 抽 `src/utils/storage.ts` 统一封装（`getAgentSettings()` 等） | 1 hour |
| P1 | `aw_open_article` 改纯事件，删 localStorage 中转 | 10 min |
| P2 | 加 schema 版本字段（versioned storage） | 30 min |
| P3 | 类型守卫 + 错误日志 | 30 min |

### 2. 其他遗留（pre-existing）

- `src/components/RichEditor.tsx:121` — `prompt` 变量自引用导致 TS 报错（不影响运行）
- `src/utils/export.ts:321` — `docx` 类型不匹配（不影响构建产物）
- `docs/FEATURES.md` §10 路线图未实现项（P0 调度器已部分实现，其他未动）

---

## 📚 相关文档

- `docs/FEATURES.md` — 功能矩阵 + 路线图
- `docs/USER_GUIDE.md` — 用户使用说明
- `docs/MODULE_STATUS.md` — 模块完成度审计
- `DESIGN.md` — 设计规范
- `README.md` — 项目门面

---

**最后更新**：2026-08-28 · `develop` 分支 `42c97a5` 后

**维护规则**：每次发版（或累计 ≥ 3 commits）更新本文件，列出新增功能 + 关键决策 + 已知问题