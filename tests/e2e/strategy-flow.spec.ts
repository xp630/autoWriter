/**
 * 内容策略系统 V2 E2E（Strategy-Driven Workflow）
 *
 * 覆盖：
 *  1. 迁移：V1「一行装一批 angles」→ V2「一行一个策略」炸开，批次号溯源，采纳关系重映射
 *  2. 旧旧代 content_angles（P0-1a 中间态）也能升级到同一终点
 *  3. 策略:文章 = 1:N（同一策略反复采纳）+ 采纳后 status 变 adopted
 *  4. strategy:list 的 mode/status/track/search/profile 过滤与 adoption_count
 *  5. §十三 效果回填：metrics 写到执行记录上，strategy:stats 能聚合
 *  6. §十/§十一 消费点存在：大纲、正文、润色三个模板都有 {{strategyBlock}}；配图有反查口
 *  7. strategy:generate 的双模式入参守卫（不触达 LLM）
 *
 * 有意不覆盖：真实生成（要调外部 CLI Agent，不确定且烧 token）；
 * 解析与提示词渲染由 tests/unit/strategy-block.test.ts 覆盖。
 */
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import {
  launchAutoWriter, cleanupAutoWriter, invokeIpc, execSql, type LaunchedApp,
} from './_electron-app';

let ctx: LaunchedApp;

const colsOf = async (table: string) => {
  const rows = await execSql<Array<{ name: string }>>(ctx.window, `SELECT name FROM pragma_table_info(?)`, [table]);
  return rows.map((r) => r.name);
};
const tables = async () =>
  (await execSql<Array<{ name: string }>>(ctx.window, `SELECT name FROM sqlite_master WHERE type='table'`)).map(t => t.name);

/** 插一篇真文章，供 1:N 与反查用 */
async function seedArticle(title: string) {
  const r = await execSql<{ lastInsertRowid: number }>(
    ctx.window,
    `INSERT INTO article_drafts (title, content, status) VALUES (?, '正文', 'draft')`,
    [title],
  );
  return Number(r.lastInsertRowid);
}

/** 造一条策略行（V2 的写入形状） */
async function seedStrategy(o: {
  mode?: string; topic?: string; profileId?: string; status?: string;
  title?: string; difficulty?: string; factRisk?: string;
} = {}) {
  const {
    mode = 'reference', topic = '策略测试题', profileId = 'p-v2',
    status = 'candidate', title = 'T-策略', difficulty = 'hard', factRisk = 'medium',
  } = o;
  const r = await execSql<{ lastInsertRowid: number }>(
    ctx.window,
    `INSERT INTO content_strategies
     (mode, source_type, topic, profile_id, track, angle_type, title, core_point, target_user,
      structure, emotion, goal, value_score, differentiator, track_fit, feasibility, evidence_needed, fact_risk, status)
     VALUES (?, ?, ?, ?, 'AI 与科技', '个体账本视角', ?, '不愿进入低质量关系', '25-35 职场女性',
             '["钩子","论点","结论"]', '共鸣', '涨粉', 8.5,
             '{"type":"new_audience","description":"换人群","instruction":"全文按新人群展开"}',
             '{"score":8,"reason":"贴赛道"}', ?, '["待核实：一个公开处罚文号","一组读者案例"]', ?, ?)`,
    [mode, mode === 'topic' ? 'topic' : 'analysis', topic, profileId, title,
     JSON.stringify({ score: 6, difficulty, reason: '缺一手案例' }), factRisk, status],
  );
  return Number(r.lastInsertRowid);
}

