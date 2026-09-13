# Autonomous Content Observer V1 技术设计

> **Status: Current Product · Phase 1**
> 定稿日期：2026-09-09（owner 定）
> Principle: **先手工喂信号，再验证机会判断；不提前建设自动感知基础设施。**
> 长期愿景（Phase 3，不进当前 Roadmap）：`docs/AUTONOMOUS_CONTENT_OPERATOR_VISION.md`

---

## 1. 背景

产品长期愿景是：

> 一个 24 小时运行、能够长期替用户经营内容账号的 AI Operator。

长期来看，Agent 应能够持续观察外部环境、自主发现内容机会、决策、执行、获取反馈并调整策略。

但当前阶段不直接实现 Autonomous Content Operator。原因有三：

1. **反馈燃料不足**：当前账号处于早期阶段，缺乏足够真实数据，无法支撑 Belief、Experiment、Strategy 等统计和学习机制。
2. **人的判断仍然是产品差异点**：账号内容的核心仍然依赖用户自己的经历、判断、观点和角度，不能让 AI 自主取代这一部分。
3. **平台执行能力不是当前验证变量**：公众号自动发布等平台能力存在边界，即使能够技术实现，也不代表当前产品价值已经得到验证。

因此当前只建设：

> **Autonomous Content Observer**

Observer 的职责不是替用户创作和运营，而是：

> **持续或按需接收外部 Signal，将其转化为值得用户关注的 Content Opportunity，并把决策交还给用户。**

---

## 2. 产品边界

### 2.1 当前阶段做什么

```text
Signal
  ↓
Opportunity Analysis
  ↓
为什么值得关注
  ↓
缺少哪些背景
  ↓
Human Decision
```

用户最终决定：

```text
忽略   记录观察   进入思考   决定创作
```

### 2.2 当前阶段不做什么

Observer V1 明确不做：

```text
❌ 自动发现外部热点        ❌ RSS 自动抓取          ❌ 定时任务
❌ 24/7 后台运行           ❌ 自动选定观点           ❌ 自动决定文章角度
❌ 自动写长文              ❌ 自动发布               ❌ 自动修改已发布内容
❌ 自动调整账号策略        ❌ 自动根据小样本做评分/排行
❌ 自动根据数据训练"账号认知"
```

这些能力属于未来 Operator 阶段，不属于当前 Roadmap。

---

## 3. 核心设计原则

### 3.1 先手工喂，再决定系统要不要帮

当前 Observer 不主动建立外部感知基础设施。用户主动提供：

```text
链接   一句话   截图   一段新闻   一条社交媒体内容   一个观察到的现象
```

系统负责分析。验证成立后，再建设自动感知层。

### 3.2 Observer 只负责提供入口，不负责替用户完成判断

AI 的输出应该是：

> "这件事情为什么值得你看。"

而不是：

> "你应该写这篇文章。"

后者属于用户自己的判断。

### 3.3 不制造伪确定性

当前账号数据量不足时：

```text
不做排名   不做统计显著性判断   不输出虚假的成功概率   不根据少量样本生成精确评分
```

尤其不能出现"阅读潜力：82%""涨粉概率：74%"这类没有充分证据支撑的数字。

### 3.4 允许"不值得继续"

Observer 必须允许 `IGNORE / WAIT / ABORT`。它不需要为了"给出答案"而强行制造机会。

---

## 4. 核心领域模型

Observer V1 只有四个核心对象：

```text
Signal → Opportunity → Observation → Human Decision
```

### 4.1 Signal

Signal 是用户观察到的外部输入。来源可以是 URL / Text / Screenshot / News / Social Post / User Observation。

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

Signal 只是事实输入，**不代表它一定具有内容价值**。

---

## 5. Opportunity

Opportunity 是 AI 对 Signal 的一次判断：

> "这件事情可能值得这个用户继续关注。"

Opportunity 不是 Topic，也不是 Article。它属于**内容机会判断层**。

```ts
interface Opportunity {
  id: string;
  signalId: string;

  summary: string;

  relevance?: string;
  timeliness?: string;
  differentiation?: string;
  audienceValue?: string;
  strategicRelevance?: string;

  whyWorthAttention: string;

  missingContext: string[];

  risks?: string[];

  status:
    | "candidate"
    | "presented"
    | "ignored"
    | "observed"
    | "thinking"
    | "creating";
}
```

### 注意

V1 中这些字段主要用于**解释判断过程**，不是用于生成综合评分。

例如 `relevance = 高 / timeliness = 高 / differentiation = 尚不明确` 可以作为决策依据，但**不转换成 `Opportunity Score = 87.4`**。

---

## 6. Observation

当用户认为一个 Opportunity 值得记录时，将其转化为 Observation。Observation 属于用户自己的内容资产。

