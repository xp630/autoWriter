# Autonomous Content Observer V1 技术方案与选型

> **Status: Draft · Phase 1**
> 定稿日期：2026-09-09（owner 定）
> Positioning: **先验证 Opportunity 判断价值，再建设自动感知能力**
> Core Principle: **最小技术成本验证核心变量，不为未来 Operator 提前建设基础设施。**
> 配套产品定义：`docs/AUTONOMOUS_CONTENT_OBSERVER.md` ｜ 长期愿景：`docs/AUTONOMOUS_CONTENT_OPERATOR_VISION.md`

---

## 1. 技术目标

Observer V1 的技术目标不是构建一个完整的 Autonomous Agent Runtime。

只验证一个核心问题：

> **用户主动提供一个外部 Signal 后，AI 能否将其转化为一个真正值得用户继续关注的 Opportunity。**

最小闭环：

```text
User → Signal → Observer Agent → Opportunity → Human Decision → Observation / Thinking / Creation
```

当前技术实现必须服务于这个闭环。

---

## 2. 非目标

V1 明确不建设：

```text
❌ 24/7 Agent Runtime     ❌ Scheduler              ❌ Event Bus
❌ RSS 自动抓取           ❌ 全网 Crawler            ❌ 自动热点发现
❌ Autonomous Research    ❌ 自动选题                ❌ 自动确认 Viewpoint
❌ 自动写长文             ❌ 自动发布                ❌ 自动修改已发布内容
❌ 自动策略调整           ❌ Belief Learning Engine  ❌ Reward Model
❌ 多 Agent               ❌ 独立 Agent 微服务
```

这些均属于后续阶段。

---

## 3. V1 核心架构

```text
┌───────────────────────────────────────────────┐
│                 AutoWriter UI                 │
│   Signal Input / Opportunity Review /         │
│   Human Decision                              │
└───────────────────────┬───────────────────────┘
                        ↓
┌───────────────────────────────────────────────┐
│             Observer Application              │
│   Signal Ingestion / Observer Orchestration / │
│   Result Validation / Decision Persistence    │
└───────────────────────┬───────────────────────┘
                        ↓
┌───────────────────────────────────────────────┐
│              Existing AI Layer                │
│   Existing pi / Agent capability              │
│   Content Observer Skill                      │
└───────────────────────┬───────────────────────┘
                        ↓
                   LLM Provider
                        ↓
┌───────────────────────────────────────────────┐
│             Existing Data Layer               │
│   Signal / Opportunity / Decision Record /    │
│   Observation                                 │
└───────────────────────────────────────────────┘
```

核心原则：

> **Observer 是 AutoWriter 的一个能力，而不是一个新的独立产品或服务。**

---

## 4. 技术选型结论

### 4.1 Agent Runtime：复用现有能力

**选择**：复用当前已经集成的 pi / Agent 能力。

**原因**：Observer V1 的调用模式是

```text
一次输入 → 一次分析 → 一次结构化输出 → 用户决策
```

并不存在复杂的多轮自主规划 / 长期 Session / 复杂 Tool Loop / Sub-Agent / Durable Execution。因此没有必要为 Observer V1 引入新的 Agent Framework。

**不选择**：`LangGraph`、`DSH`、自建 Agent Runtime、独立 Agent Service。

不是这些技术不好，而是：

> **它们解决的问题超出了 V1 的验证范围。**

---

## 5. 为什么暂时不选择 DSH

DSH 可以作为未来 Autonomous Operator 的候选 Runtime。但当前 V1 不需要 Goal Runtime / Plugin Runtime / Scheduler / 复杂 Session / 长期 Agent Loop / 多工具自主编排。

因此：

> **DSH 当前属于技术观察对象，而不是 V1 依赖。**

以后进入 Operator Phase，再重新评估。（评估记录见 2026-09-09：能力覆盖充分——`ctx.tools` / `ctx.skills` / `ctx.sessionProjections` / `agent/turn-stopping` / SDK JSON-RPC；不选的原因是 v0.1 成熟度、Cordis 学习曲线、桌面安装路径与打包成本，不是能力不足。）

---

## 6. 为什么暂时不选择 LangGraph

