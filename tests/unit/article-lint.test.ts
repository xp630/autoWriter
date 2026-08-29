// articleLint 纯函数单测
import { describe, it, expect } from 'vitest';
import {
  lintArticle, plainText, charCount, paragraphs, scoreOf, scoreBand, sortIssues,
  type LintIssue,
} from '../../src/utils/articleLint';

const ids = (r: { issues: LintIssue[] }) => r.issues.map((i) => i.id);

/** 一篇"该过"的短稿：有标题、有小节、有金句短句、有配图、结尾有问句、字数在 short 档 */
const GOOD = [
  '# 够用AI正在变便宜，你为什么还在追旗舰',
  '',
  '上个月我算了一笔账：同样的活，换个便宜模型，成本差了十倍。',
  '',
  '[[配图:两台笔记本屏幕成本对比@pic1]]',
  '',
  '## 一、价格确实在塌',
  '',
  '多数人把这当作“囊杆”问题：模型越强越好。',
  '',
  '这不是感觉，是账。',
  '',
  '我把三个常用任务分别跑在贵价和便宜两档上，按官方标价折算，一整天用量下来不到一杯豆浆钱。',
  '省下来的数字不大，但它让我意识到一件事：我付的贵价，很大一部分其实是保险费。',
  '',
  '## 二、追旗舰的真实代价',
  '',
  '真正贵的不是调用费，而是你的判断成本。',
  '',
  '是排查时间。我见过一个团队为了一个措辞问题反复重跑，一天过去了，钱没花多少，人先耗光了。',
  '更常见的情况是：你并不知道便宜档能不能过，于是默认全用贵的，这个默认值本身就值钱。',
  '',
  '[[配图:一个人盯着一列结果的表格@pic2]]',
  '',
  '## 三、四问选路法',
  '',
  '问自己四个问题就够了。',
  '',
  '第一，这个任务的输出能不能机器校验？能校验的，便宜档风险很低。',
  '第二，错一次的代价多大？内部草稿和对外公告不是一个量级。',
  '第三，有没有更便宜的能过？没测过就没有发言权。',
  '第四，谁来兜底？没人复核的环节，才值得留贵价。',
  '',
  '这四问里最关键的是第三个。没测过就没有发言权——包括我说的“差了十倍”，也是我自己测的，不是行业结论。',
  '',
  '## 四、哪些场景别省',
  '',
  '三类活我建议继续用贵的：对外发布的第一稿、涉及数字与引用的核验、以及你自己也不确定的判断题。',
  '它们的共同点是错了很难发现，而不是错了很贵。',
  '',
  '尤其第三类。当你自己拿不准的时候，便宜模型会把你的不确定放大成错误的确定，因为它比你更不怕输。',
  '这种时候贵档的价值不是写得更好，是错得更少。',
  '',
  '还有一个容易被忽略的点：贵档适合做“第一次”，便宜档适合做“重复次”。',
  '把同一套流程跑第 20 次时，你已经知道错在哪里，这时候便宜就是优势。',
  '',
  '## 五、下一步',
  '',
  '把你最常用的三个任务列出来，逐个跑一遍便宜档，记下你返工了几次。',
  '',
  '记的时候只记两件事：输出可用还是不可用，以及为了判断可不可用你花了多少时间。',
  '后一项才是你的真实成本，它从来不出现在发票上。',
  '',
  '一次都不返工，说明你一直在为不存在的风险付钱。',
  '',
  '你现在还在为哪个场景付贵价？',
].join('\n');

describe('文本工具', () => {
  it('plainText 去掉 markdown 语法与配图占位', () => {
    const t = plainText('# 标题\n\n**粗体**正文 `code`\n\n[[配图:一张图@pic1]]\n- 列表项');
    expect(t).not.toContain('配图');
    expect(t).not.toContain('#');
    expect(t).not.toContain('**');
    expect(t).toContain('粗体正文');
    expect(t).toContain('列表项');
  });

  it('charCount 不计空白', () => {
    expect(charCount('中 文\nabc')).toBe(5);
  });

  it('paragraphs 不把标题行当正文段', () => {
    const ps = paragraphs('# T\n\n## S\n\n段落一\n段落一续\n\n段落二');
    expect(ps).toEqual(['段落一\n段落一续', '段落二']);
  });
});

describe('lintArticle · 不误伤合格稿', () => {
  const r = lintArticle(GOOD, { length: 'short' });

  it('字数达标不报篇幅问题', () => {
    expect(r.stats.chars).toBeGreaterThanOrEqual(800 * 0.6);
    expect(ids(r)).not.toContain('word-count-low');
    expect(ids(r)).not.toContain('word-count-high');
  });

  it('有金句短句 → 不报 no-punchline', () => expect(ids(r)).not.toContain('no-punchline'));
  it('有配图占位 → 不报 no-image', () => expect(ids(r)).not.toContain('no-image'));
  it('结尾有问句 → 不报 weak-ending', () => expect(ids(r)).not.toContain('weak-ending'));
  it('有小节 → 不报 no-sections', () => { expect(r.stats.sections).toBe(5); expect(ids(r)).not.toContain('no-sections'); });
  it('分数落在可用区间（四检全过）', () => {
    expect(ids(r)).not.toContain('quality-opinion');
    expect(ids(r)).not.toContain('quality-shift');
    expect(ids(r)).not.toContain('quality-evidence');
    expect(ids(r)).not.toContain('quality-savable');
    expect(r.score).toBeGreaterThanOrEqual(80);
  });
});

