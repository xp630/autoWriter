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
 *  - 每个测试用独立的 userData 目录，隔离 SQLite 状态
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
} = {}): Promise<LaunchedApp> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autowriter-e2e-'));

  const app = await electron.launch({
    args: ['.'],
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

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // 测试模式下，preload 会暴露 window.electronAPI._test
  // 等到 _test 可用再返回（确保 test:invoke handler 已注册）
  await window.waitForFunction(
    () => typeof (window as any).electronAPI?._test?.invoke === 'function',
    { timeout: 10000 },
  );

  if (opts.resetDb !== false) {
    // 每个测试实例默认重置一次 db，避免顺序依赖
    await window.evaluate(async () => {
      await (window as any).electronAPI._test.resetDb();
    });
  }

  return { app, window, userDataDir };
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
