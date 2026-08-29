/**
 * 文章身份隔离 E2E
 *
 * 隔离的是「身份 profile」，不是「赛道 track」：同一台机器多人共用时，
 * 各人的文章互相看不见；赛道只是筛选维度，不该做成墙。
 *
 * 覆盖：
 *  1. schema/迁移：article_drafts 有 profile_id 列 + 有索引
 *  2. article:list 的隔离规则：本身份 + 历史空值可见，别人的不可见
 *  3. 不传 profileId 时仍是全量（系统任务/管理视图需要）
 *  4. 与 status/search 过滤可叠加
 *  5. 写入口确实带 profile_id（静态守卫 —— 正文入库要真调 Agent，不该进默认套件）
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launchAutoWriter, cleanupAutoWriter, invokeIpc, execSql, type LaunchedApp,
} from './_electron-app';

// spec 是 ESM，没有 __dirname —— 与 _electron-app.ts 保持同一做法
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '../..');

let ctx: LaunchedApp;

async function seedArticle(title: string, profileId: string, status = 'draft') {
  await execSql(
    ctx.window,
    `INSERT INTO article_drafts (title, content, status, profile_id, created_at, updated_at)
     VALUES (?, '正文', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [title, status, profileId],
  );
}

test.beforeAll(async () => { ctx = await launchAutoWriter({ resetDb: true }); });
test.afterAll(async () => { if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir); });

test('article_drafts 具备身份列与索引', async () => {
  const cols = await execSql<Array<{ name: string }>>(
    ctx.window, `SELECT name FROM pragma_table_info('article_drafts')`,
  );
  expect(cols.map((c) => c.name)).toContain('profile_id');

  const idx = await execSql<Array<{ name: string }>>(
    ctx.window, `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='article_drafts'`,
  );
  expect(idx.map((i) => i.name)).toContain('idx_article_profile');
});

test('article:list 只看本身份 + 历史记录，看不到别人的', async () => {
  await seedArticle('我的文章', 'p-mine');
  await seedArticle('老婆的文章', 'p-hers');
  await seedArticle('隔离上线前的老文章', '');   // 历史空值：不该对任何人隐身

  const mine = await invokeIpc<Array<{ title: string }>>(ctx.window, 'article:list', { profileId: 'p-mine' });
  const titles = mine.map((a) => a.title);
  expect(titles).toContain('我的文章');
  expect(titles).toContain('隔离上线前的老文章');
  expect(titles).not.toContain('老婆的文章');

  const hers = await invokeIpc<Array<{ title: string }>>(ctx.window, 'article:list', { profileId: 'p-hers' });
  const hTitles = hers.map((a) => a.title);
  expect(hTitles).toContain('老婆的文章');
  expect(hTitles).not.toContain('我的文章');

  // 不传 profileId = 全量（调度器等系统任务要用）
  const all = await invokeIpc<Array<{ title: string }>>(ctx.window, 'article:list', {});
  const aTitles = all.map((a) => a.title);
  expect(aTitles).toContain('我的文章');
  expect(aTitles).toContain('老婆的文章');
});

test('身份过滤可与 status / search 叠加', async () => {
  await seedArticle('排程中的一篇', 'p-mine', 'draft');
  await execSql(
    ctx.window,
    `UPDATE article_drafts SET scheduled_at = datetime('now', '+1 day') WHERE title = '排程中的一篇'`,
  );

  const scheduled = await invokeIpc<Array<{ title: string }>>(ctx.window, 'article:list', {
    profileId: 'p-mine', status: 'scheduled',
  });
  expect(scheduled.map((a) => a.title)).toContain('排程中的一篇');
  // 别人的已排程文章不该串进来
  const hersScheduled = await invokeIpc<Array<{ title: string }>>(ctx.window, 'article:list', {
    profileId: 'p-hers', status: 'scheduled',
  });
  expect(hersScheduled.map((a) => a.title)).not.toContain('排程中的一篇');

  const searched = await invokeIpc<Array<{ title: string }>>(ctx.window, 'article:list', {
    profileId: 'p-mine', search: '我的文章',
  });
  expect(searched).toHaveLength(1);
});

test('写入口静态守卫：正文入库必须带 profile_id，列表调用必须透传', () => {
  // 正文入库要真调外部 Agent（30–90s、结果不确定、烧 token），不该进默认套件。
  // 但"忘记写 profile_id"这类回归是静默的（列存在、默认空、不报错），
  // 所以用源码静态断言兜住，跟 ipc-imports 守卫同一思路。
  const ipc = fs.readFileSync(path.join(ROOT, 'electron/ipc.cjs'), 'utf-8');

  const insertBlock = ipc.slice(
    ipc.indexOf('INSERT INTO article_drafts'),
    ipc.indexOf('INSERT INTO article_drafts') + 900,
  );
  expect(insertBlock, 'INSERT 列里必须有 profile_id').toContain('profile_id');
  expect(insertBlock, '取值必须来自 params.profileId').toContain('params.profileId');

  const listBlock = ipc.slice(ipc.indexOf("ipcMain.handle('article:list'"), ipc.indexOf("ipcMain.handle('article:list'") + 700);
  expect(listBlock, 'article:list 必须接 profileId 参数').toContain('profileId');
  expect(listBlock).toContain(`profile_id = ''`);   // 历史记录不隐身

  // renderer 三处列表调用都要带上身份，否则切了身份页面还是全量
  const files = ['src/pages/ArticlesPage.tsx', 'src/components/Sidebar.tsx', 'src/pages/DashboardPage.tsx'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    expect(src, `${f} 的 listArticles 必须传 profileId`).toMatch(/listArticles\(\{[^}]*profileId/);
  }

  // 正文生成两处调用（首次生成 + 重新生成）都要带身份
  const write = fs.readFileSync(path.join(ROOT, 'src/pages/WritePage.tsx'), 'utf-8');
  const withProfile = (write.match(/profileId: profile\.id/g) || []).length;
  expect(withProfile, 'generateArticle 两处 + 其它调用应都带身份').toBeGreaterThanOrEqual(2);
});
