// Scheduler 单元测试
// 验证：注册 / tick / runNow / enable/disable / 历史 / 错误隔离
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Scheduler,
  processScheduledArticles,
  syncBloggers,
  cleanupStaleTopics,
} from '../../electron/scheduler.cjs';

// 一个内存 SQLite mock，足够跑任务查询
function makeMockDb() {
  const tables = {
    article_drafts: [],
    bloggers: [],
    topics: [],
  };
  const stmt = {
    all: (...args) => {
      // 简化：所有 SELECT 返回空
      return [];
    },
    run: () => ({ changes: 0 }),
  };
  return {
    prepare: () => stmt,
    _tables: tables,
  };
}

describe('Scheduler — 生命周期', () => {
  it('start() 后 timer 存在；stop() 后清掉', () => {
    const s = new Scheduler({ interval: 100_000 });
    s.register('noop', () => ({}));
    expect(s.timer).toBeNull();
    s.start();
    expect(s.timer).not.toBeNull();
    s.stop();
    expect(s.timer).toBeNull();
  });

  it('setEnabled(false) 停止定时器；setEnabled(true) 重新启动', () => {
    const s = new Scheduler({ interval: 100_000 });
    s.register('noop', () => ({}));
    s.start();
    expect(s.timer).not.toBeNull();
    s.setEnabled(false);
    expect(s.timer).toBeNull();
    s.setEnabled(true);
    expect(s.timer).not.toBeNull();
    s.stop();
  });

  it('setIntervalMs 校验范围', () => {
    const s = new Scheduler();
    expect(() => s.setIntervalMs(500)).toThrow(RangeError);
    expect(() => s.setIntervalMs('foo' as any)).toThrow(RangeError);
    expect(() => s.setIntervalMs(2000)).not.toThrow();
  });
});

describe('Scheduler — tick 与 runNow', () => {
  it('tick 串行执行所有 handler，结果写进 history', async () => {
    const s = new Scheduler({ interval: 100_000 });
    const calls: string[] = [];
    s.register('a', async () => { calls.push('a'); return { ok: 1 }; });
    s.register('b', async () => { calls.push('b'); return { ok: 2 }; });

    await s.tick();
    expect(calls).toEqual(['a', 'b']);

    const snap = s.snapshot();
    expect(snap.lastTick).toBeGreaterThan(0);
    expect(snap.history.length).toBe(2);
    expect(snap.history[0].name).toBe('b');   // 最新在前 (b 后跑)
    expect(snap.history[0].ok).toBe(true);
    expect(snap.history[0].detail).toEqual({ ok: 2 });
    expect(snap.history[1].name).toBe('a');
  });

  it('handler 抛错 → 记 history ok:false，不阻断其他', async () => {
    const s = new Scheduler({ interval: 100_000 });
    s.register('bad', async () => { throw new Error('boom'); });
    s.register('good', async () => 'fine');

    await s.tick();
    const h = s.snapshot().history;
    expect(h.find((r: any) => r.name === 'bad').ok).toBe(false);
    expect(h.find((r: any) => r.name === 'bad').error).toBe('boom');
    expect(h.find((r: any) => r.name === 'good').ok).toBe(true);
  });

  it('runNow 返回该任务的执行结果', async () => {
    const s = new Scheduler();
    s.register('calc', async () => 42);
    const r = await s.runNow('calc');
    expect(r.ok).toBe(true);
    expect(r.detail).toBe(42);
  });

  it('runNow 不存在的任务返回 not-found', async () => {
    const s = new Scheduler();
    const r = await s.runNow('ghost');
    expect(r).toEqual({ ok: false, reason: 'not-found' });
  });

  it('tick 后 lastTick 被设置', async () => {
    const s = new Scheduler();
    expect(s.lastTick).toBeNull();
    await s.tick();
    expect(s.lastTick).not.toBeNull();
  });

  it('disabled 状态下 tick 是 no-op', async () => {
    const s = new Scheduler();
    s.register('x', async () => 'ran');
    s.setEnabled(false);
    await s.tick();
    expect(s.history.length).toBe(0);
  });

  it('重入保护：同任务上一次未结束就跳过', async () => {
    const s = new Scheduler();
    let firstRunning = true;
    let releaseFirst: (() => void) | null = null;
    s.register('slow', async () => {
      if (firstRunning) {
        firstRunning = false;
        await new Promise<void>((r) => { releaseFirst = r; });
      }
      return 'ok';
    });
    const tickPromise = s.tick();  // 第一个 tick，slow 任务卡住
    // 立即发起第二次 tick，应该跳过 slow
    await s.tick();
    releaseFirst!();
    await tickPromise;
    const slowRuns = s.snapshot().history.filter((r: any) => r.name === 'slow');
    // 第二次的 slow 应该被跳过（error: 'skip...'）
    expect(slowRuns.some((r: any) => r.error?.startsWith('skip'))).toBe(true);
  });
});

describe('Scheduler — history 保留上限', () => {
  it('超过 historyLimit 丢弃最旧', async () => {
    const s = new Scheduler({ historyLimit: 3 });
    s.register('t', async () => 'x');
    for (let i = 0; i < 5; i++) await s.tick();
    expect(s.snapshot().history.length).toBe(3);
  });
});

describe('Scheduler — 内置任务（用 mock db）', () => {
  let db: any;
  beforeEach(() => {
    db = makeMockDb();
  });

  it('processScheduledArticles 在没数据时返回 processed:0', () => {
    expect(processScheduledArticles(db)).toEqual({ processed: 0 });
  });

  it('syncBloggers 在没数据时返回 processed:0', () => {
    expect(syncBloggers(db)).toEqual({ processed: 0, due: [] });
  });

  it('cleanupStaleTopics 在 mock 上不报错', () => {
    expect(() => cleanupStaleTopics(db)).not.toThrow();
  });
});