test.beforeAll(async () => {
  // 预置「V1 + 旧旧代」混合的旧库，让 app 启动时走完整的炸开迁移
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
        -- V1：一行装一批 angles
        CREATE TABLE content_strategies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mode TEXT DEFAULT 'reference', analysis_id INTEGER, topic TEXT DEFAULT '',
          profile_id TEXT DEFAULT '', track TEXT DEFAULT '', persona TEXT DEFAULT '',
          strategy_json TEXT NOT NULL DEFAULT '{}', status TEXT DEFAULT 'running',
          error TEXT DEFAULT '', duration_ms INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE strategy_adoptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          strategy_id INTEGER NOT NULL, article_id INTEGER, angle_index INTEGER NOT NULL,
          adopted_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      const aId = db.prepare(
        `INSERT INTO content_analysis (title, content, status, profile_id) VALUES ('被迁移的原文', '正文', 'completed', 'p-legacy')`,
      ).run().lastInsertRowid;
      db.prepare(
        `INSERT INTO content_strategies (id, mode, analysis_id, topic, profile_id, track, strategy_json, status, created_at)
         VALUES (5, 'reference', ?, '旧批次题', 'p-legacy', '情感', ?, 'completed', '2026-08-28 10:00:00')`,
      ).run(aId, JSON.stringify({
        mode: 'reference',
        angles: [
          { angle_type: '老角度A', title: 'OLD1', core_point: 'P1', structure: ['x', 'y'] },
          { angle_type: '老角度B', title: 'OLD2', core_point: 'P2' },
          { angle_type: '老角度C', title: 'OLD3', core_point: 'P3' },
        ],
        track_fit: { matches: false, note: '旧数据只有 matches/note' },
      }));
      // 旧采纳：批次 5 的第 1 个角度，已关联文章 42
      db.prepare(`INSERT INTO strategy_adoptions (strategy_id, article_id, angle_index, adopted_at) VALUES (5, 42, 1, '2026-08-28 10:30:00')`).run();
      db.close();
    },
  });
});

test.afterAll(async () => { if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir); });

test('V1 → V2 炸开：一行一批变成多行，采纳关系重映射到新行', async () => {
  const ts = await tables();
  expect(ts).toContain('content_strategies');
  expect(ts).toContain('strategy_articles');
  expect(ts).not.toContain('strategy_adoptions');   // 旧名表必须消失

  const cols = await colsOf('content_strategies');
  // 平铺列（§九）：这些都在，才说明"一行=一策略"成立
  for (const c of ['mode', 'source_type', 'analysis_id', 'batch_id', 'angle_type', 'title', 'core_point',
    'target_user', 'structure', 'emotion', 'goal', 'value_score',
    'differentiator', 'track_fit', 'feasibility', 'evidence_needed', 'fact_risk', 'status', 'updated_at']) {
    expect(cols, `content_strategies 应有列 ${c}`).toContain(c);
  }
  expect(cols, 'V2 不该再有整批 JSON 列').not.toContain('strategy_json');

  // 1 个旧批次 → 3 行独立策略
  const rows = await execSql<Array<Record<string, unknown>>>(
    ctx.window, `SELECT * FROM content_strategies WHERE topic = '旧批次题' ORDER BY id`,
  );
  expect(rows).toHaveLength(3);
  expect(rows.map(r => r.title)).toEqual(['OLD1', 'OLD2', 'OLD3']);
  const struct = JSON.parse(String(rows[0].structure));
  expect(struct).toEqual(['x', 'y']);

  // 批次号归组 + 分析挂靠保留
  expect(rows[0].batch_id).toBeTruthy();
  expect(new Set(rows.map(r => r.batch_id)).size).toBe(1);
  expect(Number(rows[0].analysis_id)).toBe(1);
  expect(rows[0].mode).toBe('reference');
  expect(rows[0].profile_id).toBe('p-legacy');

  // 批次级 track_fit 下沉到每一行，且旧 matches/note 被折算成 score/reason
  const tf = JSON.parse(String(rows[0].track_fit));
  expect(tf.score).toBe(3);            // matches:false → 3
  expect(tf.reason).toBe('旧数据只有 matches/note');

  // 旧 (批次5, angle_index=1) 的采纳 → 必须落到 OLD2 那一行
  const links = await execSql<Array<Record<string, unknown>>>(
    ctx.window, `SELECT * FROM strategy_articles WHERE article_id = 42`,
  );
  expect(links).toHaveLength(1);
  const adopted = await execSql<Array<{ title: string; status: string }>>(
    ctx.window, `SELECT cs.title, cs.status FROM content_strategies cs WHERE cs.id = ?`,
    [Number(links[0].strategy_id)],
  );
  expect(adopted[0].title).toBe('OLD2');
  expect(adopted[0].status).toBe('adopted');   // 被采纳的行状态要跟着升
});

