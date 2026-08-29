# autoWriter-desktop · 模块完成度审计

> **最近审计**：2026-08-29（内容策略层 V3 + 身份隔离落地后重测） · 代码基线：`develop`
>
> 所有数字用命令实测：`wc -l`、`grep -c`、`playwright test --list`、`vitest run`。
>
> 本文基于代码真实状态（非文档自我描述）逐模块审计，包含：
> - 完成度百分比 + 详细子项
> - 后端实现 + 前端调用双向验证
> - 死代码 / 半成品 / 缺位功能标记

---

## 0. 总览

| 维度 | 数字 |
|---|---|
| 后端 IPC handler | **65 个**（image 12 / article 12 / strategy 6+1别名 / scheduler 5 / analysis 5 / provider 4 / images 4 / queue 3 / prompts 3 / file 2 / agent 2 / 其余 4） |
| 数据库表 | **11 个**，其中 **2 个完全未用**（rss_sources / rss_items） |
| Skills 文件 | 5 personas + 4 channels + **2 策略 skill** + 1 分析 skill = **12 个** |
| Prompt 模板 | outline / article / polish / image（+ craft 系列）；其中 **3 个含 `{{strategyBlock}}`** |
| 页面 | **8 个**（新增 StrategiesPage） |
| 单元测试 | **152 用例 / 9 套件** |
| E2E 测试 | **104 用例 / 11 套件**，整局约 3.2 分钟 |

**整体完成度**：约 **82%** — 写作主链路 + 内容策略层（V2/V3）已闭环；自动化（发布抓取 / RSS）与
高级能力（策略评分、暗色模式）待做。

> 本文档所有数字由代码实测得出（`grep` 计数 + `playwright test --list` + `vitest run`），
> 不要凭印象修改；改代码请同步改这里。

---

## 1. 页面模块（src/pages/）

| 页面 | 行数 | useState | useEffect | electronAPI 调用 | 状态 |
|---|---|---|---|---|---|
| **WritePage** | 1258 | 19 | 7 | 16 | ✅ 核心完成（策略双模式 + 队列 + 配图占位） |
| **ArticlesPage** | 1121 | 15 | 4 | 20 | ✅ 完成（最大模块，按身份过滤） |
| **ImagesPage** | 972 | 13 | 5 | 11 | ✅ 完成 |
| **SettingsPage** | 739 | 7 | 5 | 13 | ✅ 完成 |
| **StrategiesPage** | 419 | 3 | 1 | 8 | ✅ **新增**：策略库（浏览/筛选/详情/战绩/证据/复用） |
| **DashboardPage** | 337 | 1 | 2 | 5 | ✅ 完成（KPI 按身份） |
| **TopicsPage** | 43 | 0 | 0 | 0 | ⚠️ 骨架（3 个 tab 全是 Empty 占位） |
| **SourcesPage** | 22 | 0 | 0 | 0 | ❌ 纯占位 |

> 计数方式：`wc -l` / `grep -c 'useState('` 等直接量得；TopicsPage 的 3 个 useState 是 tab 切换，
> 早先版本记为"2 useState"已不符。此处一律以命令实测为准。

### 1.1 DashboardPage ✅

**功能**：KPI 卡 + 当前 Agent 状态 + 快速开始 + 最近编辑 + 队列副本 + 首次启动引导。

| 子项 | 状态 | 备注 |
|---|---|---|
| 4 个 KPI 卡（总数/草稿/今日/字数） | ✅ | |
| 当前 Agent + 全部 4 CLI 就绪状态 | ✅ | |
| 4 个快速开始磁贴 | ✅ | |
| 最近 5 篇编辑 | ✅ | 点击跳详情 |
| 队列副本（任务运行时显示） | ✅ | |
| 首次启动引导横幅 | ✅ | 未检测到任意 CLI 时显示 |

### 1.2 WritePage ✅

