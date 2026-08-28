// Analysis 模块 — 跑 content-analysis skill，解析 JSON，存数据库
// 设计：把 Agent 输出解析为严格 JSON 的三种容错策略
const fs = require('node:fs');
const path = require('node:path');

/**
 * 从 Agent 文本输出中提取 JSON
 * 容错：直接 JSON / markdown 代码块 / 截取的 {…} 段
 * @param {string} text
 * @returns {{ ok: true, data: any } | { ok: false, error: string, raw: string }}
 */
function parseAnalysisJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'empty response', raw: text || '' };
  }

  // 1) 直接 JSON.parse
  const trimmed = text.trim();
  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch (_) { /* fall through */ }

  // 2) 从 markdown 代码块中提取（```json ... ``` 或 ``` ... ```）
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenceMatch) {
    try {
      return { ok: true, data: JSON.parse(fenceMatch[1].trim()) };
    } catch (_) { /* fall through */ }
  }

  // 3) 找第一对匹配的 {…}
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return { ok: true, data: JSON.parse(slice) };
    } catch (_) { /* fall through */ }
  }

  return { ok: false, error: 'no valid JSON found', raw: text.slice(0, 500) };
}

/** 读取 angle-generation skill（不依赖 skills.cjs 体系） */
function loadAngleSkill() {
  const p = path.resolve(__dirname, "..", "src", "skills", "analysis", "angle-generation", "SKILL.md");
  if (!fs.existsSync(p)) throw new Error(`Angle skill not found: ${p}`);
  return fs.readFileSync(p, "utf-8")
    .replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

/** 角度生成结果：必须含 angles[]（≥5）与 track_fit{block}；其他字段容错 */
function parseAngleResult(data) {
  if (!data || typeof data !== "object") return { ok: false, error: "缺少 JSON 对象" };
  const raw = Array.isArray(data.angles) ? data.angles.filter(a => a && (a.title || a.angle_type)) : [];
  const angles = raw.map(normalizeAngle);
  if (angles.length < 3) return { ok: false, error: `angles 不足（${angles.length} 个，至少要 3 个）` };
  const tf = data.track_fit && typeof data.track_fit === "object" ? data.track_fit : null;
  return { ok: true, angles, track_fit: tf };
}

/**
 * 单个角度字段归一化。
 * 宽容处理：value_score 容忍字符串/越界；emotion/goal 不强校枚举（模型可能换说法），
 * 保留原文交给 UI 展示。老数据（没有这三个字段）不会因为缺字段而报错。
 */
function normalizeAngle(a) {
  const out = {
    angle_type: String(a.angle_type || '').trim(),
    title: String(a.title || '').trim(),
    core_point: String(a.core_point || '').trim(),
  };
  if (a.target_user) out.target_user = String(a.target_user).trim();
  if (Array.isArray(a.structure)) {
    const st = a.structure.map(s => String(s == null ? '' : s).trim()).filter(Boolean);
    if (st.length) out.structure = st;
  }
  if (a.reason) out.reason = String(a.reason).trim();
  const n = typeof a.value_score === 'number' ? a.value_score : parseFloat(a.value_score);
  if (Number.isFinite(n)) out.value_score = Math.max(0, Math.min(10, Math.round(n * 10) / 10));
  if (a.emotion) out.emotion = String(a.emotion).trim();
  if (a.goal) out.goal = String(a.goal).trim();
  return out;
}

// 情绪锦点→写法约束（策略能指影响标题/开头/结尾，而不是只当一个标签）
const EMOTION_GUIDE = {
  '共鸣': '多用“你是不是也…”的具体场景指认，让读者先觉得被理解，再给观点。',
  '愤怒': '明确一个可指认的不对等/不公，用事实和细节推高，不要直接喊口号。',
  '焦虑': '把风险具体到时间线和代价上，但结尾必须给一条出路，避免纯危言。',
  '治愈': '语气克制温和，先承认难处，再给小颛粒度的安慰与可行建议。',
  '反转': '前半部分先把常识立场立稳，后半部分用事实/案例推翻，转折处要有明确断点。',
  '鼓励': '以“普通人真的做到过”的证据为主体，给出下一步最小行动，避免鸡汤。',
};

// 内容目标→结构约束
const GOAL_GUIDE = {
  '涨粉': '结尾要有明确的“关注动机”：给出持续更新的预期 + 一句身份认同式号召，不要软广口吻。',
  '评论': '留一个有争议的决定点让读者表态（二选一/站队），结尾用问句收束，不给圆满结论。',
  '收藏': '提高信息密度：把可执行部分清单化/步骤化，让人有“以后要用”的理由。',
  '建立IP': '用鲜明的个人立场和第一手经历，敢下判断，不用中性表述，让人记住“是谁说的”。',
  '商业转化': '把观点落到具体需求场景与决策焦虑上，自然过渡到解决方案，不要硬推。',
};

/**
 * 把用户采纳的那个角度渲染成提示词里的“创作策略”块。
 * 与 buildAnalysisContextBlock 的区分：那边是“参考素材是什么”，这边是“用户已决定怎么写”，
 * 所以显式要求不得沿用原文观点与结构。
 * @param {Object} [strategy] 来自 renderer 的已采纳角度（Angle 字段 + anglesId/index）
 */
function buildStrategyBlock(strategy) {
  if (!strategy || typeof strategy !== 'object') return '';
  const lines = [];
  if (strategy.angle_type) lines.push(`- **创作角度**: ${strategy.angle_type}`);
  if (strategy.core_point) lines.push(`- **文章立意**: ${strategy.core_point}`);
  if (strategy.title) lines.push(`- **标题方向**: ${strategy.title}`);
  if (strategy.target_user) lines.push(`- **目标读者**: ${strategy.target_user}`);
  if (strategy.emotion) {
    const g = EMOTION_GUIDE[strategy.emotion];
    lines.push(`- **情绪策略**: 读完后的主导情绪 = ${strategy.emotion}${g ? ' —— ' + g : ''}`);
  }
  if (strategy.goal) {
    const g = GOAL_GUIDE[strategy.goal];
    lines.push(`- **内容目标**: ${strategy.goal}${g ? ' —— ' + g : ''}`);
  }
  const struct = Array.isArray(strategy.structure) ? strategy.structure.filter(Boolean) : [];
  if (struct.length) {
    lines.push('- **结构要求**（按此顺序组织，可细化但不得丢步骤）:');
    struct.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  if (!lines.length) return '';
  return [
    '## 本次创作策略（用户已采纳，约束力高于参考素材）',
    ...lines,
    '',
    '⚠️ 上面的「参考内容分析」只是素材与市场参照，**不得沿用原文的观点、例子与结构**；',
    strategy.core_point
      ? '本文必须围绕上面这条「文章立意」展开，并按指定的角度、情绪、目标重写。'
      : '本文必须按上面指定的角度、情绪、目标来写。',
  ].join('\n');
}

/** 读取 content-analysis skill（不依赖 skills.cjs 的 channels/personas 体系） */
function loadAnalysisSkill() {
  const skillPath = path.resolve(__dirname, '..', 'src', 'skills', 'analysis', 'content-analysis', 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Analysis skill not found: ${skillPath}`);
  }
  const raw = fs.readFileSync(skillPath, 'utf-8');
  // 剥掉 YAML frontmatter（---\n...\n---）：它不是给模型的指令，且以 --- 开头会干扰部分 CLI
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

/**
 * 构造分析任务的 prompt
 * @param {Object} input
 * @param {string} input.title
 * @param {string} input.content
 * @param {string} [input.platform]
 * @param {string} [input.author]
 * @param {string} [input.source]
 * @returns {string}
 */
function buildAnalysisPrompt({ title, content, platform, author, source, domain }) {
  return `请分析以下内容，按你定义的 JSON Schema 输出。

## 平台
${platform || '未指定'}

## 作者
${author || '未指定'}

## 来源
${source || 'user input'}

## 用户专注领域
${domain || '未指定'}

## 标题
${title || '(无标题)'}

## 正文
${content}

---

严格按照 JSON Schema 输出，不要任何额外解释、注释、或 markdown 代码块包裹。`;
}

/**
 * 把分析结果插入数据库
 * @param {Object} db
 * @param {Object} params
 */
/**
 * 把分析结果格式化成 prompt 中的 context block
 * 会被注入到 outline / article 生成时作为上下文
 * @param {Object} analysis  - ContentAnalysisResult 结构
 * @returns {string} 空字符串或 markdown 段落
 */
function buildAnalysisContextBlock(analysis) {
  if (!analysis || typeof analysis !== 'object') return '';
  const parts = [];
  const b = analysis.basic_info || {};
  const t = analysis.topic || {};
  const a = analysis.audience || {};
  const v = analysis.viral || {};
  const core = Array.isArray(analysis.core_points) ? analysis.core_points : [];
  const struct = Array.isArray(analysis.structures) ? analysis.structures : [];

  const lines = [];
  lines.push('## AI 对参考内容的分析（上下文，不要逐字复用原文观点）');
  if (t.main_topic || t.category) {
    lines.push(`- **主题**: ${t.main_topic || '?'} (${t.category || '未分类'})`);
  }
  if (t.summary) lines.push(`- **总结**: ${t.summary}`);
  if (core.length) {
    lines.push('- **核心观点**:');
    for (const p of core) lines.push(`  - ${p}`);
  }
  const reasons = Array.isArray(v.reason) ? v.reason : [];
  if (v.emotion || v.conflict || reasons.length) {
    const head = v.emotion || v.conflict
      ? `情绪=${v.emotion || '?'}, 冲突=${v.conflict || '?'}`
      : '';
    if (head) lines.push(`- **爆点**: ${head}`);
    if (reasons.length) {
      lines.push('- **传播原因**:');
      for (const r of reasons) lines.push(`  - ${r}`);
    }
  }
  if (a.target_user) lines.push(`- **目标用户**: ${a.target_user}`);
  const pains = Array.isArray(a.pain_points) ? a.pain_points : [];
  if (pains.length) {
    lines.push('- **关注点**:');
    for (const p of pains) lines.push(`  - ${p}`);
  }
  if (struct.length) {
    lines.push('- **结构参考**:');
    for (const s of struct) lines.push(`  - ${s}`);
  }
  if (lines.length <= 1) return '';
  parts.push(lines.join('\n'));
  parts.push('');
  return parts.join('\n');
}

function saveAnalysis(db, { source_url, title, platform, author, content, analysis_json, duration_ms, status = 'completed', error = '' }) {
  const stmt = db.prepare(`
    INSERT INTO content_analysis
    (source_url, title, platform, author, content, analysis_json, status, error, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    source_url || '',
    title || '',
    platform || '',
    author || '',
    content || '',
    typeof analysis_json === 'string' ? analysis_json : JSON.stringify(analysis_json),
    status,
    error,
    duration_ms || 0,
  );
  return result.lastInsertRowid;
}

module.exports = {
  parseAnalysisJson, parseAngleResult, normalizeAngle, loadAnalysisSkill, loadAngleSkill,
  buildAnalysisPrompt, buildAnalysisContextBlock, buildStrategyBlock, saveAnalysis,
};