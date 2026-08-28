/**
 * 内容策略层 E2E（独立创作决策层，双模式）
 *
 * 覆盖增量需求：
 *  1. 重构迁移：旧 content_angles 数据 → content_strategies + strategy_adoptions，旧表删除
 *  2. 策略 : 文章 = 1:N —— 同一策略可反复采纳，每次一条 adoption
 *  3. strategy:generate 双模式入参守卫（A 缺 analysisId / B 缺 topic），不触达 LLM
 *  4. strategy:list 按 mode 与 profile 过滤（身份隔离在策略表上成立）
 *  5. strategy:get 返回解析后的 strategy + 全部 adoption；strategy:delete 生效
 *  6. 大纲/正文模板含 {{strategyBlock}}
 *
 * 有意不覆盖：strategy:generate 的真实生成（要调外部 CLI Agent，不确定且耗 token）。
 * 解析与提示词渲染由单元测试覆盖（tests/unit/strategy-block.test.ts）。
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

/** 造一条 A 模式策略（含 3 个角度）+ 它依赖的分析记录 */
async function seedStrategy(opts: {
  topic?: string; mode?: string; profileId?: string; status?: string;
  analysisId?: number | null; adoptedIndex?: number | null; articleId?: number | null;
} = {}) {
  const {
    topic = '策略测试题', mode = 'reference', profileId = 'p-strategy',
    status = 'completed', analysisId = null,
  } = opts;
  const anglesJson = JSON.stringify({
    mode,
    angles: [
      { angle_type: '女性成长视角', title: 'T1', core_point: 'P1', value_score: 8.5, emotion: '共鸣', goal: '涨粉', differentiator: '从个体选择推到可算的账' },
      { angle_type: '反常识视角', title: 'T2', core_point: 'P2', value_score: 7.2, emotion: '反转', goal: '评论', feasibility: '中', evidence_needed: ['待核实：一个公开处罚文号'] },
      { angle_type: '故事案例视角', title: 'T3', core_point: 'P3' },
    ],
    track_fit: mode === 'reference' ? { matches: true, note: '可写' } : null,
    value: mode === 'topic' ? { worth: true, score: 7.5, advice: '建议写 #1' } : null,
  });
  const res = await execSql<{ lastInsertRowid: number }>(
    ctx.window,
    `INSERT INTO content_strategies (mode, analysis_id, topic, profile_id, track, persona, strategy_json, status)
     VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
    [mode, analysisId, topic, profileId, 'AI 与科技', anglesJson, status],
  );
  return Number(res.lastInsertRowid);
}

test.beforeAll(async () => {
  // 预置「重命名前」的库：content_angles 带 P0-2 那三列，其中一条已采纳且已关联文章。
  // app 启动时应把它搬到 content_strategies + strategy_adoptions 并删掉旧表。
  ctx = await launchAutoWriter({
    resetDb: false,
    seedUserData: (dir) => {
      const db = new Database(path.join(dir, 'autoWriter.db'));
      db.exec(`
        CREATE TABLE content_analysis (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_url TEXT DEFAULT '', title TEXT, platform TEXT DEFAULT '', author TEXT DEFAULT '',
          content TEXT NOT NULL, analysis_json TEXT DEFAULT '{}', status TEXT DEFAULT 'completed',
          error TEXT DEFAULT '', duration_ms INTEGER DEFAULT 0, profile_id TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE content_angles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          analysis_id INTEGER NOT NULL, profile_id TEXT DEFAULT '', track TEXT DEFAULT '',
          angles_json TEXT NOT NULL DEFAULT '{"angles":[],"track_fit":null}',
          status TEXT DEFAULT 'running', error TEXT DEFAULT '', duration_ms INTEGER DEFAULT 0,
          adopted_index INTEGER DEFAULT -1, adopted_at DATETIME, article_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (analysis_id) REFERENCES content_analysis(id)
        );
      `);
      const aId = db.prepare(
        `INSERT INTO content_analysis (title, content, analysis_json, status, profile_id) VALUES (?, ?, '{}', 'completed', ?)`,
      ).run('被迁移的原文', '原文正文', 'p-legacy').lastInsertRowid;
      // id 显式给出，验证迁移保留主键
      const angles = JSON.stringify({
        angles: [
          { angle_type: '老角度A', title: 'OLD1', core_point: 'P' },
          { angle_type: '老角度B', title: 'OLD2', core_point: 'P' },
          { angle_type: '老角度C', title: 'OLD3', core_point: 'P' },
        ],
        track_fit: { matches: false, note: '旧数据' },
      });
      db.prepare(
        `INSERT INTO content_angles (id, analysis_id, profile_id, track, angles_json, status, adopted_index, adopted_at, article_id, created_at)
         VALUES (7, ?, 'p-legacy', '情感', ?, 'completed', 1, '2026-08-28 10:00:00', 42, '2026-08-28 10:00:00')`,
      ).run(aId, angles);
      db.close();
    },
  });
});

test.afterAll(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
});

test('重构迁移：content_angles → content_strategies + strategy_adoptions，旧表消失', async () => {
  const tables = await execSql<Array<{ name: string }>>(
    ctx.window, `SELECT name FROM sqlite_master WHERE type='table'`,
  );
  const names = tables.map((t) => t.name);
  expect(names).toContain('content_strategies');
  expect(names).toContain('strategy_adoptions');
  expect(names, '旧表必须被删除，否则会一直占着同名索引').not.toContain('content_angles');

  const moved = await execSql<Array<Record<string, unknown>>>(
    ctx.window, `SELECT * FROM content_strategies WHERE id = 7`,
  );
  expect(moved).toHaveLength(1);
  expect(moved[0].mode).toBe('reference');          // 旧数据一律标成 A 模式
  expect(moved[0].analysis_id).toBe(1);             // 保留挂靠
  expect(moved[0].profile_id).toBe('p-legacy');
  const body = JSON.parse(String(moved[0].strategy_json));
  expect(body.mode).toBe('reference');              // JSON 内也补了 mode
  expect(body.angles).toHaveLength(3);
  expect(body.track_fit.matches).toBe(false);
  expect(body.value).toBeNull();                    // 旧数据没有 B 的 value 块

  // 旧 adopted_index + article_id 必须变成一条真实 adoption（1:N 语义下不再丢历史）
  const adoptions = await execSql<Array<Record<string, unknown>>>(
    ctx.window, `SELECT * FROM strategy_adoptions WHERE strategy_id = 7`,
  );
  expect(adoptions).toHaveLength(1);
  expect(adoptions[0].angle_index).toBe(1);
  expect(adoptions[0].article_id).toBe(42);
});

test('自增序列未被旧 id 顶爆：新插入能拿到 id > 7', async () => {
  const id = await seedStrategy({ topic: '序列检查' });
  expect(id).toBeGreaterThan(7);
});

test('strategy:generate 守卫：A 缺 analysisId、B 缺 topic，都不触达 LLM', async () => {
  const a = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'strategy:generate', {
    mode: 'reference', profileId: 'p-strategy',
  });
  expect(a.ok).toBe(false);
  expect(a.error).toMatch(/analysisId/);

  const b = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'strategy:generate', {
    mode: 'topic', topic: '   ', profileId: 'p-strategy',
  });
  expect(b.ok).toBe(false);
  expect(b.error).toMatch(/主题/);

  // A 模式指向不存在的分析
  const ghost = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'strategy:generate', {
    mode: 'reference', analysisId: 999999, profileId: 'p-strategy',
  });
  expect(ghost.ok).toBe(false);
  expect(ghost.error).toMatch(/不存在/);
});

test('策略:文章 = 1:N —— 同一策略可反复采纳，每次一条 adoption', async () => {
  const sid = await seedStrategy({ topic: '可复用的策略' });

  const first = await invokeIpc<{ ok: boolean; adoptionId?: number; angle?: { title?: string } }>(
    ctx.window, 'strategy:adopt', { strategyId: sid, angleIndex: 0 },
  );
  expect(first.ok).toBe(true);
  expect(first.angle?.title).toBe('T1');
  expect(first.adoptionId).toBeTruthy();

  // 同一策略再采纳一次（例如换个渠道重发）——不应覆盖第一次
  const second = await invokeIpc<{ ok: boolean; adoptionId?: number }>(
    ctx.window, 'strategy:adopt', { strategyId: sid, angleIndex: 1 },
  );
  expect(second.ok).toBe(true);
  expect(second.adoptionId).not.toBe(first.adoptionId);

  const rows = await execSql<Array<{ angle_index: number; article_id: number | null }>>(
    ctx.window, `SELECT angle_index, article_id FROM strategy_adoptions WHERE strategy_id = ? ORDER BY id`, [sid],
  );
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.angle_index)).toEqual([0, 1]);
  expect(rows[0].article_id).toBeNull();   // 采纳时文章还没生成 → 允许空

  // 越界与未完成状态都必须被拒
  const bad = await invokeIpc<{ ok: boolean; error?: string }>(
    ctx.window, 'strategy:adopt', { strategyId: sid, angleIndex: 9 },
  );
  expect(bad.ok).toBe(false);
  expect(bad.error).toMatch(/越界/);

  const running = await seedStrategy({ topic: '生成中的策略', status: 'running' });
  const tooEarly = await invokeIpc<{ ok: boolean; error?: string }>(
    ctx.window, 'strategy:adopt', { strategyId: running, angleIndex: 0 },
  );
  expect(tooEarly.ok).toBe(false);
  expect(tooEarly.error).toMatch(/未完成|未生成完成/);
});

test('B 模式策略不依赖分析记录（analysis_id 为 NULL 可存可查）', async () => {
  const sid = await seedStrategy({ mode: 'topic', topic: '只有一个题目', profileId: 'p-topic' });
  const got = await invokeIpc<Record<string, unknown>>(ctx.window, 'strategy:get', sid);
  expect(got).toBeTruthy();
  expect(got!.mode).toBe('topic');
  expect(got!.analysis_id).toBeNull();       // 独立层的直接证据：策略不挂在分析上
  const body = (got!.strategy ?? {}) as { value?: { advice?: string }; angles?: unknown[] };
  expect(body.angles).toHaveLength(3);
  expect(body.value?.advice).toBe('建议写 #1');
});

test('strategy:list 按 mode 与身份过滤', async () => {
  const all = await invokeIpc<Array<{ mode: string; profile_id: string }>>(ctx.window, 'strategy:list', {});
  expect(all.length).toBeGreaterThanOrEqual(2);

  const topics = await invokeIpc<Array<{ mode: string }>>(ctx.window, 'strategy:list', { mode: 'topic' });
  expect(topics.length).toBeGreaterThan(0);
  expect(topics.every((r) => r.mode === 'topic')).toBe(true);

  const refs = await invokeIpc<Array<{ mode: string }>>(ctx.window, 'strategy:list', { mode: 'reference' });
  expect(refs.every((r) => r.mode === 'reference')).toBe(true);

  // 身份隔离：只看到 p-topic 与历史空身份，不看到 p-strategy / p-legacy
  const mine = await invokeIpc<Array<{ profile_id: string }>>(ctx.window, 'strategy:list', { profileId: 'p-topic' });
  const pids = new Set(mine.map((r) => r.profile_id));
  expect(pids.has('p-topic')).toBe(true);
  expect(pids.has('p-strategy')).toBe(false);
  expect(pids.has('p-legacy')).toBe(false);

  // 列表带上角度数，策略库页面不用逐条解析 JSON
  const withCount = await invokeIpc<Array<{ angle_count: number | null }>>(ctx.window, 'strategy:list', { mode: 'topic' });
  expect(withCount[0].angle_count).toBe(3);
});

test('strategy:delete 生效且采纳记录随主记录级联清理', async () => {
  const sid = await seedStrategy({ topic: '要被删掉的策略' });
  await invokeIpc(ctx.window, 'strategy:adopt', { strategyId: sid, angleIndex: 0 });
  const before = await execSql<Array<{ c: number }>>(
    ctx.window, `SELECT COUNT(*) c FROM strategy_adoptions WHERE strategy_id = ?`, [sid],
  );
  expect(before[0].c).toBe(1);

  const del = await invokeIpc<{ ok: boolean; changes: number }>(ctx.window, 'strategy:delete', sid);
  expect(del.ok).toBe(true);
  expect(del.changes).toBe(1);
  expect(await invokeIpc(ctx.window, 'strategy:get', sid)).toBeNull();

  // schema 上 strategy_adoptions.strategy_id 是 ON DELETE CASCADE
  // 但 db.cjs 在别处关过 foreign_keys，这里按“孤儿采纳记录不应继续可见”断言
  const after = await execSql<Array<{ c: number }>>(
    ctx.window, `SELECT COUNT(*) c FROM strategy_adoptions WHERE strategy_id = ?`, [sid],
  );
  expect(after[0].c).toBe(0);
});

test('大纲与正文模板含 strategyBlock 占位符（双模式共用同一注入点）', async () => {
  for (const name of ['outline', 'article']) {
    const tpl = await invokeIpc<{ content?: string }>(ctx.window, 'prompts:get', name);
    const body = tpl?.content ?? '';
    expect(body, `${name}.md 应含 {{strategyBlock}}`).toContain('{{strategyBlock}}');
    // 策略块排在分析块之后 —— 已采纳的策略应覆盖“参考素材”的立场
    expect(body.indexOf('{{strategyBlock}}')).toBeGreaterThan(body.indexOf('{{analysisBlock}}'));
  }
});
