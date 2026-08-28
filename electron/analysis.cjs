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
function buildAnalysisPrompt({ title, content, platform, author, source }) {
  return `请分析以下内容，按你定义的 JSON Schema 输出。

## 平台
${platform || '未指定'}

## 作者
${author || '未指定'}

## 来源
${source || 'user input'}

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
  saveAnalysis,
};