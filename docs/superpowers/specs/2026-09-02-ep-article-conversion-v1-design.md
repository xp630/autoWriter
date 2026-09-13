# EP → Article 转化层 V1 · 设计规格

Date: 2026-09-02 · Status: 待用户审阅 · 来源: /skill:brainstorming（superpowers v6.2.0）
范围裁决: 本 spec = A（EP 结构+抽取）+ B（Article Plan）；C 期另立 spec：**Article Generation Harness V1**（见 §7）。

---

## 1. 问题与目标

系统现状：三层"卡片活着、EP 层全断"——8 集 EP 的 observation/question/insight 全为 0，
料留在卡片区没流进出版物；证据系统（Evidence V1）半成品未落地。

目标：把"观察→聊天→EP→策划"这根主水管接通。一句话产品定义：

> EP = 一段经过本人确认的真实经历 + 思考变化 + 尚未完全解决的问题。
> Observation 是"今天注意到了什么"，EP 是"这件事为什么值得继续想"，Article 是"怎么讲给别人听"。

## 2. 四条已拍板的决定

1. **EP 是活档案，冻结的是文章不是 EP**。发布后数据/经历变化**回流原 EP** 的
   Development/Shift/Unknown；只有**新问题**才开新卡。判别线：这条经历在"回答已有问题"
   （回流）还是"提出新问题"（新卡）。一个 EP 可长出多篇文章（1:N，跟进篇/收尾篇）。
2. **Article Plan 引用不复制**。Plan 只存 EP 里没有的转化物（读者问题/核心冲突/讨论范围），
   判断与证据走 `ep_id` 引用，改素材只有一处真相。
   字段名定为 **`reader_question`**（不用 universal）：语义是“一个陌生读者可以代入的问题”，
   不是“所有人都面对的大问题”——防 AI 把小故事拔高成方法论命题。质量红线：
   出现“每个人都会/所有人都/我们总是”式句式 = 拔高信号，Plan 提议直接拒收重做。
3. **标题分层（2026-09-02 owner rescope）**。原决定"episodes.title = 只读派生"已调整为：
   **episodes.title = 用户可编辑内部标签**（职责=帮 owner 识别这个 EP，不是表达最终判断——
   真实使用中改 EP02/03/04 标题是在重新聚焦，不是在改判断）；
   **article_plans.article_title = 面向读者的唯一文章标题来源**（策划产物，仍不进 EP）。
   三层独立：EP Title=档案标签 / Judgment=当前判断 / Article Title=文章标题。
4. **结构=状态≠剧本**。九槽位是 agent 的眼睛（prompt 输入里带当前槽位 JSON），
   不是采访脚本——删五层问题策略、删“缺口表生成问题”、删 `canConclude` 代码门槛。
   挖什么、何时收尾，agent 自主判断；人用「继续问/我定稿了」拥有一票否决。
5. **EP 无完成度要求**。EP 不是 100% 填完的表，是持续生长的思考档案：
   允许任意槽位永久空缺（Next 可选可不存）；“完整”不是发布/做策划的门槛，
   空槽只在 Plan 入口作提醒（不拦截）。

## 3. 数据模型（改动式，非新建世界）

```
episodes          +6 列: event, reaction, development, shift, unknown, next
                  (observation/question/insight 三列已有直接复用：question=“我开始追问什么”)
                  title 转只读派生; status 允许 published 后 ongoing 续档
evidence          +kind 列: fact|experience|judgment|speculation|unknown (默认 fact)
                  转正未提交的 V1 表
interview_messages 转正。会话本体。role/content/reasoning/round
insights          转正。content + evidence_ids(JSON) + confirmed
article_plans     (新表) episode_id, proposals(JSON 未选角度), chosen_angle,
                  article_title, reader_question, core_conflict,
                  judgment_ref(指向 EP 哪条判断被选中), evidence_ids(JSON，本策划选用哪几手证据),
                  discussion_scope, confirmed, created_at
```

冲突（core_conflict）属于 Plan 不属于 EP：冲突不是经历，是经历切向读者时发出的声音。
经历层：“一个陌生人的赞让我期待，后来数据更差”；文章层问题：“一个正反馈到底能不能证明内容方向对？”——两者不得混淆。

**生成馈入契约（为 C 期预留，现在就定死）**：将来文章生成的输入不是“EP 自由发挥”，而是：

```
Article Plan（chosen_angle + reader_question + core_conflict + scope）
  + judgment_ref 选中的那条判断
  + evidence_ids 选中的那几条证据（含 kind 标注）
  ↓
Article
```

——“文章里的观点到底是不是我真的想过”由这条引用链保证。

## 4. Interview 技术方案（选型表，全部复用现有件）

