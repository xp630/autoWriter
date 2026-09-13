import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('idea-interview skill', () => {
  it('SKILL.md 存在且带 frontmatter', () => {
    const p = path.resolve(__dirname, '../../src/skills/interview/idea-interview/SKILL.md');
    expect(fs.existsSync(p)).toBe(true);
    const body = fs.readFileSync(p, 'utf-8');
    expect(body).toMatch(/^---\n[\s\S]*?\n---\n/);
  });

  it('导出 loadInterviewSkill 函数并能读 body', async () => {
    const mod = require(path.resolve(__dirname, '../../electron/analysis.cjs'));
    expect(typeof mod.loadInterviewSkill).toBe('function');
    const body = mod.loadInterviewSkill();
    expect(body.length).toBeGreaterThan(50);
    // 不能含 frontmatter 原始标记
    expect(body.startsWith('---')).toBe(false);
    // 必须含访谈核心规则
    expect(body).toContain('观点');
    expect(body).toContain('FOLLOWUP');
    expect(body).toContain('INSIGHT');
  });
});
