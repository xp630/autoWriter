import { describe, it, expect } from 'vitest';
import path from 'node:path';

const { parseInterviewOutput } = require(path.resolve(__dirname, '../../electron/analysis.cjs'));

describe('parseInterviewOutput 3 行契约', () => {
  it('新格式：FOLLOWUP + 推力 + 问', () => {
    const r = parseInterviewOutput(
`FOLLOWUP
[我在逼你站边——你那"没看过"是不屑还是怕？]
你说"没看过"——是不屑，还是怕看了失望？`);
    expect(r.type).toBe('question');
    expect(r.reasoning).toContain('逼你站边');
    expect(r.text).toContain('失望');
  });

  it('新格式：INSIGHT + 推力 + 观点', () => {
    const r = parseInterviewOutput(
`INSIGHT
[作者两次都在躲"立场"——他其实没看过成片]
看不到成片不是懒，是怕失望`);
    expect(r.type).toBe('insight');
    expect(r.reasoning).toContain('躲');
    expect(r.text).toContain('失望');
  });

  it('向后兼容：旧 2 行格式（无推力）', () => {
    const r = parseInterviewOutput(
`FOLLOWUP
你说"没看过"——是不屑，还是怕看了失望？`);
    expect(r.type).toBe('question');
    expect(r.reasoning).toBe('');
    expect(r.text).toContain('失望');
  });

  it('向后兼容：旧 1 行格式', () => {
    const r = parseInterviewOutput('你说"没看过"——是不屑，还是怕看了失望？');
    expect(r.type).toBe('question');
    expect(r.reasoning).toBe('');
    expect(r.text).toContain('失望');
  });

  it('坏格式兜底', () => {
    const r = parseInterviewOutput('');
    expect(r.type).toBe('question');
    expect(r.text).toBeTruthy();
  });
});