```ts
interface Observation {
  id: string;
  sourceSignalId?: string;
  opportunityId?: string;
  observation: string;
  viewpoint?: string;
  unresolved?: string[];
  createdAt: string;
}
```

其中 `observation` 描述"我看到了什么"，`viewpoint` 描述"我怎么理解它"。

V1 中**不要让 AI 自动把 Opportunity 直接升级成用户 Viewpoint**。Viewpoint 必须来自用户确认。

---

## 7. Human Decision

Observer 的终点不是 Article，而是 Human Decision。

```ts
type HumanDecision =
  | "ignore"
  | "record_observation"
  | "enter_thinking"
  | "create_content";
```

对应：

```text
IGNORE             → 不再处理
RECORD_OBSERVATION → 保存为观察
ENTER_THINKING     → 进入后续思考流程
CREATE_CONTENT     → 进入当前创作流程
```

---

## 8. Decision Record

Observer V1 不采用复杂 Prediction Model。当前只记录：

> **我为什么认为这个机会值得做。**

这是一个 Decision Record。

```ts
interface DecisionRecord {
  id: string;
  opportunityId: string;
  reasoning: string;
  expectedValue?: string;
  constraints?: string[];
  createdAt: string;
  userDecision: "ignore" | "observe" | "think" | "create";
}
```

重点是 `reasoning`，**不是** `predictedRead = 8200 / predictedShares = 100 / predictedFollowers = 50`——因为当前样本不足，数字预测会制造伪确定感。

例：

```text
选题：AI + DSL
我的判断：可能有较强分享价值
我的依据：
  1. 最近 AI Coding 讨论集中在代码生成
  2. DSL 能提供另一种结构化表达路径
  3. 我自己已经有真实原型
预测：我认为"为什么 AI + Code 还不够"这个切口更值得写
```

---

## 9. Observer V1 主流程

```text
                User
                 │
          输入一个 Signal
                 ↓
        ┌─────────────────┐
        │ Signal Ingestion │
        └────────┬────────┘
                 ↓
        ┌─────────────────┐
        │ Opportunity      │
        │ Analysis         │
        └────────┬────────┘
                 ↓
       ┌─────────────────────┐
       │ 为什么值得关注？     │
       │ 缺哪些背景？         │
       │ 有什么风险？         │
       └──────────┬──────────┘
                  ↓
             Human Decision
           ┌──────┼───────┐
           ↓      ↓       ↓
         Ignore Observe Think/Create
```

---

## 10. 单次调用模型

V1 只要求：

```text
一次输入 + 一次 Agent 调用 + 一次机会分析 + 一次用户决策
```

不做：

```text
持续 Agent Loop   多轮自主 Research   后台 Scheduler   自动唤醒   长期 Autonomous Session
```

这样可以保证当前阶段成本最小。

---

## 11. Agent Role

当前 Agent 不是 Operator，而是：

> **Opportunity Analyst**

它的职责：

1. 理解 Signal。
2. 判断与账号的相关性。
3. 判断是否存在值得继续观察的内容机会。
4. 解释为什么值得关注。
5. 指出当前缺失的背景信息。
6. 识别明显风险。
7. 将决定权交给用户。

它不负责：

```text
决定最终观点   决定最终文章角度   决定是否发布
```

---

## 12. Agent Prompt / Skill 边界

Observer 使用一个独立 Skill：

```text
skills/
└── content-observer/
    └── SKILL.md
```

Skill 的核心原则：

```text
你不是作者。
你是机会观察者。

你的任务不是替用户决定写什么，
而是帮助用户识别：
"这个外部信号是否值得我继续关注？"

禁止：
- 自行确认用户观点
- 为用户发明经历
- 将猜测表达为事实
- 使用无数据支撑的精确概率
- 为了填满输出而强行制造问题
- 强迫用户继续深挖

允许：
- WAIT
- ASK_HUMAN
- ABORT

最终判断权属于用户。
```

---

## 13. Tool 边界

Observer V1 不建设复杂 Tool Runtime。最小 Tool 集合：

```text
parse_signal()        fetch_url_content()     analyze_signal()
save_opportunity()    save_decision()         save_observation()
```

其中 `fetch_url_content()` 可以复用 AutoWriter 已有的 URL 抓取能力。

不新增：

```text
RSS   Crawler   Scheduler   Search Infrastructure   WeChat Publisher   Analytics API
```

这些属于未来阶段。

---

## 14. UI 设计

Observer UI 不应该表现成"AI 写作助手"。推荐结构：

