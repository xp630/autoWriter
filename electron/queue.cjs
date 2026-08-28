// TaskQueue — 轻量任务队列，支持并发上限、每类型并发、取消
// 纯 Node.js，无外部依赖
const { EventEmitter } = require('node:events');

/**
 * @typedef {Object} Task
 * @property {string} id           - 任务 ID，如 "t1"
 * @property {string} type         - 任务类型（如 'outline'、'article'、'polish'），用于按类型限流
 * @property {string} label        - 人类可读标签
 * @property {'pending'|'running'|'done'|'error'|'cancelled'|'cancelling'} status
 * @property {number} enqueuedAt   - 毫秒时间戳
 * @property {number|null} startedAt
 * @property {number|null} endedAt
 * @property {any} result
 * @property {string|null} error
 * @property {Object} meta         - 任意附加元数据（如 articleId、channel、cli）
 * @property {Promise<any>} promise - 调用 enqueue() 时返回的 Promise
 * @property {Function} _fn        - 内部函数 ({ signal }) => Promise<result>
 * @property {Function} _abort     - 触发取消
 */

class TaskQueue extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {number} [opts.maxConcurrent=2]      - 全局最大并发数
   * @param {number} [opts.perTypeConcurrent=1]  - 单类型最大并发数（防止同类型互相挤占）
   * @param {number} [opts.historyLimit=50]      - 保留最近多少条已完成任务
   */
  constructor({ maxConcurrent = 2, perTypeConcurrent = 1, historyLimit = 50 } = {}) {
    super();
    this.maxConcurrent = maxConcurrent;
    this.perTypeConcurrent = perTypeConcurrent;
    this.historyLimit = historyLimit;

    /** @type {Map<string, Task>} */
    this.tasks = new Map();
    /** @type {Task[]} */
    this.pending = [];
    /** @type {Set<Task>} */
    this.running = new Set();
    /** @type {Task[]} */
    this.completed = [];

    this._nextId = 1;
  }

  /**
   * 入队一个任务，立即返回一个带 taskId 的对象。
   * 调用方可通过 task.promise 等待结果，通过 queue.cancel(task.id) 取消。
   *
   * @param {string} type
   * @param {string} label
   * @param {(ctx: { signal: AbortSignal }) => Promise<any>} fn
   * @param {Object} [opts]
   * @param {Object} [opts.meta]
   * @returns {Task}
   */
  enqueue(type, label, fn, { meta = {} } = {}) {
    if (typeof fn !== 'function') throw new TypeError('fn must be a function');

    const id = `t${this._nextId++}`;
    let resolveOuter, rejectOuter;
    const promise = new Promise((res, rej) => { resolveOuter = res; rejectOuter = rej; });

    const task = {
      id, type, label,
      status: 'pending',
      enqueuedAt: Date.now(),
      startedAt: null,
      endedAt: null,
      result: null,
      error: null,
      meta,
      promise,
      _resolveOuter: resolveOuter,
      _rejectOuter: rejectOuter,
      _fn: fn,
      _abort: null,
    };

    this.tasks.set(id, task);
    this.pending.push(task);
    this._broadcast();
    // 异步 pump（不让 enqueue 的同步路径触发 fn 执行）
    setImmediate(() => this._pump());
    return task;
  }

  /**
   * 取消任务：pending 立即丢弃；running 触发 abort signal；已完成则返回 already-done。
   * @param {string} id
   * @returns {{ ok: boolean, reason?: string }}
   */
  cancel(id) {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, reason: 'not-found' };

    if (task.status === 'pending') {
      this.pending = this.pending.filter((t) => t.id !== id);
      this._finishTask(task, 'cancelled', null, 'cancelled');
      return { ok: true };
    }
    if (task.status === 'running') {
      task._abort?.();
      task.status = 'cancelling';
      this._broadcast();
      return { ok: true };
    }
    return { ok: false, reason: 'already-done' };
  }

  /** 当前状态快照（用于 IPC / 测试） */
  snapshot() {
    const tasks = [];
    for (const t of this.running) tasks.push(this._serialize(t));
    for (const t of this.pending) tasks.push(this._serialize(t));
    for (const t of this.completed) tasks.push(this._serialize(t));
    return {
      running: this.running.size,
      pending: this.pending.length,
      completed: this.completed.length,
      tasks,
    };
  }

  /** 测试用：等待所有 running 任务结束 */
  async drain() {
    while (this.running.size > 0 || this.pending.length > 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  /** 测试用：重置（保留配置） */
  _reset() {
    // 取消所有 pending；让 running 自己 abort
    for (const t of [...this.pending]) this.cancel(t.id);
    this.tasks.clear();
    this.completed = [];
  }

  // ---------- 内部 ----------

  _serialize(t) {
    return {
      id: t.id,
      type: t.type,
      label: t.label,
      status: t.status,
      enqueuedAt: t.enqueuedAt,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      meta: t.meta,
    };
  }

  _finishTask(task, status, result, error) {
    task.status = status;
    task.endedAt = Date.now();
    task.result = status === 'done' ? result : null;
    task.error = error || null;

    if (status === 'done') task._resolveOuter(result);
    else task._rejectOuter(new Error(error || status));

    // 移到 completed
    this.completed.unshift(task);
    if (this.completed.length > this.historyLimit) this.completed.length = this.historyLimit;
    this._broadcast();
  }

  _broadcast() {
    try { this.emit('state', this.snapshot()); }
    catch (e) { console.error('[queue] state listener error:', e); }
  }

  _pump() {
    // 全局并发上限
    if (this.running.size >= this.maxConcurrent) return;

    // 按类型计数（已 running）
    const typeCounts = new Map();
    for (const t of this.running) typeCounts.set(t.type, (typeCounts.get(t.type) || 0) + 1);

    // 找下一个不超 perTypeConcurrent 的 pending 任务（FIFO）
    const idx = this.pending.findIndex(
      (t) => (typeCounts.get(t.type) || 0) < this.perTypeConcurrent,
    );
    if (idx === -1) return;

    const task = this.pending.splice(idx, 1)[0];
    task.status = 'running';
    task.startedAt = Date.now();
    this.running.add(task);
    this._broadcast();

    const ac = new AbortController();
    task._abort = () => ac.abort();

    Promise.resolve()
      .then(() => task._fn({ signal: ac.signal }))
      .then(
        (result) => {
          this.running.delete(task);
          this._finishTask(task, 'done', result, null);
          // pump 下一个
          setImmediate(() => this._pump());
        },
        (err) => {
          this.running.delete(task);
          if (ac.signal.aborted) {
            this._finishTask(task, 'cancelled', null, 'cancelled by user');
          } else {
            const msg = err?.message || String(err);
            this._finishTask(task, 'error', null, msg);
          }
          setImmediate(() => this._pump());
        },
      );
  }
}

module.exports = { TaskQueue };
