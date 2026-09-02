# EP → Article 转化层 V1 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"观察→聊天→活档案 EP→Article Plan"接通：九槽位经异步抽取从真实对话里长出来，Plan 只做引用式转化，全程无表单。

**Architecture:** 无状态轮次 + SQLite `interview_messages` 全量转写重放；本机 CLI（runAgent）为唯一执行器；每轮后异步 extractRound 产 JSON 槽位 patch，`validatePatch` 以出处消息 id 执法"无原话不立槽"；INSIGHT 确认后全量终抽覆盖轮抽。

**Tech Stack:** Electron(CJS) + better-sqlite3 + React/TS + vitest（纯函数）+ Playwright electron e2e（假 CLI 降级链）。

**Spec:** `docs/superpowers/specs/2026-09-02-ep-article-conversion-v1-design.md`（已批准）

## Global Constraints

- 不新增任何 npm 依赖；AI 执行只走本机 CLI（`runAgent`/`resolveCli`），禁止直连模型 API
- 对话三行契约不变：`FOLLOWUP|INSIGHT / [推力] / 文本`；`parseInterviewOutput` 是唯一解析口
- 界面中文文案；不用 emoji 做功能 icon（现有一处 `💭` 为 owner 认可的例外，新增需批准）
- 每个 EP 槽位内容必须挂 `source_message_ids`，查无出处即丢弃；手改打 `[手改]`
- `episodes.title` 只读派生（从 judgment 截取 30 字），EpisodePage 不再提供编辑
- 收尾无代码门槛：删除 `canConclude`；agent 提议 + 人「继续问/我定稿了」
- 分支 `feat/ep-article-v1`（off develop）；每任务一 commit；测试命令：`npx vitest run <file>`、`npx playwright test <spec> -g "<name>"`
- e2e 前必须 `npm run build`（dist 与 vite dev 不互通）

---

## 文件结构（改动地图）

| 文件 | 职责 | 动作 |
|---|---|---|
| `electron/schema.sql` | 表结构真值 | 改：3 张 V1 表转正 + `evidence.kind` + episodes +6 列 + `article_plans` |
| `electron/db.cjs` | 启动迁移 | 改：状态 raw/grown→new/episode_created；ADD COLUMN 幂等 |
| `electron/analysis.cjs` | 全部纯解析/校验 | 改：+`parseEvidenceOutput` `parseExtractOutput` `validatePatch` `validateAngles` |
| `electron/ipc.cjs` | 通道层 | 改：V1 半成品收尾（去 parseEvidenceOutput 引用缺失）、`interview:turn` 收 observationId、挂 extractRound、删 canConclude；+`evidence:*` `insight:confirm` `interview:history` `plan:*` `episode:material` |
| `electron/prompts.cjs` | 模板渲染（运行时读 src/prompts） | 不动 |
| `src/prompts/ep-extract.md` | 轮抽/终抽契约 | 新建 |
| `src/skills/interview/idea-interview/SKILL.md` | 访谈规则 | 改：删收尾门槛段、+槽位状态输入说明（结构=状态≠剧本） |
| `electron/preload.cjs` | API 面 | 改：+8 个方法 |
| `src/types.ts` | 类型 | 改：+`EvidenceKind` `EpisodeSlot` `ArticlePlan`、CardStatus 四态 |
| `src/pages/EpisodePage.tsx` | EP 编辑页 | 改：槽位只读预览+手改标记、修 stale write、title 只读、Plan 入口 |
| `src/pages/DashboardPage.tsx` | 访谈 UI | 改：startIv 恢复历史、observationId 传入、槽位预览面板 |
| `tests/unit/ep-contracts.test.ts` | 纯函数测试 | 新建 |
| `tests/e2e/ep-article-flow.spec.ts` | 全链路 e2e | 新建 |
| `tests/e2e/ipc-registry.spec.ts` | 通道守卫 | 改：+8 通道 |

---

### Task 1: Schema 与迁移（表结构落地）

**Files:**
- Modify: `electron/schema.sql`（尾部 V1 段）
- Modify: `electron/db.cjs`（迁移块）
- Test: `tests/unit/schema-ep.spec.ts`（新建，用 better-sqlite3 :memory: 执行）