| # | 模块 | 选型 | 被否替代 |
|---|---|---|---|
| 1 | 执行器 | 现有 runAgent：spawn 本机 CLI（resolveCli 绝对路径）、stdin 喂 prompt | 直连 API；agent 框架 |
| 2 | 会话 | 无状态轮次 + interview_messages 全量转写重放；恢复=查库 | CLI --resume 原生会话 |
| 3 | 对话契约 | 三行契约不动：FOLLOWUP\|INSIGHT / [推力] / 文本 | 对话里塞 JSON patch（脆弱） |
| 4 | 轮抽 | 每轮后**异步** extractRound：输入=当前槽位 JSON+本轮原话，输出=JSON {evidence,slot_patches}；失败只伤预览 | 同步抽取（延迟翻倍）；只有终抽（中途瞎）|
| 5 | 校验 | validatePatch 纯函数：src 消息 id 查无→整条丢弃；与原话零重叠→pending 待人工 | 无校验（AI 编故事通道） |
| 6 | 终抽 | INSIGHT 确认后全量终抽一次，人逐槽确认；**终抽覆盖轮抽** | 只信轮抽 |
| 7 | 流式 | 现有 agent:chunk + taskId 过滤；QueueBadge 可见轮抽任务 | — |
| 8 | 门槛 | 删除代码层收尾门槛（决定 4） | canConclude 计数器 |
| 9 | 存储 | 上表列改动全部 ADD COLUMN / 新表，SQLite 无痛迁移 | 新 ep_assets 平行表（两份真相） |
| 10 | 测试 | vitest 纯函数（parseExtract/validatePatch/终抽合并）+ e2e 假 CLI 对话链 + 真 claude 手动冒烟清单 | — |

数据流：

```
人说 → messages 落库 → turn(claude·三行) → 问/收 → messages 落库
                              │异步
                              ▼
                     extractRound → validatePatch → 槽位预览(pending/confirmed) + evidence(kind)
                              ▼ (INSIGHT 确认后)
                     全量终抽 → 人逐槽确认 → EP 定稿 → (可长 Article Plan，可发布，可回流)
```

## 5. 界面（无表单原则）

- 用户面前**没有九字段表单，只有一个聊天框 + 一个不断长出来的档案预览**。
- 预览每槽两行：内容 + "出处于第 N/M 轮"；pending 项黄色，可一键"采纳/丢弃/说错在哪"。
- 想改槽位 → 正路是对着聊天说错在哪，AI 重抽；手改是逃生口，改了打 `[手改]` 标、脱离出处链。
- 回流入口：已发布 EP 页面「带新素材聊一轮」= 续聊，AI 专打后段槽（Development/Shift/Unknown）。
- Article Planning 入口（EP 有已确认判断即可亮，不设完整度门槛）：AI 读 EP 出 3~5 个读者入口 → 人选 →
  补 reader_question/core_conflict/judgment_ref/evidence_ids/scope → 确认落 article_plans。AI 提议，人不代选。

## 6. 错误处理

- turn 失败：不降级不装死（今晚已定），toast 带原因 + 关窗；messages 已落库不丢聊天。
- extractRound 失败/超时：静默重试 1 次，再失败仅 console.warn；终抽兜底。
- validatePatch 拒收：丢弃项进 pending 列表，不静默——被 AI 编出来的东西要看得见。

## 7. Harness 控制层（owner 定稿 2026-09-02，C 期主体）

三权分立：**EP = Source of Truth；Article Plan = Editorial Decision；Harness = Execution Boundary。**
Harness 不是新模块，是流水线上的控制层：

```
Article Plan ─→ [ Harness：事实包组装 + 语态规则 + 出口校验 ] ─→ AI 写作 ─→ Claim 对账 ─→ PASS / REVIEW(人裁)
```

四条执法规则：
1. **事实包封闭世界**：生成输入 = plan 四件套 + judgment_ref 一条 + evidence_ids 若干（含 kind），
   其余库内容/模型记忆一律不可达。harness 化接入（如终端 agent）只给
   `get_fact_pack(plan_id)`，不给万能查库口。
2. **kind→语态映射表单一真值源**（生成 prompt 与校验器同读一份）：
   fact=可直陈 | experience=必须第一人称亲历句式 | judgment=可作作者观点
   | speculation=只能显式推测句式（"我猜/我当时觉得"）| unknown=禁止作答，不得补答案
3. **出口校验是主体，prompt 规则是附属**：逐句切分（确定性代码）→ 候选证据圈定
   （数字/关键词匹配）→ LLM 判 supported/unsupported/conflict（只有提名权）→
   unsupported 进 REVIEW 队列，原文句与证据原文并排呈人——定罪权在人。
4. **数字逐字对账**：文中数字与 evidence 值精确匹配，不匹配=硬拦截；
   动机句（他/读者+觉得/认为）无 speculation 背书=硬拦截；材料外引用=删。

C 期 spec 改名：**Article Generation Harness V1**——生成槽位（Hook/Story/Conflict/…）
是挂在 Harness 下的子项，不是独立功能。架构从 "EP→Article" 升级为
"EP→Evidence→Plan→Generation Harness→Article"。

## 8. V1 边界（Non-Goals，沿用 owner 文档）

不做（本 spec 与 V1 范围）：文章生成（移交给 C 期 Harness spec，见 §7）·观点库·排行榜·知识图谱·
belief_before/after·多 Agent 协作·自动发文·自动确认观点。生成仍走人肉 + Quick Publish，
直到本层跑出 20~30 张真卡。

## 9. 风险与未验证假设

1. **未验证**："AI 能从生的、乱的用户口述中抽出可信九槽位"——dry-run 被 owner 跳过，
   文档内 EP03 示例系另一 AI 整理，不构成证据。首个实施里程碑应含一次真口述验证。
2. 轮抽 token 成本 ≈ 对话翻倍（已确认接受，QueueBadge 可见）。
3. stale write 老 bug 未修：EpisodePage 保存会冲掉外部写入的槽位列——**实施第一步必须修它**，
   否则九列加了也是 0。
4. Evidence V1 半成品（工作区 3 文件未提交）与本 spec 交叠，开工先收尾。
</content>
