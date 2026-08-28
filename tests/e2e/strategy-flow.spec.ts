/**
 * P0-2「策略进入写作」E2E
 *
 * 覆盖增量需求：
 *  1. db.cjs 的 ALTER 迁移：旧库（无 adopted_index / article_id / profile_id）启动后自动补列
 *  2. angles:adopt 的守卫分支与 happy path（采纳标记 + adopted_at）
 *  3. content_angles.article_id 闭环所需的列可用性
 *  4. analysis:list 的身份隔离（profile_id 真的被写入 + 被过滤；旧数据不隐身）
 *  5. 大纲/正文模板含 {{strategyBlock}} 占位符（策略注入提示词的落点存在）
 *
 * 不覆盖（有意）：analysis:angles 的真实生成 —— 要调外部 CLI Agent，属外部依赖，
 * 由单元测试覆盖解析与渲染（tests/unit/strategy-block.test.ts、angle-result.test.ts）。
 */
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import {
  launchAutoWriter,
  cleanupAutoWriter,
  invokeIpc,
  execSql,
  type LaunchedApp,
} from './_electron-app';

let ctx: LaunchedApp;

test.beforeAll(async () => {
  // 关键：预置一个「旧 schema」的库，让 app 启动时走 db.cjs 的 ALTER 迁移路径。
  // 不这么做的话，全新临时库只会跑 CREATE TABLE，永远测不到迁移。
  ctx = await launchAutoWriter({
    resetDb: false,
    seedUserData: (dir) => {
      const db = new Database(path.join(dir, 'autoWriter.db'));
      db.exec(`
        CREATE TABLE content_analysis (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_url TEXT DEFAULT '',
          title TEXT,
          platform TEXT DEFAULT '',
          author TEXT DEFAULT '',
          content TEXT NOT NULL,
          analysis_json TEXT NOT NULL DEFAULT '{}',
          status TEXT DEFAULT 'completed',
          error TEXT DEFAULT '',
          duration_ms INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE content_angles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          analysis_id INTEGER NOT NULL,
          profile_id TEXT DEFAULT '',
          track TEXT DEFAULT '',
          angles_json TEXT NOT NULL DEFAULT '{"angles":[],"track_fit":null}',
          status TEXT DEFAULT 'running',
          error TEXT DEFAULT '',
          duration_ms INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        -- 注：只预置要测迁移的两张表。其他表（article_drafts 等）必须留给 schema.sql 全量建，
        -- 否则 CREATE TABLE IF NOT EXISTS 会跳过这张残缺表，调度器一查不存在的列就崩。
      `);
      db.close();
    },
  });
});

test.afterAll(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
});

const colsOf = async (table: string): Promise<string[]> => {
  const rows = await execSql<Array<{ name: string }>>(
    ctx.window,
    `SELECT name FROM pragma_table_info(?)`,
    [table],
  );
  return rows.map((r) => r.name);
};

test('旧库启动后自动补齐策略相关列（ALTER 迁移生效）', async () => {
  const angleCols = await colsOf('content_angles');
  expect(angleCols).toContain('adopted_index');   // 采纳了第几个角度
  expect(angleCols).toContain('adopted_at');      // 采纳时间
  expect(angleCols).toContain('article_id');      // 策略 → 文章闭环

  const analysisCols = await colsOf('content_analysis');
  expect(analysisCols).toContain('profile_id');   // 分析记录的身份隔离
});

test('angles:adopt 入参守卫：缺 id / 缺 index / 记录不存在 / 下标越界', async () => {
  const noId = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'angles:adopt', {});
  expect(noId.ok).toBe(false);
  expect(noId.error).toMatch(/缺少/);

  const noIndex = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'angles:adopt', { id: 1 });
  expect(noIndex.ok).toBe(false);

  const ghost = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'angles:adopt', { id: 999999, index: 0 });
  expect(ghost.ok).toBe(false);
  expect(ghost.error).toMatch(/不存在/);
});

