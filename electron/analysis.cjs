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

const EVIDENCE_STATUS = ['todo', 'ready'];

/**
 * evidence 归一化：支持三种输入形状。
 *   ['真实案例', ...]                                  ← V1 旧数据
 *   [{item:'官方价格', status:'ready'}, ...]        ← V3 带状态
 *   [{text:'…', done:true}, ...]                    ← 模型偶尔这么写
 * 未知 status 一律当 todo（安全默认：没确认过的素材就是没素材）。
 */
function normalizeEvidence(list) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  for (const e of list) {
    if (!e) continue;
    if (typeof e === 'string') {
      const item = str(e);
      if (item) out.push({ item, status: 'todo' });
      continue;
    }
    if (typeof e !== 'object') continue;
    const item = str(e.item || e.text || e.need || e.evidence);
    if (!item) continue;
    let status = str(e.status || e.state).toLowerCase();
    if (e.done === true || e.ready === true) status = 'ready';
    if (!EVIDENCE_STATUS.includes(status)) status = 'todo';
    out.push({ item, status });
  }
  return out.length ? out : undefined;
}

/**
 * 成立度：已备证据 / 总证据。
 * 这是 V3 的核心概念 —— 前面的字段决定“想写什么”，这一项决定“这篇能不能成立”。
 */
function evidenceCoverage(strategy) {
  const list = Array.isArray(strategy?.evidence_needed) ? strategy.evidence_needed : [];
  const total = list.length;
  const ready = list.filter((e) => (typeof e === 'string' ? false : e?.status === 'ready')).length;
  return { evidence_total: total, evidence_ready: ready, evidence_coverage: total ? ready / total : null };
}

/**
 * narrative 四段式叙事骨架（V3）。
 * 自由文本 structure 只能描述“一篇”，模板化的 narrative 才能复用“好多篇”。
 * 兼容：旧 structure 数组按下标当成四拍归到同名字段。
 */
const NARRATIVE_BEATS = ['hook', 'explanation', 'framework', 'action'];
// 提示词里给人看的拍名
const BEAT_TEXT = { hook: '钩子', explanation: '解释/论证', framework: '框架/方法', action: '行动/结尾' };

// 中文拍名 → 标准 beat（允许模型用中文键给）
const BEAT_ALIAS = {
  '钩子': 'hook', '开头钩子': 'hook', 'hook': 'hook',
  '解释': 'explanation', '论证': 'explanation', '展开': 'explanation', 'explanation': 'explanation',
  '框架': 'framework', '方法': 'framework', '模型': 'framework', 'framework': 'framework',
  '行动': 'action', '结尾': 'action', '号召': 'action', 'action': 'action',
};

function normalizeNarrative(n, structure) {
  const out = { hook: '', explanation: '', framework: '', action: '' };
  if (n && typeof n === 'object' && !Array.isArray(n)) {
    for (const [k, v] of Object.entries(n)) {
      const beat = BEAT_ALIAS[str(k).toLowerCase()] || BEAT_ALIAS[str(k)];
      const text = str(v);
      if (beat && text && !out[beat]) out[beat] = text;
    }
    if (Object.values(out).some(Boolean)) return out;
  }
  // 数组或旧 structure：按下标归拍，超过 4 拍的全归 action（结尾类）
  const list = Array.isArray(n) ? n : (Array.isArray(structure) ? structure : []);
  const filled = list.map(str).filter(Boolean);
  if (!filled.length) return null;
  filled.forEach((v, i) => {
    const beat = NARRATIVE_BEATS[Math.min(i, NARRATIVE_BEATS.length - 1)];
    out[beat] = out[beat] ? `${out[beat]}；${v}` : v;
  });
  return out;
}

/**
 * 单个角度归一成一个平铺策略（V2：一行 = 一个策略）。
 * 宽容处理：缺字段不报错，旧数据（字符串型 differentiator/feasibility）自动包装。
 */