**Interfaces:**
- Produces: 表 `interview_messages(id,observation_id,role,content,reasoning,round,created_at)`、`evidence(id,observation_id,content,kind,source_message_ids,created_at)`、`insights(id,observation_id,content,evidence_ids,confirmed,created_at)`、`article_plans(id,episode_id,proposals,chosen_angle,article_title,reader_question,core_conflict,judgment_ref,evidence_ids,discussion_scope,confirmed,created_at)`；列 `episodes.{event,reaction,development,shift,unknown,next}`；status 值域 `new|raw→new、grown→episode_created、interviewing、insight_found`

- [ ] **Step 1: 写失败测试**（`tests/unit/schema-ep.spec.ts`）

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import path from 'node:path'; import Database from 'better-sqlite3';
const schema = fs.readFileSync(path.resolve(__dirname, '../../electron/schema.sql'), 'utf-8');
describe('EP V1 schema', () => {
  const db = new Database(':memory:'); db.exec(schema);
  it('四张新表存在', () => {
    for (const t of ['interview_messages','evidence','insights','article_plans'])
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)).toBeTruthy();
  });
  it('episodes 六槽位列存在且默认空串', () => {
    const r: any = db.prepare("SELECT event,reaction,development,shift,unknown,next FROM episodes LIMIT 0;").raw();
    for (const c of ['event','reaction','development','shift','unknown','next'])
      expect(schema).toContain(`  ${c}       TEXT DEFAULT ''`);
  });
  it('evidence.kind 默认 fact', () => { expect(schema).toMatch(/kind\s+TEXT DEFAULT 'fact'/); });
});
```

- [ ] **Step 2: 跑测试确认失败** `npx vitest run tests/unit/schema-ep.spec.ts`（缺列/缺表 FAIL）
- [ ] **Step 3: 改 schema.sql**：把 V1 三表段补齐 `evidence.kind TEXT DEFAULT 'fact'`（注释 `fact|experience|judgment|speculation|unknown`）；episodes 建表段加六列（同注释风格，`-- EP 活档案槽位（2026-09-02 V1）`）；追加 `article_plans` 表（字段同上表 Interfaces，全部 TEXT/INTEGER DEFAULT，`confirmed INTEGER DEFAULT 0`）
- [ ] **Step 4: 改 db.cjs 迁移**（现有 try/catch 迁移区，幂等）：

```js
// 旧库补列（新库由 schema 自带）：ADD COLUMN 存在即跳过
for (const col of ['event','reaction','development','shift','unknown','next']) {
  try { db.prepare(`ALTER TABLE episodes ADD COLUMN ${col} TEXT DEFAULT ''`).run(); }
  catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
}
try { db.prepare(`ALTER TABLE evidence ADD COLUMN kind TEXT DEFAULT 'fact'`).run(); } catch (e) {}
db.prepare(`UPDATE observations SET status='new' WHERE status='raw'`).run();
db.prepare(`UPDATE observations SET status='episode_created' WHERE status='grown'`).run();
```

- [ ] **Step 5: 跑测试通过** + `node --check electron/db.cjs electron/schema.sql`（后者跳过）
- [ ] **Step 6: Commit** `feat(schema): EP槽位列+article_plans+kind+状态四段迁移`

---

### Task 2: 纯函数契约（抽取解析 + 出处执法 + 拔高红线）

**Files:**
- Modify: `electron/analysis.cjs`（追加 3 函数 + exports）
- Create: `tests/unit/ep-contracts.test.ts`

**Interfaces:**
- Consumes: Task 1 的槽位名集合
- Produces:
  - `parseEvidenceOutput(raw) → string[]`（JSON 数组，兼容逐行文本）
  - `parseExtractOutput(raw) → { evidence: [{content,kind}], slots: {slot: {text, src:number[]}} }`（非法 kind 归 `fact`；非白名单槽位丢弃）
  - `validatePatch(parsed, messages) → { accepted, pending, rejected }`——src id 不在 messages → rejected；文本与引用原话 bigram 重叠 <0.15 → pending；否则 accepted
  - `validateAngles(list) → { ok: [...], rejectedHigh: [...] }`——命中 `/每个(人|普通人都)|所有人都|我们总是|人人都|皆如/` 的句子进 rejectedHigh

- [ ] **Step 1: 写失败测试**（关键用例，全部进 `ep-contracts.test.ts`）

```ts
const { parseExtractOutput, validatePatch, validateAngles } = require('../../electron/analysis.cjs');
it('parseExtractOutput 剥围栏并归类 kind', () => {
  const r = parseExtractOutput('```json\n{"evidence":[{"content":"10阅读5粉丝>1000阅读0粉丝","kind":"fact"},{"content":"也许他觉得有价值","kind":"bogus"}],"slots":{"Event":{"text":"陌生人点赞并分享了文章","src":[7]}}}\n```');
  expect(r.evidence[0].kind).toBe('fact');
  expect(r.evidence[1].kind).toBe('fact');           // 非法 kind 兜底归 fact
  expect(r.slots.Event.src).toEqual([7]);
});
it('validatePatch 无出处即拒', () => {
  const msgs = [{ id: 7, role: 'user', content: '一个陌生人给我的文章点了赞，还分享了' }];
  const p = validatePatch({ slots: { Event: { text: '陌生人点赞并分享了文章', src: [7] }, Shift: { text: '我太早下结论了', src: [99] } } }, msgs);
  expect(p.accepted.map(a => a.slot)).toEqual(['Event']);
  expect(p.rejected.map(a => a.slot)).toEqual(['Shift']);
});
it('validatePatch 与原话零重叠 → pending', () => {
  const msgs = [{ id: 1, role: 'user', content: '电梯里听到两人讨论AI编剧' }];
  const p = validatePatch({ slots: { Event: { text: '季度营收翻倍增长', src: [1] } } }, msgs);
  expect(p.pending.length).toBe(1);
});
it('validateAngles 拔高句拒收', () => {
  const r = validateAngles(['一个赞到底能证明什么？', '为什么我们总想从一个样本找答案？']);
  expect(r.ok.length).toBe(1); expect(r.rejectedHigh.length).toBe(1);
});
```

- [ ] **Step 2: 跑测试 FAIL**
- [ ] **Step 3: 实现**（analysis.cjs；bigram 相似度用字符 2-gram 交集÷小集合，`SLOT_WHITELIST = ['event','reaction','development','shift','unknown','next','observation','question','judgment']`；`JSON` 提取失败时兜底逐行 `内容|kind` 文本）
- [ ] **Step 4: 跑测试 PASS** + 全量 `npx vitest run`
- [ ] **Step 5: Commit** `feat(契约): parseExtract/validatePatch出处执法/validateAngles拔高红线`

---

### Task 3: IPC 收尾与扩展（工作区半成品 → 全通道）

**Files:**
- Modify: `electron/ipc.cjs`（工作区已改未提交段 + 新通道）
- Modify: `electron/preload.cjs`、`src/types.ts`
- Modify: `tests/e2e/ipc-registry.spec.ts`

**Interfaces:**
- Consumes: Task 1 表、Task 2 纯函数
- Produces:
  - `interview:turn({…,observationId})` → `{ok,type,text,reasoning,taskId,round}`（**删 canConclude/门槛分支**；用户答与 AI 问落 `interview_messages`；首轮把卡 status 推 `interviewing`；轮后 fire-and-forget `extractRound`）
  - `interview:history(observationId) → {ok,messages}`
  - `evidence:list/save/delete`；`insight:confirm({observationId,content,evidenceIds})`（插 insights 行+冗余写 `observations.insight`，status→`insight_found`）
  - `plan:propose(episodeId)`（组 EP 材料喂 CLI 出 3~5 角度→过 validateAngles→返回 proposals，不落库）
  - `plan:confirm({episodeId,plan})` 落 `article_plans`；`plan:list(episodeId)`
  - `episode:material(episodeId)` → `{ok,ep,observations[],evidence[],insights[],plans[]}`
  - renderer 调用签名与 `src/types.ts` 声明一致

- [ ] **Step 1: 先修工作区坏引用**——现 ipc.cjs 引用的 `parseEvidenceOutput` 未 import（Task 2 已提供，加进 `require('./analysis.cjs')` 解构）；删 `canConclude` 分支与 `concludeGate`/`evidenceBlock` 注入；跑 `node --check` + `npx vitest run tests/unit/ipc-imports.test.ts` 确认静态守卫绿
- [ ] **Step 2: 写 e2e 失败测试**（`ep-article-flow.spec.ts`，假 CLI）

```ts
test('interview 留痕与恢复（假CLI）', async () => {
  await ctx.window.evaluate(() => { (window as any).__IV_CLI__ = '__nonexistent_cli__'; });
  // 存卡→开访谈→填一句答→下一步（AI不可用但用户答已落库）→ 重开能恢复
  const cardId = await createCardWith(`留痕卡 ${Date.now()}：电梯听到AI编剧讨论`);
  await openInterviewAndAnswer(cardId, '他们兴奋但没看过成片');
  const h = await ctx.window.evaluate(async (id) => (window as any).electronAPI.interviewHistory(id), cardId);
  expect(h.ok).toBe(true);
  expect(h.messages.some((m: any) => m.role === 'user' && m.content.includes('没看过成片'))).toBe(true);
});
```

- [ ] **Step 3: 跑 FAIL** → **Step 4: 实现**通道（复用工作区已写的落库段；`extractRound` 用 `renderPrompt('ep-extract', {slotState, evidence, answer})` + `enqueueAgentRun('extract',…)`，产物过 `parseExtractOutput+validatePatch` 后写 `evidence` 行与 `pending` 槽位表——pending 存 `episodes` 需新表？**不加**：accepted 直接进槽位列，pending 以 `"[待确认] "` 前缀进同列，UI 按前缀渲染，避免第三态表）
- [ ] **Step 5: e2e PASS** + registry 补 8 通道（含探测：`['plan:confirm',[{}]]` 等返回 `{ok:false}` 形状）
- [ ] **Step 6: Commit** `feat(ipc): 访谈留痕/证据/观点确认/策划通道全接线（无门槛版）`

---

### Task 4: 抽取契约文件 + SKILL 修正

**Files:**
- Create: `src/prompts/ep-extract.md`
- Modify: `src/skills/interview/idea-interview/SKILL.md`
- Modify: `electron/ipc.cjs`（`episode:material` 组料函数）
- Test: `tests/unit/prompts.test.ts` 追加

- [ ] **Step 1: 写失败测试**：`renderPrompt('ep-extract',{slotState:'{}',evidence:'无',answer:'x'})` 输出含 `只提取用户明确表达的`、`不允许出现`、五档 kind 名
- [ ] **Step 2: 写 `ep-extract.md`**（全文即契约）：

```
从作者的原始回答里提取可用于 EP 的内容。
规则：不推测、不扩写、不总结成抽象话；没有的槽位返回空对象。
每条 slot/evidence 必须引用作者原话的 message id（src）。
evidence kind 只能五档：fact 事实 | experience 经历 | judgment 判断 | speculation 推测 | unknown 未知。
推测不得写成事实（例：不能把"他可能觉得有价值"写成"他觉得有价值"）。
当前槽位状态：{{slotState}}
已提取证据：{{evidence}}
本轮原话（含 msg id）：{{answer}}
只输出 JSON：{"evidence":[{"content":"…","kind":"fact"}],"slots":{"Event":{"text":"…","src":[7]}}}
```

- [ ] **Step 3: SKILL.md 修正**：删"收尾规则"里轮次/证据计数触发（若有），输入上下文段 +`当前EP槽位状态（这是你的眼睛，不是你的剧本：读它决定往哪挖，但严禁按槽位顺序提问）`
- [ ] **Step 4: 测试 PASS** → **Step 5: Commit** `feat(契约): ep-extract 抽取合同 + SKILL 去脚本化`

---

### Task 5: stale write 修复（不加列先修漏）

**Files:**
- Modify: `src/pages/EpisodePage.tsx`
- Test: `tests/e2e/ep-article-flow.spec.ts` 追加

**Interfaces:** Produces: `episode:save` 不再冲掉外部写入（含 spec 风险 3 的执法修复）

- [ ] **Step 1: 写失败测试**

```ts
test('EP03 槽位不被编辑页冲掉（stale write 回归）', async () => {
  // 打开 EP 页 → 外部 IPC 写 development → 页面派发 focus → 页面触发保存 → 读回
  const dev = '后续数据反而更差';
  await ctx.window.evaluate(async (d) => { const eps = await (window as any).electronAPI.listEpisodes(); const ep = eps[0];
    await (window as any).electronAPI.saveEpisode({ id: ep.id, season_id: ep.season_id, title: ep.title, status: ep.status, profileId: '' , development: d }); }, dev);
  await ctx.window.evaluate(() => window.dispatchEvent(new Event('focus')));
  await ctx.window.waitForTimeout(400);
  const got = await ctx.window.evaluate(async () => { const eps = await (window as any).electronAPI.listEpisodes(); return eps[0].development; });
  expect(got).toBe(dev);
});
```

- [ ] **Step 2: 跑 FAIL**
- [ ] **Step 3: 实现**：EpisodePage 加 `useEffect`——`window.addEventListener('focus', refetch)` 重新拉行并 `setForm`；`saveEpisode` payload 只带**渲染层已知字段**，`episode:save`（ipc）UPDATE 里六槽位列 + `insight/observation/question` 一律 `COALESCE(NULLIF(?,''), col)`（空传不覆盖非空），仅 `draft/title/status/publish_url` 允许显式清空（draft 清空已有确认弹窗）
- [ ] **Step 4: PASS** + 老用例 `writepage-flow.spec.ts` 全套回归
- [ ] **Step 5: Commit** `fix(EP): 编辑页focus刷新+空值不覆盖槽位——stale write 终结`

---

### Task 6: 访谈 UI——恢复、槽位预览、无门槛收尾

**Files:**
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/index.css`
- Test: `ep-article-flow.spec.ts` 追加

