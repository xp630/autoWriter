# Roadmap · Observer V1（2026-09-09 定）

> 两条线：**产品是主线，技术是仆人**。
> 闸门规则：**连续两周没有服务过一次真实发布的工程项 → 冻结。**

---

## 一、产品路线

| 优先级 | 内容 | 节奏 | 判据 |
|---|---|---|---|
| **P0** | **Season 2 出版**（`AUTOWRITER_SEASON_2.md`）。第一个交付：**EP00 序章《扫盲：DSL 到底是什么？》**——它不依赖任何开发进展，现在就能写 | 双周一篇 | 发出去 + 记录转发 |
| **P1** | **Observer 两周手工实验**：手工喂 Signal → AI 出机会判断 → 四选一。每条 Decision Record 本身就是一张观察卡 | 与 P0 并行，每天 ≤5 分钟 | Opportunity Adoption Rate |
| **P2** | Phase 2 Decision Assistant | **条件驱动，不排日期** | "真实数据开始形成形状" |
| **P3** | Phase 3 Autonomous Operator | **愿景，不进 Roadmap** | 6 个前置条件齐全 |

Season 2 硬纪律：**没有事实的一集不发**（EP04 前必须先有能跑的 Parser，EP08 前必须先有对比数据）。

## 二、技术路线

### T0 · 本周（已完成 2026-09-09）

修现行数据破坏 bug：`db.cjs` 的「观察卡/EP 分离迁移」没有一次性闸门，每次启动把 EP 的
`observation/question/insight` 抄成假观察卡再清空原字段（`card:grow` 正常写这三列 → 每次重启都被剥一层）。

- `PRAGMA user_version` 水位：迁移跑过即永久跳过
- 新增 `episodes.intent` 存「本集命题」——**不能再用 `question`**，那是迁移作用域
- 真实库清理：删 11 张假卡 + 2 张重复卡，恢复 Season 2 的 11 条命题
- 回归：`tests/e2e/migration-idempotency.spec.ts`（同一 userData 重启两次；已验证撤掉闸门即红）

### T1 · Observer V1（≤4 天，按 `AUTONOMOUS_CONTENT_OBSERVER_TECH.md`）

| 步 | 内容 |
|---|---|
| 1 | `src/skills/content-observer/SKILL.md`：Role / 禁止 / 允许 WAIT·ASK_HUMAN·ABORT / 输出 schema |
| 2 | `observer:analyze` IPC —— **复用现有 runAgent 一次性调用**，不新建 runtime |
| 3 | 数据：`signals` + `opportunities` + `decision_records`；Observation **复用现有 `observations` 表** |
| 4 | UI：「新的外部信号」卡 + 四选一（忽略 / 记观察 / 进入思考 / 决定创作） |
| 5 | 测试：Schema Test + Boundary Test（不许自动确认观点 / 不许造经历 / 不许出假概率）+ Quality Test |

V1 明确不做：Scheduler、RSS、向量库、新 Agent Runtime、Event Bus、自动发布。

### T2 · 挂起（等触发条件，不排期）

| 项 | 重新启动的条件 |
|---|---|
| 访谈「聊天式引导 + 一次性收集 + 发散」 | Season 2 前 3 集发完，且真机用过 ≥5 次访谈 |
| pi SDK + Extension（A-full）/ dsh 基座 | 出现**第二个**需复用 runtime 的真实 Skill |
| 流式输出 | 模型方支持 delta 或改走 SDK；不单独立项 |
| 公众号自动发布 | Phase 3；当前不是验证变量 |

### T3 · 零碎缺口（各 <30 分钟，按需插队）

观察卡原句编辑框 · 卡长成 EP 可喂进已有计划位 · 解释图本地排版

## 三、指标

- **产品**：转发（唯一，n<20 不加任何评分/排行）
- **Observer**：`Opportunity Adoption Rate` = 被采纳机会 / AI 提出机会；V1 只记 `presented` / `accepted`，不做统计显著性

## 四、四句话原则（照抄自技术文档 §32）

```text
先手工喂，再决定系统要不要帮。
AI 提供机会，不替人决定观点。
真实反馈优先于模型想象。
没有验证需求，不提前建设基础设施。
```
