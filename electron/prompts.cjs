// Prompt 加载器 — 从 src/prompts/*.md 读模板，支持 {{变量}} 替换
// 改 .md 文件即生效（每次调用重新读，天然热加载），不用改代码、不用重启生产构建
//（开发 Electron 主进程改动需重启，但改 prompt 文件不用）

const fs = require('node:fs');
const path = require('node:path');

const PROMPTS_DIR = path.resolve(__dirname, '..', 'src', 'prompts');

/**
 * 渲染一个 prompt 模板
 * @param {string} name - 模板文件名（不带 .md，如 'outline'）
 * @param {Record<string, string>} vars - 要替换的变量 {key: value}
 * @returns {string}
 */
function renderPrompt(name, vars) {
  const filePath = path.join(PROMPTS_DIR, name + '.md');
  let tpl;
  try {
    tpl = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Prompt 模板不存在: ${name}.md (${filePath})`);
  }
  for (const [k, v] of Object.entries(vars || {})) {
    tpl = tpl.split('{{' + k + '}}').join(String(v ?? ''));
  }
  return tpl.trim();
}

module.exports = { renderPrompt, PROMPTS_DIR };