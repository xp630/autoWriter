// Content Observer 纯函数契约单测（2026-09-09）
// 关注两件事：① 解析够宽容但边界够严 ② 伪精确/代定观点必须在程序层被拒，不能只靠 prompt 求模型自觉
import { describe, it, expect } from 'vitest';
import { parseObserverOutput, validateOpportunity } from '../../electron/analysis.cjs';

const GOOD = {
  verdict: 'opportunity',
  title: 'AI 编码工具在收敛成一种接口',
  summary: '某公司把补全改成了后台任务式代理，宣称减少人工 review。',
  whyWorthAttention: '和你正在做的 AutoWriter 队列化方向是同一件事的两端，你有一手的取舍经验。',
  relevance: '高——你正在把生成任务排队化',
  timeliness: '正好——发布三天',
  differentiation: '你有自己踩过的取舍，别人只有观点',
  audienceValue: '需要验证',
  missingContext: ['他们说的"减少 review"有没有可核对的数据口径'],
  risks: ['可能只是产品话术'],
  confidenceNote: '目前没有读者侧反馈，只能判断到"值得再看一眼"。',
};
const jsonOf = (o: unknown) => JSON.stringify(o);

describe('parseObserverOutput', () => {
  it('直接合法 JSON 可解析', () => {
    const r = parseObserverOutput(jsonOf(GOOD));
    expect(r.ok).toBe(true);
    expect(r.data.verdict).toBe('opportunity');
    expect(r.data.missingContext).toHaveLength(1);
  });

  it('容忍 ```json 围栏与前后废话', () => {
    const fenced = '```json\n' + jsonOf(GOOD) + '\n```';
    expect(parseObserverOutput(fenced).ok).toBe(true);
    const chatty = '好的，这是我对你这条信号的分析：\n' + jsonOf(GOOD) + '\n希望有帮助。';
    const r = parseObserverOutput(chatty);
    expect(r.ok).toBe(true);
    expect(r.data.title).toBe(GOOD.title);
  });

  it('字符串值里带花括号不会截断 JSON', () => {
    const tricky = jsonOf({ ...GOOD, summary: '他说"把 {人工 review} 降下来"（原话带花括号）' });
    const r = parseObserverOutput(tricky);
    expect(r.ok).toBe(true);
    expect(r.data.summary).toContain('{人工 review}');
  });

  it('verdict 缺失或非法 → 明确报错（不静默兜一个假对象）', () => {
    expect(parseObserverOutput('{"title":"x"}').ok).toBe(false);
    const r = parseObserverOutput(jsonOf({ ...GOOD, verdict: 'maybe' }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('verdict');
  });

  it('完全不是 JSON → ok:false', () => {
    const r = parseObserverOutput('这条信号看起来挺有意思的，我觉得值得写。');
    expect(r.ok).toBe(false);
  });

  it('数组字段给成换行字符串时降级为数组，并剥掉列表前缀', () => {
    const r = parseObserverOutput(jsonOf({ ...GOOD, missingContext: '- 缺口径\n1. 缺反例\n、还缺读者画像' }));
    expect(r.ok).toBe(true);
    expect(r.data.missingContext).toEqual(['缺口径', '缺反例', '还缺读者画像']);
  });

  it('title 超长截断，多空格压平', () => {
    const r = parseObserverOutput(jsonOf({ ...GOOD, title: '很'.repeat(80), summary: 'a   b\n  c' }));
    expect(r.data.title.length).toBeLessThanOrEqual(40);
    expect(r.data.summary).toBe('a b c');
  });
});

describe('validateOpportunity（边界执法）', () => {
  it('正常输出通过', () => {
    const p = validateOpportunity(parseObserverOutput(jsonOf(GOOD)).data);
    expect(p).toEqual([]);
  });

  it('判成机会却不给"是什么/为什么值得看" → 拒', () => {
    const p = validateOpportunity(parseObserverOutput(jsonOf({ ...GOOD, title: '', whyWorthAttention: '' })).data);
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(p.join('')).toContain('whyWorthAttention');
  });

  it('not_opportunity 允许字段不全（说不值得也是合法结论）', () => {
    const p = validateOpportunity(parseObserverOutput(jsonOf({ verdict: 'not_opportunity', title: '别人的一亩三分地' })).data);
    expect(p).toEqual([]);
  });

  it('百分比伪精确 → 拒', () => {
    const p = validateOpportunity(parseObserverOutput(jsonOf({ ...GOOD, relevance: '高，阅读潜力 82%' })).data);
    expect(p.join('')).toContain('概率/评分');
  });

  it('"涨粉概率：74" 这类中文数字包装 → 拒', () => {
    const p = validateOpportunity(parseObserverOutput(jsonOf({ ...GOOD, confidenceNote: '涨粉概率：74 上下' })).data);
    expect(p.join('')).toContain('概率/评分');
  });

  it('替作者把观点定下来 → 拒', () => {
    const p = validateOpportunity(parseObserverOutput(jsonOf({ ...GOOD, whyWorthAttention: '你的观点是 AI 应该被限制使用，你应该写这篇。' })).data);
    expect(p.join('')).toContain('观点');
  });

  it('不误伤含普通数字的正常表述', () => {
    const p = validateOpportunity(parseObserverOutput(jsonOf({
      ...GOOD,
      summary: '他最近 12 篇里有 3 篇带来了分享，但样本太小。',
      differentiation: '你自己有一手数据，别人只有观点',
    })).data);
    expect(p).toEqual([]);
  });
});

// 评审补口（2026-09-09 sdd-task-reviewer）：漏抓的写法要能抓，引用的真实数字不能误伤
describe('validateOpportunity 数字执法的两侧（评审补口）', () => {
  const hit = (note: string) => validateOpportunity(parseObserverOutput(jsonOf({ ...GOOD, confidenceNote: note })).data).join('');
  const pass = (note: string) => expect(hit(note)).toBe('');

  it.each([
    '把握 90%',
    '涨粉概率 74',
    '我给 8.5/10',
    'Opportunity Score = 87.4',
    '评分 87 分',
    '九成把握',
    '百分之八十的可能性',
    '可能性最高不超过 80 个百分点',
  ])('该拦：%s', (note) => {
    expect(hit(note)).toContain('概率/评分');
  });

  it.each([
    '该帖完播率 12%，是同类账号的两倍（引用外部数据，不是我们的预测）',
    '一款 App Store 评分 4.8 的工具正在改动定价页',
    '他最近 12 篇里有 3 篇带来了分享，样本太小',
  ])('不该误伤：%s', (note) => {
    pass(note);
  });
});
