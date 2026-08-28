/**
 * E2E UI smoke —— 应用启动、UI 渲染、侧边栏可导航
 */
import { test, expect } from '@playwright/test';
import { launchAutoWriter, cleanupAutoWriter, type LaunchedApp } from './_electron-app';

let ctx: LaunchedApp;

test.beforeAll(async () => {
  ctx = await launchAutoWriter({ resetDb: false });
});

test.afterAll(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
});

test('应用启动成功并显示主界面', async () => {
  await expect(ctx.window).toHaveTitle(/autoWriter/i);
});

test('window.electronAPI 已暴露（包含 _test 钩子）', async () => {
  const hasAPI = await ctx.window.evaluate(() => {
    return typeof (window as any).electronAPI === 'object' && (window as any).electronAPI !== null;
  });
  expect(hasAPI).toBe(true);

  const hasTest = await ctx.window.evaluate(() => {
    return typeof (window as any).electronAPI?._test?.invoke === 'function';
  });
  expect(hasTest).toBe(true);
});

test('侧边栏可见', async () => {
  const sidebar = ctx.window.locator('aside, nav, [class*="Sidebar"]').first();
  await expect(sidebar).toBeVisible();
});

const PAGES = [
  { label: '写文章', activeId: 'write' },
  { label: '我的文章', activeId: 'articles' },
  { label: '选题中心', activeId: 'topics' },
  { label: '设置', activeId: 'settings' },
];

for (const p of PAGES) {
  test(`点击"${p.label}"激活对应导航项`, async () => {
    const link = ctx.window.getByText(p.label, { exact: false }).first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await link.click();
    // Sidebar 内部 state 切换：验证 .nav-item.active 文案匹配
    const activeItem = ctx.window.locator('.nav-item.active');
    await expect(activeItem).toContainText(p.label, { timeout: 2000 });
  });
}

test('页面切换不抛 page error', async () => {
  const errors: string[] = [];
  ctx.window.on('pageerror', (err) => errors.push(err.message));
  ctx.window.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('DevTools') || text.includes('webpack-dev-server')) return;
      errors.push(text);
    }
  });

  for (const label of ['写文章', '我的文章', '选题中心', '设置']) {
    await ctx.window.getByText(label, { exact: false }).first().click();
    await ctx.window.waitForTimeout(200);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
