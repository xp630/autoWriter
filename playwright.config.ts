import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 配置 — E2E 测试
 *
 * 关键点：
 *  - 不需要 webServer（不依赖浏览器服务器）
 *  - 通过 _electron.launch 直接启动 Electron 应用
 *  - 复用一份生产构建产物（dist/index.html），无需 Vite dev server
 *  - 默认无头模式（headless），需要观察时用 --headed
 *
 * CI 用例：跑前先 `npm run build` 产 dist/
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Electron 多个 app 实例会冲突
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30000,
  expect: { timeout: 5000 },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'electron',
      // Playwright 启动 Electron 时使用默认 platforms
      // 注意：mac/win/linux 都跑同一个用例，需要 CI 三平台分别构建
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