**功能**：内容策略（双模式）→ 三步生成（主题→大纲→正文）+ 配图占位 + 二次润色 + 5 种导出。

| 子项 | 状态 |
|---|---|
| **策略模式分段控件（借势拆解 / 命题策划）** | ✅ V2 新增，选 B 时隐藏参考文相关控件 |
| **生成创作策略 → 5 张策略卡 → 采纳** | ✅ `strategy:generate` + `strategy:adopt`（1:N） |
| **采纳后策略注入大纲/正文/润色/配图** | ✅ `{{strategyBlock}}`，模式无关 |
| **证据账勾选（成立度）** | ✅ 卡片内联 `EvidenceChecklist`，写回后同步当前生效策略 |
| **未采纳时主按钮是「生成创作策略」** | ✅ 策略成为大纲的前置闸门（跳过策略降为次按钮） |
| **从策略库复用（跨页交接）** | ✅ `strategyHandoff` 一次性消费，且在草稿恢复之后 |
| Step 1 主题输入 + 关键词 chips | ✅ |
| URL 抓取（Electron 内置 Chromium） | ✅ |
| 参考文提炼大纲 | ✅ |
| Step 2 大纲编辑 + `[已修订]` 检测 | ✅ |
| Step 3 正文生成 + Markdown 渲染 | ✅ |
| 配图占位 `[[配图:...@id]]` | ✅ 点击触发 AI |
| 二次润色 | ✅ |
| 导出 md / docx / pdf / html / png | ✅ |
| 队列接入 + 取消按钮 | ✅ v0.1 新增 |
| 主题输入 ⌘+Enter 快捷键 | ✅ |

**遗留 TODO**：`src/components/RichEditor.tsx:124` 注释「TODO: 调用 AI 生成并插入」— Tiptap 编辑器的 AI 辅助按钮未接入。

### 1.3 ArticlesPage ✅

**功能**：列表筛选 / 搜索 / 详情 Modal / 编辑 / 排程 / 发布 / 删除。

| 子项 | 状态 |
|---|---|
| 列表（5 种状态筛选 + 搜索） | ✅ |
| 详情 Modal（编辑 + 操作面板） | ✅ |
| Tiptap 富文本编辑 + 实时保存 | ✅ |
| 配图占位选择（自动生成 / 图库选 / 上传） | ✅ |
| 二次润色 | ✅ |
| 排程（datetime-local） | ✅ schema + IPC |
| 取消排程 / 标记发布 / 取消发布 | ✅ |
| 删除（含关联清理） | ✅ |
| 导出全部格式 | ✅ |

### 1.4 TopicsPage ⚠️

**真实状态**：43 行，**2 个 useState 但 0 个 IPC 调用**。

```tsx
// 当前只有三个 tab 切换 + 占位 Empty 卡片
// 没有真实「热点数据」「RSS 抓取」「我的选题库」
```

| 子项 | 状态 |
|---|---|
| 三个 tab（热点 / RSS / 我的） | ✅ UI |
| 热点数据展示 | ❌ 假数据 / 无数据源 |
| RSS 抓取 | ❌ 后端无实现 |
| 我的选题库（保存候选） | ❌ schema 无对应表 |
| 选题 → 文章生成跳转 | ❌ 未实现 |

### 1.5 SourcesPage ❌

**真实状态**：22 行，**0 hooks, 0 IPCs**。

```tsx
// 整个文件只是 PageHeader + 一个 Empty 卡片
// 「+ 添加博主」按钮无 onClick
```

| 子项 | 状态 |
|---|---|
| 添加博主 UI | ❌ |
| 列表展示 | ❌ |
| RSS 自动抓取 | ❌ |
| 抓取内容入选题库 | ❌ |

**侧边栏显示「⌘4」快捷键但点击进入的是一个空壳页面**。建议要么实现，要么从导航移除避免误导。

### 1.6 ImagesPage ✅

**功能**：图库浏览 / 筛选 / 搜索 / 单图详情 / 标签编辑 / 删除 / 跨文章应用。

