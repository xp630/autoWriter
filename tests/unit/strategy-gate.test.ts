// V4 生成守卫：strategyGate 纯函数单测
import { describe, it, expect } from 'vitest';
import { strategyGate } from '../../electron/analysis.cjs';

const ready = (n: number) => Array.from({ length: n }, (_, i) => ({ item: `证据${i}`, status: 'ready' }));
const todo = (n: number) => Array.from({ length: n }, (_, i) => ({ item: `证据${i}`, status: 'todo' }));

describe('strategyGate · 三问缺一即拦', () => {
  it('全空 → 三项都缺', () => {
    const g = strategyGate({});
    expect(g.pass).toBe(false);
    expect(g.missing).toEqual([
      '读者原本怎么想', '你希望读者改怎么想', '至少一条已备好的证据（证据账里勾上 ready）',
    ]);
  });

  it('三问齐 + 一条已备证据 → 通过', () => {
    const g = strategyGate({
      belief_before: 'AI 创业靠模型能力',
      belief_after: 'AI 创业靠渠道能力',
      evidence_needed: ready(1),
    });
    expect(g.pass).toBe(true);
    expect(g.missing).toEqual([]);
    expect(g.ready_evidence).toBe(1);
  });

  it('只答belief不勾证据 → 仍拦（列了 5 条全没备 = 没证据）', () => {
    const g = strategyGate({
      belief_before: 'A', belief_after: 'B', evidence_needed: todo(5),
    });
    expect(g.pass).toBe(false);
    expect(g.missing).toContain('至少一条已备好的证据（证据账里勾上 ready）');
  });

  it('只有 belief_after 也拦，并只报缺的那项', () => {
    const g = strategyGate({ belief_after: 'B', evidence_needed: ready(2) });
    expect(g.pass).toBe(false);
    expect(g.missing).toEqual(['读者原本怎么想']);
    expect(g.ready_evidence).toBe(2);
  });

  it('纯空白字符不算已回答（否则输入框空格就能绕过）', () => {
    const g = strategyGate({
      belief_before: '   ', belief_after: '\n\t ', evidence_needed: ready(1),
    });
    expect(g.pass).toBe(false);
    expect(g.missing.length).toBe(2);
  });

  it('旧数据（证据是字符串数组）不会被误判为已备', () => {
    const g = strategyGate({ belief_before: 'A', belief_after: 'B', evidence_needed: ['一个文号', '一组案例'] });
    expect(g.pass).toBe(false);
    expect(g.ready_evidence).toBe(0);
  });

  it('null / undefined 入参不抛错，按全缺处理', () => {
    expect(strategyGate(null).pass).toBe(false);
    expect(strategyGate(undefined).pass).toBe(false);
    expect(strategyGate('x' as any).pass).toBe(false);
  });
});
