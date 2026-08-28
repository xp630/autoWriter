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

/** 读取 angle-generation skill（A 借势拆解，不依赖 skills.cjs 体系） */
function loadAngleSkill() {
  const p = path.resolve(__dirname, "..", "src", "skills", "strategy", "angle-generation", "SKILL.md");
  if (!fs.existsSync(p)) throw new Error(`Angle skill not found: ${p}`);
  return fs.readFileSync(p, "utf-8")
    .replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

/** 读取 topic-planning skill（B 命题策划） */
function loadTopicSkill() {
  const p = path.resolve(__dirname, "..", "src", "skills", "strategy", "topic-planning", "SKILL.md");
  if (!fs.existsSync(p)) throw new Error(`Topic strategy skill not found: ${p}`);
  return fs.readFileSync(p, "utf-8")
    .replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

/** 角度生成结果：必须含 angles[]（≥5）与 track_fit{block}；其他字段容错 */
function parseAngleResult(data, mode = 'reference') {
  return parseStrategyResult(data, mode);
}

/**
 * 策略生成结果解析（双模式）。返回平铺的策略数组（V2：一条 = 一行）。
 * A reference：附带批次级 track_fit（素材与赛道适配度）
 * B topic    ：每条自带 feasibility / evidence_needed / fact_risk
 */
function parseStrategyResult(data, mode = 'reference') {
  const isTopic = mode === 'topic';
  if (!data || typeof data !== "object") return { ok: false, error: "缺少 JSON 对象" };
  const raw = Array.isArray(data.angles) ? data.angles.filter(a => a && (a.title || a.angle_type)) : [];
  const strategies = raw.map(a => normalizeStrategy(a, mode));
  if (strategies.length < 3) return { ok: false, error: `angles 不足（${strategies.length} 个，至少要 3 个）` };
  if (isTopic) return { ok: true, mode: 'topic', strategies, track_fit: null };
  return { ok: true, mode: 'reference', strategies, track_fit: normalizeTrackFit(data.track_fit) };
}

/** B 模式的题目价值评估块 */
function normalizeStrategyValue(v) {
  const out = {};
  if (typeof v.worth === 'boolean') out.worth = v.worth;
  const n = typeof v.score === 'number' ? v.score : parseFloat(v.score);
  if (Number.isFinite(n)) out.score = Math.max(0, Math.min(10, Math.round(n * 10) / 10));
  for (const k of ['competition', 'audience_need', 'advice']) {
    if (v[k]) out[k] = String(v[k]).trim();
  }
  return Object.keys(out).length ? out : null;
}

// ===== V2 统一策略模型的字段归一化 =====
const DIFF_TYPES = ['new_position', 'new_evidence', 'new_audience', 'new_scenario', 'new_conclusion', 'new_experience'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const FACT_RISKS = ['low', 'medium', 'high'];
const DIFF_LABEL = {
  new_position: '新立场', new_evidence: '新证据', new_audience: '新人群',
  new_scenario: '新场景', new_conclusion: '新结论', new_experience: '新经历',
};
const FEAS_LABEL = { easy: '易', medium: '中', hard: '难' };

const clamp10 = (n) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));
const toScore = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? clamp10(n) : undefined;
};
const str = (v) => String(v == null ? '' : v).trim();

/** A 模式核心字段：差异锚点（结构化，便于正文提示词把 instruction 当硬约束用） */
function normalizeDifferentiator(d) {
  if (!d) return null;
  if (typeof d === 'string') {
    const description = str(d);
    return description ? { type: '', description, instruction: '' } : null;
  }
  const description = str(d.description || d.text || d.diff);
  if (!description) return null;
  const type = DIFF_TYPES.includes(d.type) ? d.type : '';
  return { type, description, instruction: str(d.instruction) };
}

/** A 模式：素材与赛道适配度 */
function normalizeTrackFit(t) {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  const score = toScore(t.score);
  // 兼容旧形状 {matches, note}
  if (score !== undefined) out.score = score;
  else if (typeof t.matches === 'boolean') out.score = t.matches ? 8 : 3;
  const reason = str(t.reason || t.note);
  if (reason) out.reason = reason;
  const adapt = str(t.adapt_direction || (typeof t.matches === 'boolean' && !t.matches ? reason : ''));
  if (adapt) out.adapt_direction = adapt;
  return Object.keys(out).length ? out : null;
}