test('策略:文章 = 1:N —— 同一策略可反复采纳，每次一条执行记录', async () => {
  const sid = await seedStrategy({ topic: '可复用策略' });
  const artA = await seedArticle('公众号版');
  const artB = await seedArticle('小红书版');

  const first = await invokeIpc<{ ok: boolean; adoptionId?: number }>(ctx.window, 'strategy:adopt', {
    strategyId: sid, articleId: artA,
  });
  expect(first.ok).toBe(true);
  const second = await invokeIpc<{ ok: boolean; adoptionId?: number }>(ctx.window, 'strategy:adopt', {
    strategyId: sid, articleId: artB,
  });
  expect(second.ok).toBe(true);
  expect(second.adoptionId).not.toBe(first.adoptionId);

  const got = await invokeIpc<Record<string, unknown>>(ctx.window, 'strategy:get', sid);
  const links = (got!.links ?? []) as Array<Record<string, unknown>>;
  expect(links).toHaveLength(2);
  expect(new Set(links.map(l => l.article_id))).toEqual(new Set([artA, artB]));

  // 不存在的策略 / 缺 id 都要被拒
  expect((await invokeIpc<{ ok: boolean }>(ctx.window, 'strategy:adopt', { strategyId: 999999 })).ok).toBe(false);
  expect((await invokeIpc<{ ok: boolean }>(ctx.window, 'strategy:adopt', {})).ok).toBe(false);
});

test('采纳时可以先没有文章（article_id 为空），事后仍可由正文回填', async () => {
  const sid = await seedStrategy({ topic: '先采纳后生成' });
  const r = await invokeIpc<{ ok: boolean; adoptionId?: number }>(ctx.window, 'strategy:adopt', { strategyId: sid });
  expect(r.ok).toBe(true);
  const links = await execSql<Array<{ article_id: number | null }>>(
    ctx.window, `SELECT article_id FROM strategy_articles WHERE id = ?`, [r.adoptionId!],
  );
  expect(links[0].article_id).toBeNull();
});

test('§十三 效果回填：指标写进执行记录，stats 能聚合出哪条策略更有效', async () => {
  const sid = await seedStrategy({ topic: '要回填战绩的策略' });
  const art = await seedArticle('发出去的一篇');
  const { adoptionId } = await invokeIpc<{ adoptionId: number }>(ctx.window, 'strategy:adopt', { strategyId: sid, articleId: art });

  const res = await invokeIpc<{ ok: boolean }>(ctx.window, 'strategy:recordResult', {
    adoptionId,
    metrics: { views: 12000, comments: 340, favorites: 90, followers: 210, manual_score: 8.5, note: '评论区吵起来了' },
  });
  expect(res.ok).toBe(true);

  const row = await execSql<Array<Record<string, unknown>>>(
    ctx.window, `SELECT views, comments, favorites, followers, manual_score, note FROM strategy_articles WHERE id = ?`,
    [adoptionId],
  );
  expect(Number(row[0].views)).toBe(12000);
  expect(Number(row[0].followers)).toBe(210);
  expect(Number(row[0].manual_score)).toBe(8.5);
  expect(row[0].note).toBe('评论区吵起来了');

  // 也能按 articleId 反着回填（用户在"我的文章"里操作，不知道 adoptionId）
  const byArticle = await invokeIpc<{ ok: boolean }>(ctx.window, 'strategy:recordResult', {
    articleId: art, metrics: { likes: 500 },
  });
  expect(byArticle.ok).toBe(true);

  const stats = await invokeIpc<Array<Record<string, unknown>>>(ctx.window, 'strategy:stats', [sid]);
  expect(stats).toHaveLength(1);
  expect(Number(stats[0].times_adopted)).toBe(1);
  expect(Number(stats[0].avg_views)).toBe(12000);
  expect(Number(stats[0].avg_comments)).toBe(340);
  expect(Number(stats[0].reported)).toBe(1);   // 只有 1 条填了 views

  // 非法入参必须被拒而不是静默成功
  expect((await invokeIpc<{ ok: boolean }>(ctx.window, 'strategy:recordResult', { adoptionId, metrics: {} })).ok).toBe(false);
  expect((await invokeIpc<{ ok: boolean }>(ctx.window, 'strategy:recordResult', { adoptionId: 888888, metrics: { views: 1 } })).ok).toBe(false);
});