| 子项 | 状态 |
|---|---|
| 尺寸分类筛选（9 个） | ✅ |
| 类别筛选（封面 / 配图 / 素材 / Banner 等） | ✅ |
| 关键词搜索 | ✅ |
| 单图详情面板 | ✅ |
| 标签编辑 | ✅ |
| 删除（DB + 文件 + 关联） | ✅ |
| 应用到文章占位符 | ✅ |
| 多 Provider 生成（带 fallback） | ✅ |
| Craft 双层 prompt 扩写 | ✅ |

### 1.7 SettingsPage ✅

**功能**：6 个配置区，覆盖所有可调参数。

| 子项 | 状态 |
|---|---|
| Agent CLI 切换 + 检测 | ✅ |
| Model 选择（手动 / opencode 拉取） | ✅ |
| 图片生图设置（Craft 开关） | ✅ |
| 图片 Provider CRUD | ✅ |
| 模型 CRUD | ✅（虽然前端未调用 saveImageModel，需 UI 触发） |
| 提示词模板实时编辑 | ✅ |
| 数据存储查看 | ✅ |

---

### 1.8 StrategiesPage ✅（V2 新增）

**定位**：把"策略是资产"落到界面。此前 `strategy:list/get/stats` 后端全通但没有任何入口，
等于 5 条策略躺在库里看不见。

| 能力 | 实现 |
|---|---|
| 浏览 | 卡片网格，按创建时间倒序，上限 100 |
| 筛选 | 模式（全部/借势拆解/命题策划）+ 状态（**默认未归档**/全部/候选/已采纳/已归档），后端过滤 |
| 搜索 | 后端 LIKE 命中 标题 / 主题 / 创作角度 / 核心主张 |
| 详情 | 全字段 + 证据账 + 采用记录 + 战绩汇总 |
| 证据账 | 勾选 已备/未备 → `strategy:setEvidenceStatus` 落库，成立度跨视图一致 |
| 效果回填 | 每条采用记录内联 6 项指标 + 备注 → `strategy:recordResult` |
| 复用 | 「从这条重新创作」→ `strategyHandoff` 一次性交接给 WritePage，并新增一条采纳记录（1:N） |
| 归档 / 取消归档 | `strategy:setStatus`，归档真的从默认视图消失 |

**依赖组件**：`EvidenceChecklist`（与 AnalysisPanel 共用，避免两处逻辑漂移）、
`utils/strategyHandoff.ts`（模块级一次性 consume，take 即清空）。

**测试**：`strategies-library-flow.spec.ts` 8 用例覆盖全链路，含跨页交接与证据勾选。

---

## 2. 任务队列（electron/queue.cjs）✅

| 子项 | 状态 |
|---|---|
| 全局 maxConcurrent 上限 | ✅ 默认 2 |
| perTypeConcurrent 限流 | ✅ 默认 1（同类串行） |
| Pending 任务取消 | ✅ |
| Running 任务取消（AbortSignal） | ✅ SIGTERM → 2s SIGKILL |
| 实时状态广播 | ✅ `queue:state` 事件 |
| 历史记录 | ✅ 保留 50 条 |
| 13 个单元测试 | ✅ 全过 |

**完成度 100%**。详见 `electron/queue.cjs` 注释。

---

## 3. 主进程（electron/）

