import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const IPC = fs.readFileSync(path.resolve(__dirname, '../../electron/ipc.cjs'), 'utf-8');

// 静态守卫：episode:save 的 clearSlots（D-1，owner 拍板）
// 语义：渲染层显式请求清空的列 → 只对该列绕 COALESCE 直接写 ''；
// 其余槽位列 + observation/question/insight 维持 T5 的 COALESCE 保护。
// episode:save 的 SQL 埋在 ipc.cjs（依赖 electron，无法在 vitest require），
// 所以用与 ipc-imports.test.ts 同族的静态扫描兜底，功能行为由 e2e 断言。
describe('episode:save clearSlots 契约（静态）', () => {
  it('解析 params.clearSlots 并按六槽位白名单过滤（observation/question/insight 不在白名单）', () => {
    expect(IPC).toContain('params.clearSlots');
    // 白名单过滤表达式：map 后 lower-case 再 filter EP_SLOT_COLUMNS 命中项
    expect(IPC).toMatch(/clearSlots\s*\.map\(\(s\)\s*=>\s*String\(s\)\.toLowerCase\(\)\)\.filter\(\(s\)\s*=>\s*EP_SLOT_COLUMNS\.includes\(s\)\)/);
  });

  it('被请求清空的列写字面空串（绕过 COALESCE），未请求的列维持 COALESCE 保护', () => {
    // 清空分支：`col=''` 字面量
    expect(IPC).toMatch(/\$\{col\}=\'\'/);
    // 保护分支：`col=COALESCE(NULLIF(?, ''), col)`
    expect(IPC).toMatch(/\$\{col\}=COALESCE\(NULLIF\(\?, \'\'\), \$\{col\}\)/);
  });

  it('observation/question/insight 仍是卡的原始物料：SET 里始终 COALESCE，绝无字面空串直写', () => {
    for (const col of ['observation', 'question', 'insight']) {
      expect(IPC).toMatch(new RegExp(`${col}=COALESCE\\(NULLIF\\(\\?, ''\\), ${col}\\)`));
      // 不允许出现 `observation=''` 这类绕过（白名单外列不可显式清空）
      expect(IPC.includes(`${col}=''`)).toBe(false);
    }
  });

  it('白名单恰好是六槽位列（与 EP_SLOT_COLUMNS 一致）', () => {
    const six = ['event', 'reaction', 'development', 'shift', 'unknown', 'next'];
    for (const col of six) expect(IPC).toMatch(new RegExp(`EP_SLOT_COLUMNS\\s*=\\s*\\[.*${col}`));
  });
});