- [ ] **Step 1: 失败测试**：存卡→假CLI访谈→（重开真答无法演示，用 IPC 预置 `interview:history` 两行 + `evidence:save` 两条 + `[待确认] Event:` 直写）→开访谈→断言：历史气泡恢复；`[待确认]` 显示为 pending 行带"采纳/丢弃/说错在哪"；采纳后 `[待确认] ` 前缀消失
- [ ] **Step 2: 实现**：`startIv` 先 `interviewHistory(c.id)` 灌 msgs；预览面板轮询 `episode:material`（有 ep 时）或卡关联 EP；`canConclude` 相关禁用逻辑全删（按钮恒可用）；pending 采纳= 去前缀走 `saveEpisode`
- [ ] **Step 3: PASS** → **Step 4: Commit** `feat(UI): 访谈历史恢复 + EP槽位生长预览（pending可裁决）`

---

### Task 7: Article Planning 流程（提议→人择→确认落库）

**Files:**
- Modify: `src/pages/EpisodePage.tsx`
- Modify: `electron/ipc.cjs`（`plan:propose/confirm` 若 Task 3 未含则此任务补）
- Test: `ep-article-flow.spec.ts` 追加

- [ ] **Step 1: 失败测试**：IPC 预置一张有 judgment 的 EP → `plan:propose` 假CLI返回 4 角度（其中 1 含"我们总是"）→ UI 只显示 3 个候选 + 一行"1 个提议因拔高被拒" → 点选一个 → 补 reader_question/core_conflict/scope → 确认 → `plan:list` 回读 `chosen_angle` 与 `evidence_ids`
- [ ] **Step 2: 实现**：propose 假CLI路径读 `window.__PLAN_CLI__`（e2e 缝，模式同 `__IV_CLI__` 降级：注入固定 JSON 字符串）；入口亮起条件=**存在已确认 judgment**（无完整度要求，决定 5）；空槽位在入口旁灰显（提醒不拦截）
- [ ] **Step 3: PASS** → **Step 4: Commit** `feat(Plan): 读者入口AI提议+人择一+拔高红线拒收`

