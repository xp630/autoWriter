// 静态守卫：ipc.cjs 里调用了某 helper 模块的导出符号，就必须从该模块 require 进来。
// 防止 "buildAnalysisContextBlock is not defined" 这类「用了没 import」的运行时炸。
// 这类 bug 只有在真正 invoke 到对应 handler 时才暴露，E2E 跳过了流式生成，所以用静态扫描兜底。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const IPC = fs.readFileSync(path.resolve(__dirname, '../../electron/ipc.cjs'), 'utf-8');

// 各 helper 模块（都是纯 Node，可安全 require 拿导出名）
const HELPER_MODULES: Array<{ file: string; req: string }> = [
  { file: 'analysis.cjs', req: './analysis.cjs' },
  { file: 'queue.cjs', req: './queue.cjs' },
  { file: 'scheduler.cjs', req: './scheduler.cjs' },
  { file: 'agent.cjs', req: './agent.cjs' },
  { file: 'skills.cjs', req: './skills.cjs' },
  { file: 'prompts.cjs', req: './prompts.cjs' },
];

function exportsOf(modPath: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(path.resolve(__dirname, '../../electron', modPath));
  return Object.keys(mod);
}

describe('ipc.cjs import 完整性（静态）', () => {
  for (const { file, req } of HELPER_MODULES) {
    const exps = exportsOf(file);
    for (const name of exps) {
      // 该导出是否在 ipc.cjs 里被「当作函数/标识符调用」
      const usedRe = new RegExp(`(?<![A-Za-z0-9_$.])${name}\\s*\\(`);
      if (!usedRe.test(IPC)) continue; // 没用到就跳过

      // 若用到：必须出现在某个 require('<req>') 的解构里，或 const { name } = require
      // 找 require(req) 语句块（含多行解构）
      const reqBlockRe = new RegExp(`require\\('${req.replace('.', '\\.')}'\\)`, 'g');
      const mIdx = IPC.indexOf(`require('${req}')`);
      let imported = false;
      if (mIdx !== -1) {
        // 往前回溯最多 200 字符找解构 { ... }
        const before = IPC.slice(Math.max(0, mIdx - 240), mIdx + req.length + 30);
        imported = new RegExp(`[\\s,{]${name}[\\s,}]`).test(before);
      }

      it(`${name}：在 ipc.cjs 中被调用则必须 import（${req}）`, () => {
        if (reqBlockRe.test('') /* noop */) return;
        if (usedRe.test(IPC)) {
          expect(imported, `${name} 在 ipc.cjs 被调用但未从 ${req} require`).toBe(true);
        }
      });
    }
  }
});
