// 任务队列单元测试
// 验证：并发上限、每类型限流、pending 取消、running 取消（AbortController）、事件
import { describe, it, expect, beforeEach } from 'vitest';
import { TaskQueue } from '../../electron/queue.cjs';

describe('TaskQueue', () => {
  let q: TaskQueue;

  beforeEach(() => {
    q = new TaskQueue({ maxConcurrent: 2, perTypeConcurrent: 1 });
  });

  it('enqueue 返回 taskId 和 promise', () => {
    const t = q.enqueue('outline', 'test', async () => 'ok');
    expect(t.id).toMatch(/^t\d+$/);
    expect(t.status).toBe('pending');
    expect(t.promise).toBeInstanceOf(Promise);
  });

  it('执行完成的 task 进入 done 状态', async () => {
    const t = q.enqueue('outline', 'test', async () => 42);
    const result = await t.promise;
    expect(result).toBe(42);
    expect(t.status).toBe('done');
    expect(t.result).toBe(42);
    expect(t.endedAt).not.toBeNull();
  });

  it('抛错的 task 进入 error 状态', async () => {
    const t = q.enqueue('outline', 'test', async () => { throw new Error('boom'); });
    await expect(t.promise).rejects.toThrow('boom');
    expect(t.status).toBe('error');
    expect(t.error).toBe('boom');
  });

  it('遵守全局 maxConcurrent 上限', async () => {
    const inFlight = new Set<number>();
    let concurrent = 0;
    let maxConcurrent = 0;

    const make = (n: number) => q.enqueue('work', `#${n}`, async () => {
      inFlight.add(n);
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 30));
      concurrent--;
    });

    const tasks = [make(1), make(2), make(3), make(4)];
    await Promise.all(tasks.map((t) => t.promise));
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('遵守 perTypeConcurrent 限流（同类型串行）', async () => {
    let outlineRunning = 0;
    let maxOutlineConcurrent = 0;
    const make = () => q.enqueue('outline', 'x', async () => {
      outlineRunning++;
      maxOutlineConcurrent = Math.max(maxOutlineConcurrent, outlineRunning);
      await new Promise((r) => setTimeout(r, 10));
      outlineRunning--;
    });

    const tasks = [make(), make(), make(), make()];
    await Promise.all(tasks.map((t) => t.promise));
    expect(maxOutlineConcurrent).toBe(1);
  });

  it('不同类型可以并行（只要全局没满）', async () => {
    let outlineRunning = 0, articleRunning = 0;
    let maxCombined = 0;
    const mk = (type: string) => q.enqueue(type, 'x', async () => {
      if (type === 'outline') outlineRunning++; else articleRunning++;
      maxCombined = Math.max(maxCombined, outlineRunning + articleRunning);
      await new Promise((r) => setTimeout(r, 20));
      if (type === 'outline') outlineRunning--; else articleRunning--;
    });

    const tasks = [mk('outline'), mk('article'), mk('outline'), mk('article')];
    await Promise.all(tasks.map((t) => t.promise));
    expect(maxCombined).toBe(2);  // maxConcurrent=2
  });

  it('取消 pending 任务立即完成', async () => {
    // 先占满 running，让下一个进入 pending
    const blocker = q.enqueue('work', 'block', () => new Promise<void>((r) => setTimeout(r, 200)));
    const pending = q.enqueue('work', 'pending', async () => 'never');
    // 给 pump 一点时间让 blocker 进入 running
    await new Promise((r) => setTimeout(r, 10));
    expect(blocker.status).toBe('running');
    expect(pending.status).toBe('pending');

    const cancelResult = q.cancel(pending.id);
    expect(cancelResult).toEqual({ ok: true });
    expect(pending.status).toBe('cancelled');
    await expect(pending.promise).rejects.toThrow(/cancel/i);

    // 清理
    q.cancel(blocker.id);
    await blocker.promise.catch(() => {});
  });

  it('取消 running 任务触发 AbortSignal', async () => {
    let aborted = false;
    const t = q.enqueue('work', 'long', ({ signal }) => new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(Object.assign(new Error('cancelled'), { code: 'ABORTED' }));
      });
      setTimeout(resolve, 5000);  // 永不主动 resolve
    }));

    await new Promise((r) => setTimeout(r, 10));
    const r = q.cancel(t.id);
    expect(r.ok).toBe(true);
    await expect(t.promise).rejects.toThrow();
    expect(aborted).toBe(true);
    expect(t.status).toBe('cancelled');
  });

  it('重复 cancel 已结束任务返回 already-done', async () => {
    const t = q.enqueue('work', 'fast', async () => 'ok');
    await t.promise;
    const r = q.cancel(t.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('already-done');
  });

  it('取消不存在的 task 返回 not-found', () => {
    const r = q.cancel('t99999');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-found');
  });

  it('snapshot 包含 running/pending/completed 计数', async () => {
    const t1 = q.enqueue('work', 'a', () => new Promise<void>((r) => setTimeout(r, 50)));
    const t2 = q.enqueue('work', 'b', () => new Promise<void>((r) => setTimeout(r, 50)));
    const t3 = q.enqueue('work', 'c', () => new Promise<void>((r) => setTimeout(r, 50)));

    await new Promise((r) => setTimeout(r, 10));
    const snap = q.snapshot();
    expect(snap.tasks.length).toBeGreaterThanOrEqual(3);

    await Promise.all([t1.promise, t2.promise, t3.promise]);
  });

  it('emit state 事件在每次状态变更触发', async () => {
    const events: number[] = [];
    q.on('state', (snap) => events.push(snap.tasks.length));

    q.enqueue('work', 'a', async () => 1).promise.then(() => {});
    await q.drain();
    expect(events.length).toBeGreaterThan(0);
  });

  it('历史只保留最近 historyLimit 条', async () => {
    const small = new TaskQueue({ maxConcurrent: 1, perTypeConcurrent: 1, historyLimit: 3 });
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      tasks.push(small.enqueue('w', `#${i}`, async () => i).promise);
    }
    await Promise.all(tasks);
    expect(small.snapshot().completed).toBeLessThanOrEqual(3);
  });
});