/** B 模式：可写性与题目价值 */
function normalizeFeasibility(f) {
  if (!f) return null;
  if (typeof f === 'string') {
    const v = str(f);
    if (!v) return null;
    const map = { '易': 'easy', '中': 'medium', '难': 'hard' };
    return { score: undefined, difficulty: DIFFICULTIES.includes(v) ? v : (map[v] || ''), reason: '' };
  }
  if (typeof f !== 'object') return null;
  const out = {};
  const score = toScore(f.score);
  if (score !== undefined) out.score = score;
  const diff = str(f.difficulty || f.level);
  out.difficulty = DIFFICULTIES.includes(diff) ? diff : ({ '易': 'easy', '中': 'medium', '难': 'hard' }[diff] || '');
  const reason = str(f.reason);
  if (reason) out.reason = reason;
  return (out.score !== undefined || out.difficulty || out.reason) ? out : null;
}

function normalizeEvidence(list) {
  if (!Array.isArray(list)) return undefined;
  const ev = list.map(str).filter(Boolean);
  return ev.length ? ev : undefined;
}

/**
 * 单个角度归一成一个平铺策略（V2：一行 = 一个策略）。
 * 宽容处理：缺字段不报错，旧数据（字符串型 differentiator/feasibility）自动包装。
 */
function normalizeStrategy(a, mode = 'reference') {
  const out = {
    angle_type: str(a.angle_type),
    title: str(a.title),
    core_point: str(a.core_point),
  };
  if (a.target_user) out.target_user = str(a.target_user);
  if (Array.isArray(a.structure)) {
    const st = a.structure.map(str).filter(Boolean);
    if (st.length) out.structure = st;
  }
  if (a.reason) out.reason = str(a.reason);
  const vs = toScore(a.value_score);
  if (vs !== undefined) out.value_score = vs;
  if (a.emotion) out.emotion = str(a.emotion);
  if (a.goal) out.goal = str(a.goal);

  const diff = normalizeDifferentiator(a.differentiator);
  if (diff) out.differentiator = diff;
  const feas = normalizeFeasibility(a.feasibility);
  if (feas) out.feasibility = feas;
  const ev = normalizeEvidence(a.evidence_needed);
  if (ev) out.evidence_needed = ev;

  // fact_risk：B 模式默认 medium（无参考素材，天然有编造风险），并受素材缺口影响
  let fr = str(a.fact_risk).toLowerCase();
  if (!FACT_RISKS.includes(fr)) {
    if (mode === 'topic') fr = (ev && ev.length >= 3) ? 'high' : 'medium';
    else fr = 'low';
  }
  out.fact_risk = fr;
  void mode;
  return out;
}

