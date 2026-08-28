# 内容策略系统 V2 · Strategy-Driven Workflow

> 状态：已实现（后端 + 双模式入口）；策略库页与回填 UI 待做
> 取代：`P0_CONTENT_DECISION.md` 里 P0-1/P0-2 的原始划分
> 上游设计输入：《AutoWriter 内容策略系统（V2）》

## 一句话

**策略不是大纲，也不是正文；策略是"这一篇文章的决策记录"，它必须贯穿整个生命周期。**

```
ContentStrategy
├── 大纲生成   ✅ 注入 {{strategyBlock}}
├── 正文生成   ✅ 注入 {{strategyBlock}}
├── 二次润色   ✅ 注入 + 禁改五要素（立意/角度/情绪/目标/差异）
├── AI 配图    ✅ emotion→画面气质，goal→图像作用
├── 导出       ⚠️ 后端可反查，导出未附策略摘要
├── 发布       ⚠️ 后端可反查，发布前检查清单未做
└── 效果回填   ✅ 表 + IPC 已就绪，录入 UI 未做
```

## 为什么必须有"反查口"

导出 / 发布 / 回填发生在 renderer 状态之外（文章已入库，或在另一个页面）。
所以策略不能靠参数一路传，必须能从 `articleId` 读回：

```
article:strategyFor(articleId) → 该行策略 + adoptionId
```

`electron/ipc.cjs` 里润色与配图都是先试参数、再退到反查，保证策略不会静默丢失。

## 两种模式

| | A 借势拆解 `reference` | B 命题策划 `topic` |
|---|---|---|
| 输入 | 参考文 URL / 正文 | 一个主题 |
| 核心能力 | 迁移 | 规划 |
| **核心风险** | **同质化** | **AI 幻觉** |
| 依据 | 已有内容证据 | 赛道 + 人群 + 推演 |
| 依赖分析 | 是（`analysis_id`） | **否（`analysis_id` 为 NULL）** |
| 专属字段 | `differentiator`、`track_fit` | `feasibility`、`evidence_needed`、`fact_risk` |

### A 抗同质化：differentiator 是正向抓手

只写"不得沿用原文"是**负向约束，只产生规避，不产生差异化**。所以 A 强制产出结构化差异锚点：

```json
{ "type": "new_audience", "description": "用男性视角重新解释女性的婚恋选择", "instruction": "全文以丈夫/男友视角展开" }
```

`type` 六选一：`new_position / new_evidence / new_audience / new_scenario / new_conclusion / new_experience`。
`instruction` 会作为硬指令进正文提示词。

### B 抗幻觉：fact_risk 驱动分级约束

- 禁止编造数字/百分比/日期/研究结论/人名/机构/书名/引语/他人经历
- 缺支撑处写「待补充」占位，不得臆造
- 允许"部分用户 / 很多人 / 一些情况下 / 普遍存在"这类普遍观察表述，但不得伪装成统计结论
- `fact_risk = high` 时追加更强约束（全文以观点与推理为主，定量表述一律占位）
- `evidence_needed` 是**用户能去获取的具体东西**，不是"需要更多资料"

归一化默认值：B 模式无显式 `fact_risk` 时给 `medium`；`evidence_needed` ≥ 3 条自动升 `high`。

## 数据模型

**一行 = 一个策略**（不是一行装一批候选）——因为策略要能被单独检索、复用、回填战绩。

### `content_strategies`

`mode` `source_type`(analysis|topic|manual) `analysis_id`(nullable) `batch_id`(同次生成归组)
`topic` `profile_id` `track` `persona`
`angle_type` `title` `core_point` `target_user` `structure`(JSON) `emotion` `goal` `value_score`
`differentiator`(JSON) `track_fit`(JSON) `feasibility`(JSON) `evidence_needed`(JSON) `fact_risk`
`status`(candidate|adopted|archived) `created_at` `updated_at`

### `strategy_articles` —— 策略 : 文章 = 1:N

一条策略可反复采纳给不同渠道的执行结果（公众号长文 / 小红书笔记 / 知乎回答 / 头条）。

`strategy_id` `article_id`(nullable：先采纳后生成) `adopted_at`
+ §十三 效果回填字段：`views` `likes` `favorites` `comments` `followers` `manual_score` `note`

> 文档 §九 叫 `strategy_articles`、§十三 叫 `strategy_adoptions`，此处统一取前者。

## IPC

| channel | 用途 |
|---|---|
| `strategy:generate` | 双模式生成，返回 `strategies[]`（每行带 id）+ `track_fit` |
| `strategy:adopt` | 建执行记录，返回 `adoptionId`；策略状态升 `adopted` |
| `strategy:list` | 按 mode/status/track/search/profileId 过滤，带 `adoption_count`，JSON 列已解析回结构 |
| `strategy:get` | 单条 + 全部 `links` |
| `strategy:setStatus` / `strategy:delete` | 归档 / 删除（级联清执行记录） |
| `strategy:recordResult` | 效果回填，可按 `adoptionId` 或 `articleId` 写 |
| `strategy:stats` | 聚合：被采纳次数、平均分/阅读/评论，用于"哪条策略真有效" |
| `article:strategyFor` | 反查口 |
| `analysis:angles` / `angles:adopt` | 旧名兼容别名 |

## 身份隔离

`profile_id` 贯穿 `content_analysis` 与 `content_strategies`。列表过滤规则：
`profile_id = 当前身份 OR profile_id = ''`——**历史记录不隐身**，新记录按身份隔离。

## 迁移

`electron/db.cjs` 在 `exec(schema.sql)` **之前**把旧表改名让路（否则 `CREATE TABLE IF NOT EXISTS`
会跳过旧表，V2 的列永远建不出来），之后再炸开：

- `_legacy_strategies_v1`（一行一批）→ 每个 angle 一行，共享 `batch_id`；旧 `(批次, angle_index)`
  采纳按映射落到新行；被采纳行状态升 `adopted`
- `_legacy_content_angles`（P0-1a 中间态）→ 同一终点；`running/failed` 批次丢弃（没有不完整的策略）
- 迁移时调用 `normalizeDifferentiator / normalizeTrackFit / normalizeFeasibility`，
  保证库里**只有一种形状**，不留 `matches/note`、`易/中/难` 这类旧字段

## 待做

1. **策略库页**（§十二）：浏览/筛选/搜索/复用/**从策略直接开一篇新文章**；顺带收编"保存为选题"
   （选题降级为策略来源之一，不再是并列页面）
2. **效果回录入库 UI**：在「我的文章」详情里填阅读/评论/涨粉（后端与表已就绪）
3. **导出附策略摘要**、**发布前按 goal 生成检查清单**
4. `article_drafts` 仍无 `profile_id` → 「我的文章」两个账号混在一起（待决策）
5. `listAnalyses` 在 renderer 无调用方 → 刷新不恢复上次分析

## 相关实现文件

`electron/analysis.cjs`（归一化 + `buildStrategyBlock` + `buildImageStrategyHint`）、
`electron/ipc.cjs`（策略 handlers + `strategyForArticle`）、`electron/schema.sql`、`electron/db.cjs`（迁移）、
`src/skills/strategy/angle-generation/SKILL.md`（A）、`src/skills/strategy/topic-planning/SKILL.md`（B）、
`src/components/AnalysisPanel.tsx`、`src/pages/WritePage.tsx`、
`tests/unit/strategy-block.test.ts`、`tests/e2e/strategy-flow.spec.ts`
