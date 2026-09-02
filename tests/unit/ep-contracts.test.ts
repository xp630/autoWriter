import { describe, it, expect } from 'vitest';

const { parseEvidenceOutput, parseExtractOutput, validatePatch, validateAngles } = require('../../electron/analysis.cjs');

describe('EP→Article 纯函数契约（Task 2）', () => {
  it('parseExtractOutput 剥围栏并归类 kind', () => {
    const r = parseExtractOutput('```json\n{"evidence":[{"content":"10阅读5粉丝>1000阅读0粉丝","kind":"fact"},{"content":"也许他觉得有价值","kind":"bogus"}],"slots":{"Event":{"text":"陌生人点赞并分享了文章","src":[7]}}}\n```');
    expect(r.evidence[0].kind).toBe('fact');
    expect(r.evidence[1].kind).toBe('fact');           // 非法 kind 兜底归 fact
    expect(r.slots.Event.src).toEqual([7]);
  });

  it('validatePatch 无出处即拒', () => {
    const msgs = [{ id: 7, role: 'user', content: '一个陌生人给我的文章点了赞，还分享了' }];
    const p = validatePatch({ slots: { Event: { text: '陌生人点赞并分享了文章', src: [7] }, Shift: { text: '我太早下结论了', src: [99] } } }, msgs);
    expect(p.accepted.map(a => a.slot)).toEqual(['Event']);
    expect(p.rejected.map(a => a.slot)).toEqual(['Shift']);
  });

  it('validatePatch 与原话零重叠 → pending', () => {
    const msgs = [{ id: 1, role: 'user', content: '电梯里听到两人讨论AI编剧' }];
    const p = validatePatch({ slots: { Event: { text: '季度营收翻倍增长', src: [1] } } }, msgs);
    expect(p.pending.length).toBe(1);
    expect(p.accepted.length).toBe(0);
    expect(p.rejected.length).toBe(0);
  });

  it('validateAngles 拔高句拒收', () => {
    const r = validateAngles(['一个赞到底能证明什么？', '为什么我们总想从一个样本找答案？']);
    expect(r.ok.length).toBe(1); expect(r.rejectedHigh.length).toBe(1);
  });

  it('validateAngles 正则收紧（owner 裁定）：误伤句放行，规范信号与测试句仍拔高', () => {
    // 误伤句（义务/祈愿语气，非无据普适断言）→ ok
    const ok = validateAngles(['我们总得想办法解决', '我们总算赶上了', '我们总能找到办法']);
    expect(ok.ok).toEqual(['我们总得想办法解决', '我们总算赶上了', '我们总能找到办法']);
    expect(ok.rejectedHigh).toEqual([]);
    // 规范拔高信号 → 逐句 rejectedHigh
    for (const s of ['我们总是', '每个人都', '每个人都会', '所有人都', '人人都', '皆如']) {
      expect(validateAngles([s]).rejectedHigh).toEqual([s]);
      expect(validateAngles([s]).ok).toEqual([]);
    }
    // 裁决收紧闭包 `(是|想|觉得|以为)` 的其余分支仍算拔高
    expect(validateAngles(['我们总觉得有问题是运气不好']).rejectedHigh).toHaveLength(1);
    expect(validateAngles(['我们总以为努力就有回报']).rejectedHigh).toHaveLength(1);
    // brief 测试句仍命中 rejectedHigh
    expect(validateAngles(['为什么我们总想从一个样本找答案？']).rejectedHigh)
      .toEqual(['为什么我们总想从一个样本找答案？']);
  });

  // ==== 补充用例（Interfaces 列出的第 4 个函数，Task 3 依赖；brief 测试片段未覆盖）====
  it('parseEvidenceOutput：JSON 数组与逐行文本都出 string[]', () => {
    expect(parseEvidenceOutput('["10阅读5粉丝","也许他觉得有价值"]')).toEqual(['10阅读5粉丝', '也许他觉得有价值']);
    expect(parseEvidenceOutput('第一行\n第二行')).toEqual(['第一行', '第二行']);
    expect(parseEvidenceOutput('')).toEqual([]);
  });

  it('parseExtractOutput：解析失败时兜底逐行 内容|kind 文本', () => {
    const r = parseExtractOutput('10阅读5粉丝|fact\n也许他觉得有价值|bogus');
    expect(r.evidence.length).toBe(2);
    expect(r.evidence[0]).toEqual({ content: '10阅读5粉丝', kind: 'fact' });
    expect(r.evidence[1]).toEqual({ content: '也许他觉得有价值', kind: 'fact' }); // 非法 kind 兜底归 fact
    expect(r.slots).toEqual({});
  });
});