function normalizeStrategy(a, mode = 'reference') {
  const out = {
    // V3：frame（归因框架）与 thesis（主张）作为 angle_type / core_point 的别名接受
    angle_type: str(a.angle_type || a.frame),
    title: str(a.title),
    core_point: str(a.core_point || a.thesis),
  };
  // insight（独特洞察）与 thesis（主张）是两回事：
  // 主张可以正确但毫无价值，洞察才是读者带走的那一句。
  const insight = str(a.insight);
  if (insight) out.insight = insight;
  // V4 生成守卫三问：容忍多种写法，但绝不自己编造默认值
  const bb = str(a.belief_before || a.beliefBefore || a.reader_before);
  if (bb) out.belief_before = bb;
  const ba = str(a.belief_after || a.beliefAfter || a.target_belief);
  if (ba) out.belief_after = ba;
  const bs = str(a.belief_source || a.belief_before_source);
  if (bs) out.belief_source = bs;
  if (a.target_user) out.target_user = str(a.target_user);
  if (Array.isArray(a.structure)) {
    const st = a.structure.map(str).filter(Boolean);
    if (st.length) out.structure = st;
  }
  const narr = normalizeNarrative(a.narrative, a.structure);
  if (narr) out.narrative = narr;
  // 模型只给 narrative 时反推 structure，保证所有旧读取方（UI 列表、大纲预填）不空
  if (!out.structure && narr) {
    const beats = NARRATIVE_BEATS.map((b) => narr[b]).filter(Boolean);
    if (beats.length) out.structure = beats;
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
  const ev = normalizeEvidence(a.evidence_needed || a.evidence);
  if (ev) out.evidence_needed = ev;

  // fact_risk：显式值优先；没给则按模式 + 证据成立度推。
  // 有缺口且一条都没备 → 风险最高；全备齐 → 可以降级。
  let fr = str(a.fact_risk).toLowerCase();
  if (!FACT_RISKS.includes(fr)) {
    const cov = evidenceCoverage(out);
    const noneReady = cov.evidence_total > 0 && cov.evidence_ready === 0;
    const allReady = cov.evidence_total > 0 && cov.evidence_ready === cov.evidence_total;
    if (allReady) fr = 'low';
    else if (mode === 'topic') fr = noneReady ? 'high' : 'medium';
    else fr = noneReady && cov.evidence_total >= 2 ? 'medium' : 'low';
  }
  out.fact_risk = fr;
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
 * V4 生成守卫（①）：三问未答完 → 禁止生成正文。
 *
 * 为什么放在主进程而不是只靠 UI：UI 可以绕过（草稿恢复、旧策略、脚本 invoke），
 * 而这条规则的意义就是“输入烂不配被生成掩盖”，所以必须是硬拦。
 *
 * 证据只认 status=ready：列了 5 条但一条没备，等于没证据。
 */
function strategyGate(strategy) {
  const s = strategy && typeof strategy === 'object' ? strategy : {};
  const missing = [];
  if (!str(s.belief_before)) missing.push('读者原本怎么想');
  if (!str(s.belief_after)) missing.push('你希望读者改怎么想');
  const ev = Array.isArray(s.evidence_needed) ? s.evidence_needed : [];
  const ready = ev.filter((e) => (typeof e === 'string' ? false : str(e && e.status) === 'ready')).length;
  if (ready === 0) missing.push('至少一条已备好的证据（证据账里勾上 ready）');
  return { pass: missing.length === 0, missing, ready_evidence: ready };
}

/**
 * 把用户采纳的角度渲染成提示词里的“创作策略”块（双模式）。
 * 与 buildAnalysisContextBlock 的区分：那边是“参考素材是什么”，这边是“用户已决定怎么写”。
 * @param {Object} [strategy] 来自 renderer 的已采纳角度（Angle 字段 + mode/anglesId/index）
 */
function buildStrategyBlock(strategy) {
  if (!strategy || typeof strategy !== 'object') return '';
  const isTopic = strategy.mode === 'topic';
  const lines = [];
  if (strategy.angle_type) lines.push(`- **创作框架**: ${strategy.angle_type}`);
  if (strategy.core_point) lines.push(`- **核心主张（全文要证明它）**: ${strategy.core_point}`);
  // 主张与洞察分开写：模型只会写“正确的废话”时，是因为没人要求它给出后者。
  if (strategy.insight) lines.push(`- **独特洞察（读者要带走的那一句）**: ${strategy.insight}`);
  // V4：认知位移——本文存在的全部理由。写不出位移的文章只会充“正确的废话”
  if (strategy.belief_before || strategy.belief_after) {
    lines.push(`- **认知位移（本文要完成的事）**: 读者原本认为「${strategy.belief_before || '…'}」→ 读完后应认为「${strategy.belief_after || '…'}」`);
    if (strategy.belief_source) lines.push(`- **旧认知的出处（不得生造共识）**: ${strategy.belief_source}`);
  }
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
  // 叙事骨架优先用 narrative 四拍；没有再退回 structure 平铺
  const narr = normalizeNarrative(strategy.narrative, strategy.structure);
  if (narr && Object.values(narr).some(Boolean)) {
    lines.push('- **叙事骨架**（按此顺序写，可细化但不得丢拍）:');
    NARRATIVE_BEATS.forEach((b, i) => {
      if (narr[b]) lines.push(`  ${i + 1}. ${BEAT_TEXT[b]}：${narr[b]}`);
    });
  } else {
    const struct = Array.isArray(strategy.structure) ? strategy.structure.filter(Boolean) : [];
    if (struct.length) {
      lines.push('- **结构要求**（按此顺序组织，可细化但不得丢步骤）:');
      struct.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    }
  }
  if (!lines.length) return '';

  const head = isTopic
    ? '## 本次创作策略（用户已采纳：命题策划，无参考素材）'
    : '## 本次创作策略（用户已采纳，约束力高于参考素材）';
  const body = [head, ...lines, ''];

  // ===== 证据账（V3 核心）=====
  // 前面的字段决定“想写什么”，这一项决定“这篇能不能成立”。
  // 已备→可用证据（鼓励写实）；未备→必须占位（禁止编造）。同一份清单同时管两端。
  const rawEv = Array.isArray(strategy.evidence_needed) ? strategy.evidence_needed.filter(Boolean) : [];
  const evList = rawEv.map((e) => (typeof e === 'string' ? { item: str(e), status: 'todo' } : { item: str(e.item || e.text), status: str(e.status) === 'ready' ? 'ready' : 'todo' }))
    .filter((e) => e.item);
  const ready = evList.filter((e) => e.status === 'ready');
  const todo = evList.filter((e) => e.status === 'todo');
  const cov = evidenceCoverage(strategy);
  // 事实风险：显式值优先；没给时按成立度推（一条都没备 = 升高）
  let factRisk = str(strategy.fact_risk).toLowerCase();
  if (!FACT_RISKS.includes(factRisk)) {
    if (cov.evidence_total > 0 && cov.evidence_ready === 0) factRisk = 'high';
    else if (cov.evidence_total === 0) factRisk = isTopic ? 'medium' : 'low';
    else if (cov.evidence_coverage >= 0.999) factRisk = 'low';
    else factRisk = 'medium';
  }

  if (evList.length) {
    const pct = cov.evidence_coverage == null ? '—' : `${Math.round(cov.evidence_coverage * 100)}%`;
    body.push(`### 证据账（决定这篇能不能成立） 成立度 ${cov.evidence_ready}/${cov.evidence_total}（${pct}）`);
    if (ready.length) {
      body.push('- ✅ **用户已提供的证据，可以直接写进正文**：');
      ready.forEach((e, i) => body.push(`  ${i + 1}. ${e.item}`));
    }
    if (todo.length) {
      body.push('- ⛔ **用户还没给的素材：正文里必须留「待补充」占位，绝对不得臆造**：');
      todo.forEach((e, i) => body.push(`  ${i + 1}. ${e.item}`));
    }
    body.push('');
  }

  if (factRisk !== 'low' || isTopic) {
    body.push(`⚠️ **事实约束（事实风险=${factRisk}${isTopic ? '，本次无参考素材' : ''}，硬要求）**：`);
    body.push('- 禁止编造具体数字、百分比、日期、研究结论、人名、机构名、书名、引语、他人经历。');
    if (todo.length) body.push('- 上方标为“还没给”的每一项，在需要它的地方写「待补充：XXX」，不得臆造。');
    else body.push('- 需要数据/案例支撑而用户未提供的地方，一律写「待补充」占位。');
    body.push('- 不得替用户编造第一手经历（“我有个朋友…”、“去年我…”）。');
    body.push('- 允许用普遍观察式表述（“部分用户”、“很多人”、“一些情况下”、“普遍存在”），但不得伪装成统计结论。');
    if (factRisk === 'high') {
      body.push('- 本篇证据严重不足：全文以观点与推理为主，所有定量表述一律占位，不得为了可读性补“看起来真”的数字。');
    }
    body.push('');
  }

  if (isTopic) {
    if (strategy.core_point) {
      body.push('本文必须围绕上面这条「核心主张」展开，并按指定的框架、情绪、目标来写。');
    }
  } else {
    // A 模式核心风险 = 同质化。负向约束不够，还要正向差异锚点。
    body.push('⚠️ 上面的「参考内容分析」只是素材与市场参照，**不得沿用原文的观点、例子与结构**；');
    body.push(diff
      ? `本文必须把这条差异真正写进内容里，而不是喊口号：**${diff.description}${diff.instruction ? '（' + diff.instruction + '）' : ''}**。凡是与原文可能重合的表述、案例、结论，一律重写或删除。`
      : '本文必须按上面指定的框架、情绪、目标重写，不得只改标题与措辞。');
    if (strategy.core_point) body.push('全文要围绕上面这条「核心主张」展开。');
  }
  if (strategy.insight) {
    body.push('全文结尾前必须把「独特洞察」说成一句可被人复述的话，不要让它隐含在段落里。');
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
 * V4 图片角色（只做三种 + 一个兵底）。故意不做五套体系：
 * 2 粉阶段“低质量但承担任务的图 > 高质量但没任务的图”——角色先于美学。
 * 图的职责是降低阅读成本（标题负责点击），所以提示词重心在“一眼看懂”，不在好看。
 */
const IMAGE_ROLES = {
  compare: {
    label: '对比图',
    hint: '左右或上下两栏对比结构，两侧体量相当，中间有明显分隔，标出关键差异项；不要装饰性背景',
  },
  flow: {
    label: '流程图',
    hint: '从左到右或从上到下的步骤链路，节点用方框、箭头明确指向下一步，总数控制在 3–5 步，不画多余元素',
  },
  framework: {
    label: '框架图',
    hint: '把概念分成几个并列区块（如 2×2 或四象限），区块标题要能读，区块之间关系用连线或包含表示',
  },
  scene: {
    label: '场景图（兵底）',
    hint: '仅当内容真的需要一个具体场景时才用；以真实、具体、可读为先，不要炫技法',
  },
};

/**
 * 从占位描述里推角色。关键词命中优先级：对比 > 流程 > 框架 > 场景。
 * @returns {{ role: string, label: string, hint: string } | null}
 */
function inferImageRole(promptText) {
  const t = String(promptText || '').toLowerCase();
  const raw = String(promptText || '');
  if (/(vs|对比|相较|两种|前者后者|贵价|便宜档|之前.{0,4}之后)/i.test(t)) return { role: 'compare', ...IMAGE_ROLES.compare };
  if (/(流程|步骤|链路|阶段|从.{0,6}到|→|-&gt;)/.test(raw)) return { role: 'flow', ...IMAGE_ROLES.flow };
  if (/(框架|模型|四象限|矩阵|四问|分层|体系|清单)/.test(raw)) return { role: 'framework', ...IMAGE_ROLES.framework };
  // 没命中任何结构关键词时不强行扣角色：一句无用的“请以流程图画”比不指导更坏
  return null;
}

/** 图片角色提示（接在策略约束之后） */
function buildImageRoleHint(promptText) {
  const r = inferImageRole(promptText);
  if (!r) return '';
  return `\n\n【画面角色：${r.label}】${r.hint}。职责是降低阅读成本，不追求艺术效果；文字标签要清楚可读。`;
}

/**
 * 策略→配图提示词（情绪定画面气质，目标定图的作用）。
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
  normalizeEvidence, normalizeNarrative, evidenceCoverage, strategyGate,
  DIFF_TYPES, DIFF_LABEL, DIFFICULTIES, FACT_RISKS,
  loadAnalysisSkill, loadAngleSkill, loadTopicSkill,
  buildAnalysisPrompt, buildAnalysisContextBlock, buildStrategyBlock, buildImageStrategyHint,
  buildImageRoleHint, inferImageRole, saveAnalysis,
};