// IPC handlers — 渲染进程 ↔ 主进程通信
const { ipcMain, BrowserWindow } = require('electron');
const { getDb } = require('./db.cjs');
const { runAgent, detectAvailableClis, listModels } = require('./agent.cjs');
const { fetchUrl } = require('./fetcher.cjs');
const { loadAllSkills, buildSkillInjection } = require('./skills.cjs');
const { renderPrompt } = require('./prompts.cjs');
const { TaskQueue } = require('./queue.cjs');

/** 把 agent 流式 chunk 推到所有 renderer 窗口 */
function emitAgentChunk(chunk) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agent:chunk', chunk);
  }
}

/** 全局任务队列 — 文章生成相关全部走这里
 * - maxConcurrent: 最多同时 2 个生成任务（同一个 CLI 同时跑 2 个）
 * - perTypeConcurrent: 同一类型最多 1 个（outline/article/polish 各自串行，避免互相挤占打断）
 */
const agentQueue = new TaskQueue({ maxConcurrent: 2, perTypeConcurrent: 1, historyLimit: 50 });

/** 把队列状态实时推到所有 renderer */
function emitQueueState() {
  const snap = agentQueue.snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:state', snap);
  }
}
agentQueue.on('state', emitQueueState);

/** 队列化运行 runAgent：返回 { taskId, promise }，调用方 await promise 拿结果 */
function enqueueAgentRun(type, label, cfg, prompt, meta = {}) {
  const task = agentQueue.enqueue(
    type,
    label,
    ({ signal }) => runAgent(cfg, prompt, emitAgentChunk, { signal }),
    { meta: { ...meta, cli: cfg.cli, model: cfg.model } },
  );
  return { taskId: task.id, promise: task.promise };
}

