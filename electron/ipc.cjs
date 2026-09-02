// IPC handlers — 渲染进程 ↔ 主进程通信
const { ipcMain, BrowserWindow } = require('electron');
const { getDb } = require('./db.cjs');
const { runAgent, detectAvailableClis, listModels } = require('./agent.cjs');
const { fetchUrl } = require('./fetcher.cjs');
const { loadAllSkills, buildSkillInjection } = require('./skills.cjs');
const { renderPrompt } = require('./prompts.cjs');
const { TaskQueue } = require('./queue.cjs');
const {
  parseAnalysisJson, parseAngleResult, parseStrategyResult, loadAnalysisSkill,
  loadAngleSkill, loadTopicSkill,
  buildAnalysisPrompt, buildAnalysisContextBlock, buildStrategyBlock, buildImageStrategyHint,
  buildImageRoleHint, parseInterviewOutput, loadInterviewSkill, saveAnalysis,
  parseExtractOutput, validatePatch, validateAngles,
  evidenceCoverage, normalizeEvidence, strategyGate,
} = require('./analysis.cjs');

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
/** 生图统一入队：与文本任务同一队列闸门（provider 不被连点轰炸，UI 可见排队） */
function queuedGenerateImage(providerId, promptFor, opts = {}) {
  const { generateImage } = require('./image-providers.cjs');
  const t = agentQueue.enqueue(
    'image',
    `生图: ${String(promptFor).slice(0, 24)}`,
    ({ signal }) => {
      if (signal.aborted) throw Object.assign(new Error('已取消'), { code: 'ABORTED' });
      return generateImage(providerId, promptFor, opts);
    },
    { meta: { provider: providerId, model: opts.model || '', kind: 'image' } },
  );
  return t.promise;
}

function enqueueAgentRun(type, label, cfg, prompt, meta = {}) {
  let taskId = '';
  const task = agentQueue.enqueue(
    type,
    label,
    // 每块 chunk 带上 taskId，供队列明细按任务归类展示
    ({ signal }) => runAgent(cfg, prompt, (chunk) => emitAgentChunk({ ...chunk, taskId }), { signal }),
    { meta: { ...meta, cli: cfg.cli, model: cfg.model } },
  );
  taskId = task.id;
  return { taskId, promise: task.promise };
}