LangGraph 适用于更复杂的 Stateful Workflow / Long-running Agent / Durable Execution / Human-in-the-loop / 复杂状态机。Observer V1 没有这些实际需求。

引入它会增加 Runtime / State Graph / Checkpoint / Persistence / Deployment——而这些都不是当前验证变量。

---

## 7. Skill 设计

Observer 使用独立 Skill：

```text
skills/
└── content-observer/
    └── SKILL.md
```

Skill 的职责：

> **定义 Observer 如何判断一个 Signal 是否可能构成值得用户关注的 Opportunity。**

Skill 不定义固定 Workflow。

### 7.1 Skill 输入

```text
Signal + Account Context + Relevant Existing Content
```

其中 Account Context 可以来自现有 AutoWriter 数据：账号定位、目标受众、近期内容、已有 Observation。

但**只读取与判断相关的最小上下文**。

### 7.2 Skill 行为约束

```text
你不是作者。
你不是账号运营者。
你不是用户。

你是 Content Observer。

你的职责：
1. 理解输入 Signal。
2. 判断它是否可能值得用户关注。
3. 解释为什么。
4. 指出缺失背景。
5. 指出可能风险。
6. 将最终决定权交还给用户。
```

禁止：

```text
自行确认用户观点      自行创造用户经历        把推测写成事实
强迫用户继续深入      为了输出完整而制造问题   提供没有依据的精确成功概率
```

允许：`WAIT` / `ASK_HUMAN` / `ABORT`。

---

## 8. Agent 调用模式

V1 不要求复杂 Agent Loop。调用模型：

```text
Signal
  ↓
Observer Context Builder
  ↓
Agent Session
  ↓
Content Observer Skill
  ↓
LLM
  ↓
Structured Output
  ↓
Schema Validation
  ↓
Opportunity
```

其中：

> Agent 只负责完成当前 Observer 分析任务，不负责长期自治。

---

## 9. Context 构建

Observer 不应该把整个数据库塞给 LLM。采用最小上下文原则。

```ts
interface ObserverContext {
  signal: Signal;
  account?: {
    positioning?: string;
    audience?: string;
  };
  recentContent?: Array<{
    title: string;
    summary?: string;
  }>;
  relatedObservations?: Array<{
    observation: string;
    viewpoint?: string;
  }>;
}
```

原则：

> **只给判断 Signal 所必须的上下文。**

避免把整个 Session / 整个数据库 / 所有历史文章 / 所有聊天记录灌进去，造成 Context 膨胀。

---

## 10. Signal 数据模型

```ts
interface Signal {
  id: string;
  type: "url" | "text" | "image";
  content: string;
  source?: string;
  capturedAt: string;
  metadata?: Record<string, unknown>;
}
```

Signal 来源（V1）：URL / 一句话 / 截图。**不建设自动 Signal Source。**

---

## 11. URL Signal

URL 是最重要的 V1 输入类型之一。直接复用 AutoWriter 已有 URL 内容抓取能力：

```text
URL → BrowserWindow / Existing Fetch → Readability → Normalized Content → Observer
```

不要重新建设新的网页抓取系统。标准化后的内容至少包括：

```ts
interface NormalizedUrlContent {
  title: string;
  source: string;
  content: string;
  wordCount?: number;
  url: string;
  fetchedAt: string;
}
```

---

## 12. Opportunity 数据模型

```ts
interface Opportunity {
  id: string;
  signalId: string;

  title: string;
  summary: string;
  whyWorthAttention: string;

  relevance?: string;
  timeliness?: string;
  differentiation?: string;
  audienceValue?: string;

  missingContext: string[];
  risks: string[];

  status:
    | "candidate"
    | "presented"
    | "ignored"
    | "observed"
    | "thinking"
    | "creating";

  createdAt: string;
}
```

---

## 13. 为什么不做 Opportunity Score

以下设计当前禁止：

```text
Opportunity Score = 87.4
Reading Probability = 73%   Follow Probability = 62%   Share Probability = 81%
```

原因：

> 当前样本不足，数字无法获得可靠统计意义。

V1 使用 **解释 + 依据 + 不确定性**，而不是虚假的精确数字。

