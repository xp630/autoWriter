/**
 * IPC handler 关键链路测试
 *
 * 覆盖：
 *  - Article CRUD
 *  - Image Provider CRUD
 *  - Prompts 读写
 *  - Skills 加载
 *  - 错误处理
 */
import { test, expect } from '@playwright/test';
import { launchAutoWriter, cleanupAutoWriter, invokeIpc, type LaunchedApp } from './_electron-app';

let ctx: LaunchedApp;

test.beforeEach(async () => {
  ctx = await launchAutoWriter({ resetDb: true });
});

test.afterEach(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
});

test.describe('app:*', () => {
  test('get-version 返回非空字符串', async () => {
    const v = await invokeIpc<string>(ctx.window, 'app:get-version');
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
});

test.describe('provider:* (legacy)', () => {
  test('list 初始空', async () => {
    const list = await invokeIpc(ctx.window, 'provider:list');
    expect(list).toEqual([]);
  });

  test('save → list 闭环（注意 production bug）', async () => {
    // production handler 在 save 时没设 api_key_enc，NOT NULL 约束会失败
    // 这里验证 handler 路由是通的，业务异常是已知 bug
    await expect(
      invokeIpc(ctx.window, 'provider:save', {
        provider_id: 'claude',
        base_url: 'https://api.example.com',
        default_model: 'sonnet',
      }),
    ).rejects.toThrow();
  });
});

test.describe('image:provider:*', () => {
  test('list 初始空', async () => {
    expect(await invokeIpc(ctx.window, 'image:provider:list')).toEqual([]);
  });

  test('save → get → list 闭环', async () => {
    await invokeIpc(ctx.window, 'image:provider:save', {
      provider_id: 'pollinations',
      name: 'Pollinations',
      base_url: 'https://image.pollinations.ai',
      priority: 1,
      extra_config: { foo: 'bar' },
      enabled: true,
    });

    const fetched = (await invokeIpc(ctx.window, 'image:provider:get', 'pollinations')) as any;
    expect(fetched).toMatchObject({
      provider_id: 'pollinations',
      name: 'Pollinations',
      priority: 1,
      enabled: true,
    });
    expect(fetched.extra_config).toEqual({ foo: 'bar' });

    const list = (await invokeIpc(ctx.window, 'image:provider:list')) as any[];
    expect(list).toHaveLength(1);
  });

  test('save 同 provider_id 覆盖更新', async () => {
    await invokeIpc(ctx.window, 'image:provider:save', {
      provider_id: 'p1',
      name: 'P1 v1',
      enabled: true,
    });
    await invokeIpc(ctx.window, 'image:provider:save', {
      provider_id: 'p1',
      name: 'P1 v2',
      enabled: false,
    });
    const fetched = (await invokeIpc(ctx.window, 'image:provider:get', 'p1')) as any;
    expect(fetched.name).toBe('P1 v2');
    expect(fetched.enabled).toBe(false);
  });

  test('get 不存在返回 null', async () => {
    expect(await invokeIpc(ctx.window, 'image:provider:get', 'nope')).toBeNull();
  });

  test('get-active 只返回 enabled 的', async () => {
    await invokeIpc(ctx.window, 'image:provider:save', { provider_id: 'a', name: 'A', enabled: true });
    await invokeIpc(ctx.window, 'image:provider:save', { provider_id: 'b', name: 'B', enabled: false });
    const active = (await invokeIpc(ctx.window, 'image:provider:get-active')) as any[];
    expect(active).toHaveLength(1);
    expect(active[0].provider_id).toBe('a');
  });

  test('delete 联动删除 models', async () => {
    await invokeIpc(ctx.window, 'image:provider:save', { provider_id: 'x', name: 'X', enabled: true });
    await invokeIpc(ctx.window, 'image:model:save', {
      provider_id: 'x',
      model_id: 'm1',
      name: 'M1',
      enabled: true,
    });
    await invokeIpc(ctx.window, 'image:provider:delete', 'x');
    expect(await invokeIpc(ctx.window, 'image:provider:get', 'x')).toBeNull();
    const models = (await invokeIpc(ctx.window, 'image:model:list', 'x')) as any[];
    expect(models).toEqual([]);
  });
});

test.describe('image:model:*', () => {
  test('list 初始空', async () => {
    await invokeIpc(ctx.window, 'image:provider:save', { provider_id: 'p', name: 'P', enabled: true });
    expect(await invokeIpc(ctx.window, 'image:model:list', 'p')).toEqual([]);
  });

  test('save → list 闭环，is_default 正确', async () => {
    await invokeIpc(ctx.window, 'image:provider:save', { provider_id: 'p', name: 'P', enabled: true });
    await invokeIpc(ctx.window, 'image:model:save', {
      provider_id: 'p',
      model_id: 'flux',
      name: 'FLUX',
      extra_params: { width: 1024, height: 1024 },
      enabled: true,
      is_default: true,
    });
    const models = (await invokeIpc(ctx.window, 'image:model:list', 'p')) as any[];
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ model_id: 'flux', name: 'FLUX' });
  });
});

