import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest 配置 — 仅单元测试（纯逻辑）
 *
 * 重要：vitest 的 vi.mock 对 .cjs 内的 require('electron') 不生效，
 * 因为 Node CJS loader 与 vite 模块系统是两条独立链路。
 *
 * 因此：
 *  - 单元测试（skills/prompts 等纯逻辑）→ vitest
 *  - IPC 接口测试 → Playwright + 真实 Electron（见 tests/ipc-e2e/）
 *  - UI 端到端 → Playwright + 真实 Electron（见 tests/e2e/）
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/unit/**/*.{test,spec}.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    testTimeout: 10000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['electron/**/*.cjs'],
      exclude: ['electron/main.cjs', 'electron/init-image-providers.cjs', 'electron/db.cjs'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