test('strategy:list 过滤（mode / status / track / search / 身份隔离）并带 adoption_count', async () => {
  const sid = await seedStrategy({ topic: '被筛选题', mode: 'topic', profileId: 'p-filter' });
  await invokeIpc(ctx.window, 'strategy:adopt', { strategyId: sid });

  const topics = await invokeIpc<Array<Record<string, unknown>>>(ctx.window, 'strategy:list', { mode: 'topic' });
  expect(topics.length).toBeGreaterThan(0);
  expect(topics.every(t => t.mode === 'topic')).toBe(true);

  const adopted = await invokeIpc<Array<Record<string, unknown>>>(ctx.window, 'strategy:list', { status: 'adopted' });
  expect(adopted.some(t => Number(t.id) === sid)).toBe(true);

  const byTrack = await invokeIpc<Array<Record<string, unknown>>>(ctx.window, 'strategy:list', { track: 'AI 与科技' });
  expect(byTrack.every(t => t.track === 'AI 与科技')).toBe(true);

  const searched = await invokeIpc<Array<Record<string, unknown>>>(ctx.window, 'strategy:list', { search: '被筛选题' });
  expect(searched.length).toBeGreaterThan(0);

  // 结构列在列表里已被解析回对象/数组，UI 不必再 JSON.parse
  expect(Array.isArray(searched[0].structure)).toBe(true);
  expect(typeof searched[0].differentiator).toBe('object');
  expect(searched[0].feasibility).toBeTruthy();
  expect((searched[0].feasibility as { difficulty: string }).difficulty).toBe('hard');

  const withCount = await invokeIpc<Array<{ adoption_count: number }>>(ctx.window, 'strategy:list', { mode: 'topic' });
  expect(Number(withCount[0].adoption_count)).toBeGreaterThanOrEqual(1);

  // 身份隔离：p-filter 看不到 p-v2 / p-legacy，但历史空身份不隐身
  const mine = await invokeIpc<Array<{ profile_id: string }>>(ctx.window, 'strategy:list', { profileId: 'p-filter' });
  const pids = new Set(mine.map(r => r.profile_id));
  expect(pids.has('p-filter')).toBe(true);
  expect(pids.has('p-v2')).toBe(false);
});

test('策略不依赖分析：B 模式策略 analysis_id 为 NULL 也能存在并被反查', async () => {
  const sid = await seedStrategy({ mode: 'topic', topic: '无分析的独立策略' });
  const got = await invokeIpc<Record<string, unknown>>(ctx.window, 'strategy:get', sid);
  expect(got!.analysis_id).toBeNull();
  expect(got!.source_type).toBe('topic');
  expect(got!.fact_risk).toBe('medium');

  // 反查口（§十/§十一 的跨页面消费前提）
  const art = await seedArticle('反查用文章');
  const adopt = await invokeIpc<{ adoptionId: number }>(ctx.window, 'strategy:adopt', { strategyId: sid, articleId: art });
  const back = await invokeIpc<Record<string, unknown>>(ctx.window, 'article:strategyFor', art);
  expect(back).toBeTruthy();
  expect(Number(back!.id)).toBe(sid);
  expect(Number(back!.adoptionId)).toBe(adopt.adoptionId);
  expect(Array.isArray(back!.evidence_needed)).toBe(true);
  expect((back!.differentiator as { type?: string })?.type).toBe('new_audience');

  // 没有策略的文章返回 null，而不是抛
  expect(await invokeIpc(ctx.window, 'article:strategyFor', 999999)).toBeNull();
});