/** 向后兼容：旧名 normalizeAngle 仍是单条归一化 */
function normalizeAngle(a, mode = 'reference') {
  const s = normalizeStrategy(a, mode);
  // 旧调用者期待“缺字段则键不存在”，归一化后的不同iator/feasibility 在旧测试里不存在也没关系
  return s;
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
 * 把用户采纳的角度渲染成提示词里的“创作策略”块（双模式）。
 * 与 buildAnalysisContextBlock 的区分：那边是“参考素材是什么”，这边是“用户已决定怎么写”。
 * @param {Object} [strategy] 来自 renderer 的已采纳角度（Angle 字段 + mode/anglesId/index）
 */
function buildStrategyBlock(strategy) {
  if (!strategy || typeof strategy !== 'object') return '';
  const isTopic = strategy.mode === 'topic';
  const lines = [];
  if (strategy.angle_type) lines.push(`- **创作角度**: ${strategy.angle_type}`);
  if (strategy.core_point) lines.push(`- **文章立意**: ${strategy.core_point}`);
  if (strategy.title) lines.push(`- **标题方向**: ${strategy.title}`);
  if (strategy.target_user) lines.push(`- **目标读者**: ${strategy.target_user}`);
  const diff = normalizeDifferentiator(strategy.differentiator);
  if (diff) {
    const label = diff.type ? `${DIFF_LABEL[diff.type] || diff.type}｜${diff.description}` : diff.description;
    lines.push(`- **差异锚点**: ${label}`);
  }
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

  const head = isTopic
    ? '## 本次创作策略（用户已采纳：命题策划，无参考素材）'
    : '## 本次创作策略（用户已采纳，约束力高于参考素材）';
  const body = [head, ...lines, ''];

  const ev = Array.isArray(strategy.evidence_needed) ? strategy.evidence_needed.filter(Boolean) : [];
  const factRisk = String(strategy.fact_risk || (isTopic ? 'medium' : 'low')).toLowerCase();
  if (isTopic) {
    // B 模式核心风险 = 幻觉。无参考文时模型最爱编数据/人名/案例。
    body.push(`⚠️ **事实约束（本次无参考素材，事实风险=${factRisk}，硬要求）**：`);
    body.push('- 禁止编造具体数字、百分比、日期、研究结论、人名、机构名、书名、引语、他人经历。');
    body.push('- 需要数据/案例支撑处，若用户未提供则写「待补充」占位，不得自行臆造。');
    body.push('- 不得替用户编造第一手经历（“我有个朋友…”、“去年我…”）。');
    body.push('- 允许用普遍观察式表述（“部分用户”、“很多人”、“一些情况下”、“普遍存在”），但不得伪装成统计结论。');
    if (factRisk === 'high') {
      body.push('- 本角度事实风险高：全文以观点与推理为主，所有定量表述一律占位，不得为了可读性补“看起来真”的数字。');
    }
    if (ev.length) {
      body.push('');
      body.push('- **本角度需要用户补充的素材（写之前先看用户有没有给；缺就保留占位并在结尾提醒）**：');
      ev.forEach((e, i) => body.push(`  ${i + 1}. ${e}`));
    }
    if (strategy.core_point) {
      body.push('');
      body.push(`本文必须围绕上面这条「文章立意」展开，并按指定的角度、情绪、目标来写。`);
    }
  } else {
    // A 模式核心风险 = 同质化。负向约束不够，还要正向差异锚点。
    body.push('⚠️ 上面的「参考内容分析」只是素材与市场参照，**不得沿用原文的观点、例子与结构**；');
    body.push(diff
      ? `本文必须把这条差异真正写进内容里，而不是喊口号：**${diff.description}${diff.instruction ? '（' + diff.instruction + '）' : ''}**。凡是与原文可能重合的表述、案例、结论，一律重写或删除。`
      : '本文必须按上面指定的角度、情绪、目标重写，不得只改标题与措辞。');
    if (strategy.core_point) {
      body.push(`全文要围绕上面这条「文章立意」展开。`);
    }
    if (ev.length) {
      body.push('');
      body.push('- **建议补充的素材**：');
      ev.forEach((e, i) => body.push(`  ${i + 1}. ${e}`));
    }
  }
  return body.join('\n');
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

/**
 * 策略→配图提示词（情绪定画面气质，目标定图的作用）。
 * 放在 analysis.cjs 是为了能单测；主进程只负责拼到生图 prompt 上。
 * @returns {string} 追加到原 prompt 后面的风格后缀（无策略时返回空串）
 */
function buildImageStrategyHint(strategy) {
  if (!strategy || typeof strategy !== 'object') return '';
  const tone = strategy.emotion ? EMOTION_IMAGE_TONE[strategy.emotion] : '';
  const use = strategy.goal ? GOAL_IMAGE_USE[strategy.goal] : '';
  if (!tone && !use) return '';
  const bits = [];
  if (tone) bits.push(`情绪基调：${tone}`);
  if (use) bits.push(`图像作用：${use}`);
  return `\n\n【创作策略约束】${bits.join('；')}。不要给出与这基调相反的观感。`;
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

// 情绪策略 → 画面气质（同样是策略选择，不是描述原文）
const EMOTION_IMAGE_TONE = {
  '共鸣': '生活化真实场景、自然光、可代入的具体细节，避免摆拍与商业图库感',
  '愤怒': '高对比、硬光、压迫性构图，冷色调与不对等空间关系',
  '焦虑': '暗调、紧迫感、都市夜景/时间元素，画面留白少',
  '治愈': '柔光、大留白、自然材质与低饱和暖色',
  '反转': '同一画面内并置两个矛盾元素，强反差构图',
  '鼓励': '明亮高调、上升视线、行动中的普通人',
};

// 内容目标 → 图应该干什么
const GOAL_IMAGE_USE = {
  '涨粉': '要有人物与场景叙事、有记忆点，能让人记住“这个账号”',
  '评论': '呈现对立/二选一关系，让读者看了就想站队',
  '收藏': '偏信息图：清单化/步骤化/结构清晰，能单独看懂',
  '建立IP': '真实工作/生活现场感，带人的痕迹，不用通用美图',
  '商业转化': '需求场景 + 解决后的对比，不要产品硬图',
};

module.exports = {
  parseAnalysisJson, parseAngleResult, parseStrategyResult,
  normalizeStrategy, normalizeAngle, normalizeStrategyValue,
  normalizeDifferentiator, normalizeTrackFit, normalizeFeasibility,
  DIFF_TYPES, DIFF_LABEL, DIFFICULTIES, FACT_RISKS,
  loadAnalysisSkill, loadAngleSkill, loadTopicSkill,
  buildAnalysisPrompt, buildAnalysisContextBlock, buildStrategyBlock, buildImageStrategyHint, saveAnalysis,
};