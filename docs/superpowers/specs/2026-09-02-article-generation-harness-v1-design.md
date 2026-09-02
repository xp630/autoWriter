# Article Generation Harness V1 · 设计规格（C 期）

Date: 2026-09-02 · Status: 待用户审阅 · 来源: brainstorming（superpowers v6.2.0），7 问全裁
对象: 与 `2026-09-02-ep-article-conversion-v1-design.md`（A+B 期 spec）配套的 C 期 spec。
定位: **Harness 是流水线的控制层，不是新模块**——EP=Source of Truth，Plan=Editorial Decision，Harness=Execution Boundary。

---

## 1. 宪法条文

> **AI 可以自由表达，但不能自由创造事实。**
> **Generator 只负责写，Validator 负责怀疑，人负责最终裁决。**
> **AI 可以替你表达感受，但不能替你增加发生过的事情。**
> **人可以覆盖 Harness，但覆盖是局部的，不改变 Harness 本身。**

## 2. 定位与架构

```
Article Plan → [ Harness: 事实包组装 → 语态规则 → 出口校验 ] → AI 写作 → Claim 对账 → PASS / REVIEW
Entry: 独立 CLI（aw-harness）+ 纯函数共享核心（harness-core）
App / MCP 未来 = 入口适配层；规则只有 core 一份，永不漂移
```

责任表：

| 环节 | 人 | AI |
|---|---|---|
| Observation | ✅ | 辅助 |
| Idea Interview | 回答 | 采访 |
| EP | 确认 | 抽取 |
| Evidence | 确认事实 | 分类/绑定 |
| Angle | 选择 | 提案 |
| Core Conflict | 确认 | 提案 |
| Article Plan | 确认 | 组织 |
| Article | 审核 | 生成 |
| Evidence Check | 最终裁决 | 自动检查 |

## 3. 幻觉防御 · 三层结构（依次都是失效安全带）

1. **素材层**：EP 活档案 + 五档 kind + source_message_ids 出处链 + pending/confirmed。能说的"谎"在入库前死。
2. **事中·Fact Pack 封闭世界**：生成输入只含 Plan 四件套 + chosen judgment + 被圈定 evidence（带 kind）+ 已确认 EP 槽位文本；**其余库内容与模型记忆一律不可达**。External agent 只给 `get_fact_pack(plan_id)`，不给万能查库口。
3. **事后·Claim 对账**（Harness 的执法核心，prompt 规则仅是附属）：
   - 逐句切分（确定性代码降熵，不做摘要）
   - 特征 → 候选证据圈定 → LLM 判 supported/unsupported/conflict（只有提名权）
   - 凡 unsupported/conflict → REVIEW 队列，原文句与证据原文并排呈人——**定罪权在人**

## 4. Claim 边界（三区）

- **A. Evidence-bound Claim**：任何引入可验证世界状态的陈述 → 必须有 Evidence；对不上 = REVIEW。
  五类：数字/量（逐字对账）、事件与时序、他人动机/心理（speculation + 第一人称推测句式）、外部世界事实（引用或删）、比较/因果断言。
  **规则修正**：因果/比较不因贴上 judgment 标签就放行——校验对象是"证据是否支撑它声称的关系"。judgment 不是免死金牌。
- **B. Free Expression**：不改变世界状态的表达变化（衔接、复述已背书内容的句式变形）→ 免检。
- **C. Subjective Expression**：作者自己的即时心理/感受/态度/思考 → 默认放行；**一旦引入可验证动作/时间/数量/外部事件，升级为 Claim**。判定标准=是否引入可被追问"何时何地"的新事件（"我有点兴奋"放行；"我盯着看了很久"REVIEW；"我截图了"REVIEW）。

**红旗特征表是风险提示器，不是最终判定器**：
```
Claim Detection → Feature Flags → Evidence Matching → Decision(PASS/REVIEW)
```
（"我后来越来越不确定"无红旗词仍是 claim；"我看了一个数字"有数字但只是引用 = PASS。）

## 5. 生成策略

- **整篇一次生成**（保"一口气"文风，防分段接缝 AI 味）；C 期槽位只作 **Narrative Hints**（可用叙事资源：available_material / possible_tension / possible_progression），**不是规定结构**，生成器可不采用——防模板化写作。
- **Validator 独立于 Generator**：生成器永不输出自背书 claim ref，也永不预知"这句会不会 PASS"——绑定只出自第三方校验器（自我报告的可信度恒为零）。
- **审计粒度默认句级；重写粒度按最小必要升级，由人指定，不自动升级**：
  ```
  改句 → 句+前后句 → 整段重写 →（仍不自然）人自己写
  ```
  Harness 可报"这句有问题"，但**不能替人判断"那扩大到整段吧"**——重写范围是人的意图，不是 AI 的判断结果。

## 6. 对账与裁决流程（终端优先）

```
generate → review/<plan>-draft.md
          正文逐句标记：🟢 PASS / 🟡 REVIEW / 🔴 UNSUPPORTED
          文末待裁清单（句子原文 → 候选证据 id+kind → 建议处置）
用户："3删 5改推测 1放"
Harness 执行改写 → 只重检受影响区域 → 收敛
```