```text
┌────────────────────────────────────────┐
│ 新的外部信号                           │
│                                        │
│ [ 粘贴链接 / 输入一句话 / 上传截图 ]    │
│                                        │
│               [分析]                   │
└────────────────────────────────────────┘

                 ↓

┌────────────────────────────────────────┐
│ 可能值得关注                           │
│                                        │
│ 为什么值得看                           │
│ ……                                     │
│                                        │
│ 还缺哪些背景                           │
│ ……                                     │
│                                        │
│ 可能的风险                             │
│ ……                                     │
│                                        │
│ [忽略] [记观察] [进入思考] [决定创作]   │
└────────────────────────────────────────┘
```

核心体验：

> **把外部信息变成一个值得用户判断的入口。**

---

## 15. Opportunity Adoption Rate

Observer V1 的核心验证指标不是 AI 分析次数、AI 输出长度、Opportunity 数量，而是：

> **Opportunity Adoption Rate（机会采纳率）**

```text
Opportunity Adoption Rate
=
被用户实际采纳的 Opportunity
/
AI 提出的 Opportunity
```

"采纳"包含：记录观察、进入思考、决定创作。

第一阶段甚至不需要做复杂统计，只需记录：

```text
opportunity.presented
opportunity.accepted
```

---

## 16. 两周实验

实验周期：约两周。输入方式：用户主动手工提供 Signal。

只观察一个核心问题：

> **AI 给出的入口，我真的会用吗？**

**情况 A：使用率高** → 说明 Opportunity 判断具有实际价值。下一步才值得建设：RSS / 新闻源 / 同类账号 / 自动监测 / Scheduler / Event System。即自动感知层开始有真实需求依据。

**情况 B：使用率低** → **不要继续增加数据源**。应该首先重新审视：什么叫 Opportunity？什么信息真正值得用户关注？AI 判断是否符合用户真实工作方式？

结论：

> **入口判断问题 > 信息源数量问题。**

---

## 17. 与长期 Operator 的关系

Observer 是 Operator 的 Phase 1，**而不是 Operator 的缩水版**。

```text
Phase 1  Observer            只观察、提机会、交还判断
        ↓
Phase 2  Decision Assistant  积累 Decision Record + Outcome
        ↓
Phase 3  Autonomous Operator 在真实反馈和明确权限基础上自主行动
```

---

## 18. Phase 2：Decision Assistant

触发条件不是固定时间，而是：

> **真实数据开始形成形状。**

届时可以逐渐增加：`Decision Record / Outcome / Evidence / Attribution / Experiment / Belief`。

但必须建立在真实数据上。不提前制造：`Belief Score / Success Probability / Content Ranking / Strategy Score`。

---

## 19. Phase 3：Autonomous Operator

最终愿景闭环：

```text
Goal → Observe → Opportunity → Decision → Action
     → Outcome → Attribution → Learning → Strategy → 下一次 Decision
```

但 Operator 必须满足：

```text
有真实反馈 + 有长期状态 + 有明确权限 + 有资源约束 + 有稳定平台能力 + 有可靠的人类边界
```

在这些条件成立之前，不进入 Phase 3。

---

## 20. 当前架构

V1 推荐保持极简：

```text
┌──────────────────────────────┐
│          AutoWriter UI       │
└───────────────┬──────────────┘
                ↓
┌──────────────────────────────┐
│      Observer Application    │
│  Signal Ingestion            │
│  Opportunity Analysis        │
│  Human Decision              │
│  Decision Record             │
└───────────────┬──────────────┘
                ↓
        Existing Data Layer
                │
        ┌───────┼────────┐
        ↓       ↓        ↓
     Signal  Opportunity Observation
```

AI Runtime 可以复用现有 Agent/LLM 能力，但：

> **不为了 Observer V1 新建独立 Agent Runtime。**

---

## 21. 当前不解决的问题

以下全部明确延期（它们属于未来 Operator，而不是当前验证变量）：

```text
1. 自动热点发现        2. 24/7 Scheduler        3. Event Bus
4. 自动发布            5. 自动策略调整          6. Belief Learning
7. Reward Model        8. 多 Agent              9. Autonomous Research
10. 自动商业化
```

---

## 22. 验证结论

Observer V1 的成功标准非常简单：

> **当 AI 把一个外部 Signal 转化成"值得我继续关注的入口"时，我是否真的愿意基于这个入口继续行动？**

如果答案是"是"，才继续投资自动感知。

如果答案是"否"，就继续优化：

> **什么样的 Signal，经过什么样的判断，才能成为真正值得用户关注的 Opportunity。**

---

## 23. 当前产品原则

```text
先手工喂，再决定系统要不要帮。
AI 提供机会，不替人决定观点。
真实反馈优先于模型想象。
没有验证需求，不提前建设基础设施。
```

这四句话构成 Autonomous Content Observer V1 的技术与产品边界。
