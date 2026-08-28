/**
 * 策略库 E2E（V2 §十二 + §十三）
 *
 * 覆盖：
 *  - 入口可发现（侧栏「策略库」）
 *  - 列表渲染 + 三种筛选（模式 / 状态 / 搜索）
 *  - 详情：策略字段、采用记录、被采用次数与关联文章数
 *  - 效果回填写入后仍在，并被汇总统计读出
 *  - 归档改变状态
 *  - 「从这条重新创作」把策略交给写文章页并真的预填生效（跨页交接）
 *
 * 不触达 LLM：全部用 test:exec-sql 造策略行。
 */
import { test, expect } from '@playwright/test';
import {
  launchAutoWriter, cleanupAutoWriter, invokeIpc, execSql, type LaunchedApp,
} from './_electron-app';

let ctx: LaunchedApp;

async function seedStrategy(o: {
  mode?: string; topic?: string; title?: string; angleType?: string;
  status?: string; profileId?: string; structure?: string[];
} = {}) {
  const {
    mode = 'topic', topic = '年轻人为什么不结婚', title = 'T-库内策略',
    angleType = '个体账本视角', status = 'candidate', profileId = '',
    structure = ['钩子：一张账单', '论点：三笔账', '结论：不必将就'],
  } = o;
  const r = await execSql<{ lastInsertRowid: number }>(
    ctx.window,
    `INSERT INTO content_strategies
     (mode, source_type, topic, profile_id, track, angle_type, title, core_point, target_user,
      structure, emotion, goal, value_score, differentiator, feasibility, evidence_needed, fact_risk, status)
     VALUES (?, ?, ?, ?, 'AI 与科技', ?, ?, '不愿进入低质量关系', '25-35 岁一线城市女性',
             ?, '共鸣', '评论', 8.2,
             '{"type":"new_conclusion","description":"从理解推到不必","instruction":"结论必须落在不必将就"}',
             '{"score":7.5,"difficulty":"medium","reason":"缺一手案例"}',
             '["待核实：十年居住成本区间","一组读者真实案例"]', 'medium', ?)`,
    [mode, mode === 'topic' ? 'topic' : 'analysis', topic, profileId, angleType, title,
     JSON.stringify(structure), status],
  );
  return Number(r.lastInsertRowid);
}

async function goLibrary() {
  await ctx.window.locator('.nav-item').filter({ hasText: '策略库' }).first().click();
  await expect(ctx.window.locator('h1, .page-title').filter({ hasText: '策略库' }).first())
    .toBeVisible({ timeout: 5000 });
}

test.beforeAll(async () => { ctx = await launchAutoWriter({ resetDb: true }); });
test.afterAll(async () => { if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir); });

test('侧栏有策略库入口，能进去', async () => {
  const item = ctx.window.locator('.nav-item').filter({ hasText: '策略库' });
  expect(await item.count()).toBe(1);
  await goLibrary();
});

test('列表渲染策略卡片，显示角度/标题/立意/模式与分数', async () => {
  await seedStrategy({ title: '不结婚的十年，我算了一笔账', angleType: '个体账本视角' });
  await seedStrategy({ mode: 'reference', title: '轻量模型用法拆解', angleType: '反常识归因视角', status: 'adopted' });
  await goLibrary();
  await ctx.window.locator('button:has-text("刷新")').first().click();

  const cards = ctx.window.locator('.sl-card');
  await expect(cards.first()).toBeVisible({ timeout: 5000 });
  expect(await cards.count()).toBeGreaterThanOrEqual(2);

  const text = await ctx.window.locator('main').first().innerText();
  expect(text).toContain('不结婚的十年，我算了一笔账');
  expect(text).toContain('不愿进入低质量关系');       // 立意直接可见，不必点详情
  expect(text).toContain('命题策划');
  expect(text).toContain('借势拆解');
  expect(text).toContain('8.2');
});

test('筛选：按模式、按状态、按关键词搜索', async () => {
  await goLibrary();

  await ctx.window.locator('.sl-modes button').filter({ hasText: '命题策划' }).click();
  await ctx.window.waitForTimeout(400);
  let badges = await ctx.window.locator('.sl-mode-badge').allTextContents();
  expect(badges.length).toBeGreaterThan(0);
  expect(badges.every((b) => b.includes('命题策划'))).toBe(true);

  await ctx.window.locator('.sl-modes button').filter({ hasText: '全部模式' }).click();
  await ctx.window.waitForTimeout(400);
  await ctx.window.locator('.sl-status').selectOption('adopted');
  await ctx.window.waitForTimeout(400);
  badges = await ctx.window.locator('.sl-mode-badge').allTextContents();
  expect(badges.length).toBe(1);
  expect(badges[0]).toContain('借势拆解');

  // 复位后搜索
  await ctx.window.locator('.sl-status').selectOption('all');
  await ctx.window.locator('.sl-search input').fill('算了一笔账');
  await ctx.window.waitForTimeout(500);
  const titles = await ctx.window.locator('.sl-title').allTextContents();
  expect(titles).toHaveLength(1);
  expect(titles[0]).toContain('算了一笔账');
  await ctx.window.locator('.sl-search input').fill('');
  await ctx.window.waitForTimeout(500);
});

