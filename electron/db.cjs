// SQLite 单例 + 自动迁移
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

let db = null;

/**
 * 获取 SQLite 单例。
 *
 * 默认走 Electron userData（生产行为）。测试可通过 opts 注入：
 *   - { inMemory: true }      → ':memory:'，Vitest 默认
 *   - { path: '/tmp/x.db' }   → 临时文件，可多进程/E2E 共享
 *   - { force: true }         → 关闭并重建（测试间清理）
 */
function getDb(opts = {}) {
  if (db && !opts.force) return db;

  let dbPath;
  if (opts.inMemory) {
    dbPath = ':memory:';
  } else if (opts.path) {
    dbPath = opts.path;
  } else {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
    dbPath = path.join(userData, 'autoWriter.db');
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ===== 预迁移：先把旧版策略表改名让路 =====
  // 必须在 exec(schema.sql) 之前做：新表名与旧表名相同，而 schema 用的是
  // CREATE TABLE IF NOT EXISTS —— 不让路的话 V2 的列根本建不出来。
  const tableCols = (t) => {
    try { return db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); } catch { return []; }
  };
  const tableExists = (t) => !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const renameAside = (from, to) => {
    try { db.exec(`ALTER TABLE ${from} RENAME TO ${to}`); } catch (e) { console.warn(`[db] ${from} 改名失败:`, e.message); }
  };
  const LEGACY_ANGLES = '_legacy_content_angles';
  const LEGACY_STRAT_V1 = '_legacy_strategies_v1';
  const LEGACY_ADOPT = '_legacy_strategy_adoptions';
  const stratCols = tableCols('content_strategies');
  if (stratCols.includes('strategy_json')) renameAside('content_strategies', LEGACY_STRAT_V1);   // V1：一行装一批 angles
  if (tableExists('content_angles')) renameAside('content_angles', LEGACY_ANGLES);                // P0-1a/P0-2 中间态
  if (tableExists('strategy_adoptions')) renameAside('strategy_adoptions', LEGACY_ADOPT);

  // 自动建表（执行 schema.sql）
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  }

  // 轻量迁移：images 表补新增列
  try {
    const cols = db.prepare(`PRAGMA table_info(images)`).all().map(c => c.name);
    if (cols.length > 0) {
      const ALTERS = [
        ['tags', 'TEXT DEFAULT \'\''],
        ['width', 'INTEGER DEFAULT 0'],
        ['height', 'INTEGER DEFAULT 0'],
        ['aspect', 'TEXT DEFAULT \'\''],
        ['size_kb', 'INTEGER DEFAULT 0'],
        ['original_prompt', 'TEXT DEFAULT \'\''],
        ['provider', 'TEXT DEFAULT \'\''],
        ['model', 'TEXT DEFAULT \'\''],
      ];
      for (const [name, type] of ALTERS) {
        if (!cols.includes(name)) db.exec(`ALTER TABLE images ADD COLUMN ${name} ${type}`);
      }
      // article_images 若缺 image_id
      const aCols = db.prepare(`PRAGMA table_info(article_images)`).all().map(c => c.name);
      if (aCols.length > 0 && !aCols.includes('image_id')) {
        db.exec('ALTER TABLE article_images ADD COLUMN image_id INTEGER NOT NULL DEFAULT 0');
      }
      // content_analysis 若缺 profile_id（P0 内容决策·身份隔离）
      const ensureCols = (table, defs) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
        if (!cols.length) return false;
        for (const [name, type] of defs) {
          if (!cols.includes(name)) {
            try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); } catch (e) { console.warn(`[db] ${table}.${name} 迁移失败:`, e.message); }
          }
        }
        return true;
      };
      // 索引必须在补列之后建：旧库的表可能还没这些列
      const ensureIdx = (sql) => { try { db.exec(sql); } catch (e) { console.warn('[db] index skipped:', e.message); } };

      // 分析记录的身份隔离
      if (ensureCols('content_analysis', [['profile_id', "TEXT DEFAULT ''"]])) {
        ensureIdx(`CREATE INDEX IF NOT EXISTS idx_content_analysis_profile ON content_analysis(profile_id, created_at DESC)`);
      }
      // 文章的身份隔离（同一台机器多人共用：各人的文章互相看不见；历史记录 profile_id 为空 → 不隐身）
      if (ensureCols('article_drafts', [['profile_id', "TEXT DEFAULT ''"]])) {
        ensureIdx(`CREATE INDEX IF NOT EXISTS idx_article_profile ON article_drafts(profile_id, updated_at DESC)`);
      }
      // ===== P0 Week 1：Season + Episode 关联（不锁死原则）=====
      // article_drafts 是 Episode 的"已发布快照"，EP 不必建 Article，Article 也不必挂 EP。
      if (ensureCols('article_drafts', [
        ['season_id', 'INTEGER'],
        ['episode_id', 'INTEGER'],
      ])) {
        ensureIdx('CREATE INDEX IF NOT EXISTS idx_article_season ON article_drafts(season_id)');
        ensureIdx('CREATE INDEX IF NOT EXISTS idx_article_episode ON article_drafts(episode_id)');
      }

      // ===== 旧结构 → V2「一行 = 一个策略」炸开迁移 =====
      // 兼容两代旧结构：
      //   _legacy_content_angles （P0-1a/P0-2 中间态：angles_json + adopted_index + article_id）
      //   _legacy_strategies_v1  （V1：strategy_json 装一批 angles + track_fit/value）
      // 旧表的 id 不保留（一行变多行，无法一一对应），改用 batch_id 保留批次溯源；
      // 旧的采纳关系按 (旧id, angle_index) 重新映射到炸开后的新行。
      const parseJson = (s, fallback) => {
        try { const v = JSON.parse(s || ''); return (v === undefined || v === null) ? fallback : v; } catch { return fallback; }
      };
      const dumpJson = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
      // 复用主进程的归一化，让迁移完的库里只有一种形状（不留 matches/note 这种旧字段）。
      // analysis.cjs 不依赖 db.cjs，无循环引用风险。
      const { normalizeDifferentiator, normalizeTrackFit, normalizeFeasibility } = require('./analysis.cjs');

      const INS_STRATEGY = db.prepare(`
        INSERT INTO content_strategies
        (mode, source_type, analysis_id, batch_id, topic, profile_id, track, persona,
         angle_type, title, core_point, target_user, structure, emotion, goal, value_score,
         differentiator, track_fit, feasibility, evidence_needed, fact_risk, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const INS_LINK = db.prepare(`
        INSERT INTO strategy_articles (strategy_id, article_id, adopted_at) VALUES (?, ?, ?)
      `);
      const linkExists = db.prepare(`SELECT COUNT(*) c FROM strategy_articles WHERE strategy_id = ?`);

      /** 把一个 angle 对象写成一行策略；返回新行 id */
      function explodeAngle(base, angle, createdAt) {
        const mode = base.mode || 'reference';
        const struct = Array.isArray(angle.structure) ? JSON.stringify(angle.structure) : '[]';
        const ev = Array.isArray(angle.evidence_needed) ? JSON.stringify(angle.evidence_needed) : null;
        // differentiator：旧数据是自由文本，经归一化统一成 {type,description,instruction}
        const diff = dumpJson(normalizeDifferentiator(angle.differentiator));
        // feasibility：旧数据是「易/中/难」字符串，同样归一成 {score,difficulty,reason}
        let feas = dumpJson(normalizeFeasibility(angle.feasibility));
        // B 模式旧库只有批次级的 value 块 → 下沉成每个策略的 feasibility（V2 没有批次级字段）
        if (!feas && mode === 'topic' && base.value) {
          feas = JSON.stringify({ score: base.value.score ?? null, difficulty: null, reason: base.value.advice || '' });
        }
        const factRisk = angle.fact_risk || (mode === 'topic' ? 'medium' : 'low');
        return INS_STRATEGY.run(
          mode,
          base.source_type || (mode === 'topic' ? 'topic' : 'analysis'),
          base.analysis_id ?? null,
          base.batch_id || '',
          base.topic || '',
          base.profile_id || '',
          base.track || '',
          base.persona || '',
          angle.angle_type || '',
          angle.title || '',
          angle.core_point || '',
          angle.target_user || '',
          struct,
          angle.emotion || '',
          angle.goal || '',
          typeof angle.value_score === 'number' ? angle.value_score : null,
          diff,
          dumpJson(normalizeTrackFit(base.track_fit)),
          feas,
          ev,
          factRisk,
          'candidate',
          createdAt,
          createdAt,
        ).lastInsertRowid;
      }

      // --- V1（strategy_json 装一批 angles）---
      if (tableExists(LEGACY_STRAT_V1)) {
        const v1Rows = db.prepare(`SELECT * FROM ${LEGACY_STRAT_V1} ORDER BY id`).all();
        const oldAdopt = tableExists(LEGACY_ADOPT)
          ? db.prepare(`SELECT * FROM ${LEGACY_ADOPT} ORDER BY id`).all() : [];
        const n = db.transaction(() => {
          let count = 0;
          for (const r of v1Rows) {
            const body = parseJson(r.strategy_json, {});
            const angles = Array.isArray(body.angles) ? body.angles : [];
            const base = {
              mode: r.mode || body.mode || 'reference',
              analysis_id: r.analysis_id, batch_id: `v1-${r.id}`, topic: r.topic || '',
              profile_id: r.profile_id, track: r.track, persona: r.persona,
              track_fit: body.track_fit, value: body.value,
            };
            const newIds = [];
            angles.forEach((a, i) => { newIds[i] = explodeAngle(base, a, r.created_at); count++; });
            // 采纳关系重映射：旧 angle_index → 新行 id
            for (const ad of oldAdopt.filter(x => x.strategy_id === r.id)) {
              const mapped = newIds[ad.angle_index];
              if (!mapped) continue;
              if (linkExists.get(mapped).c > 0) continue;
              INS_LINK.run(mapped, ad.article_id ?? null, ad.adopted_at || r.created_at);
              try { db.prepare(`UPDATE content_strategies SET status='adopted' WHERE id=?`).run(mapped); } catch {}
            }
          }
          return count;
        })();
        db.exec(`DROP TABLE ${LEGACY_STRAT_V1}`);
        console.log(`[db] 迁移：V1 批次表 → V2 单策略行，共 ${n} 条`);
      }

      // --- 更老的 content_angles（批次状态可能还是 running/failed）---
      if (tableExists(LEGACY_ANGLES)) {
        const oldRows = db.prepare(`SELECT * FROM ${LEGACY_ANGLES} ORDER BY id`).all();
        const n = db.transaction(() => {
          let count = 0;
          for (const r of oldRows) {
            if (r.status && r.status !== 'completed') continue;   // 生成中/失败的批次没有可用策略
            const body = parseJson(r.angles_json, {});
            const angles = Array.isArray(body.angles) ? body.angles : [];
            const base = {
              mode: 'reference', analysis_id: r.analysis_id, batch_id: `angles-${r.id}`,
              topic: '', profile_id: r.profile_id, track: r.track, persona: '',
              track_fit: body.track_fit, value: null, source_type: 'analysis',
            };
            const newIds = [];
            angles.forEach((a, i) => { newIds[i] = explodeAngle(base, a, r.created_at); count++; });
            const hadAdopt = (r.article_id != null) || ((r.adopted_index ?? -1) >= 0);
            if (hadAdopt) {
              const mapped = newIds[Math.max(0, r.adopted_index ?? 0)];
              if (mapped && linkExists.get(mapped).c === 0) {
                INS_LINK.run(mapped, r.article_id ?? null, r.adopted_at || r.created_at);
                try { db.prepare(`UPDATE content_strategies SET status='adopted' WHERE id=?`).run(mapped); } catch {}
              }
            }
          }
          return count;
        })();
        db.exec(`DROP TABLE ${LEGACY_ANGLES}`);
        console.log(`[db] 迁移：content_angles → content_strategies，共 ${n} 条策略`);
      }

      if (tableExists(LEGACY_ADOPT)) db.exec(`DROP TABLE ${LEGACY_ADOPT}`);

      // ===== V4：生成守卫三问字段 + 回填只加一个指标（转发）=====
      ensureCols('content_strategies', [
        ['belief_before', "TEXT DEFAULT ''"], ['belief_after', "TEXT DEFAULT ''"], ['belief_source', "TEXT DEFAULT ''"],
      ]);
      // 旧策略没有三问字段 → 保持空，由闸门拦住让用户补填（而不是默认为通过）
      ensureCols('strategy_articles', [['shares', 'INTEGER']]);

      // ===== V3 升级：content_strategies 补 insight / narrative 列，证据升级成带状态对象 =====
      // （旧库的 content_strategies 已经存在，schema 的 CREATE IF NOT EXISTS 会跳过它，必须 ALTER）
      if (ensureCols('content_strategies', [
        ['insight', "TEXT DEFAULT ''"], ['narrative', "TEXT DEFAULT '[]'"],
      ])) {
        const { normalizeEvidence, normalizeNarrative } = require('./analysis.cjs');
        const updInsight = db.prepare(`UPDATE content_strategies SET insight = ?, narrative = ? WHERE id = ?`);
        const updEv = db.prepare(`UPDATE content_strategies SET evidence_needed = ? WHERE id = ?`);
        const rowsV3 = db.prepare(`
          SELECT id, insight, narrative, structure, evidence_needed, core_point
          FROM content_strategies
        `).all();
        const v3 = db.transaction(() => {
          let changed = 0;
          for (const r of rowsV3) {
            let list = [];
            try { list = JSON.parse(r.evidence_needed || '[]'); } catch {}
            const first = Array.isArray(list) ? list[0] : null;
            // 字符串形状 → 带状态对象（全部当 todo：没确认过的就是没素材）
            if (Array.isArray(list) && list.length && typeof first === 'string') {
              const upgraded = normalizeEvidence(list);
              if (upgraded) { updEv.run(JSON.stringify(upgraded), r.id); changed++; }
            }
            // 旧数据只有 structure：按下标反推四拍，让旧策略也能用 V3 的叙事骨架
            const hasNarr = r.narrative && r.narrative !== '[]' && r.narrative !== 'null';
            const insightAlready = r.insight && r.insight !== '';
            if (!hasNarr || !insightAlready) {
              let narr = null;
              if (!hasNarr) {
                let st = [];
                try { st = JSON.parse(r.structure || '[]'); } catch {}
                narr = normalizeNarrative(st, st);
              }
              const narrative = hasNarr ? r.narrative : (narr ? JSON.stringify(narr) : '[]');
              // 洞察没得可推：旧数据把 core_point 当 insight 会重复，以空串上线让模新补
              const insight = insightAlready ? r.insight : '';
              if (narrative !== (r.narrative || '[]') || insight !== (r.insight || '')) {
                updInsight.run(insight, narrative, r.id); changed++;
              }
            }
          }
          return changed;
        });
        const n3 = v3();
        if (n3) console.log(`[db] V3 升级：${n3} 条策略已补 insight/narrative 或升级证据形状`);
      }
    }
  } catch (e) { console.warn('[db] migration skipped:', e.message); }

  // 初始化图片 Provider（延迟加载避免循环依赖）
  // 在测试中跳过：通过 setEnv('AUTOWRITER_SKIP_INIT_PROVIDERS', '1')
  if (!process.env.AUTOWRITER_SKIP_INIT_PROVIDERS) {
    try {
      const { initImageProviders } = require('./init-image-providers.cjs');
      initImageProviders();
    } catch (e) { console.warn('[db] initImageProviders skipped:', e.message); }
  }

  return db;
}

/** 测试用：关闭并清空单例。 */
function resetDb() {
  if (db) {
    try { db.close(); } catch {}
    db = null;
  }
}

module.exports = { getDb, resetDb };
