// Analysis 解析器单元测试
import { describe, it, expect } from 'vitest';
import { parseAnalysisJson, buildAnalysisPrompt, buildAnalysisContextBlock } from '../../electron/analysis.cjs';

describe('parseAnalysisJson', () => {
  it('解析直接合法 JSON', () => {
    const r = parseAnalysisJson('{"topic":{"main_topic":"x"}}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.topic.main_topic).toBe('x');
  });

  it('解析 markdown ```json 代码块', () => {
    const text = '这是我的分析：\n\n```json\n{"a":1,"b":[1,2,3]}\n```\n\n以上。';
    const r = parseAnalysisJson(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.a).toBe(1);
      expect(r.data.b).toEqual([1, 2, 3]);
    }
  });

  it('解析 markdown ``` 无 json 标记', () => {
    const text = '```\n{"foo":"bar"}\n```';
    const r = parseAnalysisJson(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.foo).toBe('bar');
  });

  it('截取首尾花括号包围的 JSON（带前缀废话）', () => {
    const text = '思考了一下，我的分析是：{"result":"ok","score":0.9}，希望对你有帮助';
    const r = parseAnalysisJson(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.result).toBe('ok');
  });

  it('空字符串返回错误', () => {
    const r = parseAnalysisJson('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('empty response');
  });

  it('纯废话返回错误', () => {
    const r = parseAnalysisJson('思考中...');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no valid JSON found');
  });

  it('嵌套 JSON 能解析', () => {
    const text = JSON.stringify({
      topic: { main_topic: '婚姻', summary: '年轻人婚恋观转变' },
      core_points: ['p1', 'p2'],
      audience: { pain_points: ['经济压力', '婆媳'] },
    });
    const r = parseAnalysisJson(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.core_points.length).toBe(2);
      expect(r.data.audience.pain_points).toContain('经济压力');
    }
  });

  it('错误 JSON 返回 raw 截断', () => {
    const r = parseAnalysisJson('{ invalid json ...');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('no valid JSON found');
      expect(r.raw).toBeDefined();
    }
  });

  it('前后有 markdown 但内容含换行也能解析', () => {
    const text = `# 分析报告

下面是 JSON：

\`\`\`json
{
  "topic": {
    "main_topic": "婚恋"
  },
  "core_points": [
    "不是不想结婚",
    "是结不起"
  ]
}
\`\`\`

报告完毕。`;
    const r = parseAnalysisJson(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.topic.main_topic).toBe('婚恋');
      expect(r.data.core_points.length).toBe(2);
    }
  });
});

describe('buildAnalysisPrompt', () => {
  it('包含全部字段', () => {
    const p = buildAnalysisPrompt({
      title: '为什么年轻人不结婚',
      content: '正文内容...',
      platform: '小红书',
      author: '张三',
      source: 'https://example.com/post/123',
    });
    expect(p).toContain('为什么年轻人不结婚');
    expect(p).toContain('小红书');
    expect(p).toContain('张三');
    expect(p).toContain('https://example.com/post/123');
    expect(p).toContain('正文内容...');
  });

  it('缺字段用占位', () => {
    const p = buildAnalysisPrompt({ title: 't', content: 'c' });
    expect(p).toContain('未指定');  // platform / author / source 都用 未指定
    expect(p).toContain('t');
    expect(p).toContain('c');
  });
});

describe('buildAnalysisContextBlock', () => {
  it('空对象返回空字符串', () => {
    expect(buildAnalysisContextBlock(undefined)).toBe('');
    expect(buildAnalysisContextBlock({})).toBe('');
    expect(buildAnalysisContextBlock(null as any)).toBe('');
  });

  it('完整分析渲染包含 主题/观点/爆点/用户/结构', () => {
    const block = buildAnalysisContextBlock({
      topic: { main_topic: '婚姻', category: '情感', summary: '年轻人重新审视婚姻' },
      core_points: ['不是不想结婚', '是结不起'],
      viral: { emotion: '焦虑', conflict: '理想 vs 现实', reason: ['命中焦虑', '强共鸣'] },
      audience: { target_user: '25-35 岁女性', pain_points: ['经济压力'] },
      structures: ['开头钩子', '案例', '观点', '升华'],
    });
    expect(block).toContain('婚姻');
    expect(block).toContain('情感');
    expect(block).toContain('年轻人重新审视婚姻');
    expect(block).toContain('不是不想结婚');
    expect(block).toContain('是结不起');
    expect(block).toContain('焦虑');
    expect(block).toContain('理想 vs 现实');
    expect(block).toContain('命中焦虑');
    expect(block).toContain('25-35 岁女性');
    expect(block).toContain('经济压力');
    expect(block).toContain('开头钩子');
  });

  it('只有 topic 也工作', () => {
    const block = buildAnalysisContextBlock({ topic: { main_topic: 'X' } });
    expect(block).toContain('主题');
    expect(block).toContain('X');
  });

  it('core_points 空数组不渲染', () => {
    const block = buildAnalysisContextBlock({ core_points: [] });
    expect(block).not.toContain('核心观点');
  });

  it('structures 用 structures 字段名（对齐 PRD §7.5）', () => {
    const block = buildAnalysisContextBlock({ structures: ['step1'] });
    expect(block).toContain('结构参考');
    expect(block).toContain('step1');
  });

  it('reason 字段名（对齐 PRD §7.4，复数 reason）', () => {
    const block = buildAnalysisContextBlock({ viral: { reason: ['a', 'b'] } });
    expect(block).toContain('传播原因');
    expect(block).toContain('a');
    expect(block).toContain('b');
  });
});
describe('parseInterviewOutput（访谈两行契约）', () => {
  const fn = require('../../electron/analysis.cjs').parseInterviewOutput;
  it('FOLLOWUP 前缀 → question', () => {
    const r = fn('FOLLOWUP\n为什么你觉得他们没看成片？');
    expect(r.type).toBe('question');
    expect(r.text).toContain('成片');
  });
  it('INSIGHT 前缀 → insight，去掉尾问号', () => {
    const r = fn('INSIGHT\n兴奋的人不看成片。\n');
    expect(r.type).toBe('insight');
    expect(r.text).toBe('兴奋的人不看成片。');
  });
  it('无契约格式：含问号按追问，不含按观点', () => {
    expect(fn('你到底想说什么？').type).toBe('question');
    expect(fn('工具不背这个锅').type).toBe('insight');
  });
  it('空输入 → 安全兜底为固定第二问', () => {
    const r = fn('');
    expect(r.type).toBe('question');
    expect(r.text).toContain('最想说的');
  });
});