function registerIpc() {
  const db = getDb();

  /**
   * 策略反查口：从 articleId 拿到当时采纳的那个角度（含 mode / strategyId / adoptionId）。
   * Strategy-Driven Workflow 的根基：润色、配图、导出、发布、效果回填都发生在
   * renderer 状态之外（文章已入库、或在另一个页面），所以必须能从 DB 读回决策。
   */
  /** 按 id 取权威策略行（生成守卫专用，不信客户端传来的文本） */
  function strategyById(id) {
    const nid = Number(id);
    if (!nid) return null;
    const row = db.prepare('SELECT * FROM content_strategies WHERE id = ?').get(nid);
    return row ? shapeStrategyRow(row) : null;
  }

  function strategyForArticle(articleId) {
    const id = Number(articleId);
    if (!id) return null;
    const row = db.prepare(`
      SELECT cs.*, sa.id AS adoption_id, sa.article_id AS linked_article_id
      FROM strategy_articles sa
      JOIN content_strategies cs ON cs.id = sa.strategy_id
      WHERE sa.article_id = ?
      ORDER BY sa.adopted_at DESC, sa.id DESC
      LIMIT 1
    `).get(id);
    if (!row) return null;
    return {
      ...shapeStrategyRow(row),
      adoptionId: row.adoption_id,
      articleId: row.linked_article_id,
    };
  }

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

  function buildPromptContext({ keywords, style, length, channel, persona, title, reference_text, track } = {}) {
    const skillBlock = buildSkillInjection({ channel, persona });
    const lengthMap = { short: '800-1200字', medium: '1500-2500字', long: '3000+字' };
    const styleMap = { tech: '技术分享', news: '新闻报道', opinion: '观点评论', story: '故事叙述', knowledge: '知识科普' };
    const personaHint = persona ? `写作人设：${persona}（见下方 Skill 文件）\n` : '';
    const channelHint = channel ? `发布渠道：${channel}（见下方 Skill 文件）\n` : '';
    const titleHint = title ? `标题：${title}\n` : '';
    // 赛道 = 选题视角 + 受众 + 案例方向（与风格/人设/渠道正交）
    const trackHint = track
      ? `【创作赛道】你是「${track}」赛道的创作者。同一个素材必须从「${track}」的视角切入：
- 选题角度：从${track}领域的核心矛盾/痛点出发，不要写成泛泛的通用文
- 目标读者：${track}领域的典型受众，用他们关心的语言和例子
- 案例选择：优先用${track}领域的真实场景/案例
`
      : '';
    const refBlock = reference_text
      ? `\n## 参考文章（作为写作模板，决定本文骨架）\n${reference_text.slice(0, 6000)}\n`
      : '';
    return {
      skillBlock: skillBlock ? skillBlock + '\n\n---\n\n' : '',
      styleDesc: styleMap[style] || style,
      lengthDesc: lengthMap[length] || lengthMap.medium,
      personaHint, channelHint, titleHint, trackHint,
      keywordsStr: (keywords || []).join('、'),
      refBlock,
    };
  }

  // Step 1: 生成大纲
  ipcMain.handle('article:outline', async (_e, params) => {
    const { cli, model, title, keywords, style = 'tech', length = 'medium', channel, persona, track, reference_text, analysis, strategy } = params;
    if (!cli) throw new Error('未选择 Agent CLI');
    // keywords 可为空：有参考文时由 AI 从参考文推断主题
    if ((!keywords || !keywords.length) && !reference_text) throw new Error('关键词或参考文至少要有一个');

    const ctx = buildPromptContext({ keywords, style, length, channel, persona, title, reference_text, track });
    const analysisBlock = buildAnalysisContextBlock(analysis);

    const prompt = renderPrompt('outline', {
      skillBlock: ctx.skillBlock,
      titleHint: ctx.titleHint,
      keywords: ctx.keywordsStr || '（未指定，从参考文推断）',
      styleDesc: ctx.styleDesc,
      lengthDesc: ctx.lengthDesc,
      personaHint: ctx.personaHint,
      channelHint: ctx.channelHint,
      trackHint: ctx.trackHint,
      referenceBlock: ctx.refBlock,
      analysisBlock: analysisBlock || '',
      strategyBlock: buildStrategyBlock(strategy),
      inferHint: (keywords && keywords.length) ? '' :
        `\n📌 用户没有输入主题关键词。请先通读参考文章，**提炼出它的核心主题**作为本次大纲的主题，再按参考文的写作框架（标题/开头/段落/结尾）生成大纲。\n`,
    });

    const { taskId, promise } = enqueueAgentRun('outline', `大纲: ${(keywords || []).slice(0, 3).join('/') || '从参考文'}`, { cli, model }, prompt);
    emitAgentChunk({ type: 'info', taskId, text: `🎯 [Step 1/2] 生成大纲（派给 ${cli}）` });
    emitAgentChunk({ type: 'sys', taskId, text: `📝 发给 ${cli} 的提示词：\n${prompt}` });
    const { content, elapsedMs } = await promise;
    console.log(`[agent:outline] taskId=${taskId} 返回 ${content.length} 字符, 耗时 ${elapsedMs}ms, 前100字: ${content.slice(0,100)}`);
    return { taskId, outline: content.trim(), elapsedMs };
  });

  // Step 2: 基于大纲生成正文
  ipcMain.handle('article:article', async (_e, params) => {
    const { cli, model, title, keywords, style = 'tech', length = 'medium', channel, persona, track, reference_text, outline, need_image, analysis, strategy } = params;
    if (!cli) throw new Error('未选择 Agent CLI');
    if (!outline) throw new Error('缺少大纲，请先生成大纲');
    // 关键词可为空：只要有大纲（从链接/参考文进来的流程，主题已凝在大纲里）
    if ((!keywords || !keywords.length) && !outline && !reference_text) throw new Error('关键词、大纲、参考文至少一个');

    // V4 生成守卫①：凡带策略生成正文，三问未答完就拦下。
    // 故意做在主进程：UI 能被绕过（草稿恢复、旧数据、直接 invoke），而这条规则的价值就在于绕不过。
    const stgForGate = strategy || strategyForArticle(params.articleId);
    if (stgForGate && (stgForGate.strategyId || stgForGate.adoptionId || stgForGate.id)) {
      // 以库为准：renderer 传上来的 belief 文本不能自证清白（否则客户端填三个宇就当答完了）
      const authoritative = strategyById(stgForGate.strategyId || stgForGate.id);
      const gate = strategyGate(authoritative || stgForGate);
      if (!gate.pass) {
        throw new Error(`生成守卫未通过，请先在策略卡答完三问：${gate.missing.join('、')}`);
      }
    }

    const ctx = buildPromptContext({ keywords, style, length, channel, persona, title, reference_text, track });
    const analysisBlock = buildAnalysisContextBlock(analysis);

    // 检测用户是否修改了大纲（加了 [已修订] 标记）
    const hasUserEdit = /\[已修订\]|\[修改\]/i.test(outline);

    const prompt = renderPrompt('article', {
      skillBlock: ctx.skillBlock,
      titleHint: ctx.titleHint,
      keywords: ctx.keywordsStr || '（未指定关键词，请从下方大纲推定主题）',
      styleDesc: ctx.styleDesc,
      lengthDesc: ctx.lengthDesc,
      personaHint: ctx.personaHint,
      channelHint: ctx.channelHint,
      trackHint: ctx.trackHint,
      referenceBlock: ctx.refBlock,
      analysisBlock: analysisBlock || '',
      strategyBlock: buildStrategyBlock(strategy),
      editWarning: hasUserEdit
        ? '已确认，含 [已修订] 标记的章节是用户调整后的，必须严格遵循'
        : '已确认',
      outline,
      imageHint: need_image === false ? '' : `\n# 配图占位（重要）\n在适合配图的位置插入**纯文本占位符**，必须带唯一ID（用于后续图片分离存储与替换）：\n格式：[[配图:具体场景描述@pic 序号]]\n例如：[[配图:深圳南山写字楼夜景@pic1]]、[[配图:程序员深夜写代码@pic2]]\n每篇文章插入 1-3 个占位（章节首/小节切换/结尾行动点）。描述用具体名词、不超过 20 字，不要用"插图1"这种泛词。\n注意：一定不要用 Markdown 图片语法 ![xxx](url)，要用 [[配图:描述@picN]] 纯文本格式。`,
    });

    const start = Date.now();
    const { taskId, promise } = enqueueAgentRun('article', `正文: ${(keywords || []).slice(0, 3).join('/') || '默认'}`, { cli, model }, prompt);
    emitAgentChunk({ type: 'info', taskId, text: `🎯 [Step 2/2] 基于大纲生成正文（派给 ${cli}）` });
    emitAgentChunk({ type: 'sys', taskId, text: `📝 发给 ${cli} 的提示词：\n${prompt}` });
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
       word_count, generation_time, model, provider, platform, profile_id)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      String(params.profileId || ''),
    );

    // 策略→文章闭环（V2 §八 1:N）：正文入库后回填这次执行记录的 article_id。
    // renderer 采纳时已拿到 adoptionId；没带过来则按 strategyId 新建一条执行记录。
    const stg = strategy && typeof strategy === 'object' ? strategy : null;
    const adoptionId = stg ? Number(stg.adoptionId) : 0;
    const strategyId = stg ? Number(stg.strategyId || stg.anglesId || 0) : 0;
    if (stg && (adoptionId || strategyId)) {
      try {
        if (adoptionId) {
          db.prepare(`UPDATE strategy_articles SET article_id = ? WHERE id = ?`)
            .run(result.lastInsertRowid, adoptionId);
        } else {
          db.prepare(`INSERT INTO strategy_articles (strategy_id, article_id) VALUES (?, ?)`)
            .run(strategyId, result.lastInsertRowid);
          db.prepare(`UPDATE content_strategies SET status = 'adopted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(strategyId);
        }
      } catch (linkErr) {
        console.warn('[article:article] 策略关联写入失败:', linkErr.message);
      }
    }

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
  ipcMain.handle('article:list', (_e, { status, search, profileId } = {}) => {
    let sql = 'SELECT * FROM article_drafts WHERE 1=1';
    const params = [];
    // 身份隔离：传 profileId 则只看本身份 + 历史记录（profile_id 为空的旧文章不隐身）
    const pid = String(profileId || '');
    if (pid) {
      sql += ` AND (profile_id = ? OR profile_id = '' OR profile_id IS NULL)`;
      params.push(pid);
    }
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

  // 策略反查口：文章详情页 / 导出 / 发布 / 效果回填 都从这里拿“当时定了什么策略”，
  // 不依赖 renderer状态（跨页面、跨时间时它是唯一可靠来源）。
  ipcMain.handle('article:strategyFor', (_e, articleId) => strategyForArticle(articleId));

  // ===== P0 Week 1：Season + Episode 管理（Episode-centric）=====
  // 设计原则："不锁死"。所有字段宽松，新表是补充不替代。
  // 用户/文章/Episode 三者解耦，可任意组合：EP 不必带 Article，Article 不必挂 EP。

  // --- Season ---
  ipcMain.handle('season:list', (_e, { status = 'active', profileId } = {}) => {
    let sql = 'SELECT * FROM seasons WHERE 1=1';
    const params = [];
    if (status && status !== 'all') { sql += ' AND status=?'; params.push(status); }
    const pid = String(profileId || '');
    if (pid) {
      sql += ' AND (profile_id = ? OR profile_id = \'\' OR profile_id IS NULL)';
      params.push(pid);
    }
    sql += ' ORDER BY created_at DESC LIMIT 20';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('season:get', (_e, id) => {
    if (!id) return null;
    const row = db.prepare('SELECT * FROM seasons WHERE id=?').get(id);
    if (!row) return null;
    // 顺手算一下这个 season 下有多少 episode
    const epCount = db.prepare('SELECT COUNT(*) AS n FROM episodes WHERE season_id=?').get(id);
    row.episode_count = epCount ? epCount.n : 0;
    return row;
  });

  ipcMain.handle('season:save', (_e, params = {}) => {
    const { id, title, subtitle, description, status, started_at, ended_at, profileId } = params;
    if (!title) throw new Error('缺少 title');
    const now = new Date().toISOString();
    if (id) {
      db.prepare(`UPDATE seasons SET title=?, subtitle=?, description=?, status=?, started_at=?, ended_at=?, updated_at=? WHERE id=?`)
        .run(title, subtitle || '', description || '', status || 'active', started_at || null, ended_at || null, now, id);
      return { ok: true, id, updated_at: now };
    }
    const r = db.prepare(`INSERT INTO seasons (title, subtitle, description, status, started_at, ended_at, profile_id, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(title, subtitle || '', description || '', status || 'active', started_at || null, ended_at || null, profileId || '', now, now);
    return { ok: true, id: r.lastInsertRowid, created_at: now };
  });

  ipcMain.handle('season:archive', (_e, id) => {
    if (!id) throw new Error('缺少 id');
    db.prepare(`UPDATE seasons SET status='archived', updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), id);
    return { ok: true };
  });

  // --- Episode ---
  ipcMain.handle('episode:list', (_e, { seasonId, status, profileId } = {}) => {
    let sql = `SELECT e.*, s.title AS season_title
               FROM episodes e
               LEFT JOIN seasons s ON e.season_id = s.id
               WHERE 1=1`;
    const params = [];
    if (seasonId) { sql += ' AND e.season_id=?'; params.push(seasonId); }
    if (status && status !== 'all') { sql += ' AND e.status=?'; params.push(status); }
    const pid = String(profileId || '');
    if (pid) {
      sql += ' AND (e.profile_id = ? OR e.profile_id = \'\' OR e.profile_id IS NULL)';
      params.push(pid);
    }
    sql += ' ORDER BY COALESCE(e.order_in_season, 0) ASC, e.updated_at DESC LIMIT 100';
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('episode:get', (_e, id) => {
    if (!id) return null;
    const row = db.prepare(`SELECT e.*, s.title AS season_title
                            FROM episodes e
                            LEFT JOIN seasons s ON e.season_id = s.id
                            WHERE e.id=?`).get(id);
    return row || null;
  });

  ipcMain.handle('episode:save', (_e, params = {}) => {
    const {
      id, season_id, title, slug, status,
      observation, question, insight,
      event, reaction, development, shift, unknown, next,
      draft, publish_url, published_at,
      order_in_season, profileId,
    } = params;
    const now = new Date().toISOString();
    if (id) {
      // slug 只在显式传入时更新（COALESCE 保护）：编辑页保存不回传 slug，
      // 曾经的 bug——用户在 app 里编辑一次 EP，slug 就被冲成空（EP04 中招两次）
      // 空值不覆盖（T5 stale write）：六槽位列 + observation/question/insight 一律
      // COALESCE(NULLIF(?,''), col)——渲染层没传/传空不会把外部写入（extract/AI 回流）冲掉；
      // 仅 draft/title/status/publish_url 允许显式清空（draft 清空走确认弹窗）。
      db.prepare(`UPDATE episodes SET
        season_id=?, title=?, slug=COALESCE(NULLIF(?, ''), slug), status=?,
        observation=COALESCE(NULLIF(?, ''), observation),
        question=COALESCE(NULLIF(?, ''), question),
        insight=COALESCE(NULLIF(?, ''), insight),
        event=COALESCE(NULLIF(?, ''), event),
        reaction=COALESCE(NULLIF(?, ''), reaction),
        development=COALESCE(NULLIF(?, ''), development),
        shift=COALESCE(NULLIF(?, ''), shift),
        unknown=COALESCE(NULLIF(?, ''), unknown),
        next=COALESCE(NULLIF(?, ''), next),
        draft=?, publish_url=?, published_at=?,
        order_in_season=?, profile_id=?, updated_at=?
        WHERE id=?`).run(
          season_id || null, title || '', slug || '', status || 'observation',
          observation || '', question || '', insight || '',
          event || '', reaction || '', development || '', shift || '', unknown || '', next || '',
          draft || '', publish_url || '', published_at || null,
          Number(order_in_season) || 0, profileId || '', now, id,
        );
      // 自愈：slug 被任何路径清空时按序号补；先查重，冲突则跳过（绝不因补名搞挂保存）
      try {
        const cur = db.prepare('SELECT order_in_season FROM episodes WHERE id=?').get(id);
        const cand = `ep-${String(Math.max(1, Number(cur && cur.order_in_season) || id)).padStart(3, '0')}`;
        const taken = db.prepare('SELECT 1 FROM episodes WHERE slug=? AND id!=?').get(cand, id);
        if (!taken) db.prepare(`UPDATE episodes SET slug=? WHERE id=? AND (slug='' OR slug IS NULL)`).run(cand, id);
      } catch (e) { console.warn('[episode:save] slug 自愈跳过:', e.message); }
      return { ok: true, id, updated_at: now };
    }
    const r = db.prepare(`INSERT INTO episodes (
      season_id, title, slug, status,
      observation, question, insight,
      draft, publish_url, published_at,
      order_in_season, profile_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      season_id || null, title || '', slug || '', status || 'observation',
      observation || '', question || '', insight || '',
      draft || '', publish_url || '', published_at || null,
      Number(order_in_season) || 0, profileId || '', now, now,
    );
    return { ok: true, id: r.lastInsertRowid, created_at: now };
  });

  ipcMain.handle('episode:delete', (_e, id) => {
    if (!id) throw new Error('缺少 id');
    db.prepare('DELETE FROM episodes WHERE id=?').run(id);
    return { ok: true };
  });

  ipcMain.handle('episode:linkArticle', (_e, { episodeId, articleId }) => {
    if (!episodeId || !articleId) throw new Error('缺少 episodeId/articleId');
    db.prepare('UPDATE article_drafts SET episode_id=? WHERE id=?').run(episodeId, articleId);
    db.prepare('UPDATE episodes SET publish_url=(SELECT publish_url FROM article_drafts WHERE id=?) WHERE id=?')
      .run(articleId, episodeId);
    return { ok: true };
  });

  // ===== 观察卡（生活账；2026-08-31 与 Episode 分离定稿）=====
  ipcMain.handle('card:list', (_e, { status, episodeId, profileId, limit = 50 } = {}) => {
    let sql = `SELECT o.*, e.title AS episode_title
               FROM observations o
               LEFT JOIN episodes e ON o.episode_id = e.id
               WHERE 1=1`;
    const params = [];
    if (status && status !== 'all') { sql += ' AND o.status=?'; params.push(status); }
    if (episodeId) { sql += ' AND o.episode_id=?'; params.push(episodeId); }
    const pid = String(profileId || '');
    if (pid) { sql += ' AND (o.profile_id = ? OR o.profile_id = \'\' OR o.profile_id IS NULL)'; params.push(pid); }
    sql += ' ORDER BY o.created_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(200, Number(limit) || 50)));
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('card:save', (_e, params = {}) => {
    const { id, observation, question, insight, season_id, profileId } = params;
    const now = new Date().toISOString();
    if (id) {
      const cur = db.prepare('SELECT * FROM observations WHERE id=?').get(id);
      if (!cur) throw new Error('卡片不存在');
      db.prepare(`UPDATE observations SET observation=?, question=?, insight=?, season_id=?, updated_at=? WHERE id=?`)
        .run(
          observation !== undefined ? observation : cur.observation,
          question !== undefined ? question : cur.question,
          insight !== undefined ? insight : cur.insight, /*__V1MARK__*/
          season_id !== undefined ? season_id : cur.season_id,
          now, id,
        );
      return { ok: true, id };
    }
    const text = String(observation || '').trim();
    if (!text) throw new Error('观察不能为空——这就是卡片的唯一必填');
    const r = db.prepare(`INSERT INTO observations (observation, question, insight, status, season_id, profile_id, created_at, updated_at)
      VALUES (?, ?, ?, 'raw', ?, ?, ?, ?)`)
      .run(text, question || '', insight || '', season_id || null, profileId || '', now, now);
    return { ok: true, id: r.lastInsertRowid };
  });

  ipcMain.handle('card:delete', (_e, id) => {
    if (!id) throw new Error('缺少 id');
    db.prepare('DELETE FROM observations WHERE id=?').run(id);
    return { ok: true };
  });

  // 长成 EP：建一集（标题取观点/观察句），卡片标 grown 并回链
  ipcMain.handle('card:grow', (_e, id) => {
    const card = db.prepare('SELECT * FROM observations WHERE id=?').get(id);
    if (!card) throw new Error('卡片不存在');
    if (card.episode_id) return { ok: true, episodeId: card.episode_id, already: true };
    const season = db.prepare(`SELECT id FROM seasons WHERE status='active' ORDER BY created_at DESC LIMIT 1`).get();
    const title = (String(card.insight || card.observation || '未命名').replace(/[*#>]/g, '').trim()).slice(0, 30);
    const order = (db.prepare('SELECT COALESCE(MAX(order_in_season),0) m FROM episodes WHERE season_id=?').get(season ? season.id : null).m) + 1;
    const now = new Date().toISOString();
    // 卡上的原料/问题/判断必须随 EP 一起搬过来——空壳 EP 是没法扩写的。
    // 之前这里三个字段都写 ''，导致 8 集全部 o=q=i=0（owner 实测发现）。
    const ep = db.prepare(`INSERT INTO episodes (season_id, title, status, observation, question, insight, draft, order_in_season, profile_id, created_at, updated_at)
      VALUES (?, ?, 'observation', ?, ?, ?, '', ?, ?, ?, ?)`)
      .run(
        season ? season.id : null,
        title,
        String(card.observation || ''),
        String(card.question || ''),
        String(card.insight || ''),
        order,
        card.profile_id || '',
        now,
        now,
      );
    db.prepare(`UPDATE observations SET status='grown', episode_id=?, updated_at=? WHERE id=?`).run(ep.lastInsertRowid, now, id);
    return { ok: true, episodeId: ep.lastInsertRowid };
  });

  // ===== Idea Interview V1（2026-09-02）：采访留痕 → 证据 → 观点，观点可追溯 =====
  // 留痕：interview_messages 持久化每一问一答（含 AI 的推力），关掉 app 也能续上
  // 无门槛版：AI 随时可收尾提炼 INSIGHT，用户确认后才算数；只守"出处执法"（validatePatch）
  // 每轮结束后异步抽一轮素材（不阻塞访谈响应；提取失败不影响对话）——
  // ep-extract 模板（Task 4）：renderPrompt 抛错也兜住（console.warn 不崩）
  const EP_SLOT_COLUMNS = ['event', 'reaction', 'development', 'shift', 'unknown', 'next'];
  const extractRound = (observationId, cli, model, lastAnswer) => {
    if (!observationId || !lastAnswer) return;
    void (async () => {
      try {
        const obs = db.prepare('SELECT id, episode_id FROM observations WHERE id=?').get(observationId);
        if (!obs) return;
        // 槽位现状（accepted 直写、pending 带前缀，都在这同一批列里，不出第三态表）
        const epRow = obs.episode_id
          ? db.prepare(`SELECT ${EP_SLOT_COLUMNS.join(',')} FROM episodes WHERE id=?`).get(obs.episode_id)
          : null;
        const slotState = {};
        if (epRow) {
          for (const col of EP_SLOT_COLUMNS) {
            const v = String(epRow[col] || '');
            slotState[col] = v.startsWith('[待确认] ') ? v.slice('[待确认] '.length) : v;
          }
        }
        const evidence = db.prepare('SELECT id, content, kind FROM evidence WHERE observation_id=? ORDER BY id').all(observationId);
        const p = renderPrompt('ep-extract', {
          slotState: JSON.stringify(slotState),
          evidence: JSON.stringify(evidence.map((e) => e.content)),
          answer: String(lastAnswer),
        });
        const { promise } = enqueueAgentRun('extract', `素材抽取: ${String(lastAnswer).slice(0, 20)}`, { cli, model: model || '' }, p);
        const { content } = await promise;
        const parsed = parseExtractOutput(content);
        // —— 出处执法先行：在证据落库前定稿 verdict，accepted 的 src 要回填进 evidence ——
        const slotKeys = parsed.slots ? Object.keys(parsed.slots) : [];
        const msgs = (obs.episode_id && slotKeys.length)
          ? db.prepare('SELECT id, role, content FROM interview_messages WHERE observation_id=? ORDER BY id').all(observationId)
          : [];
        const verdict = (obs.episode_id && slotKeys.length)
          ? validatePatch(parsed, msgs)
          : { accepted: [], pending: [], rejected: [] };
        // accepted 的 src 数组：validatePatch 执法下缺 src / 任一 src 查无消息都会进 rejected，
        // 所以 accepted 项必然带 src；若万一出现空 src（如无 episode 时无从验证、accepted 为空），
        // 按 [] 落库（与旧行为一致，不因回填逻辑崩掉访谈）。
        const srcIds = [...new Set(verdict.accepted.flatMap((a) => (a && Array.isArray(a.src) ? a.src : [])))].sort((x, y) => x - y);
        // 1) 证据行（复用既有落库段：查重后插入）——source_message_ids 不再写死 []：
        //    回填本轮 accepted 项的 src，守住契约“证据必须回指作者原话 message id”
        if (parsed.evidence.length) {
          const have = db.prepare('SELECT id, content FROM evidence WHERE observation_id=?').all(observationId);
          const norm = (t) => String(t).replace(/\s+/g, '');
          let inserted = 0;
          for (const it of parsed.evidence) {
            const text = String(it.content || '').trim();
            if (!text) continue;
            const dup = have.some((h) => norm(h.content).includes(norm(text)) || norm(text).includes(norm(h.content)));
            if (dup) continue;
            db.prepare('INSERT INTO evidence (observation_id, content, kind, source_message_ids) VALUES (?, ?, ?, ?)')
              .run(observationId, text, it.kind || 'fact', JSON.stringify(srcIds));
            inserted++;
          }
          if (inserted) console.log(`[extract] 卡 ${observationId} 新增 ${inserted} 条证据`);
        }
        // 2) 槽位补全：accepted 直写 / 零重叠挂"[待确认] "前缀 → 同列（无第三态表）
        if (obs.episode_id && slotKeys.length) {
          const assigns = {};
          for (const a of verdict.accepted) assigns[a.slot] = String(a.text || '').trim();
          for (const pd of verdict.pending) assigns[pd.slot] = '[待确认] ' + String(pd.text || '').trim();
          const cols = EP_SLOT_COLUMNS.filter((c) => assigns[c]);
          if (cols.length) {
            const setSql = cols.map((c) => `${c}=?`).join(', ');
            db.prepare(`UPDATE episodes SET ${setSql}, updated_at=? WHERE id=?`)
              .run(...cols.map((c) => assigns[c]), new Date().toISOString(), obs.episode_id);
          }
          console.log(`[extract] 卡 ${observationId} 轮抽落槽（accept ${verdict.accepted.length} / pending ${verdict.pending.length} / reject ${verdict.rejected.length}）`);
        }
      } catch (e) { console.warn('[extract] 提取失败（忽略，不伤访谈）:', e.message); }
    })();
  };

  ipcMain.handle('interview:turn', async (_e, { cli, model, observation, msgs = [], answers = [], observationId } = {}) => {
    if (!observation || !String(observation).trim()) return { ok: false, error: '缺少观察' };
    if (!cli) return { ok: false, error: '未选择 Agent CLI' };
    const obsId = Number(observationId) || 0;

    // —— 留痕：本轮作者答（取 msgs 末尾的 me）先落库，状态转 interviewing ——
    const now = () => new Date().toISOString();
    let round = 0;
    let userMsgId = 0;
    if (obsId) {
      try {
        const lastMe = [...msgs].reverse().find((m) => m.who === 'me') || (answers.length ? { text: answers[answers.length - 1] } : null);
        if (lastMe && String(lastMe.text).trim()) {
          round = (db.prepare('SELECT COALESCE(MAX(round),0) r FROM interview_messages WHERE observation_id=?').get(obsId).r) + 1;
          const r1 = db.prepare('INSERT INTO interview_messages (observation_id, role, content, round, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(obsId, 'user', String(lastMe.text), round, now());
          userMsgId = Number(r1.lastInsertRowid);
          db.prepare(`UPDATE observations SET status='interviewing', updated_at=? WHERE id=? AND status IN ('new','raw')`).run(now(), obsId);
        }
      } catch (e) { console.warn('[interview] 作者答落库失败:', e.message); }
    }

    // 证据清单（给 AI 看的上下文，无门槛）：已确认轮数按 user 行数计
    let evRows = [];
    let roundsDone = 0;
    if (obsId) {
      try {
        evRows = db.prepare('SELECT id, content FROM evidence WHERE observation_id=? ORDER BY id').all(obsId);
        roundsDone = db.prepare('SELECT COUNT(*) c FROM interview_messages WHERE observation_id=? AND role=?').get(obsId, 'user').c;
      } catch (e) { /* 表可能还没迁移完，容错 */ }
    } else {
      roundsDone = answers.length;
    }

    let transcript;
    if (Array.isArray(msgs) && msgs.length > 0) {
      transcript = msgs.map((m, i) => `${i + 1}. ${m.who === 'ai' ? '访谈者' : '作者'}：${m.text}`).join('\n');
    } else {
      transcript = answers.map((a, i) => `${i + 1}. 作者：${a}`).join('\n') || '（还没有回答）';
    }
    console.log(`[interview] calling ${cli} | obs=${String(observation).slice(0,30)}... | transcript=${transcript.length} chars | 轮=${roundsDone} 证据=${evRows.length}`);
    let skillBody = '';
    try { skillBody = loadInterviewSkill(); } catch (e) { /* skill 缺失则只跑模板 */ }
    let prompt;
    try {
      prompt = renderPrompt('interview', { skillBody, observation: String(observation), transcript });
    } catch (err) { return { ok: false, error: err.message }; }
    let taskId = '';
    try {
      const enq = enqueueAgentRun('interview', `观点访谈: ${String(observation).slice(0, 24)}`, { cli, model: model || '' }, prompt);
      taskId = enq.taskId;
      const { content } = await enq.promise;
      console.log(`[interview] ${cli} returned ${content.length} chars: ${content.slice(0,200).replace(/\n/g,' / ')}`);
      const parsed = parseInterviewOutput(content);
      // —— 留痕：AI 问/收尾也落库 ——
      if (obsId && userMsgId) {
        try {
          db.prepare('INSERT INTO interview_messages (observation_id, role, content, reasoning, round, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(obsId, 'assistant', parsed.text, parsed.reasoning || '', round, now());
        } catch (e) { console.warn('[interview] AI 问落库失败:', e.message); }
      }
      // —— 每轮结束：异步抽一轮素材（不 await，不等它）——
      if (obsId) {
        const lastMe = [...msgs].reverse().find((m) => m.who === 'me');
        extractRound(obsId, cli, model, lastMe ? String(lastMe.text) : '');
      }
      return { ok: true, ...parsed, taskId, round: roundsDone };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), taskId };
    }
  });

  // 历史回放：重新打开访谈能续上（interviewing 状态存在的意义）
  ipcMain.handle('interview:history', (_e, observationId) => {
    const id = Number(observationId);
    if (!id) return { ok: false, error: '缺少卡片 id' };
    try {
      const messages = db.prepare('SELECT id, role, content, reasoning, round, created_at FROM interview_messages WHERE observation_id=? ORDER BY round, id').all(id);
      return { ok: true, messages };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ===== 证据（V1：访谈的中间产物，观点的地基）=====
  ipcMain.handle('evidence:list', (_e, observationId) => {
    const id = Number(observationId);
    if (!id) return { ok: false, error: '缺少卡片 id' };
    try { return { ok: true, evidence: db.prepare('SELECT * FROM evidence WHERE observation_id=? ORDER BY id').all(id) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('evidence:save', (_e, { observationId, content, sourceMessageIds } = {}) => {
    const id = Number(observationId); const text = String(content || '').trim();
    if (!id || !text) return { ok: false, error: '缺 observationId 或 content' };
    try {
      const r = db.prepare('INSERT INTO evidence (observation_id, content, source_message_ids) VALUES (?, ?, ?)')
        .run(id, text, JSON.stringify(Array.isArray(sourceMessageIds) ? sourceMessageIds : []));
      return { ok: true, id: Number(r.lastInsertRowid) };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('evidence:delete', (_e, id) => {
    try { db.prepare('DELETE FROM evidence WHERE id=?').run(Number(id)); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // ===== 观点确认（AI 只能提议，用户最终决定——确认后 status→insight_found）=====
  ipcMain.handle('insight:confirm', (_e, { observationId, content, evidenceIds } = {}) => {
    const id = Number(observationId); const text = String(content || '').trim();
    if (!id || !text) return { ok: false, error: '缺 observationId 或观点内容' };
    try {
      const now = new Date().toISOString();
      db.prepare('INSERT INTO insights (observation_id, content, evidence_ids, confirmed, created_at) VALUES (?, ?, ?, 1, ?)')
        .run(id, text, JSON.stringify(Array.isArray(evidenceIds) ? evidenceIds : []), now);
      // 冗余副本写回卡（card:grow 与 EP 长成都读这个字段），并升状态
      db.prepare(`UPDATE observations SET insight=?, status='insight_found', updated_at=? WHERE id=? AND status!='episode_created'`).run(text, now, id);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ===== 策划通道（EP→Article V1）：材料组包 → 角度提议 → 用户确认落 article_plans =====
  // 组 EP 材料：一集 + 挂靠的观察卡 + 每张卡的证据/观点 + 已确认过的方案
  function buildEpisodeMaterial(episodeId) {
    const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(episodeId);
    if (!ep) return { ep: null, observations: [], evidence: [], insights: [], plans: [] };
    const observations = db.prepare('SELECT * FROM observations WHERE episode_id=? ORDER BY created_at').all(episodeId);
    const obsIds = observations.map((o) => o.id);
    let evidence = [];
    let insights = [];
    if (obsIds.length) {
      const marks = obsIds.map(() => '?').join(',');
      evidence = db.prepare(`SELECT * FROM evidence WHERE observation_id IN (${marks}) ORDER BY id`).all(...obsIds);
      insights = db.prepare(`SELECT * FROM insights WHERE observation_id IN (${marks}) ORDER BY id`).all(...obsIds);
    }
    const plans = db.prepare('SELECT * FROM article_plans WHERE episode_id=? ORDER BY id DESC').all(episodeId);
    return { ep, observations, evidence, insights, plans };
  }

  // 把 CLI 输出解析成角度句列表（JSON 数组 | 逐行列表）：与 parseExtractOutput 同族容错
  function parseAngleProposals(raw) {
    const t = String(raw || '').trim();
    if (!t) return [];
    const parsed = parseAnalysisJson(t);
    if (parsed.ok && Array.isArray(parsed.data)) {
      return parsed.data
        .map((x) => {
          if (x == null) return '';
          if (typeof x === 'string') return x.trim();
          if (typeof x === 'object') return String(x.title || x.text || x.angle || '').trim();
          return '';
        })
        .filter(Boolean);
    }
    return t.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
  }

  // 组材料喂 CLI 出 3~5 个选题角度 → 过拔高红线（validateAngles）→ 返回 proposals，不落库
  ipcMain.handle('plan:propose', async (_e, arg = {}) => {
    const episodeId = typeof arg === 'number' ? arg : Number((arg && arg.episodeId) || 0);
    if (!episodeId) return { ok: false, error: '缺少 episodeId' };
    const ep = db.prepare('SELECT id FROM episodes WHERE id=?').get(episodeId);
    if (!ep) return { ok: false, error: 'Episode 不存在' };
    const cli = (typeof arg === 'object' && arg && arg.cli) || '';
    if (!cli) return { ok: false, error: '未选择 Agent CLI' };
    const m = buildEpisodeMaterial(episodeId);
    let prompt;
    try {
      prompt = renderPrompt('plan-propose', {
        title: m.ep.title || '',
        observation: m.ep.observation || '',
        question: m.ep.question || '',
        insight: m.ep.insight || '',
        evidence: JSON.stringify(m.evidence.map((e) => e.content)),
        insights: JSON.stringify(m.insights.map((i) => i.content)),
        plans: JSON.stringify(m.plans.map((p) => p.chosen_angle || '')),
      });
    } catch (err) {
      // 模板缺失时给结构化失败（Task 4 已建 plan-propose.md，正常不会走到）
      return { ok: false, error: err.message };
    }
    try {
      const { promise } = enqueueAgentRun('plan', `选题角度: ${String(m.ep.title || m.ep.observation || '').slice(0, 24)}`, { cli, model: arg.model || '' }, prompt);
      const { content } = await promise;
      const angles = parseAngleProposals(content);
      const { ok: okAngles, rejectedHigh } = validateAngles(angles);
      return { ok: true, proposals: okAngles, rejectedHigh };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // 用户确认方案 → 落 article_plans（confirmed=1；证据链打平存档）
  ipcMain.handle('plan:confirm', (_e, { episodeId, plan } = {}) => {
    const id = Number(episodeId) || 0;
    if (!id) return { ok: false, error: '缺少 episodeId' };
    const ep = db.prepare('SELECT id FROM episodes WHERE id=?').get(id);
    if (!ep) return { ok: false, error: 'Episode 不存在' };
    const p = plan && typeof plan === 'object' ? plan : {};
    const angle = String(p.chosen_angle || p.angle || p.title || '').trim();
    if (!angle) return { ok: false, error: '缺少 plan.chosen_angle' };
    const now = new Date().toISOString();
    const r = db.prepare(`INSERT INTO article_plans (
      episode_id, proposals, chosen_angle, article_title, reader_question, core_conflict,
      judgment_ref, evidence_ids, discussion_scope, confirmed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
      id,
      JSON.stringify(Array.isArray(p.proposals) ? p.proposals : []),
      angle,
      String(p.article_title || '').trim(),
      String(p.reader_question || '').trim(),
      String(p.core_conflict || '').trim(),
      String(p.judgment_ref || '').trim(),
      JSON.stringify(Array.isArray(p.evidence_ids) ? p.evidence_ids : []),
      String(p.discussion_scope || '').trim(),
      now,
    );
    return { ok: true, id: Number(r.lastInsertRowid) };
  });

  ipcMain.handle('plan:list', (_e, episodeId) => {
    const id = Number(episodeId) || 0;
    if (!id) return { ok: false, error: '缺少 episodeId' };
    try {
      const plans = db.prepare('SELECT * FROM article_plans WHERE episode_id=? ORDER BY id DESC').all(id);
      return { ok: true, plans };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // EP 材料整包（策划页/生成前置的单一取数口）
  ipcMain.handle('episode:material', (_e, episodeId) => {
    const id = Number(episodeId) || 0;
    if (!id) return { ok: false, error: '缺少 episodeId' };
    try {
      const material = buildEpisodeMaterial(id);
      if (!material.ep) return { ok: false, error: 'Episode 不存在' };
      return { ok: true, ...material };
    } catch (e) { return { ok: false, error: e.message }; }
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
    const { cli, model, content, instruction, channel, persona, track, analysis, strategy, articleId } = params;
    if (!cli) throw new Error('未选择 Agent CLI');
    if (!content) throw new Error('缺少原文');
    if (!instruction) throw new Error('缺少润色指令');

    // 润色以前只带 analysis（素材）不带 strategy（决策），结果一次润色就把
    // 立意/情绪杠杆/差异锚点冲平。没传 strategy 时从 DB 反查，不让策略可丢。
    const stg = strategy || strategyForArticle(articleId);

    const skillBlock = buildSkillInjection({ channel, persona });
    const analysisBlock = buildAnalysisContextBlock(analysis);
    const trackHint = track ? `【创作赛道】本文服务于「${track}」赛道，润色时保持${track}领域的用词与读者视角。
` : '';

    const prompt = renderPrompt('polish', {
      skillBlock: skillBlock ? skillBlock + '\n\n---\n\n' : '',
      trackHint,
      analysisBlock: analysisBlock || '',
      strategyBlock: buildStrategyBlock(stg),
      instruction,
      content,
    });

    const { taskId, promise } = enqueueAgentRun('polish', `润色: ${instruction.slice(0, 30)}`, { cli, model }, prompt);
    emitAgentChunk({ type: 'info', taskId, text: `✨ [润色] ${instruction}` });
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
  ipcMain.handle('image:generate', async (_e, { prompt, filename, width, height, providerId, modelId, model: legacyModel, tags }) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    const { generateImage } = require('./image-providers.cjs');
    const NO_PROVIDER = '未配置生图服务：请到 设置 → 生图 Provider 启用一个（Tensor.Art 需填 Access Token；以后有高质量免费源也可添加）';

    // 解析 provider：显式指定 > 启用的按优先级第一个
    let pid = providerId || '';
    let mid = modelId || legacyModel || '';
    if (!pid) {
      const p = db.prepare(`SELECT * FROM image_providers WHERE enabled=1 ORDER BY priority ASC`).get();
      if (!p) return { ok: false, error: NO_PROVIDER };
      pid = p.provider_id;
    }
    const prow = db.prepare('SELECT * FROM image_providers WHERE provider_id=?').get(pid);
    if (!prow || prow.enabled !== 1) return { ok: false, error: `Provider「${pid}」未启用或不存在` };
    if (!mid) {
      const dm = db.prepare(`SELECT * FROM image_models WHERE provider_id=? AND enabled=1 AND is_default=1 LIMIT 1`).get(pid);
      mid = dm ? dm.model_id : '';
    }
    // 预检 token：没 token 直接给结构化引导，不发无谓请求
    if (pid === 'tensorart') {
      let cfg = prow.extra_config;
      if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = {}; } }
      cfg = cfg || {};
      if (!cfg.accessToken && !prow.api_key_enc) {
        return { ok: false, error: 'Tensor.Art 还没填 Access Token：设置 → 生图 Provider → Tensor.Art → 粘贴令牌' };
      }
    }

    try {
      // 生图进队列：与大纲/正文/润色同一闸门排队，防止连点刷屏 provider
      const imgTask = agentQueue.enqueue(
        'image',
        `生图: ${String(prompt).slice(0, 24)}`,
        ({ signal }) => {
          if (signal.aborted) throw Object.assign(new Error('已取消'), { code: 'ABORTED' });
          return generateImage(pid, prompt, { model: mid, width: width || 1200, height: height || 800 });
        },
        { meta: { provider: pid, model: mid } },
      );
      const buf = await imgTask.promise;
      const dir = path.join(app.getPath('userData'), 'uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeName = (filename || prompt || 'img').replace(/[^\w一-龥-]/g, '_').slice(0, 60);
      const fileName = `${safeName}-${Date.now()}.jpg`;
      fs.writeFileSync(path.join(dir, fileName), buf);
      const KB = Math.round(buf.length / 1024);
      const url = 'aw-img://img/' + encodeURIComponent(fileName);
      const r = db.prepare(`INSERT INTO images (file_name, file_path, prompt, source, tags, width, height, size_kb, original_prompt, provider, model)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(fileName, 'uploads/' + fileName, prompt, 'ai', tags || '', width || 1200, height || 800, KB, prompt, pid, mid);
      return { ok: true, id: r.lastInsertRowid, url, path: path.join(dir, fileName), prompt, fileName, provider: pid, model: mid };
    } catch (err) {
      return { ok: false, error: `生图失败（${pid}${mid ? ' / ' + mid : ''}）：${err.message}` };
    }
  });

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

    const { promise: p1 } = enqueueAgentRun('image', '生图提示词扩写·standard', { cli: cli || 'claude' },
      `${standardPrompt}\n\n# 用户输入\n${bizPrompt}\n\n# 输出\n`);
    const standardResult = await p1;
    const standardOutput = standardResult.content.trim();

    // 第二层：模型优化（如果有对应模板）
    const modelPath = path.join(PROMPTS_IMAGE_DIR, `craft-${model}.md`);
    if (fs.existsSync(modelPath)) {
      const modelPrompt = fs.readFileSync(modelPath, 'utf-8');
      const { promise: p2 } = enqueueAgentRun('image', '生图提示词扩写·模型层', { cli: cli || 'claude' },
        `${modelPrompt}\n\n# Standard 扩写结果\n${standardOutput}\n\n# 输出（Flux 优化后的提示词）\n`);
      const modelResult = await p2;
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

    // 策略驱动配图：情绪定画面气质、目标定图像作用。
    // 从 articleId 反查策略（图库里手动新建的图无 articleId → 自然不加约束）。
    // V4 再加一层“画面角色”：从占位描述里推断对比/流程/框架，角色先于美学。
    // 拼在 AI 扩写之前，让风格约束被一并展开，而不是事后追加互相矛盾。
    const imgHint = buildImageStrategyHint(strategyForArticle(articleId)) + buildImageRoleHint(prompt);

    // 可选：用 AI 双层扩写（standard + 模型优化）
    let finalPrompt = (prompt || '') + imgHint;
    if (useCraft && finalPrompt) {
      try {
        finalPrompt = await craftImagePrompt(finalPrompt, craftCli, modelId || 'flux');

      } catch (err) {
        // 扩写失败，用原文
      }
    }

    // 获取使用的 Provider 配置
    let currentProvider = providerId || '';
    let currentModel = modelId || '';

    if (!currentProvider) {
      // 没指定 provider：按 priority 取默认启用的 provider + 其默认模型
      const providers = db.prepare(`SELECT * FROM image_providers WHERE enabled=1 ORDER BY priority ASC`).all();
      if (providers.length > 0) {
        const p = providers[0];
        currentProvider = p.provider_id;
        const defaultModel = db.prepare(`SELECT * FROM image_models WHERE provider_id=? AND enabled=1 AND is_default=1 LIMIT 1`).get(p.provider_id);
        if (defaultModel) currentModel = defaultModel.model_id;
      } else {
        // 免费兜底（Pollinations）已下线——没有可用 provider 就给明确引导，而不是产出烂图
        return { ok: false, error: '未配置生图服务：请到 设置 → 生图 Provider 启用一个（Tensor.Art 需填 Access Token）' };
      }
    } else if (!currentModel) {
      // 指定了 provider 但没指定 model：取该 provider 自己的默认模型（不能硬套 'flux'）
      const defaultModel = db.prepare(`SELECT * FROM image_models WHERE provider_id=? AND enabled=1 AND is_default=1 LIMIT 1`).get(currentProvider);
      currentModel = defaultModel?.model_id || '';
    }



    // 生成图片
    let buf;
    try {
      buf = await queuedGenerateImage(currentProvider, finalPrompt, { model: currentModel });
    } catch (err) {
      // 生成失败，尝试备用 Provider
      
      // 尝试备用 Provider
      const providers = db.prepare(`SELECT * FROM image_providers WHERE enabled=1 AND provider_id!=? ORDER BY priority ASC`).all(currentProvider);
      for (const p of providers) {
        try {

          const defaultModel = db.prepare(`SELECT * FROM image_models WHERE provider_id=? AND enabled=1 AND is_default=1 LIMIT 1`).get(p.provider_id);
          buf = await queuedGenerateImage(p.provider_id, finalPrompt, { model: defaultModel?.model_id || currentModel });
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
  // ===== Provider 连接测试（主进程 fetch，避 CORS）=====
  ipcMain.handle('provider:test', async (_e, { providerId, token } = {}) => {
    const { testProviderConnection } = require('./image-providers.cjs');
    return await testProviderConnection(String(providerId || ''), String(token || ''));
  });

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

  // ===== Scheduler =====
  ipcMain.handle('scheduler:snapshot', () => global.scheduler?.snapshot() ?? null);
  ipcMain.handle('scheduler:enable', () => { global.scheduler?.setEnabled(true); return global.scheduler?.snapshot(); });
  ipcMain.handle('scheduler:disable', () => { global.scheduler?.setEnabled(false); return global.scheduler?.snapshot(); });
  ipcMain.handle('scheduler:run-now', async (_e, name) => {
    const { getDb } = require('./db.cjs');
    return await global.scheduler?.runNow(String(name || ''), getDb());
  });
  ipcMain.handle('scheduler:set-interval', (_e, ms) => {
    try {
      global.scheduler?.setIntervalMs(Number(ms));
      return { ok: true, snapshot: global.scheduler?.snapshot() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ===== Content Analysis (P0) =====
  ipcMain.handle('analysis:run', async (_e, params) => {
    const { title, content, platform, author, source_url, domain, profileId, cli, model } = params || {};
    if (!content || !String(content).trim()) {
      throw new Error('缺少分析内容');
    }

    // 先入库一条 pending 记录拿出去
    const pendingId = db.prepare(`
      INSERT INTO content_analysis
      (source_url, title, platform, author, content, analysis_json, status, duration_ms, profile_id)
      VALUES (?, ?, ?, ?, ?, '{}', 'running', 0, ?)
    `).run(
      source_url || '',
      title || '',
      platform || '',
      author || '',
      String(content),
      String(profileId || ''),
    ).lastInsertRowid;

    // 构造 prompt + 跑 skill
    let skillBody;
    let userPrompt;
    let fullPrompt;
    let start;
    try {
      skillBody = loadAnalysisSkill();
      userPrompt = buildAnalysisPrompt({ title, content, platform, author, source: source_url, domain });
      fullPrompt = skillBody + '\n\n---\n\n' + userPrompt;
      start = Date.now();
    } catch (loadErr) {
      // 准备阶段失败（skill 找不到 / prompt 构造失败）也要写一条 failed 记录
      db.prepare(`
        UPDATE content_analysis
        SET status='failed', error=?, duration_ms=?
        WHERE id=?
      `).run(loadErr.message || String(loadErr), 0, pendingId);
      return { ok: false, id: pendingId, error: loadErr.message, taskId: null };
    }

    try {
      const { taskId, promise } = enqueueAgentRun(
        'analysis',
        `分析: ${(title || '').slice(0, 30) || '未命名'}`,
        // 以前这里是硬编码 { cli: 'claude', model: '' }，导致「分析内容」无条件用 claude，
        // 用户在设置/仪表盘里选的 Agent 不生效（analysis:angles 则是收 cli 的，不一致）。
        { cli: String(cli || 'claude'), model: String(model || '') },
        fullPrompt,
      );
      const { content: raw, elapsedMs } = await promise;
      const parseResult = parseAnalysisJson(raw);
      const duration = elapsedMs || (Date.now() - start);

      if (!parseResult.ok) {
        // 解析失败：保留 raw 到 error 字段
        db.prepare(`
          UPDATE content_analysis
          SET status='failed', error=?, duration_ms=?, analysis_json=?
          WHERE id=?
        `).run(parseResult.error, duration, JSON.stringify({ raw: parseResult.raw }), pendingId);
        return { ok: false, id: pendingId, error: parseResult.error, taskId };
      }

      // 成功：写回 analysis_json
      db.prepare(`
        UPDATE content_analysis
        SET status='completed', analysis_json=?, duration_ms=?
        WHERE id=?
      `).run(JSON.stringify(parseResult.data), duration, pendingId);

      return {
        ok: true,
        id: pendingId,
        taskId,
        analysis: parseResult.data,
        durationMs: duration,
      };
    } catch (err) {
      const duration = Date.now() - start;
      db.prepare(`
        UPDATE content_analysis
        SET status='failed', error=?, duration_ms=?
        WHERE id=?
      `).run(err.message || String(err), duration, pendingId);
      return { ok: false, id: pendingId, error: err.message, taskId: null };
    }
  });

  ipcMain.handle('analysis:get', (_e, id) => {
    const row = db.prepare(`SELECT * FROM content_analysis WHERE id = ?`).get(Number(id));
    if (!row) return null;
    let parsed = {};
    try { parsed = JSON.parse(row.analysis_json || '{}'); } catch {}
    return { ...row, analysis: parsed };
  });

  // ===== 内容策略系统 V2：Strategy-Driven Workflow =====
  // 一行 = 一个策略。生成一次产出 5 行（同 batch_id）；采纳 = 建一条 strategy_articles（1:N）。
  const parseCol = (s, d) => {
    if (s === null || s === undefined || s === '') return d;
    try { const v = JSON.parse(s); return v === null || v === undefined ? d : v; } catch { return d; }
  };

  /** DB 行 → 给 renderer 的策略对象（JSON 列解析回结构） */
  function shapeStrategyRow(r) {
    const base = {
      id: r.id,
      mode: r.mode,
      source_type: r.source_type,
      analysis_id: r.analysis_id ?? null,
      batch_id: r.batch_id || '',
      topic: r.topic || '',
      profile_id: r.profile_id || '',
      track: r.track || '',
      persona: r.persona || '',
      angle_type: r.angle_type || '',
      title: r.title || '',
      core_point: r.core_point || '',
      insight: r.insight || '',
      belief_before: r.belief_before || '',
      belief_after: r.belief_after || '',
      belief_source: r.belief_source || '',
      target_user: r.target_user || '',
      structure: parseCol(r.structure, []),
      narrative: parseCol(r.narrative, null),
      emotion: r.emotion || '',
      goal: r.goal || '',
      value_score: r.value_score ?? null,
      differentiator: parseCol(r.differentiator, null),
      track_fit: parseCol(r.track_fit, null),
      feasibility: parseCol(r.feasibility, null),
      evidence_needed: parseCol(r.evidence_needed, []),
      fact_risk: r.fact_risk || 'low',
      status: r.status || 'candidate',
      created_at: r.created_at,
      updated_at: r.updated_at,
      adoption_count: r.adoption_count,   // list 查询才带；get 不带
    };
    // V3：成立度随策略一起下发，列表/卡片/详情页不必各自重复计算
    return { ...base, ...evidenceCoverage(base) };
  }

  const newBatchId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const INS_S = db.prepare(`
    INSERT INTO content_strategies
    (mode, source_type, analysis_id, batch_id, topic, profile_id, track, persona,
     angle_type, title, core_point, insight, target_user, structure, narrative, emotion, goal, value_score,
     differentiator, track_fit, feasibility, evidence_needed, fact_risk,
     belief_before, belief_after, belief_source, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate')
  `);

  async function runStrategyGenerate(params) {
    const mode = (params && params.mode === 'topic') ? 'topic' : 'reference';
    const track     = String((params && params.track)     || '');
    const persona   = String((params && params.persona)   || '');
    const cli       = String((params && params.cli)       || 'claude');
    const model     = String((params && params.model)     || '');
    const profileId = String((params && params.profileId) || '');
    let topic = String((params && params.topic) || '');

    let analysisId = null;
    let skillBody;
    let userPrompt;

    if (mode === 'reference') {
      analysisId = Number(params && params.analysisId);
      if (!analysisId) return { ok: false, error: '缺少 analysisId' };
      const row = db.prepare('SELECT id, title, content, analysis_json, status FROM content_analysis WHERE id = ?').get(analysisId);
      if (!row) return { ok: false, error: '分析记录不存在' };
      if (row.status !== 'completed') return { ok: false, error: '分析未完成，无法生成策略' };

      let analysisObj = {};
      try { analysisObj = JSON.parse(row.analysis_json || '{}'); } catch {}
      const ctx = {
        topic: analysisObj.topic,
        basic_info: analysisObj.basic_info,
        core_points: Array.isArray(analysisObj.core_points) ? analysisObj.core_points.slice(0, 3) : undefined,
        viral: analysisObj.viral,
        audience: analysisObj.audience,
      };
      if (!topic) topic = row.title || '';
      skillBody = loadAngleSkill();
      userPrompt = `## 当前创作身份\n赛道：${track || '（未设赛道）'}\n人设：${persona || '（未设人设）'}\n\n## 已生成的内容分析（7 维摘要）\n${JSON.stringify(ctx, null, 0)}\n\n## 原文（截前 3000 字）\n${(row.content || '').slice(0, 3000)}\n\n## 任务\n基于以上分析，**从「${track || '通用'}」赛道角度**生成 5 个互斥的创作策略。\n每个策略必须给：angle_type（或 frame）、锐度 title、**core_point（主张：全文要证明的那一句判断）**、**insight（独特洞察：读者带走的那一句，不得与 core_point 同义反复）**、target_user、**narrative 四拍叙事骨架 {"hook":"…","explanation":"…","framework":"…","action":"…"}**、value_score、emotion、goal、reason。\n**evidence（证据账）A 模式也必须给**：至少 2 条用户需要去拿的具体素材，写成 {"item":"…","status":"todo"}；如果参考文里已经带了可用证据，把它标成 status:"ready"。尤其 type=new_evidence 的差异锚点，不列证据就是空头支票。\n**differentiator 是本模式最重要的字段**，必须给结构化对象：\n  {"type":"new_position|new_evidence|new_audience|new_scenario|new_conclusion|new_experience 选一个","description":"本稿比原文具体多给什么","instruction":"全文必须怎么落这条差异"}\n禁止 type 空着、禁止 description 写"换个说法/更深入浅出"这类空话。\n另给批次级 track_fit：{"score":0-10,"reason":"为什么适合/不适合当前账号","adapt_direction":"不适合时怎么改角度"}。\n\n输出严格合法 JSON（不要 markdown 代码块包裹）。`;
    } else {
      if (!topic.trim()) return { ok: false, error: '请填写主题' };
      skillBody = loadTopicSkill();
      userPrompt = `## 当前创作身份\n赛道：${track || '（未设赛道）'}\n人设：${persona || '（未设人设）'}\n\n## 主题（唯一实质输入，**没有参考文章**）\n${topic}\n\n## 任务\n在没有任何参考素材的前提下推演，生成 5 个互斥的创作策略。\n每个策略必须给：angle_type（或 frame）、title、**core_point（主张：全文要证明的那句判断，不依赖未证实数据）**、**insight（独特洞察：别人没想到、但读者会记住的那一句，不得与 core_point 同义反复）**、target_user、**narrative 四拍叙事骨架 {"hook":"…","explanation":"…","framework":"…","action":"…"}**、\n**feasibility**：{"score":0-10 这个题目在当前赛道值不值得写,"difficulty":"easy|medium|hard 用户没有一手素材时写得动的程度","reason":"把竞争情况、目标人群为何关心、结论建议合进这一句"}、\n**evidence（证据账，决定这篇能不能成立）**：至少 3 条用户能去获取的具体素材，每条写成 {"item":"…","status":"todo"}，禁止"需要更多资料"这种废话；\n**fact_risk**："low|medium|high"——这个角度最容易让 AI 编造事实的程度（要数据/案例/人物的越高），\n以及 value_score、emotion、goal、reason、differentiator（相对同类写法新在哪，同样用结构化对象）。\n\n铁律：不得编造具体数字、日期、人名、机构、研究结论、案例细节、第一手经历；不确定的内容一律进 evidence_needed 并标「待核实」。difficulty 要敢给 hard，不要全给 easy 讨好用户。\n\n输出严格合法 JSON（不要 markdown 代码块包裹）。`;
    }

    const fullPrompt = skillBody + '\n\n---\n\n' + userPrompt;
    const start = Date.now();
    try {
      const { taskId, promise } = enqueueAgentRun('strategy',
        `策略·${mode === 'topic' ? '命题' : '借势'}: ${(topic || '未命名').slice(0, 24)}`,
        { cli, model }, fullPrompt);
      const { content: raw, elapsedMs } = await promise;
      const parsed = parseAnalysisJson(raw);
      if (!parsed.ok) return { ok: false, error: parsed.error, taskId, durationMs: elapsedMs || (Date.now() - start) };
      const shaped = parseStrategyResult(parsed.data, mode);
      if (!shaped.ok) return { ok: false, error: shaped.error, taskId, durationMs: elapsedMs || (Date.now() - start) };

      // 一次生成 = 一个批次，产出 N 行独立策略（V2 的核心：策略可单独复用）
      const batchId = newBatchId();
      const tfJson = shaped.track_fit ? JSON.stringify(shaped.track_fit) : null;
      const ids = db.transaction(() => shaped.strategies.map((s) =>
        INS_S.run(
          shaped.mode, shaped.mode === 'topic' ? 'topic' : 'analysis', analysisId, batchId,
          topic, profileId, track, persona,
          s.angle_type, s.title, s.core_point, s.insight || '', s.target_user || '',
          JSON.stringify(s.structure || []), s.narrative ? JSON.stringify(s.narrative) : '[]',
          s.emotion || '', s.goal || '',
          s.value_score ?? null,
          s.differentiator ? JSON.stringify(s.differentiator) : null,
          tfJson,
          s.feasibility ? JSON.stringify(s.feasibility) : null,
          s.evidence_needed ? JSON.stringify(s.evidence_needed) : null,
          s.fact_risk || (shaped.mode === 'topic' ? 'medium' : 'low'),
          // 三问：存 AI 提的候选（可空）。闸门只认用户确认后的值，所以 AI 填了也不代表能生成。
          s.belief_before || '', s.belief_after || '', s.belief_source || '',
        ).lastInsertRowid,
      ))();

      const rows = db.prepare(
        `SELECT *, (SELECT COUNT(*) FROM strategy_articles sa WHERE sa.strategy_id = content_strategies.id) AS adoption_count
         FROM content_strategies WHERE batch_id = ? ORDER BY id`,
      ).all(batchId);

      return {
        ok: true, taskId, batchId, mode: shaped.mode,
        strategies: rows.map(shapeStrategyRow),
        track_fit: shaped.track_fit,
        durationMs: elapsedMs || (Date.now() - start),
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err), taskId: null, durationMs: Date.now() - start };
    }
  }

  ipcMain.handle('strategy:generate', (_e, params) => runStrategyGenerate(params));
  // 兼容别名：P0-1 时期 renderer 调的名字
  ipcMain.handle('analysis:angles', (_e, params) => runStrategyGenerate({ ...(params || {}), mode: 'reference' }));

  /** 采纳一条策略 → 建 strategy_articles（1:N：同一策略可反复采纳给不同渠道的文章） */
  function adoptStrategy(strategyId, articleId) {
    const id = Number(strategyId);
    if (!id) return { ok: false, error: '缺少 strategyId' };
    const row = db.prepare('SELECT id, mode, status FROM content_strategies WHERE id = ?').get(id);
    if (!row) return { ok: false, error: '策略不存在' };
    const res = db.prepare(`INSERT INTO strategy_articles (strategy_id, article_id) VALUES (?, ?)`)
      .run(id, articleId ? Number(articleId) : null);
    db.prepare(`UPDATE content_strategies SET status = 'adopted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    return { ok: true, adoptionId: res.lastInsertRowid, strategyId: id, mode: row.mode };
  }

  ipcMain.handle('strategy:adopt', (_e, params) =>
    adoptStrategy(params && params.strategyId, params && params.articleId));
  // 兼容旧签名（P0-2 用 {id,index} 指向批次里的第 index 个角度；V2 里策略本身就是行）
  ipcMain.handle('angles:adopt', (_e, params) => {
    const legacyId = params && (params.strategyId ?? params.id);
    return adoptStrategy(legacyId, params && params.articleId);
  });

  ipcMain.handle('strategy:list', (_e, params) => {
    const { profileId, mode, status, track, search, limit = 50 } = params || {};
    const where = [], vals = [];
    const pid = String(profileId || '');
    // 身份隔离：传 profileId 则只看本身份 + 历史空身份记录
    if (pid) { where.push(`(profile_id = ? OR profile_id = '' OR profile_id IS NULL)`); vals.push(pid); }
    if (mode === 'topic' || mode === 'reference') { where.push(`mode = ?`); vals.push(mode); }
    if (status === 'unarchived') {
      // 默认视图：“归档”应当真的隐东西，否则归档几乎等于没作用
      where.push(`status != 'archived'`);
    } else if (status === 'candidate' || status === 'adopted' || status === 'archived') {
      where.push(`status = ?`); vals.push(status);
    }
    if (track) { where.push(`track = ?`); vals.push(String(track)); }
    const q = String(search || '').trim();
    if (q) { where.push(`(title LIKE ? OR topic LIKE ? OR angle_type LIKE ? OR core_point LIKE ?)`); vals.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    vals.push(Number(limit) || 50);
    const rows = db.prepare(`
      SELECT *, (SELECT COUNT(*) FROM strategy_articles sa WHERE sa.strategy_id = content_strategies.id) AS adoption_count
      FROM content_strategies
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...vals);
    return rows.map(shapeStrategyRow);
  });

  ipcMain.handle('strategy:get', (_e, id) => {
    const row = db.prepare('SELECT * FROM content_strategies WHERE id = ?').get(Number(id));
    if (!row) return null;
    const links = db.prepare(`
      SELECT id, article_id, adopted_at, shares, views, likes, favorites, comments, followers, manual_score, note
      FROM strategy_articles WHERE strategy_id = ? ORDER BY adopted_at DESC
    `).all(row.id);
    return { ...shapeStrategyRow(row), links };
  });

  ipcMain.handle('strategy:delete', (_e, id) => {
    const res = db.prepare('DELETE FROM content_strategies WHERE id = ?').run(Number(id));
    return { ok: true, changes: res.changes };
  });

  ipcMain.handle('strategy:setStatus', (_e, params) => {
    const { id, status } = params || {};
    if (!['candidate', 'adopted', 'archived'].includes(status)) return { ok: false, error: 'status 非法' };
    const res = db.prepare(`UPDATE content_strategies SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, Number(id));
    return { ok: res.changes > 0, changes: res.changes };
  });

  /**
   * V3：勾选某条证据为已备/未备 —— 成立度要由用户亲手勾上来，不是 AI 猜的。
   * body 只改 evidence_needed 列，其余字段不动。
   */
  ipcMain.handle('strategy:setEvidenceStatus', (_e, params) => {
    const id = Number(params && params.strategyId);
    const index = params && params.index;
    const status = params && params.status === 'ready' ? 'ready' : 'todo';
    if (!id || !Number.isInteger(index)) return { ok: false, error: '缺少 strategyId 或 index' };
    const row = db.prepare('SELECT id, evidence_needed FROM content_strategies WHERE id = ?').get(id);
    if (!row) return { ok: false, error: '策略不存在' };
    let list = [];
    try { list = JSON.parse(row.evidence_needed || '[]'); } catch {}
    if (!Array.isArray(list) || index < 0 || index >= list.length) {
      return { ok: false, error: `证据下标越界（${index} / 共 ${Array.isArray(list) ? list.length : 0} 条）` };
    }
    const item = typeof list[index] === 'string' ? { item: list[index], status } : { ...list[index], status };
    list[index] = item;
    db.prepare(`UPDATE content_strategies SET evidence_needed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(JSON.stringify(list), id);
    const cov = evidenceCoverage({ evidence_needed: list });
    return { ok: true, ...cov };
  });

  /**
   * V4：回答三问（生成守卫的写入孔）。
   * 这三句故意不记 AI 自填的默认值：必须是人确认的内容，所以单独一个窄接口。
   */
  ipcMain.handle('strategy:setBelief', (_e, params) => {
    const id = Number(params && params.strategyId);
    if (!id) return { ok: false, error: '缺少 strategyId' };
    const row = db.prepare('SELECT id FROM content_strategies WHERE id = ?').get(id);
    if (!row) return { ok: false, error: '策略不存在' };
    const clean = (v) => String(v == null ? '' : v).trim().slice(0, 500);
    const bb = clean(params.beliefBefore ?? params.belief_before);
    const ba = clean(params.beliefAfter ?? params.belief_after);
    const bs = clean(params.beliefSource ?? params.belief_source);
    db.prepare(`
      UPDATE content_strategies
      SET belief_before = ?, belief_after = ?, belief_source = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(bb, ba, bs, id);
    const fresh = db.prepare('SELECT * FROM content_strategies WHERE id = ?').get(id);
    return { ok: true, strategy: shapeStrategyRow(fresh), gate: strategyGate(shapeStrategyRow(fresh)) };
  });

  /**
   * 效果回填（§十三）：把发布后的真实数据写回那条「策略×文章」执行记录。
   * 没有这一环，策略只是提示词片段；有了它，策略才会被真实结果校正。
   */
  ipcMain.handle('strategy:recordResult', (_e, params) => {
    const p = params || {};
    const metrics = p.metrics || {};
    const cols = ['shares', 'views', 'likes', 'favorites', 'comments', 'followers', 'manual_score'];
    const sets = [], vals = [];
    for (const c of cols) {
      if (metrics[c] === undefined) continue;
      if (metrics[c] === null || metrics[c] === '') { sets.push(`${c} = NULL`); continue; }
      const n = Number(metrics[c]);
      if (!Number.isFinite(n)) return { ok: false, error: `${c} 不是数字` };
      sets.push(`${c} = ?`); vals.push(n);
    }
    if (typeof metrics.note === 'string') { sets.push(`note = ?`); vals.push(metrics.note); }
    if (!sets.length) return { ok: false, error: '没有任何要写入的指标' };

    let linkId = Number(p.adoptionId ?? p.linkId);
    if (!linkId && p.articleId) {
      const link = db.prepare(`SELECT id FROM strategy_articles WHERE article_id = ? ORDER BY adopted_at DESC, id DESC LIMIT 1`)
        .get(Number(p.articleId));
      if (link) linkId = link.id;
    }
    if (!linkId) return { ok: false, error: '找不到对应的策略执行记录（strategy_articles）' };
    const exists = db.prepare(`SELECT id FROM strategy_articles WHERE id = ?`).get(linkId);
    if (!exists) return { ok: false, error: '策略执行记录不存在' };
    vals.push(linkId);
    db.prepare(`UPDATE strategy_articles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true, adoptionId: linkId };
  });

  /** 策略战绩聚合：哪条策略真的有效（§十二 策略库要排序用） */
  ipcMain.handle('strategy:stats', (_e, ids) => {
    const list = Array.isArray(ids) ? ids.map(Number).filter(Boolean) : [];
    if (!list.length) return [];
    const ph = list.map(() => '?').join(',');
    return db.prepare(`
      SELECT strategy_id,
             COUNT(*) AS times_adopted,
             SUM(CASE WHEN views IS NOT NULL THEN 1 ELSE 0 END) AS reported,
             AVG(shares) AS avg_shares,
             AVG(views) AS avg_views, AVG(comments) AS avg_comments,
             AVG(favorites) AS avg_favorites, AVG(followers) AS avg_followers,
             AVG(manual_score) AS avg_manual_score
      FROM strategy_articles
      WHERE strategy_id IN (${ph})
      GROUP BY strategy_id
    `).all(...list);
  });
    ipcMain.handle('analysis:list', (_e, { limit = 20, profileId } = {}) => {
  // 身份隔离：传 profileId 则只看本身份 + 旧数据（profile_id='' 的历史记录不隐身）
  const pid = String(profileId || '');
  const rows = pid
    ? db.prepare(`
      SELECT id, source_url, title, platform, author, status, duration_ms, created_at, profile_id
      FROM content_analysis
      WHERE profile_id = ? OR profile_id = '' OR profile_id IS NULL
      ORDER BY created_at DESC
      LIMIT ?
    `).all(pid, Number(limit) || 20)
    : db.prepare(`
      SELECT id, source_url, title, platform, author, status, duration_ms, created_at, profile_id
      FROM content_analysis
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Number(limit) || 20);
    return rows;
  });

  ipcMain.handle('analysis:delete', (_e, id) => {
    const r = db.prepare(`DELETE FROM content_analysis WHERE id = ?`).run(Number(id));
    return { ok: true, changes: r.changes };
  });
}

module.exports = { registerIpc };