describe('lintArticle · 该抓的必须抓到', () => {
  it('字数严重不足报 error', () => {
    const r = lintArticle('# 短\n\n只有一句话。', { length: 'medium' });
    expect(ids(r)).toContain('word-count-critical');
    expect(r.issues.find((i) => i.id === 'word-count-critical')!.severity).toBe('error');
  });

  it('字数超上限报偏长', () => {
    const one = '这是一段用来凑字数的中文内容，它需要足够长以便稳定进入并超过短档上限区间。';
    const body = Array.from({ length: 45 }, (_, i) => `## 第${i}节\n\n${one}`).join('\n\n');
    const r = lintArticle(`# 一个够长够具体的标题用于本用例${body}`, { length: 'short' });
    expect(ids(r)).toContain('word-count-high');
  });

  it('残留「待补充」报 error，且不给一键润色（AI 补不了事实）', () => {
    const body = GOOD + '\n\n关于行业规模，待补充：一个可检索的公开数据源。';
    const r = lintArticle(body, { length: 'short', pendingEvidence: ['公开数据源'] });
    const hit = r.issues.find((i) => i.id === 'placeholder-left')!;
    expect(hit.severity).toBe('error');
    expect(hit.fix).toBeUndefined();
    expect(hit.detail).toContain('公开数据源');
  });

  it('识别多种占位写法（TODO / XXX / [占位]）', () => {
    const r = lintArticle(GOOD + '\n\nTODO 这里要补案例，XXX 数字，[占位]。', { length: 'short' });
    expect(ids(r)).toContain('placeholder-left');
  });

  it('AI 套话堆叠报警并给出改写指令', () => {
    const clichy = GOOD + '\n\n在当今时代，随着技术的发展，不难发现，赋能与闭环是底层逻辑，总而言之我们要抓住机会。';
    const r = lintArticle(clichy, { length: 'short' });
    const hit = r.issues.find((i) => i.id === 'ai-cliches')!;
    expect(hit).toBeTruthy();
    expect(hit.fix).toContain('套话');
  });

  it('超 200 字的段被判为段落墙', () => {
    const wall = '很'.repeat(230);
    const r = lintArticle(`# 一个足够长的标题用于测试\n\n${wall}`, { length: 'short' });
    expect(ids(r)).toContain('wall-paragraph');
  });

  it('整篇无小节标题报 no-sections', () => {
    const r = lintArticle('# 标题\n\n' + '正文没有分节。'.repeat(150), { length: 'short' });
    expect(ids(r)).toContain('no-sections');
  });

  it('小节下没有正文报 empty-section', () => {
    const r = lintArticle('# 标题\n\n## 有内容的节\n\n这段是正文内容。\n\n## 空节\n\n## 另一节\n\n这也有正文。', { length: 'short' });
    expect(ids(r)).toContain('empty-section');
  });

  it('缺主标题报 no-title', () => {
    const r = lintArticle('只有一段正文，没有一级标题。', { length: 'short' });
    expect(ids(r)).toContain('no-title');
  });

  it('标题过短报 title-length', () => {
    const r = lintArticle('# 短题\n\n' + '正文内容重复以避开字数问题。'.repeat(40), { length: 'short' });
    expect(ids(r)).toContain('title-length');
  });

  it('结尾既无问句也无行动 → 报 weak-ending，并按 goal 给定制指令', () => {
    const noEnd = GOOD.replace('你现在还在为哪个场景付贵价？', '以上就是全部内容。');
    const r = lintArticle(noEnd, { length: 'short', goal: '评论' });
    const hit = r.issues.find((i) => i.id === 'weak-ending')!;
    expect(hit).toBeTruthy();
    expect(hit.title).toContain('评论');
    expect(hit.fix).toContain('站队');
  });

  it('同一 goal 下结尾给了问句就不报', () => {
    const r = lintArticle(GOOD, { length: 'short', goal: '评论' });
    expect(ids(r)).not.toContain('weak-ending');
  });

  it('高度相似的两段被检出', () => {
    const a = '追旗舰的成本不在调用费，而在你为怕不够好所花的排查时间上。';
    const near = '追旗舰的成本不在调用费上，而在你为怕不够好所花的排查时间上面。';
    const body = `# 一个够长够具体的标题用于测试用${a}\n\n${a}\n\n${near}\n\n${'补足字数到短档下限的内容，'.repeat(45)}`;
    const r = lintArticle(body, { length: 'short' });
    expect(ids(r)).toContain('duplicate-para');
  });
});

describe('评分与排序', () => {
  it('无问题 = 100 分', () => expect(scoreOf([])).toBe(100));
  it('error 扣得比 warn 重，warn 比 info 重', () => {
    const mk = (severity: LintIssue['severity']): LintIssue => ({ id: 'x', severity, title: 't', detail: 'd' });
    const e = scoreOf([mk('error')]), w = scoreOf([mk('warn')]), i = scoreOf([mk('info')]);
    expect(e).toBeLessThan(w);
    expect(w).toBeLessThan(i);
    expect(i).toBeLessThan(100);
  });
  it('分数下限不低于 0', () => expect(scoreOf(Array.from({ length: 30 }, () => ({ id: 'x', severity: 'error' as const, title: 't', detail: 'd' })))).toBe(0));
  it('分档边界', () => {
    expect(scoreBand(85)).toBe('good');
    expect(scoreBand(84)).toBe('fair');
    expect(scoreBand(65)).toBe('fair');
    expect(scoreBand(64)).toBe('poor');
  });
  it('排序：error 在前，info 在后', () => {
    const sorted = sortIssues([
      { id: 'i', severity: 'info', title: '', detail: '' },
      { id: 'e', severity: 'error', title: '', detail: '' },
      { id: 'w', severity: 'warn', title: '', detail: '' },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['e', 'w', 'i']);
  });
});