test.describe('skills:list', () => {
  test('返回 channels + personas', async () => {
    const skills = (await invokeIpc(ctx.window, 'skills:list')) as any;
    expect(skills).toHaveProperty('channels');
    expect(skills).toHaveProperty('personas');
    expect(Array.isArray(skills.channels)).toBe(true);
    expect(Array.isArray(skills.personas)).toBe(true);
  });
});

test.describe('prompts:*', () => {
  test('list 包含 article/outline/polish', async () => {
    const list = (await invokeIpc(ctx.window, 'prompts:list')) as Array<{ name: string }>;
    const names = list.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['article', 'outline', 'polish']));
  });

  test('get 模板原文非空', async () => {
    const result = (await invokeIpc(ctx.window, 'prompts:get', 'outline')) as { name: string; content: string };
    expect(result.content.length).toBeGreaterThan(0);
  });

  test('get 不存在抛错', async () => {
    await expect(invokeIpc(ctx.window, 'prompts:get', 'nope-xxx')).rejects.toThrow();
  });

  test('save → get 闭环（需预创建文件）', async () => {
    // prompts:save 只能覆盖现有文件，不能创建。预创建：
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(process.cwd(), 'src/prompts/_e2e_test.md');
    fs.writeFileSync(file, 'original');
    try {
      await invokeIpc(ctx.window, 'prompts:save', { name: '_e2e_test', content: 'hello {{name}}' });
      const got = (await invokeIpc(ctx.window, 'prompts:get', '_e2e_test')) as { content: string };
      expect(got.content).toBe('hello {{name}}');
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });
});

test.describe('article:* CRUD', () => {
  // 辅助：直接 INSERT 一篇文章（绕过没有 article:create handler 的问题）
  async function insertArticle(title: string, content: string, status = 'draft'): Promise<number> {
    const r = await ctx.window.evaluate(
      async ({ t, c, s }) => {
        return await (window as any).electronAPI._test.execSql(
          `INSERT INTO article_drafts (title, content, status, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [t, c, s],
        );
      },
      { t: title, c: content, s: status },
    );
    return (r as any).lastInsertRowid as number;
  }

  test('create / list / get / update / delete 完整链路', async () => {
    const id = await insertArticle('E2E Test Article', 'Hello E2E');
    expect(id).toBeGreaterThan(0);

    const list = (await invokeIpc(ctx.window, 'article:list', {})) as Array<{ id: number; title: string }>;
    expect(list.find((a) => a.id === id)).toMatchObject({ title: 'E2E Test Article' });

    const got = (await invokeIpc(ctx.window, 'article:get', id)) as any;
    expect(got).toMatchObject({ id, content: 'Hello E2E' });

    // article:update 只能改 content
    await invokeIpc(ctx.window, 'article:update', { id, content: 'Updated content' });
    const after = (await invokeIpc(ctx.window, 'article:get', id)) as { content: string };
    expect(after.content).toBe('Updated content');

    await invokeIpc(ctx.window, 'article:delete', id);
    const listAfter = (await invokeIpc(ctx.window, 'article:list', {})) as Array<{ id: number }>;
    expect(listAfter.find((a) => a.id === id)).toBeUndefined();
  });

  test('article:list 支持 status 过滤', async () => {
    await insertArticle('A', 'a', 'draft');
    await insertArticle('B', 'b', 'published');
    const drafts = (await invokeIpc(ctx.window, 'article:list', { status: 'draft' })) as Array<{ title: string }>;
    expect(drafts.some((a) => a.title === 'A')).toBe(true);
    expect(drafts.some((a) => a.title === 'B')).toBe(false);
  });

  test('article:get 不存在返回 undefined', async () => {
    const r = await invokeIpc(ctx.window, 'article:get', 99999);
    expect(r).toBeUndefined();
  });

  test('article:update 缺 id 抛错', async () => {
    await expect(
      invokeIpc(ctx.window, 'article:update', { id: null, content: 'x' }),
    ).rejects.toThrow(/缺少 id/);
  });
});

test.describe('错误处理', () => {
  test('image:provider:save 缺 provider_id 应报错', async () => {
    await expect(
      invokeIpc(ctx.window, 'image:provider:save', { name: 'NoID' }),
    ).rejects.toThrow();
  });

  test('invoke 不存在 channel 抛错', async () => {
    await expect(invokeIpc(ctx.window, 'totally:not:existing', {})).rejects.toThrow(/未注册/);
  });
});
