/**
 * IPC handler 注册表测试
 *
 * 目标：
 *  1. 确保所有期望的 IPC channel 都已注册
 *  2. 防漏：新加 handler 必同步改 EXPECTED_CHANNELS
 */
import { test, expect } from '@playwright/test';
import { launchAutoWriter, listChannels, cleanupAutoWriter, invokeIpc } from './_electron-app';

test.describe('IPC handler 注册表', () => {
  test('注册的 channel 数量 = 预期清单数量', async () => {
    const { app, window, userDataDir } = await launchAutoWriter();
    try {
      const actual = await listChannels(window);
      const expected = EXPECTED_CHANNELS.map(([ch]) => ch);

      // 找出差异（避免直接失败，给出诊断信息）
      const missing = expected.filter((ch) => !actual.includes(ch));
      const extra = actual.filter((ch) => !expected.includes(ch));

      // 数量一致
      expect(actual.length, `actual=${actual.length}, expected=${expected.length}, missing=${missing}, extra=${extra}`).toBe(expected.length);

      // 每个期望的 channel 必须存在
      for (const ch of expected) {
        expect(actual, `缺少 channel: ${ch}`).toContain(ch);
      }

      // 不允许出现未声明的 channel（防拼写错误）
      for (const ch of actual) {
        expect(expected, `channel "${ch}" 未在 EXPECTED_CHANNELS 清单中声明`).toContain(ch);
      }
    } finally {
      await cleanupAutoWriter(app, userDataDir);
    }
  });

  test('所有 handler 都能被 invoke（最小 smoke）', async () => {
    const { app, window, userDataDir } = await launchAutoWriter();
    try {
      for (const [channel, sampleArgs, acceptUndefined] of SAFE_SAMPLE_ARGS) {
        let result: unknown;
        try {
          result = await invokeIpc(window, channel, ...sampleArgs);
        } catch (err) {
          const msg = (err as Error).message;
          // "channel 未注册"是真正的失败
          if (msg.includes('未注册')) {
            throw new Error(`Channel "${channel}" 调用失败: ${msg}`);
          }
          // 业务异常（缺 key 等）不算失败
          continue;
        }
        if (!acceptUndefined) {
          expect(result, `Channel "${channel}" 返回 undefined`).not.toBeUndefined();
        }
      }
    } finally {
      await cleanupAutoWriter(app, userDataDir);
    }
  });
});

/**
 * 所有 IPC channel 清单 + 简短描述。
 * 改 electron/ipc.cjs 必须同步改这里。
 */
const EXPECTED_CHANNELS: Array<[string, string]> = [
  ['app:get-version', '应用版本'],
  ['agent:detect', '检测本地 CLI'],
  ['agent:list-models', '列出 CLI 模型'],
  ['provider:save', '保存 Provider 配置'],
  ['provider:list', '列出 Provider'],
  ['provider:get-default', '默认 Provider'],
  ['image:provider:list', '列出图片 Provider'],
  ['image:provider:get', '取一个图片 Provider'],
  ['image:provider:save', '保存图片 Provider'],
  ['image:provider:delete', '删除图片 Provider'],
  ['image:provider:get-active', '启用中的图片 Provider'],
  ['image:model:list', '列出模型'],
  ['image:model:save', '保存模型'],
  ['skills:list', '列出 Skills'],
  ['prompts:list', '列出 prompt 模板'],
  ['prompts:get', '取一个 prompt'],
  ['prompts:save', '保存 prompt'],
  ['web:fetch', '抓取网页'],
  ['article:outline', '生成大纲（流式）'],
  ['article:article', '生成正文（流式）'],
  ['article:polish', '润色（流式）'],
  ['article:list', '列出文章'],
  ['article:get', '取一篇文章'],
  ['article:update', '更新文章'],
  ['article:delete', '删除文章'],
  ['article:schedule', '调度发布'],
  ['article:unschedule', '取消调度'],
  ['article:publish', '发布'],
  ['article:unpublish', '取消发布'],
  ['article:images', '文章关联图片'],
  ['images:list', '列出图片'],
  ['images:delete', '删除图片'],
  ['images:update', '更新图片'],
  ['images:refs', '图片引用查询'],
  ['image:link-to-article', '关联图片到文章'],
  ['image:generate', '生成图片'],
  ['image:generate-for', '为占位符生成'],
  ['image:upload-for', '为占位符上传'],
  ['image:read-dataurl', '读 data URL'],
  ['file:save-md', '保存 Markdown'],
  ['file:save-image', '保存图片'],
  ['queue:list', '队列状态快照'],
  ['queue:cancel', '取消队列任务'],
  ['queue:clear-completed', '清空已完成'],
  ['scheduler:snapshot', '调度器状态'],
  ['scheduler:enable', '启动调度器'],
  ['scheduler:disable', '停止调度器'],
  ['scheduler:run-now', '手动跑任务'],
  ['scheduler:set-interval', '修改调度间隔'],
  ['analysis:run', '跑内容分析'],
  ['analysis:get', '取单条分析'],
  ['analysis:list', '列出分析'],
  ['analysis:delete', '删除分析'],
  // 测试钩子（自身）
  ['test:list-channels', '测试用：列 channels'],
  ['test:invoke', '测试用：调 handler'],
  ['test:reset-db', '测试用：重置 db'],
  ['test:userdata', '测试用：userData 路径'],
  ['test:exec-sql', '测试用：执行 SQL'],
];

/**
 * 每个 handler 的"安全最小入参"——能跑通且不依赖外部资源。
 * 流式生成（article:outline/article/polish）跳过，因为会真去调 AI。
 *
 * 第二个元素 optionalAcceptUndefined：handler 返回 undefined 也算通过（如 article:get 缺记录）
 */
const SAFE_SAMPLE_ARGS: Array<[string, unknown[], boolean?]> = [
  ['app:get-version', []],
  ['agent:detect', []],
  ['agent:list-models', ['claude']],
  ['provider:list', []],
  ['provider:get-default', []],
  ['image:provider:list', []],
  ['image:provider:get', ['non-existent']],
  ['image:provider:get-active', []],
  ['image:model:list', []],
  ['skills:list', []],
  ['prompts:list', []],
  ['prompts:get', ['article']],
  ['article:list', [{}]],
  // article:get 缺记录返回 undefined（better-sqlite3 行为）
  ['article:get', [99999], true],
  ['images:list', []],
  ['images:refs', [99999], true],
  ['scheduler:snapshot', [], true],  // 启动后才存在
  ['scheduler:enable', [], true],
  ['analysis:list', [{}]],
  ['article:images', [99999], true],
  ['test:list-channels', []],
  ['test:userdata', []],
];