test('angles:adopt happy path：写入 adopted_index + adopted_at；越界下标被拒', async () => {
  // 造一条已完成的分析 + 一条含 3 个角度的方向记录
  await execSql(
    ctx.window,
    `INSERT INTO content_analysis (title, content, analysis_json, status, profile_id)
     VALUES (?, ?, ?, 'completed', ?)`,
    ['策略测试原文', '原文正文内容', '{}', 'p-strategy'],
  );
  const anglesJson = JSON.stringify({
    angles: [
      { angle_type: '女性成长视角', title: 'T1', core_point: 'P1', value_score: 8.5, emotion: '共鸣', goal: '涨粉' },
      { angle_type: '反常识视角', title: 'T2', core_point: 'P2', value_score: 7.2, emotion: '反转', goal: '评论' },
      { angle_type: '故事案例视角', title: 'T3', core_point: 'P3' },
    ],
    track_fit: { matches: true, note: '可写' },
  });
  await execSql(
    ctx.window,
    `INSERT INTO content_angles (analysis_id, profile_id, track, angles_json, status)
     VALUES ((SELECT id FROM content_analysis WHERE title = ?), ?, ?, ?, 'completed')`,
    ['策略测试原文', 'p-strategy', 'AI 与科技', anglesJson],
  );

  const rows = await execSql<Array<{ id: number }>>(ctx.window, `SELECT id FROM content_angles LIMIT 1`);
  const anglesId = rows[0].id;

  // 采纳第 2 个角度
  const r = await invokeIpc<{ ok: boolean; index?: number; angle?: { title?: string } }>(
    ctx.window, 'angles:adopt', { id: anglesId, index: 1 },
  );
  expect(r.ok).toBe(true);
  expect(r.index).toBe(1);
  expect(r.angle?.title).toBe('T2');   // 返回被采纳的那个角度，供 UI 回显

  const after = await execSql<Array<{ adopted_index: number; adopted_at: string | null }>>(
    ctx.window, `SELECT adopted_index, adopted_at FROM content_angles WHERE id = ?`, [anglesId],
  );
  expect(after[0].adopted_index).toBe(1);
  expect(after[0].adopted_at).not.toBeNull();

  // 越界下标必须被拒，且不能破坏已有采纳标记
  const bad = await invokeIpc<{ ok: boolean; error?: string }>(
    ctx.window, 'angles:adopt', { id: anglesId, index: 9 },
  );
  expect(bad.ok).toBe(false);
  expect(bad.error).toMatch(/越界/);
  const still = await execSql<Array<{ adopted_index: number }>>(
    ctx.window, `SELECT adopted_index FROM content_angles WHERE id = ?`, [anglesId],
  );
  expect(still[0].adopted_index).toBe(1);
});

test('analysis:list 身份隔离：只看本身份 + 历史空身份记录，不泄露别人的', async () => {
  // p-strategy 已有 1 条（上面插入的）；再造别的身份的 + 一条旧的无主记录
  await execSql(
    ctx.window,
    `INSERT INTO content_analysis (title, content, analysis_json, status, profile_id)
     VALUES (?, ?, '{}', 'completed', ?)`,
    ['别人的分析', 'body', 'p-other'],
  );
  await execSql(
    ctx.window,
    `INSERT INTO content_analysis (title, content, analysis_json, status, profile_id)
     VALUES (?, ?, '{}', 'completed', '')`,
    ['历史无主分析', 'body'],
  );

  const mine = await invokeIpc<Array<{ title: string }>>(ctx.window, 'analysis:list', {
    limit: 50, profileId: 'p-strategy',
  });
  const titles = mine.map((r) => r.title);
  expect(titles).toContain('策略测试原文');   // 本身份的
  expect(titles).toContain('历史无主分析');   // 旧数据不隐身（迁移期兼容）
  expect(titles).not.toContain('别人的分析'); // 别人的不进来自本身份

  const all = await invokeIpc<Array<{ title: string }>>(ctx.window, 'analysis:list', { limit: 50 });
  expect(all.map((r) => r.title)).toContain('别人的分析');  // 不带 profileId = 全量
});

test('analysis:run 会把 profileId 落库（身份隔离的写入口）', async () => {
  // 这条走真实 IPC + 入库路径，给足时间（默认 30s 在整局跑时不够用）
  test.setTimeout(60000);
  const before = await execSql<Array<{ c: number }>>(
    ctx.window, `SELECT COUNT(*) c FROM content_analysis WHERE profile_id = ?`, ['p-write'],
  );
  expect(before[0].c).toBe(0);

  // 故意用不存在的 cli：agent.cjs 在 default 分支 reject('未知 CLI')，不 spawn 子进程。
  // 这样既不会真去调本机 claude（耗时/耗钱），又能走到“先插 pending 行”这一步，
  // 从而验证写入口确实写了 profile_id。
  const r = await invokeIpc<{ ok?: boolean; id?: number; error?: string }>(
    ctx.window, 'analysis:run',
    { content: '策略写入口冒烟正文', title: '写入口冒烟', profileId: 'p-write', cli: '__nonexistent_cli__' },
  ).catch((e: Error) => ({ error: e.message }));
  expect(r).toBeTruthy();

  // pending 行是异步写入的，立即查会假负 → 轮询最多 15s
  await expect
    .poll(async () => {
      const rows = await execSql<Array<{ c: number }>>(
        ctx.window, `SELECT COUNT(*) c FROM content_analysis WHERE profile_id = ?`, ['p-write'],
      );
      return rows[0].c;
    }, { timeout: 15000, message: 'profile_id 应随 pending 行一起写入' })
    .toBeGreaterThanOrEqual(1);
});

test('大纲与正文模板含 strategyBlock 占位符（策略注入提示词的落点在）', async () => {
  for (const name of ['outline', 'article']) {
    const tpl = await invokeIpc<{ content?: string }>(ctx.window, 'prompts:get', name);
    const body = tpl?.content ?? '';
    expect(body, `${name}.md 应含 {{strategyBlock}}`).toContain('{{strategyBlock}}');
    // 策略块排在分析块之后 —— 用户已采纳的策略应覆盖“参考素材”的立场
    expect(body.indexOf('{{strategyBlock}}')).toBeGreaterThan(body.indexOf('{{analysisBlock}}'));
  }
});