---

### Task 8: 真机冒烟 + 文档同步

- [ ] **Step 1:** 装机版真 claude 冒烟清单（人工）：①一张新卡全程聊出 ≥5 槽位、出处可回指 ②一次 `[待确认]` 裁决 ③一次 Plan 提议含拒收 ④一次"继续问"否决 INSIGHT
- [ ] **Step 2:** 首里程碑验证 spec 风险 1：**用户真口述**跑通一轮（owner 亲自，不可用整理稿）
- [ ] **Step 3:** 文档：`docs/AUTOWRITER_SEASON_1.md` 加"EP=活档案"一句；`AGENTS.md` 已定方向加两条（回流：文章冻结 EP 不冻；reader_question 防拔高）；`docs/USER_GUIDE.md` §2.4 更新访谈描述（无表单、预览生长）
- [ ] **Step 4:** 重打包装机 + `verification-before-completion`：全量 `npx vitest run` + `npx playwright test` 绿才许说"完成"
- [ ] **Step 5:** Commit + push + 开 PR 到 develop

---

## Self-Review 结论

1. Spec 覆盖：决定 1↔T1/T3/T5(回流通道)+T6；决定 2/3↔T1/T2/T7；决定 4↔T3(删门槛)/T4；决定 5↔T7(入口亮起条件)；风险 1↔T8 步骤 2；风险 3↔T5。✅
2. 占位符：T3 的 pending 前缀方案是对"不加第三态表"的显式选择，非 TBD。✅
3. 类型一致：`validatePatch/parseExtractOutput` 签名以 T2 为准；`episode:material` 返回形在 T3/T6/T7 引用相同。✅
