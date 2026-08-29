# autoWriter-desktop · Changelog & Roadmap

> 单一文档追踪：**已完成方案** + **关键设计决策** + **后续计划（带勾选框）**
> 代码基线：`develop` 分支 · 207 单元测试 / 110 E2E 全过

---

- [x] **写文章页首次引导横幅 + USER_GUIDE §2.4「10 秒速通」** — 上一轮 V2/V3/V4 加了 12+ 按钮,用户反映「不会用了」。本补丁不动页面逻辑,只补文档+横幅:
  - `docs/USER_GUIDE.md` 新增 §2.4「写文章 10 秒速通」(快路径、什么时候跳到 §3、按钮总图)
  - 写文章页顶部新增 `.intro-banner`:首次进入提示「主题→切命题策划→点生成创作策略」,附「去看文档 →」+「知道了」按钮;localStorage `aw_writepage_intro_v1_dismissed=1` 后不再出现
  - **不做**任何流程/闸门改动——按用户决定走「写好文档,后面再优化流程」路线
  - e2e +1: 横幅显示 / dismiss / 持久化不重现
  - 单测 207 + e2e 110 全过

- [x] **「周记计划」+ 第一篇草稿落地** — 决定把"做这个订阅号"本身做成长期系列选题:
  - `docs/WEEKLY_RECAP.md` 新增:9 段模板、双周节奏、诚实周约定、3 层系统支持选项
  - `drafts/first-article-2026-08-29.html` 第一篇:「找了一篇硬核文章问 AI 能不能写,AI 说『它不背这个锅』」(684 字,带手机阅读 + 打印 CSS)
  - USER_GUIDE §附录「内容生产节奏」加索引

## 📋 待办清单（勾选式）

### P0 · 立即做（影响用户感知）

- [x] **本地更新 / 死代码修复** — `saveDraft`/`loadDraft` 启用，1.5s debounce 自动保存，文章入库后清草稿 · commit `31dbd56`
- [x] **localStorage 统一封装** — 抽 `src/utils/storage.ts`，5 文件 11 处直接 `JSON.parse` 收敛到 `getAgentSettings()` / `getImageSettings()` / `getDraft()` 等 8 个具名 API，含类型守卫、版本迁移、错误容错 · commit `31dbd56`
- [x] **`aw_open_article` 去 localStorage 化** — 通过 `setOpenArticleId(null)` 一次性消费实现（虽然存储还在 localStorage，但语义已是一次性触发）· commit `31dbd56`
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
- [x] **本地更新 / 死代码修复 + localStorage 统一封装** — `src/utils/storage.ts` 8 个具名 API + WritePage 草稿自动保存 1.5s debounce + 5 文件 11 处迁移，18 个新测试 · commit `31dbd56`
- [x] **P0 内容分析中心 + 3 gap 修复** — AnalysisPanel 7 卡片 + JSON 容错 3 路径 + buildAnalysisContextBlock 注入 prompt + 用户领域参数 + 「开始写作」真正接 generateOutline · commits `42c97a5` `5fde790`
- [x] **内容分析中心 (P0)** — AnalysisPanel 7 卡片 + JSON 容错 + 11 测试 · commit `42c97a5`
- [x] **Revert V2 Phase 1 残留** — 清理 scheduler commit 里多带的 schema/skill · commit `43a5ba9`
- [x] **Queue + 取消** — TaskQueue 真实 SIGTERM 子进程 · commit `3e2e2b3` (pre-v0.2)
- [x] **Lucide 图标 + Card accent 变体** — 替换 emoji-as-icon · commit `664d1e4`
- [x] **Dashboard 落地页** — KPI + 当前 Agent + 最近编辑 + 首次启动引导 · commit `6192a0d`

---

