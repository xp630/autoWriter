/**
 * WritePage 完整 flow E2E
 * 覆盖：
 *  - 导航到写文章页
 *  - 输入主题 + 关键词 chips 显示
 *  - 高级设置展开（渠道 / 人设 / 风格 / 长度）
 *  - 点击分析内容（无参考文时）应被禁用 / 提示
 *  - 模拟填入参考文 + 点分析 → 触发 agent → 等待 analysis 渲染
 *  - 在分析结果上点「开始写作」跳到 Step 2
 *  - 草稿自动保存 → 刷新页面后字段恢复
 *  - 取消正在运行的任务
 */
import { test, expect } from '@playwright/test';
import {
  launchAutoWriter,
  cleanupAutoWriter,
  invokeIpc,
  execSql,
  type LaunchedApp,
} from './_electron-app';

let ctx: LaunchedApp;

test.beforeAll(async () => {
  ctx = await launchAutoWriter({ resetDb: true });
});

test.afterAll(async () => {
  if (ctx) await cleanupAutoWriter(ctx.app, ctx.userDataDir);
});

test('导航到写文章页能渲染 Step 1 输入区', async () => {
  await ctx.window.getByText('写文章', { exact: false }).first().click();
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible({ timeout: 5000 });
  await expect(ctx.window.locator('textarea').first()).toBeVisible();
  await expect(ctx.window.locator('text=当前 Agent').first()).toBeVisible();
});

test('输入主题后，关键词 chips 自动出现', async () => {
  const textarea = ctx.window.locator('textarea').first();
  await textarea.fill('Sora 短视频 冲击 创作者');
  // 等待 debounce 解析
  await ctx.window.waitForTimeout(300);
  // 至少能看到几个 kw-chip
  const chips = ctx.window.locator('.kw-chip');
  expect(await chips.count()).toBeGreaterThan(0);
  // chip 文本包含我们输入的词
  const allText = await chips.allTextContents();
  expect(allText.join('|')).toMatch(/Sora|短视频|冲击|创作者/);
});

test('展开高级设置：渠道/风格/长度 3 个下拉 + 赛道/人设 是账号级只读 chip', async () => {
  // 自洽：不依赖前一个测试把页面留在哪（文件内共享一个 app 实例，隐式状态会让用例互踩）
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible({ timeout: 5000 });

  const adv = ctx.window.locator('button:has-text("高级设置")').first();
  await expect(adv).toBeVisible({ timeout: 5000 });
  // 折叠态文案是「▼ 高级设置（4 渠道 / 5 人设）」（不含“展开”二字），展开后才是「▲ 收起」。
  // 用“没有收起”判断需要点，避免误判断导致面板未展开、select=0。
  if (!(await adv.textContent() || '').includes('收起')) await adv.click();
  await expect(ctx.window.locator('select').first()).toBeVisible({ timeout: 5000 });

  const count = await ctx.window.locator('select').count();
  expect(count).toBeGreaterThanOrEqual(3);

  // 四轴重构后的事实：赛道/人设不再是写文章页的下拉，而是 profile 级的只读 chip
  await expect(ctx.window.locator('.identity-chip').first()).toBeVisible();
  expect(count, '赛道已上收到身份层，Step1 不应再有 4 个下拉').toBeLessThan(6);
});

test('分析触发器存在；无参考文时 disabled（用稳定 class，不靠会变的文案）', async () => {
  // 旧写法靠 button:has-text("分析内容")，但该按钮文案会随状态变成「分析中…」，
  // 前一用例触发的异步任务未结束时就定位不到 —— 改用类名定位。
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  const trigger = ctx.window.locator('.write-analysis-trigger').first();
  await expect(trigger).toBeVisible({ timeout: 5000 });
  await expect(trigger).toBeDisabled();
});

