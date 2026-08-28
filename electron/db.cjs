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
      // content_angles 若缺策略采纳相关列（P0-2 策略进入写作）
      if (ensureCols('content_angles', [
        ['adopted_index', 'INTEGER DEFAULT -1'],
        ['adopted_at', 'DATETIME'],
        ['article_id', 'INTEGER'],
      ])) {
        ensureIdx(`CREATE INDEX IF NOT EXISTS idx_content_angles_adopted ON content_angles(profile_id, adopted_index, created_at DESC)`);
        ensureIdx(`CREATE INDEX IF NOT EXISTS idx_content_angles_article ON content_angles(article_id)`);
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
