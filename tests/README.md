# 测试目录

## 架构

```
tests/
├── unit/                          纯逻辑单元测试（vitest + Node）
│   ├── skills.test.ts
│   └── prompts.test.ts
└── e2e/                           Playwright + 真实 Electron
    ├── _electron-app.ts           启动器 + invokeIpc 辅助
    ├── ipc-registry.spec.ts       40+ IPC handler 注册表断言
    ├── ipc-handlers.spec.ts       IPC 关键链路 CRUD
    └── ui-smoke.spec.ts           UI 启动 + 侧边栏导航
```

## 设计决策

### 为什么 IPC 测试走 Playwright 而不是 vitest？

vitest 的 `vi.mock` 对 `.cjs` 文件内的 `require('electron')` **不生效**——Node CJS loader 与 vite 模块系统是两条独立链路。试过 `server.deps.inline`、模块别名、`__mocks__` 目录都绕过不了这个边界。

所以最终方案：
- **单元测试**：vitest，仅测试**不依赖 electron 的纯逻辑**（skills, prompts 等）
- **IPC 接口测试 + E2E**：Playwright + 真实 Electron，通过 `main.cjs` 的测试钩子直接调任意 handler

### 测试钩子机制（main.cjs / preload.cjs）

当 `AUTOWRITER_TEST_MODE=1`：
1. `main.cjs` 在 `registerIpc()` 之前**包装 `ipcMain.handle`**，把所有 listener 复制到内部 Map
2. 注册 4 个 `test:*` meta-handler：
   - `test:list-channels`：列已注册 channel
   - `test:invoke(channel, ...args)`：直接调任意 handler
   - `test:reset-db`：重置 SQLite 单例
   - `test:userdata`：取 userData 路径
3. `preload.cjs` 通过 `contextBridge` 暴露 `window.electronAPI._test.{listChannels, invoke, resetDb, getUserDataDir}`

生产构建时 `AUTOWRITER_TEST_MODE` 默认未设，钩子完全静默不生效。

## 运行

```bash
# 单元（快，< 5s）
npm run test:unit

# IPC 接口（中等，~30s，需先 build）
npm run test:e2e:ipc

# UI smoke（中等，~30s，需先 build）
npm run test:e2e:ui

# 全部
npm run test                  # 自动 pretest:build + 跑全部

# 单跑 + UI
npm run test:e2e:headed       # 带浏览器/窗口
npm run test:e2e:debug        # Playwright Inspector

# 覆盖率
npm run test:coverage
```

## 写新测试

### 加一个 IPC handler 测试

1. 在 `tests/e2e/ipc-registry.spec.ts` 的 `EXPECTED_CHANNELS` 加一行
2. 在 `tests/e2e/ipc-handlers.spec.ts` 加业务断言
3. （可选）在 `SAFE_SAMPLE_ARGS` 加 smoke 入参

### 加一个新模块的单元测试

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);

describe('mymodule', () => {
  let mod;
  beforeAll(() => { mod = require_('../../electron/mymodule.cjs'); });
  it('does X', () => {
    expect(mod.doX()).toBe(/* ... */);
  });
});
```

注意：被测模块不能 `require('electron')`，否则单元测试加载失败。

### 加一个 E2E 流程

```ts
import { test, expect, beforeEach, afterEach } from '@playwright/test';
import { launchAutoWriter, cleanupAutoWriter, invokeIpc } from './_electron-app';

let ctx;
beforeEach(async () => {
  ctx = await launchAutoWriter();
});
afterEach(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
});

test('关键流程', async () => {
  // 直接调 IPC
  const list = await invokeIpc(ctx.window, 'article:list', {});
  expect(list).toEqual([]);

  // 或操作 UI
  await ctx.window.getByText('写文章').click();
});
```

## CI

`.github/workflows/test.yml`：
- `unit-and-ipc` job：跑 vitest（unit + IPC）—— 但 IPC 已迁到 E2E，所以现在仅 vitest
- `e2e` job：3 平台并行跑 Playwright E2E

## 注意事项

- 所有 E2E 用例必须先 `npm run build` 产 `dist/`，否则 Electron 加载不到 renderer
- `pretest:e2e` 钩子自动 build
- 每个测试用独立 userData 目录（`os.tmpdir()`），互不污染
- 改 `electron/ipc.cjs` 必须同步改 `EXPECTED_CHANNELS`，否则 CI 红
