/**
 * Content Observer V1 流程 E2E（2026-09-09）
 *
 * 覆盖真实闭环：手工 Signal → observer:analyze（真 handler + 真 SKILL + 真模板 + 假 CLI 输出）
 * → Opportunity 落库 → 人类四选一 → decision_records + 观察卡 + 采纳率统计。
 * 另覆盖一条边界：模型吐出伪精确概率时，程序层必须拒收（不能只靠 prompt 求自觉）。
 *
 * 不打真 LLM：假 claude 写死输出（沿用 ep-article-flow 的 PATH 注入手法）。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchAutoWriter, cleanupAutoWriter, invokeIpc, type LaunchedApp } from './_electron-app';

let ctx: LaunchedApp;
let fakeBin = '';
const dir = () => { fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-obs-fakebin-')); return fakeBin; };

/** 写一个假 claude：读 stdin 后按注入内容分流，输出固定结果 */
function setFakeScript(body: string) {
  const script = `#!/bin/sh\ncat > /dev/null 2>&1\nprintf '%s\\n' ${JSON.stringify(body)}\n`;
  fs.writeFileSync(path.join(fakeBin, 'claude'), script);
  fs.chmodSync(path.join(fakeBin, 'claude'), 0o755);
}

const OPP_JSON = JSON.stringify({
  verdict: 'opportunity',
  title: 'AI 写作工具开始管"什么时候写"',
  summary: '某团队把生成从即时补全改成了排队任务，人只在关键节点确认。',
  whyWorthAttention: '你正在把生图/正文塞进同一个队列闸门，这是同一个判断的别人的版本，你有实操取舍可以对照。',
  relevance: '高——和你刚做的队列统一直接相关',
  timeliness: '正好——刚发布三天',
  differentiation: '你有自己踩过的坑，别人只有观点',
  audienceValue: '需要验证',
  missingContext: ['他们说的"关键节点"具体是哪些', '有没有可核对的成功率口径'],
  risks: ['可能只是产品话术'],
  confidenceNote: '缺少读者侧反馈，目前只能判断到值得再看一眼。',
});

const BAD_JSON = JSON.stringify({
  verdict: 'opportunity',
  title: '伪精确机会',
  summary: '一件事。',
  whyWorthAttention: '阅读潜力 82%，涨粉概率 74%，值得写。',
  missingContext: [],
  risks: [],
});

test.beforeAll(async () => {
  dir();
  ctx = await launchAutoWriter({
    resetDb: true,
    env: { PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}` },
  });
});

test.afterAll(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
  if (fakeBin) { try { fs.rmSync(fakeBin, { recursive: true, force: true }); } catch { /* noop */ } }
});

test('Observer 卡渲染在仪表盘（输入框 + 判断按钮）', async () => {
  await ctx.window.waitForTimeout(800);
  await expect(ctx.window.locator('.Card, .card').filter({ hasText: '外部信号 · Observer' }).first()).toBeVisible();
  await expect(ctx.window.locator('button:has-text("判断机会")')).toBeVisible();
});

test('手工 Signal → 一次调用 → Opportunity 落库并进机会流', async () => {
  setFakeScript(OPP_JSON);
  const r = await invokeIpc<{ ok: boolean; error?: string; opportunityId?: number; opportunity?: any }>(
    ctx.window, 'observer:analyze', { cli: 'claude', model: '', type: 'text', content: '某团队把 AI 写作从即时补全改成了排队任务' },
  );
  expect(r.ok, r.error).toBe(true);
  const o = r.opportunity!;
  expect(r.opportunityId).toBeTruthy();
  expect(o.verdict).toBe('opportunity');
  expect(o.title).toContain('什么时候写');
  expect(o.missingContext.length).toBe(2);
  expect(o.status).toBe('presented');

  const list = await invokeIpc<{ ok: boolean; opportunities: any[]; stats: { presented: number; accepted: number } }>(
    ctx.window, 'observer:list', {},
  );
  expect(list.opportunities.some((x) => x.id === r.opportunityId)).toBe(true);
  expect(list.stats.presented).toBe(1);
  expect(list.stats.accepted).toBe(0);
});

test('四选一「记观察」→ 生成观察卡 + 状态变 observed + 采纳率进一格', async () => {
  const list = await invokeIpc<{ opportunities: any[] }>(ctx.window, 'observer:list', {});
  const oppId = list.opportunities[0].id;

  const d = await invokeIpc<{ ok: boolean; error?: string; observationId?: number; status?: string }>(
    ctx.window, 'observer:decide', { opportunityId: oppId, decision: 'observe', reasoning: '和我刚做的队列闸门是同一件事，先记下' },
  );
  expect(d.ok, d.error).toBe(true);
  expect(d.status).toBe('observed');
  expect(d.observationId).toBeTruthy();

  // 采纳后必须能在观察卡流里看到它（复用 observations 表，不建第二套内容系统）
  const cards = await invokeIpc<any[]>(ctx.window, 'card:list', {});
  const card = cards.find((c) => c.id === d.observationId);
  expect(card).toBeTruthy();
  expect(card.observation).toContain('什么时候写');

  const after = await invokeIpc<{ stats: { presented: number; accepted: number } }>(ctx.window, 'observer:list', {});
  expect(after.stats).toEqual({ presented: 1, accepted: 1 });
});

test('边界执法：模型吐伪精确概率 → 契约拒收，不落库', async () => {
  setFakeScript(BAD_JSON);
  const r = await invokeIpc<{ ok: boolean; error?: string }>(
    ctx.window, 'observer:analyze', { cli: 'claude', model: '', type: 'text', content: '另一条会诱发数字的信号' },
  );
  expect(r.ok).toBe(false);
  expect(r.error).toContain('概率/评分');

  // 契约失败不能留脏 Opportunity（但 Signal 要留下——"我看过什么"本身就是资产）
  const list = await invokeIpc<{ opportunities: any[]; stats: { presented: number } }>(ctx.window, 'observer:list', {});
  expect(list.stats.presented).toBe(1);
});

test('AI 不可用时不崩，返回人话错误', async () => {
  const r = await invokeIpc<{ ok: boolean; error?: string }>(
    ctx.window, 'observer:analyze', { cli: '__nonexistent_cli__', model: '', type: 'text', content: '随便一条信号' },
  );
  expect(r.ok).toBe(false);
  expect((r.error || '').length).toBeGreaterThan(0);
});