四种终态（Claim 状态机）：

| 状态 | 含义 | 后续 |
|---|---|---|
| PASS | 有 Evidence 背书 | 入稿 |
| HUMAN_OVERRIDE | 人裁放行（局部，本稿本句持久） | 入稿；**≠ 写进事实库**——是"允许这句话出现"，不是"这句话成为世界记录" |
| HUMAN_AUTHORED | 人笔（人自己写的句子） | 入稿；**责任转移，不是 Evidence**；Harness 不再自动改写；免再审计（作者即事实源） |
| UNRESOLVED | 未决 | 见出口 2 |

- 放行权**单句级**：`1 放` = 这一句在这篇里的豁免，**不产生模式级豁免**。（同一句后续复检不得再举——override 按 draft_id+句哈希 记账。）

## 7. Fact Pack（乙案）

```
fact_pack(plan_id) = {
  plan      : reader_question / core_conflict / discussion_scope / scope_excludes
  spine     : chosen judgment + 其 supporting evidence 列表（结论与支撑同给，禁止模型发明支撑配结论）
  confirmed   : EP 已确认槽位文本（event/reaction/development/shift/unknown）—— 已经人确认的压缩叙事，与证据共享出处
  evidence  : Plan 圈定条目 {id, kind, 原文, date?}
  unknowns  : 双重角色——禁止 AI 替作者回答 + 作者可主动声明"不知道"（文章的合法内容）
  timeline  : 被选 fact 的先后；无日期依据 = 写"顺序未知"，禁止 AI 自行排序
  names     : 实体称谓表（"一个陌生人"——禁止 AI 补性别/身份/职业）
  voice     : 五档语态表（引用同一真值文件）
  FORBIDDEN : 表外世界状态 / 表外数字 / 替他人下定论 / 回答问题 unknowns
}
```

**绝不进入 pack**：未选中的其他 judgment（防论文漂移）、`[待确认]` pending 槽（未经人手）、未被 Plan 圈定的 evidence 条目。

## 8. 形态与目录

```
harness/
  core/            ← 纯函数：claim.js / evidence.js / validation.js（无 Electron / 无 IO / 纯 Node）
  voice.json       ← kind→语态映射真值（生成 prompt 与校验器同读，防两处漂移）
  flags.json       ← 红旗特征表真值
scripts/harness.mjs ← CLI 入口：generate / dry-audit / audit / rewrite / finalize（orchestration only，零规则）
review/*.md        ← .gitignore（未发布草稿与裁决过程，不进仓库）
```

- CLI 只负责：读参/调 CLI/调 core/写产物。**CLI 不得实现任何校验规则**（规则只在 core/voice/flags）。
- 入口：`aw-harness generate <planId>` / `dry-audit <planId>` / `audit <draft>` / `rewrite <draft> <target> --scope sentence|neighbor|paragraph` / `finalize <draft>`
- rewrite 的 scope=人已指定的范围，CLI 不判断范围；复用 `resolveCli` 找 claude；重写三次失败 → 提示升级或人工接管。

## 9. 失败出口

1. **前置 dry-audit（先审素材，再生成文章）**：圈定 fact < 3、core_conflict 找不到支撑端点、judgment 无证据回链 → 报"素材不足，回去聊 EP"，**不生成**——素材薄是 REVIEW 轰炸的根因，最便宜的失败是别进场。
2. **finalize 健康证书（V1 标配）**：

```
句数 42 | 🟢背书 35 | 🟡人裁放行 4 | ✍️人笔 2 | 🔴未决 0
```

   UNRESOLVED > 0 → 默认禁 finalize；`--force` 可发但留案底"⚠️ N 条未决带病定稿"。
3. **人笔占比健康指标**：≤20% 正常；>20% ⚠️"人工接管比例偏高"——建议回炉 Fact Pack/Plan/Harness，**只报警不拦发布**（有些文章天然需要作者大量补声）。

## 10. V1 边界

不做：Review 图形 UI（终端对账报告即界面）；review_decisions 决策表（V1 不反哺规则，留真实案例给 V2）；MCP 适配（V2，core 不动即可换皮）；模式级放行；生成器自背书。align with A+B spec §7。

## 11. 与 A+B 的一致性回填（C 反推出的数据模型要求）

1. `voice.json` / `flags.json` 两个真值文件待建（位置见 §8）。
2. `article_plans` 必须暴露 `get_fact_pack` 组装入口（字段已在 A+B spec 定义，本次确认 spine 需输出"所选 judgment + 其 supporting evidence_ids"，confirm 时一并存）。
3. `evidence.kind` 五档为 Harness 语态规则输入——A+B T1 必须落 e `kind` 列（已含）。
4. `[待确认] pending` 前缀机制即 Harness 的输入栅栏（A+B 已设计）。
5. SPEC 结束。下一步：把本 spec 与 A+B plan 做一致性检查后执行。

---

（一致性检查清单：以上 §11 五点 + A+B 计划 T1 schema/T3 通道核对本 §8/§11。）