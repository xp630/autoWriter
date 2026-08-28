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

/** 读取 content-analysis skill（不依赖 skills.cjs 的 channels/personas 体系） */
function loadAnalysisSkill() {
  const skillPath = path.resolve(__dirname, '..', 'src', 'skills', 'analysis', 'content-analysis', 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Analysis skill not found: ${skillPath}`);
  }
  return fs.readFileSync(skillPath, 'utf-8');
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
  parseAnalysisJson,
  loadAnalysisSkill,
  buildAnalysisPrompt,
  buildAnalysisContextBlock,
  saveAnalysis,
};