function registerIpc() {
  const db = getDb();

  // ===== 图片 Provider 配置 =====
  ipcMain.handle('image:provider:list', () => {
    const providers = db.prepare(`
      SELECT id, provider_id, name, enabled, base_url, priority, extra_config, created_at, updated_at
      FROM image_providers ORDER BY priority ASC
    `).all();
    return providers.map(p => ({ ...p, extra_config: JSON.parse(p.extra_config || '{}'), enabled: !!p.enabled }));
  });

  ipcMain.handle('image:provider:get', (_e, providerId) => {
    const p = db.prepare(`SELECT * FROM image_providers WHERE provider_id=?`).get(providerId);
    if (!p) return null;
    return { ...p, extra_config: JSON.parse(p.extra_config || '{}'), enabled: !!p.enabled };
  });

  ipcMain.handle('image:provider:save', (_e, { provider_id, name, base_url, priority, extra_config, enabled }) => {
    const exists = db.prepare('SELECT id FROM image_providers WHERE provider_id=?').get(provider_id);
    if (exists) {
      db.prepare(`UPDATE image_providers SET name=?, base_url=?, priority=?, extra_config=?, enabled=?, updated_at=CURRENT_TIMESTAMP WHERE provider_id=?`)
        .run(name, base_url || '', priority || 99, JSON.stringify(extra_config || {}), enabled ? 1 : 0, provider_id);
    } else {
      db.prepare(`INSERT INTO image_providers (provider_id, name, base_url, priority, extra_config, enabled) VALUES (?,?,?,?,?,?)`)
        .run(provider_id, name, base_url || '', priority || 99, JSON.stringify(extra_config || {}), enabled ? 1 : 0);
    }
    return { ok: true };
  });

  ipcMain.handle('image:provider:delete', (_e, providerId) => {
    db.prepare('DELETE FROM image_models WHERE provider_id=?').run(providerId);
    db.prepare('DELETE FROM image_providers WHERE provider_id=?').run(providerId);
    return { ok: true };
  });

  // ===== 图片模型配置 =====
  ipcMain.handle('image:model:list', (_e, providerId) => {
    const sql = providerId
      ? `SELECT * FROM image_models WHERE provider_id=? ORDER BY is_default DESC`
      : `SELECT m.*, p.name as provider_name FROM image_models m JOIN image_providers p ON p.provider_id=m.provider_id ORDER BY p.priority, m.is_default DESC`;
    const rows = providerId ? db.prepare(sql).all(providerId) : db.prepare(sql).all();
    return rows.map(r => ({ ...r, extra_params: JSON.parse(r.extra_params || '{}'), enabled: !!r.enabled, is_default: !!r.is_default }));
  });

  ipcMain.handle('image:model:save', (_e, { provider_id, model_id, name, extra_params, enabled, is_default }) => {
    const exists = db.prepare('SELECT id FROM image_models WHERE provider_id=? AND model_id=?').get(provider_id, model_id);
    if (exists) {
      db.prepare(`UPDATE image_models SET name=?, extra_params=?, enabled=?, is_default=? WHERE provider_id=? AND model_id=?`)
        .run(name, JSON.stringify(extra_params || {}), enabled ? 1 : 0, is_default ? 1 : 0, provider_id, model_id);
    } else {
      db.prepare(`INSERT INTO image_models (provider_id, model_id, name, extra_params, enabled, is_default) VALUES (?,?,?,?,?,?)`)
        .run(provider_id, model_id, name, JSON.stringify(extra_params || {}), enabled ? 1 : 0, is_default ? 1 : 0);
    }
    return { ok: true };
  });

  // ===== 获取当前启用的 Provider + 默认模型 =====
  ipcMain.handle('image:provider:get-active', () => {
    const providers = db.prepare(`SELECT * FROM image_providers WHERE enabled=1 ORDER BY priority ASC`).all();
    if (!providers.length) return null;
    
    const activeProviders = providers.map(p => {
      const defaultModel = db.prepare(`SELECT * FROM image_models WHERE provider_id=? AND enabled=1 AND is_default=1 LIMIT 1`).get(p.provider_id);
      const allModels = db.prepare(`SELECT * FROM image_models WHERE provider_id=? AND enabled=1`).all(p.provider_id);
      return {
        ...p,
        extra_config: JSON.parse(p.extra_config || '{}'),
        defaultModel: defaultModel ? { ...defaultModel, extra_params: JSON.parse(defaultModel.extra_params || '{}') } : null,
        models: allModels.map(m => ({ ...m, extra_params: JSON.parse(m.extra_params || '{}') })),
      };
    });
    
    return activeProviders;
  });

  // ===== Provider 配置（保留兼容）=====
  ipcMain.handle('provider:save', (_e, { provider_id, base_url, default_model }) => {
    const exists = db.prepare('SELECT id FROM provider_settings WHERE provider_id=?').get(provider_id);
    if (exists) {
      db.prepare(`UPDATE provider_settings SET base_url=?, default_model=? WHERE provider_id=?`)
        .run(base_url || '', default_model || '', provider_id);
    } else {
      db.prepare(`INSERT INTO provider_settings (provider_id, base_url, default_model) VALUES (?,?,?)`)
        .run(provider_id, base_url || '', default_model || '');
    }
    return { ok: true };
  });

  ipcMain.handle('provider:list', () => {
    return db.prepare('SELECT provider_id, base_url, default_model FROM provider_settings').all();
  });

  ipcMain.handle('provider:get-default', () => {
    return db.prepare('SELECT * FROM provider_settings ORDER BY id ASC LIMIT 1').get() || null;
  });

  // ===== Skills =====
  ipcMain.handle('agent:detect', () => {
    return detectAvailableClis();
  });

  ipcMain.handle('agent:list-models', async (_e, cli) => {
    return await listModels(cli);
  });

  // 网页抓取（用 Electron 内置 Chromium）
  ipcMain.handle('web:fetch', async (_e, url) => {
    return await fetchUrl(url);
  });

  ipcMain.handle('skills:list', () => {
    const all = loadAllSkills();
    return {
      channels: all.channels.map(s => ({
        name: s.frontmatter.name,
        displayName: s.frontmatter.displayName,
        description: s.frontmatter.description,
        style: s.frontmatter.style,
        length: s.frontmatter.length,
        tags: s.frontmatter.tags || [],
      })),
      personas: all.personas.map(s => ({
        name: s.frontmatter.name,
        displayName: s.frontmatter.displayName,
        description: s.frontmatter.description,
        tags: s.frontmatter.tags || [],
      })),
    };
  });

  // ===== 文章生成（两步：先大纲，后正文）=====

  function buildPromptContext({ keywords, style, length, channel, persona, title, reference_text } = {}) {
    const skillBlock = buildSkillInjection({ channel, persona });
    const lengthMap = { short: '800-1200字', medium: '1500-2500字', long: '3000+字' };
    const styleMap = { tech: '技术分享', news: '新闻报道', opinion: '观点评论', story: '故事叙述', knowledge: '知识科普' };
    const personaHint = persona ? `写作人设：${persona}（见下方 Skill 文件）\n` : '';
    const channelHint = channel ? `发布渠道：${channel}（见下方 Skill 文件）\n` : '';
    const titleHint = title ? `标题：${title}\n` : '';
    const refBlock = reference_text
      ? `\n## 参考文章（作为写作模板，决定本文骨架）\n${reference_text.slice(0, 6000)}\n`
      : '';
    return {
      skillBlock: skillBlock ? skillBlock + '\n\n---\n\n' : '',
      styleDesc: styleMap[style] || style,
      lengthDesc: lengthMap[length] || lengthMap.medium,
      personaHint, channelHint, titleHint,
      keywordsStr: (keywords || []).join('、'),
      refBlock,
    };
  }

  // Step 1: 生成大纲
  ipcMain.handle('article:outline', async (_e, params) => {
    const { cli, model, title, keywords, style = 'tech', length = 'medium', channel, persona, reference_text } = params;
    if (!cli) throw new Error('未选择 Agent CLI');
    // keywords 可为空：有参考文时由 AI 从参考文推断主题
    if ((!keywords || !keywords.length) && !reference_text) throw new Error('关键词或参考文至少要有一个');

    const ctx = buildPromptContext({ keywords, style, length, channel, persona, title, reference_text });

    const prompt = renderPrompt('outline', {
      skillBlock: ctx.skillBlock,
      titleHint: ctx.titleHint,
      keywords: ctx.keywordsStr || '（未指定，从参考文推断）',
      styleDesc: ctx.styleDesc,
      lengthDesc: ctx.lengthDesc,
      personaHint: ctx.personaHint,
      channelHint: ctx.channelHint,
      referenceBlock: ctx.refBlock,
      inferHint: (keywords && keywords.length) ? '' :
        `\n📌 用户没有输入主题关键词。请先通读参考文章，**提炼出它的核心主题**作为本次大纲的主题，再按参考文的写作框架（标题/开头/段落/结尾）生成大纲。\n`,
    });

    emitAgentChunk({ type: 'info', text: `🎯 [Step 1/2] 生成大纲（派给 ${cli}）` });
    // 把完整 prompt 投递到日志面板，便于排查
    emitAgentChunk({ type: 'sys', text: `📝 发给 ${cli} 的提示词：\n${prompt}` });
    const { taskId, promise } = enqueueAgentRun('outline', `大纲: ${(keywords || []).slice(0, 3).join('/') || '从参考文'}`, { cli, model }, prompt);
    const { content, elapsedMs } = await promise;
    console.log(`[agent:outline] taskId=${taskId} 返回 ${content.length} 字符, 耗时 ${elapsedMs}ms, 前100字: ${content.slice(0,100)}`);
    return { taskId, outline: content.trim(), elapsedMs };
  });

  // Step 2: 基于大纲生成正文
  ipcMain.handle('article:article', async (_e, params) => {
    const { cli, model, title, keywords, style = 'tech', length = 'medium', channel, persona, reference_text, outline, need_image } = params;
    if (!cli) throw new Error('未选择 Agent CLI');
    if (!keywords || !keywords.length) throw new Error('关键词不能为空');
    if (!outline) throw new Error('缺少大纲，请先生成大纲');

    const ctx = buildPromptContext({ keywords, style, length, channel, persona, title, reference_text });

    // 检测用户是否修改了大纲（加了 [已修订] 标记）
    const hasUserEdit = /\[已修订\]|\[修改\]/i.test(outline);

    const prompt = renderPrompt('article', {
      skillBlock: ctx.skillBlock,
      titleHint: ctx.titleHint,
      keywords: ctx.keywordsStr,
      styleDesc: ctx.styleDesc,
      lengthDesc: ctx.lengthDesc,
      personaHint: ctx.personaHint,
      channelHint: ctx.channelHint,
      referenceBlock: ctx.refBlock,
      editWarning: hasUserEdit
        ? '已确认，含 [已修订] 标记的章节是用户调整后的，必须严格遵循'
        : '已确认',
      outline,
      imageHint: need_image === false ? '' : `\n# 配图占位（重要）\n在适合配图的位置插入**纯文本占位符**，必须带唯一ID（用于后续图片分离存储与替换）：\n格式：[[配图:具体场景描述@pic 序号]]\n例如：[[配图:深圳南山写字楼夜景@pic1]]、[[配图:程序员深夜写代码@pic2]]\n每篇文章插入 1-3 个占位（章节首/小节切换/结尾行动点）。描述用具体名词、不超过 20 字，不要用"插图1"这种泛词。\n注意：一定不要用 Markdown 图片语法 ![xxx](url)，要用 [[配图:描述@picN]] 纯文本格式。`,
    });

    emitAgentChunk({ type: 'info', text: `🎯 [Step 2/2] 基于大纲生成正文（派给 ${cli}）` });
    // 把完整 prompt 投递到日志面板，便于排查
    emitAgentChunk({ type: 'sys', text: `📝 发给 ${cli} 的提示词：\n${prompt}` });
    const start = Date.now();
    const { taskId, promise } = enqueueAgentRun('article', `正文: ${(keywords || []).slice(0, 3).join('/') || '默认'}`, { cli, model }, prompt);
    const { content, elapsedMs } = await promise;
    console.log(`[agent:article] taskId=${taskId} 返回 ${content.length} 字符, 耗时 ${elapsedMs}ms, 前100字: ${content.slice(0,100)}`);

    // 提取标题 + 内容
    let extractedTitle = title || '';
    let body = content;
    const titleMatch = content.match(/^#\s+(.+?)\n/);
    if (titleMatch && !title) {
      extractedTitle = titleMatch[1].trim();
      body = content.replace(/^#\s+.+?\n/, '').trim();
    }
    const wordCount = body.length;

    // 入库
    const result = db.prepare(`
      INSERT INTO article_drafts
      (title, outline, content, status, style, length, keywords, reference_source,
       word_count, generation_time, model, provider, platform)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      extractedTitle || '(无标题)',
      outline,
      body,
      style,
      length,
      (keywords || []).join(','),
      JSON.stringify({ reference_urls: params.reference_urls || [], reference_text: reference_text || '' }),
      wordCount,
      Math.round(elapsedMs / 1000),
      model || cli,
      cli,
      channel || 'wechat',
    );

    return {
      taskId,
      id: result.lastInsertRowid,
      title: extractedTitle,
      outline,
      content: body,
      wordCount,
      elapsedMs,
    };
  });

  // ===== 文章列表 / 详情 =====
  ipcMain.handle('article:list', (_e, { status, search } = {}) => {
    let sql = 'SELECT * FROM article_drafts WHERE 1=1';
    const params = [];
    if (status && status !== 'all') {
      if (status === 'scheduled') sql += ' AND scheduled_at IS NOT NULL AND published_at IS NULL';
      else if (status === 'published') sql += ' AND published_at IS NOT NULL';
      else sql += ' AND status=?';
      if (status !== 'scheduled' && status !== 'published') params.push(status);
    }
    if (search) {
      sql += ' AND title LIKE ?';
      params.push(`%${search}%`);
    }
    sql += ' ORDER BY updated_at DESC LIMIT 100';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('article:get', (_e, id) => {
    return db.prepare('SELECT * FROM article_drafts WHERE id=?').get(id);
  });

  // 更新文章（用于保存润色结果）
  ipcMain.handle('article:update', (_e, { id, content }) => {
    if (!id) throw new Error('缺少 id');
    if (typeof content !== 'string') throw new Error('content 必须是字符串');
    // 去掉 turndown 过度转义的反斜杠（![...] → !\[...\]）
    const cleaned = content.replace(/\\([\[\]()<>#*_`~])/g, '$1');
    const wordCount = cleaned.length;
    const r = db.prepare('UPDATE article_drafts SET content=?, word_count=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(cleaned, wordCount, id);
    if (r.changes === 0) throw new Error('文章不存在');
    return { ok: true, wordCount };
  });

  // ===== 调度发布 =====
  ipcMain.handle('article:schedule', (_e, { id, scheduled_at }) => {
    const ts = new Date(scheduled_at);
    if (isNaN(ts.getTime())) throw new Error('时间格式无效');
    if (ts.getTime() < Date.now() - 60_000) throw new Error('时间已过期');
    // SQLite 存毫秒数（直接放字符串也认，但要 sort 时方便；这里用整数）
    const r = db.prepare('UPDATE article_drafts SET scheduled_at=? WHERE id=? AND status IN (\'draft\',\'done\',\'published\')').run(ts.getTime(), id);
    if (r.changes === 0) throw new Error('文章不存在或状态不允许');
    return { ok: true, scheduled_at: ts.toISOString() };
  });

  ipcMain.handle('article:unschedule', (_e, id) => {
    db.prepare('UPDATE article_drafts SET scheduled_at=NULL WHERE id=?').run(id);
    return { ok: true };
  });

  // ===== 标记为已发布 =====
  ipcMain.handle('article:publish', (_e, id) => {
    db.prepare(`
      UPDATE article_drafts
      SET published_at = CURRENT_TIMESTAMP,
          status = 'published',
          scheduled_at = NULL,
          publish_error = NULL
      WHERE id = ?
    `).run(id);
    return { ok: true };
  });

  // ===== 取消发布 =====
  ipcMain.handle('article:unpublish', (_e, id) => {
    db.prepare(`
      UPDATE article_drafts
      SET published_at = NULL,
          status = 'done',
          publish_error = NULL
      WHERE id = ?
    `).run(id);
    return { ok: true };
  });

  ipcMain.handle('article:delete', (_e, id) => {
    db.prepare('DELETE FROM article_drafts WHERE id=?').run(id);
    return { ok: true };
  });

  // 二次润色：拿现有正文 + 润色指令，再生成一次
  ipcMain.handle('article:polish', async (_e, params) => {
    const { cli, model, content, instruction, channel, persona } = params;
    if (!cli) throw new Error('未选择 Agent CLI');
    if (!content) throw new Error('缺少原文');
    if (!instruction) throw new Error('缺少润色指令');

    const skillBlock = buildSkillInjection({ channel, persona });

    const prompt = renderPrompt('polish', {
      skillBlock: skillBlock ? skillBlock + '\n\n---\n\n' : '',
      instruction,
      content,
    });

    emitAgentChunk({ type: 'info', text: `✨ [润色] ${instruction}` });
    const { taskId, promise } = enqueueAgentRun('polish', `润色: ${instruction.slice(0, 30)}`, { cli, model }, prompt);
    const { content: polished, elapsedMs } = await promise;
    return { taskId, content: polished.trim(), elapsedMs };
  });

  // 写文件到磁盘（用户下载 .md）
  ipcMain.handle('file:save-md', (_e, { filename, content }) => {
    const { dialog } = require('electron');
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    const result = dialog.showSaveDialogSync({
      defaultPath: path.join(app.getPath('downloads'), filename || 'article.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!result) return { ok: false, canceled: true };
    fs.writeFileSync(result, content, 'utf-8');
    return { ok: true, path: result };
  });

  // 保存图片（base64 dataURL → 写到 userData/uploads/ → 返回 file:// URL）
  ipcMain.handle('file:save-image', (_e, { dataUrl, filename }) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) throw new Error('dataUrl 格式错误');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const dir = path.join(app.getPath('userData'), 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const name = filename || `img-${Date.now()}.${ext}`;
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, Buffer.from(m[2], 'base64'));
    // 返回 aw-img:// URL（自定义协议，安全渲染本地图片）
    return { ok: true, url: 'aw-img://img/' + encodeURIComponent(name), path: filePath };
  });

  // 从 URL 抓图（Pollinations / 公网）→ 存本地 → 返回 aw-img:// URL
  ipcMain.handle('image:generate', async (_e, { prompt, filename, width, height, model }) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    const w = width || 1200;
    const h = height || 800;
    const m = model || 'flux';
    // Pollinations.ai 公共 API（无需 key）
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&model=${m}&nologo=true&seed=${Date.now() % 99999}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = path.join(app.getPath('userData'), 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safeName = (filename || prompt).replace(/[^\w一-龥-]/g, '_').slice(0, 60);
    const fileName = `${safeName}-${Date.now()}.jpg`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buf);
    return { ok: true, url: 'aw-img://img/' + encodeURIComponent(fileName), path: filePath, prompt, fileName };
  });

  // ===== 图片分离存储（正文存占位符，图片存 images 表 + article_images 关联）=====
  // 按文章查图片（JOIN 出图片详情）
  ipcMain.handle('article:images', (_e, articleId) => {
    return db.prepare(`
      SELECT ai.id, ai.article_id, ai.placeholder_id, ai.image_id,
             i.file_name, i.file_path, i.prompt, i.source, i.url
      FROM article_images ai
      JOIN images i ON i.id = ai.image_id
      WHERE ai.article_id=?
      ORDER BY ai.id
    `).all(articleId);
  });

  // 生图提示词扩写：双层扩写
  // 第一层：craft-standard.md 通用扩写
  // 第二层：craft-{model}.md 模型优化（如 craft-flux.md）
  async function craftImagePrompt(bizPrompt, cli, model = 'flux') {
    const fs = require('node:fs');
    const path = require('node:path');
    const PROMPTS_IMAGE_DIR = path.join(__dirname, '..', 'src', 'prompts', 'image');

    // 第一层：通用扩写
    const standardPath = path.join(PROMPTS_IMAGE_DIR, 'craft-standard.md');
    const standardPrompt = fs.existsSync(standardPath)
      ? fs.readFileSync(standardPath, 'utf-8')
      : fs.readFileSync(path.join(PROMPTS_IMAGE_DIR, 'craft.md'), 'utf-8');  // 兜底旧版

    const standardResult = await runAgent(
      { cli: cli || 'claude' },
      `${standardPrompt}\n\n# 用户输入\n${bizPrompt}\n\n# 输出\n`,
      () => {}  // 扩写不推日志
    );
    const standardOutput = standardResult.content.trim();

    // 第二层：模型优化（如果有对应模板）
    const modelPath = path.join(PROMPTS_IMAGE_DIR, `craft-${model}.md`);
    if (fs.existsSync(modelPath)) {
      const modelPrompt = fs.readFileSync(modelPath, 'utf-8');
      const modelResult = await runAgent(
        { cli: cli || 'claude' },
        `${modelPrompt}\n\n# Standard 扩写结果\n${standardOutput}\n\n# 输出（Flux 优化后的提示词）\n`,
        () => {}
      );
      return modelResult.content.trim();
    }

    // 无模型优化模板，返回标准扩写结果
    return standardOutput;
  }

  // 按占位符 ID 生成图片（存 images 表 + 建关联；正文不动）
  ipcMain.handle('image:generate-for', async (_e, { articleId, placeholderId, prompt, tags, aspect, useCraft, craftCli, providerId, modelId }) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    const { generateImage } = require('./image-providers.cjs');
    
    const dir = path.join(app.getPath('userData'), 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 可选：用 AI 双层扩写（standard + 模型优化）
    let finalPrompt = prompt;
    if (useCraft && prompt) {
      try {
        finalPrompt = await craftImagePrompt(prompt, craftCli, modelId || 'flux');

      } catch (err) {
        // 扩写失败，用原文
      }
    }

    // 获取使用的 Provider 配置
    let currentProvider = providerId;
    let currentModel = modelId || 'flux';
    
    if (!currentProvider) {
      // 获取默认启用的 Provider
      const providers = db.prepare(`SELECT * FROM image_providers WHERE enabled=1 ORDER BY priority ASC`).all();
      if (providers.length > 0) {
        const p = providers[0];
        currentProvider = p.provider_id;
        // 获取该 Provider 的默认模型
        const defaultModel = db.prepare(`SELECT * FROM image_models WHERE provider_id=? AND enabled=1 AND is_default=1 LIMIT 1`).get(p.provider_id);
        if (defaultModel) {
          currentModel = defaultModel.model_id;
        }
      } else {
        currentProvider = 'pollinations';
      }
    }



    // 生成图片
    let buf;
    try {
      buf = await generateImage(currentProvider, finalPrompt, { model: currentModel });
    } catch (err) {
      // 生成失败，尝试备用 Provider
      
      // 尝试备用 Provider
      const providers = db.prepare(`SELECT * FROM image_providers WHERE enabled=1 AND provider_id!=? ORDER BY priority ASC`).all(currentProvider);
      for (const p of providers) {
        try {

          const defaultModel = db.prepare(`SELECT * FROM image_models WHERE provider_id=? AND enabled=1 AND is_default=1 LIMIT 1`).get(p.provider_id);
          buf = await generateImage(p.provider_id, finalPrompt, { model: defaultModel?.model_id || currentModel });
          currentProvider = p.provider_id;
          currentModel = defaultModel?.model_id || currentModel;
          break;
        } catch (e2) {
          // 备用 Provider 也失败
        }
      }
      
      if (!buf) throw new Error('所有 Provider 都生成失败');
    }

    // 保存图片文件
    const ext = buf.length > 1000000 ? 'png' : 'jpg';  // 大图可能是 PNG
    const fileName = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buf);

    // 读取真实尺寸 + 大小，计算宽高比
    const sizeOf = require('image-size');
    let width = 0, height = 0, aspectStr = aspect || '';
    try {
      const dim = sizeOf(filePath);
      if (dim && dim.width && dim.height) { width = dim.width; height = dim.height; }
    } catch {}
    if (!aspectStr && width > 0 && height > 0) {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const g = gcd(width, height) || 1;
      aspectStr = `${Math.round(width / g)}:${Math.round(height / g)}`;
    }
    const sizeKb = Math.round(buf.length / 1024);

    // 存 images 表
    const img = db.prepare(
      'INSERT INTO images (file_name, file_path, url, prompt, original_prompt, provider, model, tags, width, height, aspect, size_kb, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(fileName, 'uploads/' + fileName, 'aw-img://img/' + encodeURIComponent(fileName), finalPrompt, prompt, currentProvider, currentModel, tags || '', width, height, aspectStr, sizeKb, 'ai');

    // 建文章-图片关联
    if (articleId && articleId !== 0 && articleId !== '0') {
      db.prepare(`
        INSERT INTO article_images (article_id, placeholder_id, image_id) VALUES (?,?,?)
        ON CONFLICT(article_id, placeholder_id) DO UPDATE SET image_id=excluded.image_id
      `).run(articleId, placeholderId, img.lastInsertRowid);
    }

    return { 
      ok: true, 
      url: 'aw-img://img/' + encodeURIComponent(fileName), 
      path: filePath, 
      prompt: finalPrompt, 
      original_prompt: prompt,
      imageId: img.lastInsertRowid,
      provider: currentProvider,
      model: currentModel,
    };
  });

  // 人工上传图片（存 images 表 + 建关联；正文不动）
  ipcMain.handle('image:upload-for', (_e, { articleId, placeholderId, dataUrl, tags }) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) throw new Error('dataUrl 格式错误');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const dir = path.join(app.getPath('userData'), 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const fileName = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, Buffer.from(m[2], 'base64'));

    // 读真实尺寸 + 大小
    const sizeOfJpg = require('image-size');
    let width = 0, height = 0;
    try { const dim = sizeOfJpg(filePath); if (dim?.width && dim?.height) { width = dim.width; height = dim.height; } } catch {}
    const sizeKb = Math.round(Buffer.byteLength(Buffer.from(m[2], 'base64')) / 1024);

    const img = db.prepare(
      'INSERT INTO images (file_name, file_path, url, prompt, tags, width, height, size_kb, source) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(fileName, 'uploads/' + fileName, 'aw-img://img/' + encodeURIComponent(fileName), '', tags || '', width, height, sizeKb, 'upload');

    // 仅在 articleId 有效时建关联（图库独立上传不关联）
    if (articleId && articleId !== 0 && articleId !== '0') {
      db.prepare(`
        INSERT INTO article_images (article_id, placeholder_id, image_id) VALUES (?,?,?)
        ON CONFLICT(article_id, placeholder_id) DO UPDATE SET image_id=excluded.image_id
      `).run(articleId, placeholderId, img.lastInsertRowid);
    }

    return { ok: true, url: 'aw-img://img/' + encodeURIComponent(fileName), imageId: img.lastInsertRowid };
  });

  // 创建文章-图片关联（图库选择配图时用）
  ipcMain.handle('image:link-to-article', (_e, { articleId, placeholderId, imageId }) => {
    db.prepare(`
      INSERT INTO article_images (article_id, placeholder_id, image_id) VALUES (?,?,?)
      ON CONFLICT(article_id, placeholder_id) DO UPDATE SET image_id=excluded.image_id
    `).run(articleId, placeholderId, imageId);
    return { ok: true };
  });

  // 图库：全部图片（含被哪些文章使用）
  ipcMain.handle('images:list', () => {
    return db.prepare(`
      SELECT i.*,
        (SELECT GROUP_CONCAT(CAST(ai.article_id AS TEXT)) FROM article_images ai WHERE ai.image_id=i.id) as used_by_articles
      FROM images i ORDER BY i.created_at DESC
    `).all();
  });

  // 读取图片为 dataURL（绕开 aw-img 协议，100% 渲染）
  ipcMain.handle('image:read-dataurl', (_e, { path_or_id }) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    let filePath = path_or_id;
    // uploads/ 或纯文件名 → 拼到 userData
    if (typeof path_or_id === 'string' && path_or_id.startsWith('uploads/')) {
      filePath = path.join(app.getPath('userData'), path_or_id);
    } else if (typeof path_or_id === 'string' && !path_or_id.includes(path.sep) && !path_or_id.startsWith('/')) {
      filePath = path.join(app.getPath('userData'), path_or_id);
    }
    // 兼容 aw-img:// 形式
    if (typeof path_or_id === 'string' && path_or_id.startsWith('aw-img://')) {
      const url = new URL(path_or_id);
      // 新格式: aw-img://img/<filename> → pathname 是 /<filename>
      // 旧格式: aw-img://<中文文件名> → hostname 是文件名（host 常被解析成中文）
      const pathPart = url.pathname.replace(/^\//, '');
      const hostPart = url.hostname || url.host || '';
      // 优先 pathname（新格式），hostname 仅当 pathname 为空才用（旧格式兜底）
      let name = pathPart ? pathPart : hostPart;
      name = decodeURIComponent(name.replace(/^img\//, ''));
      filePath = path.join(app.getPath('userData'), 'uploads', name);
    }
    if (!filePath || !fs.existsSync(filePath)) throw new Error('图片文件不存在');
    const ext = path.extname(filePath).replace('.', '');
    const dataUrl = 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + fs.readFileSync(filePath).toString('base64');
    return { ok: true, dataUrl };
  });

  // 图库：更新图片元数据（tags/prompt）
  ipcMain.handle('images:update', (_e, { id, tags, prompt, category }) => {
    const sets = [];
    const vals = [];
    if (typeof tags === 'string') { sets.push('tags=?'); vals.push(tags); }
    if (typeof prompt === 'string') { sets.push('prompt=?'); vals.push(prompt); }
    if (typeof category === 'string') { sets.push('category=?'); vals.push(category); }
    if (!sets.length) return { ok: true };
    vals.push(id);
    db.prepare(`UPDATE images SET ${sets.join(', ')} WHERE id=?`).run(...vals);
    return { ok: true };
  });

  // 图库：查图片被哪些文章引用（用于图库编辑弹窗展示）
  ipcMain.handle('images:refs', (_e, id) => {
    return db.prepare(`
      SELECT ai.article_id, ad.title, ai.placeholder_id
      FROM article_images ai
      JOIN article_drafts ad ON ad.id = ai.article_id
      WHERE ai.image_id=?
    `).all(id);
  });

  // 图库：删除一张图（DB + 磁盘文件 + 关联）
  ipcMain.handle('images:delete', (_e, id) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    // 先查文件路径再删 DB
    const row = db.prepare('SELECT file_path FROM images WHERE id=?').get(id);
    db.prepare('DELETE FROM article_images WHERE image_id=?').run(id);
    db.prepare('DELETE FROM images WHERE id=?').run(id);
    // 删磁盘文件（容错：不存在不报错）
    if (row?.file_path) {
      const full = path.join(app.getPath('userData'), row.file_path);
      try { fs.unlinkSync(full); } catch {}
    }
    return { ok: true };
  });

  // ===== 提示词模板管理（实时编辑保存，立即生效）=====
  const { PROMPTS_DIR } = require('./prompts.cjs');
  const fsP = require('node:fs');
  const pathP = require('node:path');

  // 列出可用模板（.md 文件名 → 中文名）
  ipcMain.handle('prompts:list', () => {
    const meta = {
      'outline': '生成大纲',
      'article': '生成正文',
      'polish': '二次润色',
    };
    if (!fsP.existsSync(PROMPTS_DIR)) fsP.mkdirSync(PROMPTS_DIR, { recursive: true });
    const files = fsP.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md'));
    return files.map(f => ({
      name: f.replace('.md', ''),
      label: meta[f.replace('.md', '')] || f.replace('.md', ''),
      path: pathP.join(PROMPTS_DIR, f),
    }));
  });

  // 读单个模板（实时读文件）
  ipcMain.handle('prompts:get', (_e, name) => {
    const safeName = String(name || '').replace(/\.\.|\//g, '');
    const fp = pathP.join(PROMPTS_DIR, safeName + '.md');
    if (!fsP.existsSync(fp)) throw new Error(`模板不存在: ${name}`);
    return { name: safeName, content: fsP.readFileSync(fp, 'utf-8') };
  });

  // 保存单个模板（写回磁盘，下次调用立即生效）
  ipcMain.handle('prompts:save', (_e, { name, content }) => {
    const safeName = String(name || '').replace(/\.\.|\//g, '');
    if (!safeName) throw new Error('缺少模板名');
    const fp = pathP.join(PROMPTS_DIR, safeName + '.md');
    if (!fsP.existsSync(fp)) throw new Error(`模板不存在: ${safeName}`);
    fsP.writeFileSync(fp, String(content || ''), 'utf-8');
    return { ok: true, name: safeName };
  });

  // ===== 任务队列 =====
  ipcMain.handle('queue:list', () => agentQueue.snapshot());

  ipcMain.handle('queue:cancel', (_e, taskId) => {
    return agentQueue.cancel(String(taskId || ''));
  });

  ipcMain.handle('queue:clear-completed', () => {
    // 只清除已完成列表，不取消运行中
    agentQueue.completed.length = 0;
    emitQueueState();
    return { ok: true };
  });
}

module.exports = { registerIpc };