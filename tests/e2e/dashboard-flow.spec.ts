/**
 * Dashboard 页面 E2E flow
 * 覆盖：
 *  - 默认落地页是 Dashboard
 *  - 4 个 KPI 卡显示数字
 *  - 当前 Agent 状态区显示
 *  - 4 个快速开始磁贴
 *  - 空状态下显示 Empty 组件
 *  - 有数据时显示「最近编辑」列表
 *  - 首次启动引导（无 CLI 时）
 */
import { test, expect } from '@playwright/test';
import {
  launchAutoWriter,
  cleanupAutoWriter,
  type LaunchedApp,
} from './_electron-app';

let ctx: LaunchedApp;

test.beforeAll(async () => {
  ctx = await launchAutoWriter({ resetDb: true });
});

test.afterAll(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
});

test('默认落地页是仪表盘（看到 KPI 卡）', async () => {
  await ctx.window.waitForTimeout(1000);
  // KPI 卡 4 个
  const kpiCards = ctx.window.locator('.kpi-card');
  const count = await kpiCards.count();
  expect(count).toBe(4);
});

test('KPI 卡片显示 4 个标签：总文章 / 草稿 / 今日 / 字数', async () => {
  const labels = await ctx.window.locator('.kpi-label').allTextContents();
  // 大小写不敏感 + 含子串
  const all = labels.join('|').toUpperCase();
  expect(all).toMatch(/总文章/);
  expect(all).toMatch(/草稿/);
  expect(all).toMatch(/今日/);
  expect(all).toMatch(/字数/);
});

test('当前 Agent 区域有 4 个 CLI 状态行（pi / claude / opencode / codex）', async () => {
  const cliRows = ctx.window.locator('.cli-row');
  expect(await cliRows.count()).toBeGreaterThanOrEqual(4);
  const names = await ctx.window.locator('.cli-name').allTextContents();
  // 至少包含 Claude Code（我们的默认）
  expect(names.join('|')).toMatch(/Claude Code/);
});

test('快速开始 4 个磁贴可见', async () => {
  const tiles = ctx.window.locator('.quick-tile');
  expect(await tiles.count()).toBe(4);
});

test('空状态：「最近编辑」显示 Empty 组件', async () => {
  // 重置 DB 确保空状态（之前测试可能留了 fixture）
  await ctx.window.evaluate(async () => {
    await (window as any).electronAPI._test.resetDb();
  });
  // 重新加载让 Dashboard 重新拉数据
  await ctx.window.reload();
  await ctx.window.waitForLoadState('domcontentloaded');

  // 显式等 Empty 渲染出来（避免固定等待在负载高时不够）
  const emptyEl = ctx.window.locator('.empty');
  await expect(emptyEl.first()).toBeVisible({ timeout: 10000 });
  const text = await ctx.window.locator('.empty-title').first().textContent();
  expect(text || '').toMatch(/还没有|无/);
});

test('插入文章后 Dashboard 显示「最近编辑」列表', async () => {
  // 通过 test:exec-sql 插一条
  await ctx.window.evaluate(async () => {
    const api = (window as any).electronAPI;
    const now = new Date().toISOString();
    await api._test.execSql(
      `INSERT INTO article_drafts (title, outline, content, status, keywords, word_count, model, provider, platform, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['Dashboard 测试文章', '## 大纲', '正文', 'draft', 'test', 50, 'claude', 'claude', 'wechat', now, now],
    );
  });

  // 重新加载让 Dashboard 重新拉数据
  await ctx.window.reload();
  await ctx.window.waitForLoadState('domcontentloaded');

  // 显式等刚插入的文章标题出现
  await expect(ctx.window.locator('text=Dashboard 测试文章').first()).toBeVisible({ timeout: 10000 });
});

test('KPI 数字会随文章变化', async () => {
  // 上一步插了 1 篇
  const totalValue = await ctx.window.locator('.kpi-card').first().locator('.kpi-value').textContent();
  expect(totalValue?.trim()).toBe('1');
});

test('侧边栏「仪表盘」导航有 ⌘0 快捷键提示', async () => {
  const sidebar = ctx.window.locator('aside, .sidebar').first();
  const kbd = sidebar.locator('kbd:has-text("⌘0")');
  expect(await kbd.count()).toBeGreaterThanOrEqual(1);
});

test('QueueBadge 在队列空闲时不显示（设计如此）', async () => {
  // QueueBadge 组件在 active=0 且 completed=0 时返回 null（设计意图）
  // 所以初始不应该有 .queue-badge-wrap
  const count = await ctx.window.locator('.queue-badge-wrap').count();
  expect(count).toBe(0);
});

test('点击仪表盘「写新文章」磁贴跳到写文章页', async () => {
  const tile = ctx.window.locator('.quick-tile').filter({ hasText: '写新文章' });
  await tile.first().click();
  await ctx.window.waitForTimeout(500);
  // 验证写文章页渲染
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible();
});