| 模块 | 行数 | 状态 |
|---|---|---|
| `ipc.cjs` | 1323 | ✅ **65 个 handler**（其中 11 个属于策略层 + 2 个旧名兼容别名） |
| `analysis.cjs` | 596 | ✅ **策略层核心**：双 skill 加载、字段归一化、`buildStrategyBlock`、`buildImageStrategyHint`、分析解析与入库 |
| `db.cjs` | 308 | ✅ 单例 + 自动建表 + **三段式迁移**（改名让路 → 炸开 → V3 补列） |
| `schema.sql` | 216 | ✅ **11 表**（rss_sources / rss_items 未用） |
| `preload.cjs` | 107 | ✅ contextBridge，共 70 个方法（无 TS 注解 —— 这是主进程加载的 CJS，写过就白屏） |
| `scheduler.cjs` | 237 | ✅ setInterval + 3 个内置任务 |
| `queue.cjs` | 222 | ✅ 并发 / 同类串行 / SIGTERM 取消 |
| `image-providers.cjs` | 222 | ✅ 多 Provider + fallback |
| `agent.cjs` | 213 | ✅ spawn + abort signal；未知 cli 在 default 分支立即 reject（不 spawn） |
| `skills.cjs` | 74 | ✅ frontmatter 解析（仅管 personas/channels） |
| `fetcher.cjs` | 126 | ✅ Readability 算法 |
| `main.cjs` | 178 | ✅ BrowserWindow + `aw-img://` 协议 + 测试钩子 |
| `prompts.cjs` | 29 | ✅ 变量替换（只替传入的 key，漏传会让 `{{字面量}}` 漏进 prompt） |
| `init-image-providers.cjs` | 80 | ✅ 默认数据 seed（测试可用 `AUTOWRITER_SKIP_INIT_PROVIDERS` 跳过） |

**两个必须知道的约束**（都实现在过问题，改代码时别退回去）：

1. **`preload.cjs` / `ipc.cjs` 必须是纯 JS** —— 不能出现 TS 类型注解，否则主进程语法错、所有页面白屏。
2. **`getDb()` 的顺序是 `exec(schema)` → 再跑 ALTER 迁移**。所以引用新列的索引**不能**写进
   `schema.sql`，必须在 `ensureCols` 之后用 `ensureIdx` 建，否则旧库启动即 `no such column`。

---

## 4. 数据库表使用情况

| 表 | 状态 | 用途 |
|---|---|---|
| `image_providers` | ✅ 活跃 | 7 处 db.prepare |
| `image_models` | ✅ 活跃 | 8 处 db.prepare |
| `provider_settings` | 🟡 兼容 | 3 处（保留旧版 Provider 配置） |
| `article_drafts` | ✅ 活跃 | 文章主表；V3 起带 `profile_id`（身份隔离） |
| `content_analysis` | ✅ 活跃 | 内容分析结果，带 `profile_id` |
| **`content_strategies`** | ✅ 活跃 | **策略主表**：一行 = 一个策略；`mode`/`analysis_id`(nullable)/`batch_id` + 12 个决策字段 + 5 个 JSON 结构列 |
| **`strategy_articles`** | ✅ 活跃 | **策略:文章 = 1:N 执行记录** + 效果回填字段（views/likes/favorites/comments/followers/manual_score/note） |
| `rss_sources` | ❌ **完全未用** | 仅 schema 中存在 |
| `rss_items` | ❌ **完全未用** | 仅 schema 中存在 |
| `images` | ✅ 活跃 | 图库主表 |
| `article_images` | ✅ 活跃 | 文章-图片关联 |

**迁移链**（都在 `getDb()` 里，`exec(schema)` 之后跑）：
`content_angles`（一行一批）→ `_legacy_*` 改名让路 → 炸成 `content_strategies` 多行 +
`strategy_articles`；V3 再补 `insight`/`narrative` 列并把证据字符串升级成 `{item,status}`。

⚠️ **索引只能在补列之后建**：`getDb()` 顺序是 exec(schema) → ALTER，若把引用新列的索引写进
`schema.sql`，旧库启动时会 `no such column` 直接起不来（本仓库实际踩过两次）。

**建议**：要么实现 RSS 抓取（FEATURES §10 P0），要么移除那 2 个表保持 schema 整洁。

---

## 5. Skills 加载（electron/skills.cjs）

**加载机制（两套，分工不同）**：

