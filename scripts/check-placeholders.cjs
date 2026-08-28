const fs = require('fs');
const src = fs.readFileSync('electron/ipc.cjs', 'utf8');

for (const name of ['outline', 'article', 'polish']) {
  const path = 'src/prompts/' + name + '.md';
  if (!fs.existsSync(path)) { console.log(name + ': (无模板)'); continue; }
  const tpl = fs.readFileSync(path, 'utf8');
  const need = [...new Set([...tpl.matchAll(/\{\{([a-zA-Z_]+)\}\}/g)].map(m => m[1]))];

  const marker = "renderPrompt('" + name + "',";
  const start = src.indexOf(marker);
  if (start < 0) { console.log(name + ': ❌ 找不到 renderPrompt 调用'); continue; }
  const block = src.slice(start, start + 2000);
  // 既识别 `key:` 也识别 ES6 简写 `key,`
  const keys = [...new Set([
    ...[...block.matchAll(/^ {6}([a-zA-Z_]+):/gm)].map(m => m[1]),
    ...[...block.matchAll(/^ {6}([a-zA-Z_]+),$/gm)].map(m => m[1]),
  ])];
  const missing = need.filter(k => !keys.includes(k));
  console.log(
    name + ': 模板需要 ' + need.length + ' 个占位符, handler 传 ' + keys.length + ' 个 key → ' +
    (missing.length ? '❌ 未替换会漏字面量: ' + missing.join(', ') : '✅ 全覆盖')
  );
}