---

## 14. Opportunity 输出 Schema

使用 JSON Schema / Zod 严格校验：

```ts
const ObserverResultSchema = z.object({
  title: z.string(),
  summary: z.string(),
  whyWorthAttention: z.string(),
  relevance: z.string().optional(),
  timeliness: z.string().optional(),
  differentiation: z.string().optional(),
  audienceValue: z.string().optional(),
  missingContext: z.array(z.string()),
  risks: z.array(z.string()),
  confidenceNote: z.string().optional(),
});
```

注意：`confidenceNote` 是**自然语言的不确定性说明，不是概率**。例如：

```text
目前无法判断它是否一定值得创作，
主要缺少该话题在目标读者中的实际反馈。
```

---

## 15. Human Decision

Opportunity 产生之后进入 UI，用户做四选一：

```ts
type HumanDecision =
  | "ignore"
  | "record_observation"
  | "enter_thinking"
  | "create_content";
```

```text
Opportunity
     ├── Ignore
     ├── Record Observation
     ├── Enter Thinking
     └── Create Content
```

**AI 不执行最后一步。**

---

## 16. Decision Record

V1 的关键新增数据对象：

```ts
interface DecisionRecord {
  id: string;
  opportunityId: string;
  reasoning: string;
  userDecision: "ignore" | "observe" | "think" | "create";
  createdAt: string;
}
```

其中 `reasoning` 记录：**为什么我认为这个机会值得继续。** 例如：

```text
这个话题本身未必重要，
但它和我最近正在思考的 AI + DSL 有直接联系，
而且存在我自己的实践经验可以补充。
```

---

## 17. Decision Record 的长期价值

当前不利用它做统计学习。但它为未来保留 `Decision → Action → Outcome`。

未来如果真实数据逐渐形成（`Decision Record + Publication + Metrics`），才能进一步建立 `Experiment / Attribution / Belief / Strategy`。

所以：

> **V1 只负责留下"判断痕迹"，不负责制造"学习系统"。**

---

## 18. Observation 数据衔接

如果用户选择 `record_observation`，则 `Opportunity → Observation`。

建议**复用 AutoWriter 已有 Observation 数据模型**（`observations` 表 + 观察卡流），关系为 `Signal → Opportunity → Observation`，而不是重新建立第二套内容管理系统。

---

## 19. 与现有 AutoWriter 数据体系的关系

```text
                    Signal
                       ↓
                 Opportunity
                       ↓
               Human Decision
              ┌────────┼────────┐
              ↓        ↓        ↓
           Ignore  Observation Thinking
                                 ↓
                             Viewpoint
                                 ↓
                                 EP
```

`create_content` 只是进入当前已有创作体系。Observer 本身不重新设计 Article / EP。

---

## 20. API / Service Interface

推荐新增一个最小业务接口：

```ts
interface ContentObserverService {
  analyzeSignal(input: AnalyzeSignalInput): Promise<ObserverResult>;
  recordDecision(input: RecordDecisionInput): Promise<void>;
}

interface AnalyzeSignalInput {
  type: "url" | "text" | "image";
  content: string;
}

interface ObserverResult {
  opportunity: Opportunity;
}
```

---

## 21. 调用时序

```text
User ── submit Signal ──→ ObserverService
  ├── normalize signal
  ├── build context
  ├── invoke pi/Agent
  ├── apply Observer Skill
  ├── receive structured output
  ├── validate schema
  └── persist Opportunity
        ↓
      UI ── User Decision ──→ ignore / observation / thinking / create
```

---

## 22. 异常处理

V1 至少处理：

```text
URL fetch failed        LLM timeout           LLM invalid output
Schema validation failed  DB persistence failed  Image parsing failed
```

LLM 输出非法时的处理原则：

```text
LLM → Schema Validation → FAILED → 一次自动修复 → 仍失败 → 返回用户可理解错误
```

**不要无限重试。**

---

## 23. 不确定性处理

如果 Signal 信息不足：

```text
不要补全事实。
不要编造背景。
不要直接得出结论。
```

Observer 可以返回：

```text
当前信息不足。

值得关注的可能性：……
但需要确认：……
```