- `skills.cjs: loadAllSkills()` 扫 `src/skills/{personas,channels}/` → 注入写作 prompt 的风格/渠道约束
- `analysis.cjs: loadAnalysisSkill() / loadAngleSkill() / loadTopicSkill()` 直接读
  `src/skills/analysis/**` 与 `src/skills/strategy/**`（剥掉 frontmatter），**不走** skills.cjs 体系

**共 12 个文件**：9 个（personas/channels）+ 1 个 content-analysis + **2 个策略 skill**：

| 类型 | 名称 | 用途 |
|---|---|---|
| **Strategy** | `strategy/angle-generation` | **A 借势拆解**：基于分析产出 5 个互斥策略 + `differentiator` + `track_fit` |
| **Strategy** | `strategy/topic-planning` | **B 命题策划**：只有题目时推演 + `feasibility`/`evidence`/`fact_risk`，5 条铁律禁编造 |
| Analysis | `analysis/content-analysis` | 参考文 7 维拆解 |

> 策略 skill 曾放在 `src/skills/analysis/angle-generation`（暗示"分析的附属产物"）；
> V2 把它上移到 `src/skills/strategy/`，与"独立决策层"的定位一致。

**personas / channels 9 个**：

| 类型 | 名称 | 用途 |
|---|---|---|
| Persona | authentic_seeder | 真实种草 |
| Persona | cold_analyst | 冷静分析 |
| Persona | knowledge_mentor | 知识导师 |
| Persona | viral_copywriter | 爆款写手 |
| Persona | warm_storyteller | 温暖叙事 |
| Channel | toutiao | 头条 |
| Channel | wechat | 公众号 |
| Channel | xiaohongshu | 小红书 |
| Channel | zhihu | 知乎 |

**调用方**：
- `WritePage` Step 1「高级」面板显示可选项
- IPC `article:outline` 和 `article:article` 都调用 `buildSkillInjection({ channel, persona })` 注入 prompt

**完成度 100%**。无遗留问题。

---

## 6. Prompt 模板（src/prompts/）

| 文件 | 是否实际加载 | 含 `{{strategyBlock}}` | 用途 |
|---|---|---|---|
| `outline.md` | ✅ | ✅（排在 `{{analysisBlock}}` 之后） | 大纲生成 |
| `article.md` | ✅ | ✅（同上） | 正文生成 |
| `polish.md` | ✅ | ✅ **V2 补上** | 二次润色 |
| `image/craft.md` | ✅ | — | 图片 prompt 模板目录内的兼容/配置件 |
| `image/craft-standard.md` | ✅ | — | 通用 prompt 扩写（其他模型的兜底） |
| `image/craft-flux.md` | ✅ | — | Flux 专属优化 |
| `image/config.js` | ✅ | — | 图片 prompt 相关配置（非模板） |

> `polish.md` 此前只带 `analysis`（素材）不带 `strategy`（决策），一次润色就把用户采纳的
> 立意/情绪/目标/差异锚点洗回平庸 —— 现在注入并禁止改动五要素。
> 顺序要求：策略块必须排在分析块**之后**，因为“已采纳的决策”要覆盖“参考素材的立场”。

配图另有独立于 prompt 模板的策略注入：`buildImageStrategyHint(strategy)` 把
`emotion` 映射成画面气质、`goal` 映射成图像作用，**拼在 AI 扩写之前**，
让风格约束被一并展开而不是事后追加互相矛盾。

**编辑流程**：设置页可实时编辑保存。无需重启。

**完成度 100%**。唯一缺位是缺少其他模型的 craft 模板（`craft-sdxl.md` / `craft-kontext.md`），但因为有 standard 兜底，不阻塞使用。

---

## 7. 测试覆盖

### 7.1 单元测试（vitest）— 152 用例 / 9 套件