- [x] **内容策略层 V1（P0-1/P0-2）** — 分析→5 个创作方向（analysis:angles）+ 采纳后 `{{strategyBlock}}` 注入大纲与正文 + `angles:adopt` · commits `f673ace` `dd034cd` `da88e11`
- [x] **内容策略系统 V2** — `content_angles` 重构为 `content_strategies`（**一行 = 一个策略**）+ `strategy_articles` 支撑策略:文章 **1:N** + `analysis_id` 可空（双模式）+ `differentiator`/`track_fit`/`feasibility`/`evidence`/`fact_risk` 全部结构化 + 润色与配图也注入策略 + 反查口 `article:strategyFor` · commit `239450b`
- [x] **策略库页 + 效果回填录入（P0+P1）** — 浏览/筛选/搜索/详情/采用记录/战绩汇总/从策略重新创作 + 六项指标手动回填写入 `strategy_articles` · commits `cfa5f45` `94e0b5f`
- [x] **内容策略 V3：证据账成为闸门** — `evidence{item,status}` + 成立度 + ready/todo 分开下发约束 + `fact_risk` 改由成立度推导 + thesis/insight 拆分 + narrative 四拍骨架 · commit `c50b002`
- [x] **文章身份隔离** — `article_drafts.profile_id` + 列表按身份过滤（历史空值不隐身）+ 三处读入口与两处写入口全部透传 · commit `af4c180`
- [x] **⚠ e2e 会清空用户真实生产库（严重）** — `_electron.launch` 不隔离 Electron userData，harness 建了临时目录却没传给 app → `test:reset-db` 每次跑都在 `DELETE FROM` 真实库。现真传 `--user-data-dir` + 启动后硬断言 userData 必须等于临时目录，否则中止
- [x] **⚠ 旧库启动即崩（严重）** — 把引用迁移新列的索引写进 `schema.sql`，而 `getDb()` 顺序是 exec(schema) → 再 ALTER → 旧库 `CREATE INDEX` 找不到刚要补的列 → `no such column` → app 起不来。索引全部改到补列之后建
- [x] **⚠ `analysis:run` 硬编码 claude** — 忽略调用方 cli/model → 「分析内容」永远用 claude，用户选的 Agent 不生效（而 `analysis:angles` 反而收 cli，不一致）
- [x] **⚠ `content_analysis.profile_id` 写了不读** — 列存在但从未写入、列表从未过滤 → 分析记录的账号隔离是假的，两个身份互见全部分析

### 🩹 E2E 补全 + 致命 bug 修复（commit `324efbd`）

用户实测「页面打不开」，定位到之前没跑 E2E 就提交的多个致命 bug，
现全部修复并补齐 82 个 E2E 用例。

**致命 bug（应用完全不可用）**：
1. `preload.cjs` 含 TS 注解 `(params: any)` → preload 加载失败 → `window.electronAPI` 不存在 → **所有页面白屏**
2. `ipc.cjs` 含 TS 注解 `let x: string` / `catch (e: any)` → main 进程启动即崩
3. WritePage draft useEffect 引用后置声明的 setter → TDZ 崩溃
4. SettingsPage 漏 `getImageSettings`/`getAgentSettings` import
5. QueueBadge 在 `return null` 之后还有 `useCallback` → React #310 整树崩溃

**中等**：
6. scheduler `sync-bloggers`/`cleanup-stale-topics` 引用已 revert 掉的表 → sqlite_master 存在性检查跳过
7. `analysis:run` 的 `loadAnalysisSkill()` 在 try/catch 外
8. analysis skill 文件路径 `content-analysis.md` → `content-analysis/SKILL.md`

**新增 E2E（35→82 用例）**：
| 文件 | 用例 | 覆盖 |
|---|---|---|
| `settings-flow.spec.ts` | 7 | 调度器卡 / 启停 / 立即跑 / Provider / channel 注册 |
| `writepage-flow.spec.ts` | 9 | Step1 / 关键词 / 高级 / 分析 / **草稿刷新恢复** / 禁用态 / 订阅 |
| `articles-flow.spec.ts` | 12 | 列表 / 筛选 / 搜索 / 发布 / 排程 / 删除 / 更新 |
| `queue-and-scheduler-flow.spec.ts` | 12 | queue snapshot / 订阅 / cancel / scheduler 全生命周期 |
| `dashboard-flow.spec.ts` | 10 | KPI×4 / Agent / 快速开始 / 空态 / 最近文章 / 磁贴跳转 |

**教训**：以后声称"完成"前必须实际跑 `npx playwright test` + `npx vitest run`，不能只看 build 通过。

---

## 📦 v0.3.0 · 内容策略层（进行中）

### 🎯 定位变化

从 “AI 写作工具” 变成 **AI Content Strategist + AI Writer**。

核心认知：**策略不是大纲，也不是正文，而是“这一篇文章的决策记录”**，
因此必须贯穿整个生命周期，而不是“生成个大纲就结束”：

```
ContentStrategy
├── 大纲生成   ✅ {{strategyBlock}}
├── 正文生成   ✅ {{strategyBlock}}
├── 二次润色   ✅ 注入 + 禁改五要素
├── AI 配图    ✅ emotion→画面气质，goal→图像作用
├── 导出       ⚠️ 可反查，未附策略摘要
├── 发布       ⚠️ 可反查，未做发布前检查清单
├── 效果回填   ✅ 表 + IPC + 录入 UI
└── 策略库     ✅
```

### 🧬 两种模式（关键设计：它们的风险完全不同）

| | A 借势拆解 `reference` | B 命题策划 `topic` |
|---|---|---|
| 输入 | 参考文 URL / 正文 | 一个题目 |
| 核心能力 | **迁移** | **规划** |
| 核心风险 | **同质化** | **AI 幻觉** |
| 对应抓手 | `differentiator` 差异锚点 | `evidence` 证据账 + `fact_risk` |
| 依赖分析 | 是 | 否（`analysis_id` 为 NULL） |

