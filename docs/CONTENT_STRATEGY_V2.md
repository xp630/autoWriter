# 内容策略系统 V2 · Strategy-Driven Workflow

> 状态：策略层后端 + 双模式入口 + 策略库页 + 效果回填录入 均已实现；导出摘要/发布清单/P2 策略评分待做
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
├── 导出       ⚠️ 后端可反查（article:strategyFor），导出未附策略摘要
├── 发布       ⚠️ 后端可反查，发布前检查清单未做
├── 效果回填   ✅ 表 + IPC + 策略详情页内联录入表单
└── 策略库     ✅ 浏览/筛选/搜索/详情/采用记录/战绩汇总/从策略重新创作
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

## 已实现（补）

- **策略库页** `src/pages/StrategiesPage.tsx`：侧栏「创作」组入口；卡片直显立意
  （要不要复用靠它，不用点详情）；模式/状态/关键词筛选走后端过滤；
  详情展开全部字段 + 采用记录 + 战绩汇总；归档/删除；「从这条重新创作」。
- **跳页交接** `src/utils/strategyHandoff.ts`：模块级一次性 consume（take 即清空）。
  WritePage 必须在**草稿恢复 effect 之后**消费，否则草稿会把策略预填洗掉。
  复用历史策略 = 再落一条 `strategy_articles`（这才是 1:N 的真实意义）。
- **效果回填录入 UI**：每条采用记录内联表单（阅读/点赞/收藏/评论/涨粉/主观分 + 备注）。
  先手动录，不等自动抓。

## 待做

1. **策略评分/推荐**（P2）：有了真实战绩才能做——按赛道统计各角度的平均评论/阅读，
   反向校正 `value_score`。例：AI 赛道下「反转观点」均评 230 vs 「教程拆解」均评 35。
2. **导出附策略摘要**、**发布前按 goal 生成检查清单**
3. 「保存为选题」仍是占位：选题应降级为策略的一个来源（`source_type='manual'`），
   与策略库合并，不再做并列页面
4. `article_drafts` 仍无 `profile_id` → 「我的文章」两个账号混在一起（待决策）
5. `listAnalyses` 在 renderer 无调用方 → 刷新不恢复上次分析
6. e2e 偶发：`articles-flow:51` 与 `dashboard-flow:29` 在 CPU 抢严重时超时（
   单跑必过），应改成等就绪而不是依赖默认 5s expect 超时

## 相关实现文件

`electron/analysis.cjs`（归一化 + `buildStrategyBlock` + `buildImageStrategyHint`）、
`electron/ipc.cjs`（策略 handlers + `strategyForArticle`）、`electron/schema.sql`、`electron/db.cjs`（迁移）、
`src/skills/strategy/angle-generation/SKILL.md`（A）、`src/skills/strategy/topic-planning/SKILL.md`（B）、
`src/components/AnalysisPanel.tsx`、`src/pages/WritePage.tsx`、`src/pages/StrategiesPage.tsx`（策略库）、
`src/utils/strategyHandoff.ts`（跳页交接）、
`tests/unit/strategy-block.test.ts`、`tests/e2e/strategy-flow.spec.ts`、`tests/e2e/strategies-library-flow.spec.ts`

---

# V3 增补：证据账成为闸门

> 触发：产品判断——"最有价值的不是标题、结构或立意，而是'你需要补充'那部分。
> 前面的字段决定想写什么，最后那部分决定这篇到底能不能成立。"

## 1. 证据账（evidence）从软提示升级为闸门

```
evidence_needed: [ { item: "官方价格", status: "ready" }, { item: "实测记录", status: "todo" } ]
```

- 每条证据带状态，**成立度 = ready / total**，是策略的一等指标（列表徽标、详情、卡片都有）。
- 旧数据（纯字符串数组）由迁移自动升级为 `{item, status:"todo"}`。
- **没确认过的就是没素材**：旧数据一律算 `todo`，不做乐观假设。
- 用户在界面上勾选，写回 `strategy:setEvidenceStatus`；成立度变化会**跨视图一致**（列表徽标同步）。

## 2. 同一份清单同时管"能写什么"和"不能编什么"

`buildStrategyBlock` 把证据拆成两段下发：

- `ready` → "用户已提供的证据，可以直接写进正文"
- `todo` → "正文里必须留「待补充」占位，绝对不得臆造"

这把 §七 的 B 模式反幻觉约束和 §十三 的数据资产连上了：勾上越多，AI 越能写实。

## 3. fact_risk 由成立度推导（不再只靠模型自报）

| 情况 | fact_risk |
|---|---|
| 证据全备齐 | `low` |
| 列了证据但一条没备 | `high` |
| 部分备齐 | `medium` |
| 没列证据 | B→`medium`，A→`low` |

模型显式给了值则以它为准。`high` 时追加更强约束（定量表述一律占位）。

## 4. thesis / insight 拆分

`core_point` 即 **thesis（主张，全文要证明的那句判断）**；新增 `insight`（**独特洞察，读者带走的那一句**）。
分开的理由：主张可以正确但毫无价值（"AI 越来越便宜"谁都同意），洞察才是这篇值得读的原因。
提示词要求两者不得同义反复，并强制"结尾前把洞察说成一句可被复述的话"。

## 5. narrative 四拍叙事骨架

`{hook, explanation, framework, action}` 取代自由 `structure[]`：
可复用、可比价的模板，而不是"一篇一篇的散文"。

- 双向兼容：只有 `structure` 时按下标归成四拍（超出部分并入 `action`，不丢内容）；
  只有 `narrative` 时反推出 `structure`，旧读取方（UI 列表、大纲预填）不空。
- 中文拍名（钩子/解释/框架/行动）也认。

## 6. A 模式也必须给证据

此前只有 B 要求 `evidence`。但 A 的 `differentiator.type=new_evidence` 本身就承诺了"有新证据"，
不列证据就是空头支票。现在两模式都强制产出，且 A 要把参考文里已带的证据标 `ready`。

## 7. 顺手修的真实体验缺陷

生成策略会 spawn 本地 Agent，实测 **30–90 秒**（日志里有 74360ms 的记录）。
原来只有一句静态"生成中…"，用户反馈"点了没反应"、以为按钮坏了。
现在面板里显示**实时用时**并说明"没反应不等于失败"。

## 数据迁移（V3）

`content_strategies` 补 `insight`、`narrative` 两列；`evidence_needed` 字符串形状升级为对象形状；
只有 `structure` 的旧策略按下标反推四拍。全部在 `electron/db.cjs` 的 `ensureCols` 分支里，
旧库启动即完成，失败只 warn 不阻塞启动。