| 套件 | 用例 | 覆盖 |
|---|---|---|
| `strategy-block.test.ts` | 47 | 策略字段归一化、成立度、双模式提示词渲染、配图约束 |
| `storage.test.ts` | 25 | localStorage 封装、身份 profile、版本迁移 |
| `ipc-imports.test.ts` | 17 | **静态守卫**：ipc 用到的 helper 符号必须真被 require |
| `analysis.test.ts` | 17 | 分析 JSON 容错 3 路径 |
| `scheduler.test.ts` | 14 | 调度器生命周期/异常隔离/重入 |
| `queue.test.ts` | 13 | 任务队列全部行为 |
| `prompts.test.ts` | 7 | 模板变量替换 |
| `angle-result.test.ts` | 6 | 策略结果解析（含 track_fit 折算） |
| `skills.test.ts` | 6 | frontmatter 解析 |

### 7.2 E2E 测试（playwright）— 104 用例 / 11 套件

| 套件 | 用例 | 覆盖 |
|---|---|---|
| `ipc-handlers.spec.ts` | 22 | 每个 handler 可被 invoke（最小 smoke） |
| `queue-and-scheduler-flow.spec.ts` | 12 | 队列 + 调度器端到端 |
| `articles-flow.spec.ts` | 12 | 文章列表/详情/配图/导出 |
| `writepage-flow.spec.ts` | 10 | 写文章全流程 + **策略入口可发现性** |
| `dashboard-flow.spec.ts` | 10 | 仪表盘 KPI 与快捷入口 |
| `strategy-flow.spec.ts` | 9 | **三级迁移、1:N 采纳、回填写入与聚合、反查口、双模式守卫** |
| `ui-smoke.spec.ts` | 8 | 应用启动 + 关键页面可渲染 |
| `strategies-library-flow.spec.ts` | 8 | **策略库 UI 全链路（证据勾选、战绩、跨页复用）** |
| `settings-flow.spec.ts` | 7 | 设置页 / Agent / 身份 |
| `article-isolation.spec.ts` | 4 | **文章身份隔离 + 写入口静态守卫** |
| `ipc-registry.spec.ts` | 2 | 全部 IPC channel 注册一致性（含"禁止未声明 channel"） |

### 7.2b 两个专用静态守卫

有些回归是**静默**的（列存在、默认值空、不报错），跑测试也发现不了，因此用源码断言兜住：

- `ipc-imports.test.ts`：调用了 helper 却没 require → 运行时才炸的那种
- `article-isolation.spec.ts` 末条：INSERT 必须带 `profile_id`、三个列表调用点必须透传 `profileId`
- `scripts/check-placeholders.cjs`（非测试，需手动/CI 跑）：模板里的 `{{占位符}}` 必须全部被 handler 传入，
  否则字面量会漏进提示词喂给模型

### 7.3 测试钩子

5 个 test:* channels 在 `AUTOWRITER_TEST_MODE=1` 时注册：
- `test:list-channels`
- `test:invoke`
- `test:reset-db`
- `test:userdata`
- `test:exec-sql`

**完成度 90%**。可改进：
- ArticlesPage / WritePage / ImagesPage 缺单元测试
- 队列真实取消流程缺 e2e

---

## 8. 自动化流程（未实现）

| 流程 | 状态 | 影响 |
|---|---|---|
| **调度器** | 🟡 **壳已实现，价还不闭环** | `scheduler.cjs` 237 行 + `setInterval` 60s + 3 个内置任务，设置页有 SchedulerCard 可开关/改间隔/手动跑。**但**：3 个任务里只有 1 个真干活（详下） |
| **RSS 抓取**（`rss-parser` 入 `rss_items`） | ❌ 完全无代码 | 选题中心 / 博主源都没数据源（两张表也因而空转） |
| **Publisher**（公众号 / 小红书 / 微博） | ❌ 无代码 | 「标记发布」只是改状态，不真发布 |
| **Agent ReAct Loop** | ❌ 当前是 spawn shim | 不能 Reason→Act→Observe 多步 |
| **MCP 客户端** | ❌ 无代码 | 无法连接外部 MCP server |