test('详情：策略全字段 + 采用记录 + 被采用次数与关联文章数', async () => {
  const sid = await seedStrategy({ title: '要被看的策略', angleType: '制度归因视角' });
  await goLibrary();
  await ctx.window.locator('button:has-text("刷新")').first().click();

  const card = ctx.window.locator('.sl-card').filter({ hasText: '要被看的策略' }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await card.locator('button:has-text("详情与战绩")').click();

  // 按策略 id 锁定面板：上一个用例可能留着另一个开着的详情，
  // 不精确指位就会填错面板（曾经因此让本文件 solo 能过、整文件挂）。
  const detail = ctx.window.locator(`.sl-detail[data-strategy-id="${sid}"]`);
  await expect(detail).toBeVisible({ timeout: 5000 });
  const body = await detail.innerText();
  expect(body).toContain('文章立意');
  expect(body).toContain('不愿进入低质量关系');
  expect(body).toContain('结构');
  expect(body).toContain('钩子：一张账单');
  expect(body).toContain('差异锚点');
  expect(body).toContain('new_conclusion');
  expect(body).toContain('可写性');
  expect(body).toContain('你需要补充');
  expect(body).toContain('待核实：十年居住成本区间');
  expect(body).toContain('不依赖分析（独立资产）');   // B 模式：analysis_id 为空
  expect(body).toContain('还没有采纳记录');

  // 采用一次后：计数与文章关联要出现在详情里
  await invokeIpc(ctx.window, 'strategy:adopt', { strategyId: sid });
  await detail.locator('button:has-text("收起")').click();
  await card.locator('button:has-text("详情与战绩")').click();
  const body2 = await ctx.window.locator(`.sl-detail[data-strategy-id="${sid}"]`).innerText();
  expect(body2).toContain('被采用');
  expect(body2).toMatch(/关联文章/);
});

test('§十三 效果回填：手动录入指标，重开仍在并被汇总', async () => {
  const sid = await seedStrategy({ title: '有战绩的策略' });
  const art = await execSql<{ lastInsertRowid: number }>(
    ctx.window, `INSERT INTO article_drafts (title, content, status) VALUES ('发出去的一篇', '正文', 'published')`,
  );
  await invokeIpc(ctx.window, 'strategy:adopt', { strategyId: sid, articleId: Number(art.lastInsertRowid) });

  await goLibrary();
  await ctx.window.locator('button:has-text("刷新")').first().click();
  const card = ctx.window.locator('.sl-card').filter({ hasText: '有战绩的策略' }).first();
  await card.locator('button:has-text("详情与战绩")').click();
  const detail = ctx.window.locator(`.sl-detail[data-strategy-id="${sid}"]`);
  await expect(detail).toBeVisible({ timeout: 5000 });

  await detail.locator('.sl-num').first().fill('15000');            // 阅读
  await detail.locator('input[aria-label="评论"]').fill('420');
  await detail.locator('input[aria-label="涨粉"]').fill('86');
  await detail.locator('.sl-note').fill('评论区站队很明显');
  await detail.locator('button:has-text("记录")').click();
  await expect(detail.locator('.sl-result-note')).toContainText('评论区站队很明显', { timeout: 5000 });

  // 落库确认（不能只信 UI）
  const row = await execSql<Array<Record<string, unknown>>>(
    ctx.window, `SELECT views, comments, followers FROM strategy_articles WHERE strategy_id = ?`, [sid],
  );
  expect(Number(row[0].views)).toBe(15000);
  expect(Number(row[0].comments)).toBe(420);
  expect(Number(row[0].followers)).toBe(86);

  // 汇总统计出现在详情里
  const body = await detail.innerText();
  expect(body).toContain('15000');   // 平均阅读
  expect(body).toContain('420');     // 平均评论
  expect(body).toContain('86');      // 平均涨粉
});

test('归档：状态变为已归档并可被筛出', async () => {
  const sid = await seedStrategy({ title: '要归档的策略' });
  await goLibrary();
  await ctx.window.locator('button:has-text("刷新")').first().click();
  const card = ctx.window.locator('.sl-card').filter({ hasText: '要归档的策略' }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await card.locator('button[title="归档"]').click();

  await ctx.window.locator('.sl-status').selectOption('archived');
  await ctx.window.waitForTimeout(500);
  const titles = await ctx.window.locator('.sl-title').allTextContents();
  expect(titles.some((t) => t.includes('要归档的策略'))).toBe(true);
  const dbStatus = await execSql<Array<{ status: string }>>(
    ctx.window, `SELECT status FROM content_strategies WHERE id = ?`, [sid],
  );
  expect(dbStatus[0].status).toBe('archived');
  await ctx.window.locator('.sl-status').selectOption('all');
});

test('「从这条重新创作」跨页交接：写文章页被策略预填并进入大纲步', async () => {
  const sid = await seedStrategy({
    title: '复用策略的标题', angleType: '可操作清单视角',
    structure: ['开头：清单钩子', '中段：三条做法', '结尾：抛问题'],
  });
  await goLibrary();
  await ctx.window.locator('button:has-text("刷新")').first().click();
  const card = ctx.window.locator('.sl-card').filter({ hasText: '复用策略的标题' }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await card.locator('button:has-text("从这条重新创作")').click();

  // 落到写文章页 Step 2，且大纲是按该策略 structure 生成的
  await expect(ctx.window.locator('text=Step 2 — 编辑大纲').first()).toBeVisible({ timeout: 8000 });
  const ta = ctx.window.locator('textarea').first();
  const outline = await ta.inputValue();
  expect(outline).toContain('1. 开头：清单钩子');
  expect(outline).toContain('3. 结尾：抛问题');

  // 交接必须是一次性的：再进写文章页不能重复采纳。
  // （不用文本判断，因为 WritePage 有草稿自动保存，再进页会被草稿恢复填入，那不是交接）
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await ctx.window.waitForTimeout(800);

  // 复用产生一条采纳记录（1:N），而且只产生一条
  const links = await execSql<Array<{ c: number }>>(
    ctx.window, `SELECT COUNT(*) c FROM strategy_articles WHERE strategy_id = ?`, [sid],
  );
  expect(links[0].c).toBe(1);
});