test('strategy:setStatus 归档 + strategy:delete 连带清理执行记录', async () => {
  const sid = await seedStrategy({ topic: '要归档的' });
  const up = await invokeIpc<{ ok: boolean }>(ctx.window, 'strategy:setStatus', { id: sid, status: 'archived' });
  expect(up.ok).toBe(true);
  const got = await invokeIpc<{ status: string }>(ctx.window, 'strategy:get', sid);
  expect(got!.status).toBe('archived');
  // 非法 status 必须被拒
  expect((await invokeIpc<{ ok: boolean }>(ctx.window, 'strategy:setStatus', { id: sid, status: 'deleted' })).ok).toBe(false);

  const del = await invokeIpc<{ ok: boolean; changes: number }>(ctx.window, 'strategy:delete', sid);
  expect(del.ok).toBe(true);
  expect(del.changes).toBe(1);
  expect(await invokeIpc(ctx.window, 'strategy:get', sid)).toBeNull();
  const orphan = await execSql<Array<{ c: number }>>(
    ctx.window, `SELECT COUNT(*) c FROM strategy_articles WHERE strategy_id = ?`, [sid],
  );
  expect(orphan[0].c).toBe(0);
});

test('strategy:generate 守卫：A 缺 analysisId / B 缺 topic / 幽灵分析，都不触达 LLM', async () => {
  const a = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'strategy:generate', { mode: 'reference' });
  expect(a.ok).toBe(false);
  expect(a.error).toMatch(/analysisId/);

  const b = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'strategy:generate', { mode: 'topic', topic: '   ' });
  expect(b.ok).toBe(false);
  expect(b.error).toMatch(/主题/);

  const ghost = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'strategy:generate', { mode: 'reference', analysisId: 999999 });
  expect(ghost.ok).toBe(false);
  expect(ghost.error).toMatch(/不存在/);

  // 未完成分析不允许生成
  const pend = await execSql<{ lastInsertRowid: number }>(
    ctx.window, `INSERT INTO content_analysis (title, content, status) VALUES ('还没分析完', 'x', 'running')`,
  );
  const busy = await invokeIpc<{ ok: boolean; error?: string }>(ctx.window, 'strategy:generate', {
    mode: 'reference', analysisId: Number(pend.lastInsertRowid),
  });
  expect(busy.ok).toBe(false);
  expect(busy.error).toMatch(/未完成/);
});

test('消费点齐全：大纲、正文、润色三个模板都含 strategyBlock（§二 生命周期）', async () => {
  for (const name of ['outline', 'article', 'polish']) {
    const tpl = await invokeIpc<{ content?: string }>(ctx.window, 'prompts:get', name);
    const body = tpl?.content ?? '';
    expect(body, `${name}.md 必须注入策略`).toContain('{{strategyBlock}}');
    if (name !== 'polish') {
      // 策略排在分析之后：已采纳的决策应覆盖"参考素材"的立场
      expect(body.indexOf('{{strategyBlock}}')).toBeGreaterThan(body.indexOf('{{analysisBlock}}'));
    }
  }
  // §十：润色不得改掉策略五要素
  const polish = await invokeIpc<{ content?: string }>(ctx.window, 'prompts:get', 'polish');
  expect(polish!.content).toContain('不得改掉上方创作策略');
});