> 注：早期版本把调度器记为“❌ 完全无代码”，已在本次审计修正。剩下的 4 项仍是 P0/P1 路线图核心。

### 8.1 调度器三个任务的真实成色

| 任务 | 实际行为 | 价值 |
|---|---|---|
| `process-scheduled-articles` | 扫 `article_drafts` 中 `scheduled_at <= now AND published_at IS NULL`，把 `status` 改成 `published`、写 `published_at`、清 `scheduled_at` | ✅ 真的在跑，但**它不发布文章** —— 没有 Publisher，所谓“到点自动发”实质是“到点自动标记为已发布” |
| `sync-bloggers` | 先查 `bloggers` 表是否存在，不存在直接 `return { skipped }` | ⚪ **空转**（表尚未建，属 V2 Phase 1 预留） |
| `cleanup-stale-topics` | 先查 `topics` 表是否存在，不存在直接 `return { skipped }` | ⚪ **空转**（同上；与 §11 “保存为选题并入策略库”是同一件事） |

**结论**：调度器的**机制**（周期调度、异常隔离、重入保护、手动触发、开关）已经完整且有 14 个单测;
缺的是**真正该被调度的业务**（真发布、真 RSS 抓、博主源同步）。对外描述时不要把“调度器已实现”
说成“自动发布已可用”。

---

## 9. 设计系统

| 子项 | 状态 |
|---|---|
| DESIGN.md 规范 | ✅ 16 KB 完整 |
| DESIGN.tokens.json | ✅ 完整 token |
| CSS 变量系统 | ✅ 28 个变量 |
| Card accent 变体 | ✅ 6 种（action / configure / system / insight / danger / default） |
| Lucide 图标 | ✅ 已替换所有 emoji-as-icon（遗留 ~13 处内容型 emoji，如日志） |
| 暗色模式 | ❌ DESIGN.md 提及但未实现 |
| 动画 / motion | ✅ t-fast / t / t-slow + spring easing |

## 10. 工程化

| 项 | 状态 |
|---|---|
| Git + 远程 GitHub | ✅ develop + main + branch protection |
| CODEOWNERS | ✅ 自动指派 @xp630 |
| ESLint | ✅ 配置但未集成 CI |
| TypeScript strict | ✅ 几乎 0 错误（仅 RichEditor / export.ts 有遗留） |
| 单元测试 CI | ⚠️ `.github/workflows/test.yml` 存在但需验证 |
| 发布 workflow | ❌ 未实现 |
| 错误边界 | ❌ 无 React ErrorBoundary |
| 性能优化（memo / callback） | 🟡 仅 7 处使用 |

---

## 11. 已识别的问题清单

### 🔴 关键（影响用户）

1. **TopicsPage 是空壳**（43 行，0 IPC）——「热点」和「我的选题库」无数据源
2. **SourcesPage 是空壳**（22 行）——整个页面只有一个 Empty 卡片
3. **策略层只贯通到配图** —— 导出没附策略摘要、发布没按 `goal` 生成检查清单（反查口已就绪，差的只是消费）
4. **Publisher 未实现** —— 「标记发布」只是改 DB 状态

### 🟡 中等（影响体验）

5. **`provider_settings` 表是遗留** —— 新版用 `image_providers`，旧表保留但只 3 处引用
6. **`saveImageModel` / `image:provider:delete` 后端有但前端无 UI 暴露**
7. **`file:save-image` 后端有但前端无 API 暴露**（preload 没列）
8. **`image:provider:get-active` 后端有但前端从未调用**（实际取数走 `images:list`）
9. **RichEditor 中 `TODO: 调用 AI 生成并插入` 未完成**

### 🟢 低（影响美观）

10. **暗色模式未实现** —— DESIGN.md 提及但 CSS 无 `[data-theme="dark"]` 块
11. **13 处内容型 emoji 残留**（日志行 / 列表项）—— 已替换装饰型，但内容型保留是有意的
12. **无 React ErrorBoundary** —— 组件 throw 时整页空白

