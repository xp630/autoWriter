import { describe, it, expect } from 'vitest';
import path from 'node:path';

describe('resolveCli', () => {
  it('能找到系统 PATH 里的 claude', () => {
    const { resolveCli } = require(path.resolve(__dirname, '../../electron/agent.cjs'));
    const p = resolveCli('claude');
    expect(p).toBeTruthy();
    expect(p).toMatch(/claude$/);
  });

  it('找不到不存在的 CLI 返回 null', () => {
    const { resolveCli } = require(path.resolve(__dirname, '../../electron/agent.cjs'));
    const p = resolveCli('__totally_nonexistent_cli__');
    expect(p).toBeNull();
  });
});