然后允许 `WAIT` / `ASK_HUMAN`。

---

## 24. Security / Permission

V1 没有自动发布能力，因此权限模型可以保持简单。

只允许：`READ existing data` / `CREATE Opportunity` / `CREATE Decision Record` / `CREATE Observation`

不允许：`PUBLISH` / `DELETE_PUBLISHED_CONTENT` / `CHANGE_ACCOUNT` / `CHANGE_STRATEGY` / `SPEND_MONEY`

---

## 25. Logging

V1 应记录：

```ts
interface ObserverInvocationLog {
  id: string;
  signalId: string;
  model?: string;
  startedAt: string;
  completedAt?: string;
  status: "success" | "failed";
  errorCode?: string;
}
```

不要记录无必要的完整敏感 Prompt / 上下文副本。

---

## 26. 成本控制

V1 的成本控制原则：

```text
一次 Signal → 一次 Observer 调用
```

避免：多 Agent / 多轮自主搜索 / 无限 Tool Loop / 自动后台轮询。

如果后续发现一次调用不足，再增加 Research Loop——**而不是预先实现**。

---

## 27. 测试策略

V1 测试重点不是"AI 写得漂不漂亮"，而是：

| 测试类 | 验什么 |
|---|---|
| **Schema Test** | 输出结构稳定 |
| **Boundary Test** | AI 是否越权：不能自动确认观点、不能伪造经历、不能生成虚假数字、不能替用户做最终决策 |
| **Quality Test** | 人工准备一组真实 Signal（明显值得关注 / 可能值得关注 / 无关内容 / 噪音 / 信息不足），比较 AI 是否能正确区分 |

---

## 28. V1 验证实验

时间：约两周。输入：用户手工提供 Signal。统计：`Signals / Opportunities / Human Decisions`。

最关键指标：

```text
Opportunity Adoption Rate（机会采纳率）
=
被用户采纳的 Opportunity（record_observation / enter_thinking / create_content）
/
被 AI 提出的 Opportunity
```

不追求统计显著性。它只是一个产品反馈指标。

---

## 29. 如何根据结果决定下一步

**Adoption 高** → AI 给出的机会入口确实有价值。下一步验证 `自动 Signal Source`：RSS / 新闻源 / 同类账号 / 热点 API / Scheduler / Event System。

**Adoption 低** → **不要立刻增加更多信息源**。首先检查：Opportunity 定义、判断标准、上下文质量、AI 输出方式。因为：

> **入口本身没有价值时，更多入口不会解决问题。**

---

## 30. 技术演进路线

```text
Phase 1  Observer
  手工 Signal · 一次分析 · Opportunity · Human Decision · Decision Record

Phase 2  Decision Assistant
  真实 Outcome · Evidence · Attribution · Experiment · Belief

Phase 3  Autonomous Operator
  Automatic Signal · Scheduler · Event Bus · Agent Loop · Strategy
  Tool Runtime · Policy · 24/7 Execution
```

技术架构随着验证结果演进，而不是一次性实现终局。

---

## 31. 当前技术栈建议

保持现有 AutoWriter 技术栈。

**新增**：

```text
Observer Service · Observer Skill
Signal Schema · Opportunity Schema · Decision Record Schema
Zod / JSON Schema Validation
```

**复用**：

```text
Existing pi / Agent integration     Existing LLM provider
Existing URL fetch / Readability    Existing database
Existing Observation / Viewpoint / EP system
Existing task / error handling infrastructure
```

**暂不新增**：

```text
LangGraph   DSH   独立 Agent Runtime   独立 Agent Service
Redis   Kafka   Event Bus   Scheduler   Crawler Infrastructure
MCP Layer   Vector Database
```

---

## 32. 最终技术原则

```text
        Human
          │  手工提供 Signal
          ↓
      Observer Agent
          │  Opportunity
          ↓
      Human Decide
          ↓
  Observation / Thinking / Create
```

技术实现只围绕这一条链服务。

> **先验证 Opportunity 是否有价值，再验证自动感知是否有价值；先验证产品闭环，再建设 Agent 基础设施。**

这是 Autonomous Content Observer V1 的核心技术决策。