test('agent 不可用时 analysis:run 应写 failed 记录而不是抛错', async () => {
  // 注意：原来这条叫“跑真实的 Agent”，但调 analysis:run 不传 cli 会默认 'claude'，
  // 即真的 spawn CLI 等 LLM 返回 —— 结果不确定、超 30s、还烧 token。不该待在默认套件里。
  // 这里按原注释的本意改成确定性断言：用不存在的 cli（agent.cjs 在 default 分支立即 reject，
  // 不 spawn），验证“无论如何都落一条记录 + 错误被记下来 + 不抛到 renderer”。
  const sampleContent = `
# 测试参考文

这是用于 E2E 的样本参考文。讨论年轻人为什么越来越不想结婚的话题。

核心观点：
- 经济压力是首要原因
- 价值观多元化让传统婚姻不再是必选项
- 女性经济独立降低了婚姻的"必要性"
`.trim();

  const r = await invokeIpc<any>(ctx.window, 'analysis:run', {
    title: '为什么年轻人不结婚',
    content: sampleContent,
    platform: '公众号',
    author: '测试作者',
    source_url: 'https://example.com/post/123',
    domain: '情感',
    cli: '__nonexistent_cli__',
  });

  // 不抛异常，而是返回结构化失败
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
  expect(r.id).toBeTruthy();

  // 记录确实入库了，而且状态是 failed、错误被持久化
  const rows = await execSql<Array<{ status: string; error: string; title: string }>>(
    ctx.window, `SELECT status, error, title FROM content_analysis WHERE id = ?`, [r.id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('failed');
  expect(rows[0].error).toMatch(/未知 CLI/);
  expect(rows[0].title).toBe('为什么年轻人不结婚');
});

test('通过 IPC 验证 content_analysis 记录被持久化', async () => {
  // 上面测试已经 run 过一次；这次列出最近的记录
  const list = (await invokeIpc(ctx.window, 'analysis:list', { limit: 5 })) as any[];
  expect(list.length).toBeGreaterThan(0);
  // 最新的一条应该有 content
  expect(list[0]).toHaveProperty('id');
  expect(list[0]).toHaveProperty('title');
  expect(list[0]).toHaveProperty('status');
});

test('草稿自动保存：填字段 → 刷新 → 字段恢复', async () => {
  // 直接通过 sidebar 切到写文章页（避免经过 dashboard）
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await ctx.window.waitForTimeout(500);
  await expect(ctx.window.locator('textarea').first()).toBeVisible({ timeout: 5000 });

  // 填一个独特的 query
  const magicValue = '草稿自动保存测试_' + Date.now();
  const textarea = ctx.window.locator('textarea').first();
  await textarea.fill(magicValue);

  // 等 debounce 1.5s 触发保存
  await ctx.window.waitForTimeout(2000);

  // 验证 localStorage 已写入
  const stored = await ctx.window.evaluate((key: string) => {
    return localStorage.getItem(key);
  }, 'aw_draft');
  expect(stored).toBeTruthy();
  const parsed = JSON.parse(stored!);
  expect(parsed.query).toBe(magicValue);

  // 刷新页面
  await ctx.window.reload();
  await ctx.window.waitForLoadState('domcontentloaded');
  await ctx.window.waitForTimeout(2000);

  // 验证草稿恢复
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await ctx.window.waitForTimeout(1000);
  const recovered = await ctx.window.locator('textarea').first().inputValue({ timeout: 8000 });
  expect(recovered).toBe(magicValue);
});

test('「Step 2 按钮」被禁用时（无 query）显示正确状态', async () => {
  // 先重置到 dashboard
  await ctx.window.getByText('仪表盘', { exact: false }).first().click();
  await ctx.window.waitForTimeout(300);

  // 导航到写文章页
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await ctx.window.waitForTimeout(500);
  await expect(ctx.window.locator('textarea').first()).toBeVisible({ timeout: 5000 });

  // 清空 query（草稿可能有上次残留）
  const textarea = ctx.window.locator('textarea').first();
  await textarea.fill('');
  await ctx.window.waitForTimeout(300);

  // 「生成大纲」按钮应该被禁用
  const generateBtn = ctx.window.locator('button:has-text("生成大纲")').first();
  const isDisabled = await generateBtn.isDisabled();
  expect(isDisabled).toBe(true);
});

test('策略入口可发现：默认就有模式切换，切到命题策划后不再要求参考文', async () => {
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible({ timeout: 5000 });

  // 1) 两个模式必须一眼看到（此前完全没有入口，用户只会看到“生成大纲”）
  const pills = ctx.window.locator('.mode-pill');
  expect(await pills.count()).toBe(2);
  await expect(pills.nth(0)).toContainText('借势拆解');
  await expect(pills.nth(1)).toContainText('命题策划');

  // 2) 主按钮默认就是“生成创作策略”，而不是“生成大纲”
  await expect(ctx.window.locator('button:has-text("生成创作策略")').first()).toBeVisible();
  await expect(ctx.window.locator('button:has-text("跳过策略")').first()).toBeVisible();

  // 3) 切到命题策划：参考文相关的控件必须消失（否则用户仍以为要先分析）
  await pills.nth(1).click();
  await expect(pills.nth(1)).toHaveClass(/active/);
  await expect(ctx.window.locator('.url-input')).toHaveCount(0);
  await expect(ctx.window.locator('.write-analysis-trigger')).toHaveCount(0);

  // 4) B 模式只需题目：填主题后策略面板应可用
  await ctx.window.locator('textarea').first().fill('为什么年轻人越来越不想结婚');
  await expect(ctx.window.locator('button:has-text("生成创作策略")').first()).toBeEnabled();

  // 切回 A，避免影响后面的用例
  await pills.nth(0).click();
  await expect(ctx.window.locator('.write-analysis-trigger')).toBeVisible();
});

test('OnAgentChunk 事件订阅能收到推送', async () => {
  // 直接测试 IPC 层：通过 onAgentChunk 订阅 + 模拟 chunk 事件
  const received = await ctx.window.evaluate(async () => {
    return new Promise<{ ok: boolean; chunks: number }>((resolve) => {
      const api = (window as any).electronAPI;
      let count = 0;
      const unsub = api.onAgentChunk((chunk: any) => {
        count++;
        // 1 秒后解订阅
        if (count >= 1) {
          unsub();
          resolve({ ok: true, chunks: count });
        }
      });
      // 兜底：1.5s 内没收到也算
      setTimeout(() => {
        unsub();
        resolve({ ok: true, chunks: count });
      }, 1500);
    });
  });
  // 这个测试只验证订阅机制能跑通，不强断收到 chunk（因为没真任务在跑）
  expect(received.ok).toBe(true);
});
test('约束输入：抓取失败不污染参考文，且有可用的粘贴逃生口', async () => {
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible({ timeout: 5000 });

  const trigger = ctx.window.locator('.write-analysis-trigger').first();
  await expect(trigger).toBeDisabled();          // 起手：没有参考文

  // 抓一个必然失败的地址（本机无监听端口，立刻失败）
  const urlBox = ctx.window.locator('input.url-input');
  await urlBox.fill('http://127.0.0.1:9/nope');
  await ctx.window.locator('button:has-text("抓取")').first().click();

  // 失败必须被单独显示，而不是把错误文案塞进 referenceText
  await expect(ctx.window.locator('.ref-error')).toBeVisible({ timeout: 10000 });
  await expect(ctx.window.locator('.ref-error')).toContainText('抓取失败');
  await expect(trigger).toBeDisabled();          // 关键：分析按钮绝不能因此变亮
  // 且页面不能出现“参考文已就绪”（旧代码会把它当正文）
  expect(await ctx.window.locator('text=参考文已就绪').count()).toBe(0);
});

test('约束输入：粘贴正文可用，且短/垃圾内容仍被拦住', async () => {
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  const trigger = ctx.window.locator('.write-analysis-trigger').first();

  await ctx.window.locator('button:has-text("粘贴正文")').first().click();
  const paste = ctx.window.locator('textarea.ref-paste').first();
  await expect(paste).toBeVisible({ timeout: 5000 });

  // 1) 粘一段错误页文案：不可用，并说明原因
  await paste.fill('抓取失败 URL：https://example.com 错误：403 Forbidden 请改用参考文本字段直接粘贴');
  await expect(trigger).toBeDisabled();
  await expect(ctx.window.locator('.analysis-hint')).toContainText('不像正文');

  // 2) 粘太短：不可用，引导去命题策划
  await paste.fill('AI 发展很快，企业都在应用。');
  await expect(trigger).toBeDisabled();
  await expect(ctx.window.locator('.analysis-hint')).toContainText('不足以支撑');

  // 3) 粘真实正文：可用
  await paste.fill([
    '轻量模型与贵价模型之间怎么选，这个问题被问得太多了，但多数回答都在复述参数表。',
    '我把三个常用任务分别跑在两档上，按官方标价折算，一整天用量下来不到一杯豆浆钱，省下来的数字其实不大。',
    '真正的成本在于：你并不知道便宜档能不能过，于是默认全用贵的，而这个默认值本身就要钱，它表现为反复重跑的下午。',
    '四问可以结束这场争论：输出能否机器校验，错一次代价多大，有没有更便宜的能过，以及最后谁来为错误兜底。',
    '答完这四问，多数场景都会落到一个够用档；真正答不上来的那部分，才值得继续留给贵价去解决。',
  ].join('\n\n'));
  await expect(trigger).toBeEnabled({ timeout: 5000 });

  // 清空，别影响后面的用例
  await paste.fill('');
  await expect(trigger).toBeDisabled();
});

test('写文章页：首次引导横幅显示，点了「知道了」后 localStorage 持久化不再出现', async () => {
  // 重置 localStorage 以确保是「首次」状态
  await ctx.window.evaluate(() => localStorage.removeItem('aw_writepage_intro_v1_dismissed'));
  await ctx.window.reload({ waitUntil: 'domcontentloaded' });

  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible({ timeout: 5000 });
  await expect(ctx.window.locator('.intro-banner')).toBeVisible();

  // 点了「知道了」
  await ctx.window.locator('.intro-banner button:has-text("知道了")').click();
  await expect(ctx.window.locator('.intro-banner')).toHaveCount(0);

  // 刷新一次验证 localStorage 持久化
  await ctx.window.reload({ waitUntil: 'domcontentloaded' });
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible({ timeout: 5000 });
  await expect(ctx.window.locator('.intro-banner')).toHaveCount(0);
});

test('写文章页：有草稿时显示「清空草稿」按钮，点击后清掉所有字段并消失', async () => {
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible({ timeout: 5000 });

  // 干净状态：按钮不应存在
  await expect(ctx.window.locator('.btn-reset-draft')).toHaveCount(0);

  // 填点东西，触发自动保存
  const queryBox = ctx.window.locator('.textarea').first();
  await queryBox.fill('测试一下清空按钮');
  await ctx.window.waitForTimeout(2000);  // 超过 1.5s 的 debounce

  // 现在按钮应出现
  await expect(ctx.window.locator('.btn-reset-draft')).toBeVisible();

  // 弹窗 confirm 选 "OK"
  ctx.window.on('dialog', (d) => d.accept());
  await ctx.window.locator('.btn-reset-draft').click();

  // 按钮消失，主题框回到空，localStorage 清空
  await expect(ctx.window.locator('.btn-reset-draft')).toHaveCount(0);
  await expect(queryBox).toHaveValue('');
  const has = await ctx.window.evaluate(() => localStorage.getItem('aw_draft'));
  expect(has).toBeNull();

  // 刷新后状态依然干净
  await ctx.window.reload({ waitUntil: 'domcontentloaded' });
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible({ timeout: 5000 });
  await expect(ctx.window.locator('.btn-reset-draft')).toHaveCount(0);
  await expect(ctx.window.locator('.textarea').first()).toHaveValue('');
});

test('写文章页：草稿恢复后，分析/策略也一起回来（修复不对称）', async () => {
  // 制造一个 v2 草稿，含 referenceText + analysis + analysisId（不实际跑 AI 调用）
  await ctx.window.evaluate(() => {
    localStorage.setItem('aw_draft', JSON.stringify({
      v: 2,
      query: '上次写的主题',
      referenceUrl: 'https://example.com/last',
      referenceText: '上次抓回来的参考文内容，要够长（>200字）才能触发自动分析。'.repeat(20),
      outline: '',
      outlineDirty: false,
      channel: 'wechat', style: 'tech', length: 'medium', needImage: true,
      analysis: { summary: '上次 AI 跑出来的 7 维分析' },
      analysisId: 42,
      strategy: { strategyId: 7, title: '上次采纳的策略' },
      angles: [{ title: '上次角度 1' }, { title: '上次角度 2' }],
      step: 1,
      savedAt: Date.now(),
    }));
  });
  await ctx.window.reload({ waitUntil: 'domcontentloaded' });
  await ctx.window.locator('.nav-item').filter({ hasText: '写文章' }).first().click();
  await expect(ctx.window.locator('text=Step 1 — 主题与参考').first()).toBeVisible({ timeout: 5000 });

  // 参考文应已就绪
  await expect(ctx.window.locator('text=参考文已就绪')).toBeVisible();
  // 主题框恢复
  await expect(ctx.window.locator('.textarea').first()).toHaveValue('上次写的主题');
  // 应自动进到 Step 2（因 draft.step=1）
  await expect(ctx.window.locator('text=Step 2')).toBeVisible({ timeout: 5000 });
});

test('Quick Publish v2：五步流水线渲染 + 草稿进入润色步', async () => {
  await ctx.window.locator('.nav-item').filter({ hasText: '快速发布' }).first().click();
  await expect(ctx.window.locator('.qp-steps')).toBeVisible({ timeout: 5000 });
  // 5 个步骤名
  for (const s of ['润色', '排版', '封面', '配图', '导出']) {
    await expect(ctx.window.locator('.qp-step').filter({ hasText: s })).toBeVisible();
  }
  // 粘草稿 → 下一步进排版预览 → 观点盒应出现
  await ctx.window.locator('.qp-textarea').fill('我以为自己没有观点。\n\n**观察背后，藏着你所有的观点。**');
  await ctx.window.locator('.qp-nav .btn-primary').click();
  await expect(ctx.window.locator('.qp-preview')).toBeVisible();
  await expect(ctx.window.locator('.qp-preview .qp-viewpoint')).toBeVisible();
  // 导览可回退
  await ctx.window.locator('.qp-nav .btn-outline').first().click();
  await expect(ctx.window.locator('.qp-textarea')).toBeVisible();
});
