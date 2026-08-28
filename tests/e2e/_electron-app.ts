/**
 * Playwright Electron 测试工具
 *
 * 用法：
 *   import { launchAutoWriter, cleanupAutoWriter } from './_electron-app';
 *   const { app, window, userDataDir } = await launchAutoWriter();
 *   // ...
 *   await cleanupAutoWriter(app, userDataDir);
 *
 * 关键点：
 *  - 必须先 `npm run build` 生成 dist/
 *  - 通过 NODE_ENV=production 加载生产构建（无需 Vite dev server）
 *  - 启动时设置 AUTOWRITER_TEST_MODE=1，启用 main.cjs 的测试钩子
 *  - ⚠️ 隔离靠显式传 `--user-data-dir=<临时目录>`。Playwright 的 _electron.launch
 *    不会自动隔离 Electron 的 userData；不传就会被测 app 直接落到
 *    ~/Library/Application Support/<appName>，也就是用户的真实生产库，
 *    而 resetDb 会对每个表 DELETE FROM —— 等于每次跑 e2e 清空真实数据。
 *    因此本文件在启动后做硬断言：userData 必须等于临时目录，否则立刻抛错中止。
 *  - 强制设置 ELECTRON_DISABLE_GPU 等环境变量以保证 headless 稳定
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
}

export async function launchAutoWriter(opts: {
  env?: Record<string, string>;
  resetDb?: boolean;
  /**
   * 在 app 启动前往临时 userData 目录里预置文件（例如用旧版 schema 建一个
   * autoWriter.db），用于真正验证 electron/db.cjs 的 ALTER 迁移路径。
   * 入参就是即将传给 --user-data-dir 的目录。
   */
  seedUserData?: (dir: string) => void | Promise<void>;
} = {}): Promise<LaunchedApp> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autowriter-e2e-'));

  if (opts.seedUserData) await opts.seedUserData(userDataDir);

  const app = await electron.launch({
    // '.' 是应用入口（等价 npm run dev 的 electron .），--user-data-dir 是 Chromium 开关
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AUTOWRITER_TEST_MODE: '1',
      ELECTRON_DISABLE_GPU: '1',
      ELECTRON_ENABLE_LOGGING: '0',
      ...opts.env,
    },
    timeout: 30000,
  });

  let ok = false;
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // 测试模式下，preload 会暴露 window.electronAPI._test
    // 等到 _test 可用再返回（确保 test:invoke handler 已注册）
    await window.waitForFunction(
      () => typeof (window as any).electronAPI?._test?.invoke === 'function',
      { timeout: 10000 },
    );

    // 硬断言：app 确实落在临时目录。不成立就中止 —— 往下跑就是在动真实数据。
    const actual: string = await window.evaluate(async () => {
      return await (window as any).electronAPI._test.getUserDataDir();
    });
    if (!actual || fs.realpathSync(actual) !== fs.realpathSync(userDataDir)) {
      throw new Error(
        `userData 隔离失败：app 实际用 "${actual}"，期望 "${userDataDir}"。` +
        `继续跑会读写真实生产库，已中止。`,
      );
    }

    if (opts.resetDb !== false) {
      // 每个测试实例默认重置一次 db，避免顺序依赖（现在只作用于临时库）
      await window.evaluate(async () => {
        await (window as any).electronAPI._test.resetDb();
      });
    }

    ok = true;
    return { app, window, userDataDir };
  } finally {
    if (!ok) {
      try { await app.close(); } catch {}
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }
}

export async function cleanupAutoWriter(
  app: ElectronApplication,
  userDataDir: string,
): Promise<void> {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

/**
 * 调用 IPC handler —— 测试核心 API
 *
 * 例：
 *   const list = await invokeIpc(window, 'article:list', {});
 *   const article = await invokeIpc(window, 'article:get', 42);
 */
export async function invokeIpc<T = unknown>(
  window: Page,
  channel: string,
  ...args: unknown[]
): Promise<T> {
  return await window.evaluate(
    async ({ ch, a }) => {
      const api = (window as any).electronAPI;
      if (!api?._test) throw new Error('Test mode 未启用（_test API 不存在）');
      return await api._test.invoke(ch, ...a);
    },
    { ch: channel, a: args },
  );
}

/** 获取已注册 IPC channel 列表（用于断言"全部 handler 都被注册"）。 */
export async function listChannels(window: Page): Promise<string[]> {
  return await window.evaluate(async () => {
    return await (window as any).electronAPI._test.listChannels();
  });
}

/** 执行 SQL（构造夹具 / 断言 DB 状态）。生产环境下该钩子不注册。 */
export async function execSql<T = unknown>(
  window: Page,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  return await window.evaluate(
    async ({ s, p }) => {
      const api = (window as any).electronAPI;
      if (!api?._test?.execSql) throw new Error('Test mode 未启用（execSql 不存在）');
      return await api._test.execSql(s, p);
    },
    { s: sql, p: params },
  );
}
