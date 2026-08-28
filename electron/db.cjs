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

      if (ensureCols('content_analysis', [['profile_id', "TEXT DEFAULT ''"]])) {
        ensureIdx(`CREATE INDEX IF NOT EXISTS idx_content_analysis_profile ON content_analysis(profile_id, created_at DESC)`);
      }
      // 一次性重构迁移：content_angles（分析附属能力）→ content_strategies（独立决策层）
      // schema 已先建好新表，这里只负责搬数据、补建 adoption，然后 DROP 旧表。
      const hasOld = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='content_angles'`,
      ).get();
      if (hasOld) {
        // 旧库的 content_angles 可能连 P0-2 那三列都没有（P0-1a 版本），先补齐再读
        const oldCols = db.prepare(`PRAGMA table_info(content_angles)`).all().map(c => c.name);
        for (const [n, t] of [
          ['adopted_index', 'INTEGER DEFAULT -1'], ['adopted_at', 'DATETIME'], ['article_id', 'INTEGER'],
        ]) {
          if (!oldCols.includes(n)) { try { db.exec(`ALTER TABLE content_angles ADD COLUMN ${n} ${t}`); } catch {} }
        }

        const rows = db.prepare(`SELECT * FROM content_angles ORDER BY id`).all();
        const insStrategy = db.prepare(`
          INSERT OR IGNORE INTO content_strategies
          (id, mode, analysis_id, topic, profile_id, track, persona, strategy_json, status, error, duration_ms, created_at)
          VALUES (?, 'reference', ?, ?, ?, ?, '', ?, ?, ?, ?, ?)
        `);
        const insAdoption = db.prepare(`
          INSERT INTO strategy_adoptions (strategy_id, article_id, angle_index, adopted_at)
          VALUES (?, ?, ?, ?)
        `);
        const existingAdopt = db.prepare(`SELECT COUNT(*) c FROM strategy_adoptions WHERE strategy_id = ?`);
        const moved = db.transaction(() => {
          let n = 0;
          for (const r of rows) {
            let obj = {};
            try { obj = JSON.parse(r.angles_json || '{}'); } catch {}
            const json = JSON.stringify({
              mode: 'reference',
              angles: Array.isArray(obj.angles) ? obj.angles : [],
              track_fit: obj.track_fit || null,
              value: null,
            });
            insStrategy.run(
              r.id, r.analysis_id ?? null, r.title || '', r.profile_id || '', r.track || '',
              json, r.status || 'completed', r.error || '', r.duration_ms || 0, r.created_at,
            );
            // 旧模型的采纳信息（adopted_index / article_id）转成一条 adoption，保持 1:N 语义下的历史不丢
            const hadAdopt = (r.article_id != null) || ((r.adopted_index ?? -1) >= 0);
            if (hadAdopt && existingAdopt.get(r.id).c === 0) {
              insAdoption.run(r.id, r.article_id ?? null, Math.max(0, (r.adopted_index ?? -1)), r.adopted_at || r.created_at);
            }
            n++;
          }
          return n;
        });
        const movedCount = moved();
        // 显式插了 id，要把自增序列顶上去，否则下一条新记录会 id 冲突
        const seqRow = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'content_strategies'`).get();
        const maxId = db.prepare(`SELECT COALESCE(MAX(id), 0) m FROM content_strategies`).get().m;
        if (seqRow) db.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = 'content_strategies'`).run(Math.max(seqRow.seq || 0, maxId));
        else if (maxId > 0) db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('content_strategies', ?)`).run(maxId);

        db.exec(`DROP TABLE content_angles`);
        console.log(`[db] 迁移：content_angles → content_strategies，共搬运 ${movedCount} 条策略记录（旧表已删除）`);
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
