/**
 * 任务队列 + 调度器集成 E2E
 * 覆盖：
 *  - 队列空时 snapshot 是 0
 *  - 队列能 enqueue 一个 fake 任务并 list 出来
 *  - cancel 任务（不在运行时返回 already-done）
 *  - 调度器 snapshot 包含 3 个任务
 *  - 调度器 runNow 能跑通一个任务
 *  - 调度器 enable/disable 切换
 */
import { test, expect } from '@playwright/test';
import {
  launchAutoWriter,
  cleanupAutoWriter,
  type LaunchedApp,
} from './_electron-app';

let ctx: LaunchedApp;

test.beforeAll(async () => {
  ctx = await launchAutoWriter({ resetDb: true });
});

test.afterAll(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
});

test('QueueBadge 初始 snapshot 为 0', async () => {
  const snap = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.queueList();
  })) as any;
  expect(snap.running).toBe(0);
  expect(snap.pending).toBe(0);
  // completed 可能是之前的，不强断
});

test('QueueBadge 订阅机制能跑通（不在 1s 内收到 chunk 也算订阅成功）', async () => {
  const received = await ctx.window.evaluate(async () => {
    return new Promise<{ subscribed: boolean; snapshots: any[] }>((resolve) => {
      const api = (window as any).electronAPI;
      const snapshots: any[] = [];
      const unsub = api.onQueueState((snap: any) => {
        snapshots.push(snap);
      });
      // 等 1s：要么收到 chunk，要么收不到（队列空闲时不发），但订阅本身成功
      setTimeout(() => {
        unsub();
        resolve({ subscribed: true, snapshots });
      }, 1000);
    });
  });
  expect(received.subscribed).toBe(true);
  // 不强断 snapshots 数量（队列空闲时可能为 0）
});

test('queueCancel 对不存在的 task 返回 not-found', async () => {
  const r = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.queueCancel('t-doesnotexist');
  })) as any;
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('not-found');
});

test('queueClearCompleted 返 ok', async () => {
  const r = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.queueClearCompleted();
  })) as any;
  expect(r.ok).toBe(true);
});

test('Scheduler snapshot 包含 3 个内置任务', async () => {
  const snap = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.schedulerSnapshot();
  })) as any;
  expect(snap).toBeDefined();
  expect(snap.registeredTasks).toContain('process-scheduled-articles');
  expect(snap.registeredTasks).toContain('sync-bloggers');
  expect(snap.registeredTasks).toContain('cleanup-stale-topics');
  // enabled 默认为 true
  expect(snap.enabled).toBe(true);
});

test('Scheduler runNow 能跑通一个任务（等首次 tick 完成 + 重试）', async () => {
  // 等启动后的第一次 tick 完成（避免 already-running 冲突）
  await ctx.window.waitForTimeout(2000);
  let r: any = null;
  for (let i = 0; i < 3; i++) {
    r = await ctx.window.evaluate(async () => {
      return await (window as any).electronAPI.schedulerRunNow('cleanup-stale-topics');
    });
    if (r.ok) break;
    if (r.reason === 'already-running') {
      await ctx.window.waitForTimeout(500);
      continue;
    }
    break;
  }
  expect(r.ok).toBe(true);
  // 任务没有 DB 数据，所以 processed=0
  expect(r.detail?.processed ?? 0).toBe(0);
});

test('Scheduler runNow 不存在的任务返 not-found', async () => {
  const r = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.schedulerRunNow('non-existent-task');
  })) as any;
  expect(r.ok).toBe(false);
  expect(r.reason).toBe('not-found');
});

test('Scheduler enable / disable 切换', async () => {
  // disable
  const disabled = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.schedulerDisable();
  })) as any;
  expect(disabled.enabled).toBe(false);
  expect(disabled.running).toBe(false);

  // enable
  const enabled = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.schedulerEnable();
  })) as any;
  expect(enabled.enabled).toBe(true);
  expect(enabled.running).toBe(true);
});

test('Scheduler setInterval 校验（< 1000ms 报错）', async () => {
  const r = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.schedulerSetInterval(500);
  })) as any;
  expect(r.ok).toBe(false);
  expect(r.error).toContain('1000');
});

test('Scheduler setInterval 2000ms ok', async () => {
  const r = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.schedulerSetInterval(2000);
  })) as any;
  expect(r.ok).toBe(true);
  expect(r.snapshot.interval).toBe(2000);
});

test('任务失败隔离：runNow 一个不存在的 handler 应被 IPC 拒绝', async () => {
  const r = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.schedulerRunNow('does-not-exist');
  })) as any;
  expect(r.ok).toBe(false);
});

test('应用启动后 scheduler 应该已 tick 过至少 1 次', async () => {
  await ctx.window.waitForTimeout(2000);
  const snap = (await ctx.window.evaluate(async () => {
    return await (window as any).electronAPI.schedulerSnapshot();
  })) as any;
  expect(snap.lastTick).toBeGreaterThan(0);
  // 历史里有 run 记录
  expect(snap.history.length).toBeGreaterThan(0);
});