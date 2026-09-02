/**
 * EP→Article Task 3 e2e：访谈留痕（假 CLI）+ 策划通道探测
 *
 * 核心故事（owner 定稿）：访谈最重要的资产是留痕——用户答每轮先落库，
 * AI 是否可用都不影响作者这句话已经写进 interview_messages。
 * 所以本 spec 用 `__IV_CLI__='__nonexistent_cli__'` 让 AI 必然不可用，
 * 但用户答仍要在 history 里查得到，重开访谈能续上。
 */
import { test, expect } from '@playwright/test';
import {
  launchAutoWriter,
  cleanupAutoWriter,
  invokeIpc,
  execSql,
  type LaunchedApp,
} from './_electron-app';

let ctx: LaunchedApp;

test.beforeAll(async () => {
  ctx = await launchAutoWriter({ resetDb: true });
});

test.afterAll(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
});

/** 在仪表盘"今日观察"里建一张观察卡，返回卡 id（卡片唯一标识以观察句为准） */
async function createCardWith(text: string): Promise<number> {
  await ctx.window.locator('.nav-item').filter({ hasText: '仪表盘' }).first().click();
  await expect(ctx.window.locator('text=今日观察')).toBeVisible({ timeout: 5000 });
  await ctx.window.locator('.obs-capture textarea').fill(text);
  await ctx.window.locator('button:has-text("存这张卡")').click();
  const row = ctx.window.locator('.obs-row').filter({ hasText: text }).first();
  await expect(row).toBeVisible({ timeout: 6000 });
  const rows = await execSql<Array<{ id: number }>>(
    ctx.window,
    'SELECT id FROM observations WHERE observation=? ORDER BY id DESC LIMIT 1',
    [text],
  );
  const cardId = rows[0]?.id;
  if (!cardId) throw new Error('创建观察卡后查不到 id');
  return cardId;
}

/** 打开这张卡的访谈并答一句。AI 走假 CLI 必然不可用，模态会自动关（作者答已先落库） */
async function openInterviewAndAnswer(cardId: number, answer: string) {
  const obs = await execSql<Array<{ observation: string }>>(
    ctx.window,
    'SELECT observation FROM observations WHERE id=?',
    [cardId],
  );
  const text = obs[0]?.observation || '';
  const row = ctx.window.locator('.obs-row').filter({ hasText: text }).first();
  await expect(row).toBeVisible({ timeout: 6000 });
  await row.locator('button.iv-open').click();
  await expect(ctx.window.locator('.iv-mask')).toBeVisible();
  await ctx.window.locator('.iv-card textarea').fill(answer);
  await ctx.window.locator('.iv-card button:has-text("下一步")').click();
  // AI 不可用 → 访谈关闭（弹 toast），但用户答已在 interview_messages 落库
  await expect(ctx.window.locator('.iv-mask')).toHaveCount(0, { timeout: 10000 });
}

test('interview 留痕与恢复（假CLI）', async () => {
  await ctx.window.evaluate(() => { (window as any).__IV_CLI__ = '__nonexistent_cli__'; });
  // 存卡→开访谈→填一句答→下一步（AI不可用但用户答已落库）→ 重开能恢复
  const cardId = await createCardWith(`留痕卡 ${Date.now()}：电梯听到AI编剧讨论`);
  await openInterviewAndAnswer(cardId, '他们兴奋但没看过成片');
  const h = await ctx.window.evaluate(async (id) => (window as any).electronAPI.interviewHistory(id), cardId);
  expect(h.ok).toBe(true);
  expect(h.messages.some((m: any) => m.role === 'user' && m.content.includes('没看过成片'))).toBe(true);
  // 首轮后卡 status 应被推到 interviewing（留痕状态机第一跳）
  const rows = await execSql<Array<{ status: string }>>(ctx.window, 'SELECT status FROM observations WHERE id=?', [cardId]);
  expect(rows[0]?.status).toBe('interviewing');
});

test('策划通道探测：plan 缺料/缺模板返回 {ok:false} 结构化错误（不崩）', async () => {
  // 缺 episodeId → 守卫分支，快速返回结构错误
  const p1 = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'plan:propose', {});
  expect(p1.ok).toBe(false);
  expect(typeof p1.error).toBe('string');
  const c1 = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'plan:confirm', {});
  expect(c1.ok).toBe(false);
  expect(typeof c1.error).toBe('string');
  // 不存在的 EP → 结构化失败；list 缺 id → 结构化失败；合法 id 空表 → ok 空数组
  const np = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'plan:propose', { episodeId: 999999, cli: '__nonexistent_cli__' });
  expect(np.ok).toBe(false);
  expect(typeof np.error).toBe('string');
  const ll = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'plan:list', 0);
  expect(ll.ok).toBe(false);
  expect(typeof ll.error).toBe('string');
  const l2 = await invokeIpc<{ ok: boolean; plans: unknown[] }>(ctx.window, 'plan:list', 999999);
  expect(l2.ok).toBe(true);
  expect(Array.isArray(l2.plans)).toBe(true);
  const mm = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'episode:material', 999999);
  expect(mm.ok).toBe(false);
  expect(typeof mm.error).toBe('string');
});

test('EP03 槽位不被编辑页冲掉（stale write 回归）', async () => {
  // 前置：本 spec 没有现成 episode —— 走真实出生路径 卡片→长成 EP（带 observation/question/insight），
  // 再打开 EP 编辑页（EpisodePage 挂载，focus 监听就位），然后跑 brief 里的 stale write 回归体。
  await invokeIpc(ctx.window, 'season:save', { title: `T5 stale write 回归季 ${Date.now()}` });
  const cardId = await createCardWith(`stale 卡 ${Date.now()}：电梯里没人按楼层`);
  expect(cardId).toBeTruthy();
  const row0 = ctx.window.locator('.obs-row').filter({ hasText: `stale 卡` }).first();
  await expect(row0).toBeVisible({ timeout: 6000 });
  await row0.locator('button:has-text("长成 EP")').click();
  // 长成后 dashboard reloadTick 重拉 → 创作主线出现这集 → 点进编辑页
  const epRow = ctx.window.locator('.season-episode-row').first();
  await expect(epRow).toBeVisible({ timeout: 8000 });
  await epRow.click();
  await expect(ctx.window.locator('.ep-title-input')).toBeVisible({ timeout: 8000 });

  // 打开 EP 页 → 外部 IPC 写 development → 页面派发 focus → 页面触发保存 → 读回
  const dev = '后续数据反而更差';
  await ctx.window.evaluate(async (d) => { const eps = await (window as any).electronAPI.listEpisodes(); const ep = eps[0];
    await (window as any).electronAPI.saveEpisode({ id: ep.id, season_id: ep.season_id, title: ep.title, status: ep.status, profileId: '' , development: d }); }, dev);
  await ctx.window.evaluate(() => window.dispatchEvent(new Event('focus')));
  await ctx.window.waitForTimeout(400);
  const got = await ctx.window.evaluate(async () => { const eps = await (window as any).electronAPI.listEpisodes(); return eps[0].development; });
  expect(got).toBe(dev);
});