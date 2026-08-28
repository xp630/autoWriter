// Scheduler — 定时任务调度器（在 Electron 主进程常驻）
// 职责：每 N 秒扫描一次注册的 handler（每个 handler 拿 db 做自己的活）
// 设计目标：
//   - 简单：setInterval + 顺序执行 handler，handler 抛错不阻断其他
//   - 可观测：保留最近 N 条历史，可查询 lastTick
//   - 可控：可整体 enable/disable，可单任务 runNow
//   - 可测：纯函数式 handler，handler 函数可被注入测试

const { EventEmitter } = require('node:events');

class Scheduler extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {number} [opts.interval=60000]  tick 间隔（毫秒）
   * @param {number} [opts.historyLimit=100] 历史保留条数
   */
  constructor({ interval = 60_000, historyLimit = 100 } = {}) {
    super();
    this.interval = interval;
    this.historyLimit = historyLimit;
    this.enabled = true;
    this.timer = null;
    this.lastTick = null;
    this.history = [];          // [{ name, at, ok, durationMs, detail?, error? }]
    this.handlers = new Map();   // name → async (db) => { ...result }
    this.running = new Set();    // 当前正在执行的 task 名称（防止重入）
  }

  /** 注册一个周期任务。name 唯一。handler 抛错被捕获为 ok:false */
  register(name, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    this.handlers.set(name, handler);
    return this;
  }

  unregister(name) {
    this.handlers.delete(name);
  }

  listTasks() {
    return Array.from(this.handlers.keys());
  }

  start() {
    if (this.timer) return;
    if (!this.enabled) return;
    this.timer = setInterval(() => this.tick(), this.interval);
    this.emit('start');
    // 启动后立即跑一次（不等待 interval）
    setImmediate(() => this.tick());
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.emit('stop');
    }
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.enabled) this.start();
    else this.stop();
  }

  setIntervalMs(ms) {
    if (typeof ms !== 'number' || ms < 1000) throw new RangeError('interval must be >= 1000ms');
    const wasRunning = this.timer !== null;
    this.stop();
    this.interval = ms;
    if (wasRunning || this.enabled) this.start();
  }

  /** 一次完整 tick（按注册顺序串行执行所有 handler） */
  async tick(db) {
    if (!this.enabled) return;
    this.lastTick = Date.now();
    for (const [name, handler] of this.handlers) {
      if (this.running.has(name)) {
        // 防止单任务重入（如果上一次还没跑完）
        this._recordHistory({ name, ok: false, durationMs: 0, error: 'skip: previous run still in progress' });
        continue;
      }
      this.running.add(name);
      const start = Date.now();
      try {
        const detail = await handler(db);
        this._recordHistory({ name, ok: true, durationMs: Date.now() - start, detail });
      } catch (err) {
        this._recordHistory({ name, ok: false, durationMs: Date.now() - start, error: err?.message || String(err) });
      } finally {
        this.running.delete(name);
      }
    }
    this.emit('tick', this.snapshot());
  }

  /** 手动触发单个任务（不等 interval），返回该任务的执行结果 */
  async runNow(name, db) {
    const handler = this.handlers.get(name);
    if (!handler) return { ok: false, reason: 'not-found' };
    if (this.running.has(name)) return { ok: false, reason: 'already-running' };
    this.running.add(name);
    const start = Date.now();
    try {
      const detail = await handler(db);
      this._recordHistory({ name, ok: true, durationMs: Date.now() - start, detail, manual: true });
      return { ok: true, durationMs: Date.now() - start, detail };
    } catch (err) {
      const message = err?.message || String(err);
      this._recordHistory({ name, ok: false, durationMs: Date.now() - start, error: message, manual: true });
      return { ok: false, error: message };
    } finally {
      this.running.delete(name);
    }
  }

  _recordHistory(entry) {
    this.history.unshift({ at: Date.now(), ...entry });
    if (this.history.length > this.historyLimit) this.history.length = this.historyLimit;
  }

  /** 状态快照（给 IPC / 测试用） */
  snapshot() {
    return {
      enabled: this.enabled,
      running: this.timer !== null,
      interval: this.interval,
      lastTick: this.lastTick,
      activeTasks: Array.from(this.running),
      registeredTasks: this.listTasks(),
      history: [...this.history],
    };
  }

  /** 测试用：清掉所有状态 */
  _reset() {
    this.stop();
    this.history = [];
    this.lastTick = null;
    this.running.clear();
  }
}

// ============================================================================
// 内置任务（按平台能力分注册）
// ============================================================================

/** 处理到期未发布的文章：把 scheduled_at <= now 的 draft / done 状态标记为 published */
function processScheduledArticles(db) {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT id, title, scheduled_at FROM article_drafts
    WHERE status IN ('draft', 'done', 'published')
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= ?
      AND published_at IS NULL
  `).all(now);
  if (rows.length === 0) return { processed: 0 };

  const stmt = db.prepare(`
    UPDATE article_drafts
    SET published_at = CURRENT_TIMESTAMP,
        status = 'published',
        scheduled_at = NULL,
        publish_error = NULL
    WHERE id = ?
  `);
  let processed = 0;
  const titles = [];
  for (const r of rows) {
    stmt.run(r.id);
    processed++;
    titles.push(r.title || `#${r.id}`);
  }
  return { processed, articles: titles };
}

/** 扫描需要同步的博主：标记 last_synced_at（实际抓取逻辑留待接入） */
function syncBloggers(db) {
  const rows = db.prepare(`
    SELECT id, name, platform, sync_interval_hours, last_synced_at FROM bloggers
    WHERE enabled = 1
      AND (
        last_synced_at IS NULL
        OR (julianday('now') - julianday(last_synced_at)) * 24 >= sync_interval_hours
      )
  `).all();
  if (rows.length === 0) return { processed: 0, due: [] };

  const updateStmt = db.prepare(`UPDATE bloggers SET last_synced_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const due = [];
  for (const r of rows) {
    // 目前只标记 synced_at，实际抓取逻辑后续接入（公众号 RSS / playwright）
    updateStmt.run(r.id);
    due.push({ id: r.id, name: r.name, platform: r.platform });
  }
  return { processed: due.length, due };
}

/** 清理过期选题：30 天没动作的 to_write 状态，标记 pending */
function cleanupStaleTopics(db) {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const result = db.prepare(`
    UPDATE topics SET status = 'pending', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'to_write' AND updated_at < ?
  `).run(cutoff);
  return { processed: result.changes };
}

/** 在 IPC 注册时一次性挂上所有内置任务 */
function registerBuiltinTasks(scheduler, db) {
  scheduler.register('process-scheduled-articles', () => processScheduledArticles(db));
  scheduler.register('sync-bloggers', () => syncBloggers(db));
  scheduler.register('cleanup-stale-topics', () => cleanupStaleTopics(db));
}

module.exports = {
  Scheduler,
  // 导出内置任务实现，便于单测
  processScheduledArticles,
  syncBloggers,
  cleanupStaleTopics,
  registerBuiltinTasks,
};