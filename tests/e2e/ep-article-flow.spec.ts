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

  // —— 修复轮 1/5 追加：brief 原体只覆盖“外部写→focus 刷新→读回不受影响”
  // 全程没有真实页面保存；删除 focus 监听、或页面保存仍无条件清空槽位时该用例照样通过。
  // 这里补上“focus 后真实保存不覆盖外部槽位”的后半段：
  // (1) 出生自卡片的 EP 只有 observation 非空、question/insight 为空——若直接断言“未被清空”
  //     对后两个字段是 vacuous 的，所以先外部写入非空值进 observation/question/insight；
  // (2) 用页面可操作的输入改标题（.ep-title-input）→ 点保存按钮（走 EpisodePage.save → saveEpisode）；
  // (3) 等标题落库（保存确实发生并完成）后再读回，断言外部写入的四个槽位全部保留。
  const ext = {
    observation: `外部观察 ${Date.now()}`,
    question: `外部疑问 ${Date.now()}`,
    insight: `外部观点 ${Date.now()}`,
  };
  await ctx.window.evaluate(async (slots) => {
    const eps = await (window as any).electronAPI.listEpisodes();
    const ep = eps[0];
    await (window as any).electronAPI.saveEpisode({
      id: ep.id, season_id: ep.season_id, title: ep.title, status: ep.status, profileId: '',
      observation: slots.observation, question: slots.question, insight: slots.insight,
    });
  }, ext);
  const newTitle = `stale 后改的标题 ${Date.now()}`;
  await ctx.window.locator('.ep-title-input').fill(newTitle);
  await ctx.window.locator('.ep-actions-row button:has-text("保存")').click();
  // 保存完成的确定性信号：标题在库里变成新值（onBlur/保存按钮任一触发 saveEpisode 都会进来）
  await expect.poll(async () => {
    const eps = await ctx.window.evaluate(async () => (window as any).electronAPI.listEpisodes());
    return eps[0].title;
  }, { timeout: 8000 }).toBe(newTitle);
  const after = await ctx.window.evaluate(async () => {
    const eps = await (window as any).electronAPI.listEpisodes();
    return {
      development: eps[0].development,
      observation: eps[0].observation,
      question: eps[0].question,
      insight: eps[0].insight,
    };
  });
  // focus 刷新 → 真实页面保存后，外部写入的槽位一个都不能丢、不能被清空
  expect(after.development).toBe(dev);
  expect(after.observation).toBe(ext.observation);
  expect(after.question).toBe(ext.question);
  expect(after.insight).toBe(ext.insight);
});
test('Task6 访谈 UI：历史恢复 + 槽位生长预览（pending 可裁决）', async () => {
  await ctx.window.evaluate(() => { (window as any).__IV_CLI__ = '__nonexistent_cli__'; });
  const stamp = String(Date.now());
  // 1) 存卡（真实出生路径：UI 建卡）
  const cardId = await createCardWith(`T6 预览卡 ${stamp}：电梯里 AI 编剧在聊剧本`);
  // 2) 长成 EP → 拿 episodeId（槽位列在 episodes 上）
  const grown = await ctx.window.evaluate(async (id) => (window as any).electronAPI.growCard(id), cardId);
  expect(grown?.ok).toBe(true);
  const epId = grown.episodeId as number;
  expect(epId).toBeTruthy();
  // 3) 假 CLI 访谈一轮：作者答落库（留痕），AI 不可用 → modal 自动关
  await openInterviewAndAnswer(cardId, '他们兴奋但显然没看过成片');
  // 4) 预置：history 两行 + evidence 两条 + [待确认] Event: 直写
  const presetQ = `预置质问 ${stamp}：为什么这件事让你停顿三秒？`;
  const presetA = `预置回答 ${stamp}：因为我第一次看到人类编剧在场`;
  await execSql(ctx.window,
    `INSERT INTO interview_messages (observation_id, role, content, round, created_at) VALUES (?, 'assistant', ?, 10, ?)`,
    [cardId, presetQ, new Date().toISOString()]);
  await execSql(ctx.window,
    `INSERT INTO interview_messages (observation_id, role, content, round, created_at) VALUES (?, 'user', ?, 11, ?)`,
    [cardId, presetA, new Date().toISOString()]);
  const ev1 = `预置证据A ${stamp}：编剧席只有两台笔记本`;
  const ev2 = `预置证据B ${stamp}：有人对着空白文档叹气`;
  const e1 = await invokeIpc<{ ok: boolean }>(ctx.window, 'evidence:save', { observationId: cardId, content: ev1 });
  const e2 = await invokeIpc<{ ok: boolean }>(ctx.window, 'evidence:save', { observationId: cardId, content: ev2 });
  expect(e1.ok).toBe(true);
  expect(e2.ok).toBe(true);
  const pendingText = `Event: ${stamp} 唯一在场的编剧家属`;
  const epRow = await ctx.window.evaluate(async (id) => (window as any).electronAPI.getEpisode(id), epId);
  await invokeIpc(ctx.window, 'episode:save', {
    id: epId,
    season_id: epRow?.season_id, title: epRow?.title || '', slug: epRow?.slug, status: epRow?.status || 'observation',
    observation: epRow?.observation || '', question: epRow?.question || '', insight: epRow?.insight || '',
    event: `[待确认] ${pendingText}`,
    draft: epRow?.draft || '', publish_url: epRow?.publish_url || '', published_at: epRow?.published_at ?? null,
    order_in_season: epRow?.order_in_season ?? 0, profileId: epRow?.profile_id || '',
  });
  const verifyBefore = await ctx.window.evaluate(async (id) => (window as any).electronAPI.getEpisode(id), epId);
  expect(verifyBefore?.event).toBe(`[待确认] ${pendingText}`);
  // 5) 开访谈 → 断言：历史气泡恢复；pending 行带 采纳/丢弃/说错在哪；证据进预览
  const obs = await execSql<Array<{ observation: string }>>(ctx.window, 'SELECT observation FROM observations WHERE id=?', [cardId]);
  const row = ctx.window.locator('.obs-row').filter({ hasText: obs[0]?.observation || '' }).first();
  await row.locator('button.iv-open').click();
  await expect(ctx.window.locator('.iv-mask')).toBeVisible();
  await expect(ctx.window.locator('.iv-msg').filter({ hasText: presetQ })).toBeVisible({ timeout: 8000 });
  await expect(ctx.window.locator('.iv-msg').filter({ hasText: presetA })).toBeVisible();
  const pendingRow = ctx.window.locator('.iv-preview .iv-slot-pending').filter({ hasText: 'Event' }).first();
  await expect(pendingRow).toBeVisible({ timeout: 8000 });
  await expect(pendingRow).toContainText(pendingText);
  await expect(pendingRow.locator('button:has-text("采纳")')).toBeVisible();
  await expect(pendingRow.locator('button:has-text("丢弃")')).toBeVisible();
  await expect(pendingRow.locator('button:has-text("说错在哪")')).toBeVisible();
  await expect(ctx.window.locator('.iv-preview')).toContainText(ev1);
  await expect(ctx.window.locator('.iv-preview')).toContainText(ev2);
  // 6) 采纳 → 去前缀 → 槽位落定（DB 无 [待确认] 前缀 + UI pending chip 消失）
  await pendingRow.locator('button:has-text("采纳")').click();
  await expect.poll(async () => {
    const after = await ctx.window.evaluate(async (id) => (window as any).electronAPI.getEpisode(id), epId);
    return after?.event || '';
  }, { timeout: 8000 }).toBe(pendingText);
  await expect(ctx.window.locator('.iv-preview .iv-slot-pending').filter({ hasText: pendingText })).toHaveCount(0);
  // 清理：关 modal + 删卡（growCard 建的 EP 一并清）
  await ctx.window.evaluate(() => {
    const mask = document.querySelector('.iv-mask') as HTMLElement | null;
    mask?.click();
  });
  await ctx.window.waitForTimeout(200);
  ctx.window.once('dialog', (d) => { d.accept().catch(() => {}); });
  await ctx.window.evaluate(async (id) => (window as any).electronAPI.deleteCard(id), cardId);
  await ctx.window.waitForTimeout(300);
});
