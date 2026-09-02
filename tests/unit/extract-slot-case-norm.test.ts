import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const IPC = fs.readFileSync(path.resolve(__dirname, '../../electron/ipc.cjs'), 'utf-8');

// 终审修复：extractRound 槽位键大小写归一。
// 契约层（parseExtractOutput / validatePatch）保留原键大小写——ep-contracts.test.ts 的
// Event/Reaction/Shift 全是故意大写；而落库列白名单 EP_SLOT_COLUMNS 是小写六列。
// 不归一时 `assigns['Event']` 匹配不到 `assigns['event']`，EP_SLOT_COLUMNS.filter 一条都
// 命中不了 → 大写键槽位静默丢。本文件与 clear-slots-episode-save.test.ts 同族：
// ipc.cjs 依赖 electron 无法在 vitest require，用静态扫描兜底；真路径行为由
// e2e（ep-article-flow.spec.ts「终审修复」用例）断言。
describe('extractRound 槽位键大小写归一（静态）', () => {
  it('accepted/pending 落库前统一 toLowerCase（大写契约键不再静默丢）', () => {
    expect(IPC).toMatch(/assigns\[String\(a\.slot\)\.toLowerCase\(\)\]\s*=/);
    expect(IPC).toMatch(/assigns\[String\(pd\.slot\)\.toLowerCase\(\)\]\s*=/);
  });

  it('EP_SLOT_COLUMNS 过滤仍基于归一后的小写键（assigns 键与六列同一大小写）', () => {
    expect(IPC).toContain('EP_SLOT_COLUMNS.filter((c) => assigns[c])');
  });

  it('白名单外槽位（observation/question/judgment 不在六列）落库前显式 warn，不静默丢', () => {
    // 契约 SLOT_WHITELIST 有 9 槽，DB 只有 six columns；即便小写这三槽 accepted 也会被
    // EP_SLOT_COLUMNS.filter 丢掉 → 落库前显式过滤 + warn（本轮不落库但可观测，绝不无声）
    expect(IPC).toContain('不在 EP_SLOT_COLUMNS');
  });
});