---

### 🆕 本次审计新增（放在末尾，不改动原有编号）

13. **`listAnalyses` 全项目无调用方** —— 只在 `types.ts` 声明了，renderer 没任何人用，
    所以刷新页面不会恢复上次分析结果
14. **「保存为选题」仍是占位 toast** —— 按 V3 定位，选题应降级为策略的一个来源
    （`source_type='manual'`）并并入策略库，不该再开并列页面
15. **策略库无分页与排序** —— 定 100 条上限、只按创建时间倒序；按成立度/平均评论排序
    要等战绩数据够多才有意义

---

## 12. 后续优先级建议

### P0（把已开好的能力接通）

1. **导出附策略摘要 + 发布前按 goal 生成检查清单**（1 天）—— 反查口 `article:strategyFor` 已就绪，只差消费端
2. **「保存为选题」并入策略库**（1 天）—— 新增 `source_type='manual'` 的手写策略入口，同时处理 TopicsPage 空壳
3. **SourcesPage 移除或实现**（0.5 天）—— 二选一，别让它继占着侧栏

### P1（用户能感知差异）

4. **Publisher：公众号**（3-5 天）—— playwright + 草稿模式
5. **RSS 抓取**（1 天）—— 已有 schema，只需 rss-parser + cron
6. **暗色模式**（2 天）—— 加 `[data-theme="dark"]` 块
7. **error boundary**（0.5 天）——避免白屏

### P2（数据积累后才有价值）

8. **策略评分与推荐**（2-3 天）—— 按赛道统计各角度的平均评论/阅读，反向校正
   `value_score`。**前置条件是先回攒够真实战绩**，没数据时做出来只能是个瞎猜器
9. **ReAct Engine**（5-7 天）—— 替代 spawn shim
10. **MCP 客户端**（3-5 天）—— 外部工具接入
11. **性能优化**（2 天）—— memoize 列表渲染
12. **死代码清理**（1 天）—— provider_settings / unused IPC

---

**审计方法**：直接 grep + read 源码 + 前端/后端调用对账。所有「❌ / ⚠️」均经过实际代码验证，非主观判断。

**下次审计建议**：每次重大功能合并后更新本文件「11. 已识别的问题清单」一节。

---

## 13. 内容策略层完成度（V2/V3）

策略层的定位：**策略不是大纲也不是正文，而是“这一篇文章的决策记录”**，
因此必须贯穿整个生命周期。逐环实测结果：

| 消费点 | 状态 | 实现位置 |
|---|---|---|
| 大纲生成 | ✅ | `outline.md` 的 `{{strategyBlock}}` |
| 正文生成 | ✅ | `article.md` 的 `{{strategyBlock}}` |
| 二次润色 | ✅ | `polish.md` + 无参数时按 `articleId` 反查 |
| AI 配图 | ✅ | `buildImageStrategyHint`（emotion→气质、goal→作用） |
| 导出 | ⚠️ 缺 | 反查口已就绪，导出未附策略摘要 |
| 发布 | ⚠️ 缺 | 反查口已就绪，未按 goal 生成发布前检查清单 |
| 效果回填 | ✅ | `strategy_articles` 6 项指标 + 详情页录入 UI + `strategy:recordResult` |
| 策略库 | ✅ | `StrategiesPage` 8 项能力（见 §1.8） |
| 策略评分 / 推荐 | ❌ 有意不做 | 需要真实战绩数据，现在做只会退化成瞎猜 |

双模式均已可用：A 借势拆解（风险=同质化，抓手 `differentiator`）、
B 命题策划（风险=幻觉，抓手 `evidence` + `fact_risk`）。

> 唯一还没被真实 AI 输出验证过的一环：**润色到底会不会照做（禁改五要素）**。
> 单测与 e2e 只能证明提示词里带了约束，带不带得动模型得人手跑一次。