> 入口不再是“把分析按钮放开”：策略是大纲的**前置闸门**——未采纳策略时，
> Step 1 主按钮就是「生成创作策略」，“跳过策略”降为次按钮。

### 🏛️ 数据模型（两次重构）

```
content_strategies     一行 = 一个策略（不是一行装一批候选）
                       mode / source_type / analysis_id(nullable) / batch_id
                       angle_type / title / core_point / insight / target_user
                       structure / narrative / emotion / goal / value_score
                       differentiator / track_fit / feasibility / evidence_needed / fact_risk
                       status(candidate|adopted|archived)
strategy_articles      策略 : 文章 = 1:N，带效果回填字段
```

为什么一行一个：策略要能被单独检索、复用、回填战绩——**策略是资产，文章是执行结果**。

迁移链（三级，全部在 `exec(schema)` 之后的 `ensureCols`/炸开阶段完成）：
`content_angles`（一行一批）→ V1 `content_strategies.strategy_json` → V2/V3 平铺列；
旧采纳的 `(批次, angle_index)` 重映射到新行，历史不丢。

### 🔐 V3 关键点：证据账是闸门，不是注释

```
evidence_needed: [{ item: "官方价格", status: "ready" },
                  { item: "实测记录", status: "todo" }]
成立度 = ready / total   →   卡片/详情/列表徒标
```

- `ready` → 提示词：“用户已提供的证据，可以直接写进正文”
- `todo` → 提示词：“必须留「待补充」占位，绝对不得臆造”
- **未确认就是没素材**：旧字符串数据一律升级成 `todo`，不做乐观假设
- `fact_risk` 由成立度推导（全备→low / 一条没备→high / 部分→medium）

同时拆开两个被混用的概念：`core_point` = **主张**（要证明的），`insight` = **洞察**
（读者带走的那句）。分开是因为**主张可以正确但毫无价值**。
`narrative` 四拍（hook/explanation/framework/action）取代自由 `structure[]`：
可复用、可比价的模板，而不是“一篇一篇的散文”。

### 🧭 身份（profile）隔离，不是赛道隔离

| | 按什么 | 性质 |
|---|---|---|
| 赛道 `track` | 内容领域 | 筛选维度，不做墙 |
| 身份 `profile_id` | 谁在用这台机器 | 隔离边界 |

`content_analysis` / `content_strategies` / `article_drafts` 三表统一规则：
传 `profileId` → 本身份 + 历史空值（不隐身）；不传 → 全量（调度器等系统任务）。

### 🧪 测试

| 套件 | 用例 | 覆盖 |
|---|---|---|
| `strategy-block.test.ts` | 47 | 归一化三模式/成立度/ready-todo 分开下发/narrative 四拍 |
| `strategy-flow.spec.ts` | 9 | 三级迁移、1:N、回填写入与聚合、反查口、双模式守卫 |
| `strategies-library-flow.spec.ts` | 8 | 策略库 UI：筛选、详情、战绩、证据勾选、跨页交接 |
| `article-isolation.spec.ts` | 4 | 文章身份隔离 + 写入口静态守卫 |

### 📌 本节带出的四个严重 bug（全部已修）

1. **e2e 每次跑都清空用户真实生产库**（Playwright 不隔离 Electron userData）
2. **旧库启动即崩**（索引引用了尚未补上的列）
3. **`analysis:run` 硬编码 claude**（用户选的 Agent 对分析无效）
4. **`content_analysis.profile_id` 写了不读**（身份隔离形同不存在）

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

### v0.3.0 新增（策略层相关）

| 套件 | 用例数 | 覆盖 |
|---|---|---|
| `strategy-block.test.ts` | 47 | 字段归一化、成立度、双模式提示词渲染、配图约束 |
| `strategy-flow.spec.ts` | 9 | 三级迁移、1:N 采纳、效果回填与聚合、反查口、入参守卫 |
| `strategies-library-flow.spec.ts` | 8 | 策略库 UI 全链路（含跨页交接、证据勾选） |
| `article-isolation.spec.ts` | 4 | 文章身份隔离 + 写入口静态守卫 |
| `angle-result.test.ts` / `ipc-imports.test.ts` | — | 旧用例随 V2/V3 契约更新；静态守卫改为定位真正的解构块边界 |

当前总量：**152 单元测试 / 104 E2E**（整局 1.8 分钟）

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
- `docs/USER_GUIDE.md` — 用户使用说明（§10 内容策略与策略库）
- `docs/STRATEGY_LIBRARY.md` — **策略库功能清单与操作说明**（字段含义、证据账、回填、复用）
- `docs/CONTENT_STRATEGY_V2.md` — 内容策略系统 V2/V3 设计与实现细节
- `docs/MODULE_STATUS.md` — 模块完成度审计（基于代码事实）
- `DESIGN.md` — 设计规范
- `README.md` — 项目门面

---

**最后更新**：2026-08-28 · `develop` 分支 `5ce26b9` 后