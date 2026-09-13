// quick-publish-beautify 单测：把无样式的输入变成带观点盒的 HTML
// 测试样本：用户提供的真实"信任产业链"文章
import { describe, it, expect } from 'vitest';
import { beautifyHtml } from '../../src/utils/quickPublishBeautify';

const ARTICLE = `从公开信息看，景甜与孙宇晨几乎没有正式交集。

**流量能买到热搜位，但买不到信任银行的席位。**

一、炒作型"科技企业家"的流量飞轮

拆解孙宇晨的公开营销剧本，是三件套：名人绑定、天价事件、争议变现。

炒作型创始人的核心竞争力不是技术，而是"让你记住他"。

二、名人"信用出借"

信任是可以挂牌转让的，但定价是错的。

科技圈的信任转让市场里，收溢价的永远是最后接盘的人。

三、监管与算法，正在同时改写规则

另一边，AI 把造假成本打到了地板。

当生成谎言的成本趋近于零，"可验证的信用"就成了最贵的资产。`;

describe('beautifyHtml · 真实文章结构识别', () => {
  it('中文序号 "一、二、" 识别为 H2', () => {
    const html = beautifyHtml(ARTICLE);
    expect(html).toContain('<h2 class="qp-h2">炒作型"科技企业家"的流量飞轮</h2>');
    expect(html).toContain('<h2 class="qp-h2">名人');
    expect(html).toContain('<h2 class="qp-h2">监管与算法');
  });

  it('**xxx** 整段识别为观点盒（橙色背景）', () => {
    const html = beautifyHtml(ARTICLE);
    expect(html).toMatch(/<div class="qp-viewpoint">[\s\S]*<strong>流量能买到热搜位[\s\S]*<\/div>/);
  });

  it('含"而是"的关键句被识别为观点盒', () => {
    const html = beautifyHtml(ARTICLE);
    expect(html).toContain('qp-viewpoint');
    // 至少 2 个观点盒（**xxx** + 关键词命中）
    expect((html.match(/qp-viewpoint/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('普通段落不被错误识别为观点盒', () => {
    const html = beautifyHtml(ARTICLE);
    // "从公开信息看..." 不应该被识别为观点盒（无关键词 + 不是 **）
    expect(html).toMatch(/^<p>从公开信息看/m);
  });

  it('HTML 注入安全：<、>、& 转义', () => {
    const html = beautifyHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('beautifyHtml · 边界', () => {
  it('空字符串', () => expect(beautifyHtml('')).toBe(''));
  it('只有 # 标题', () => {
    expect(beautifyHtml('# 标题')).toContain('<h1');
    expect(beautifyHtml('## 小标题')).toContain('<h2');
    expect(beautifyHtml('### 三级')).toContain('<h3');
  });
  it('超长段落不误判为观点盒（>200 字）', () => {
    const long = '其实这是一段很长的内容。' + '重复的字。'.repeat(50);
    expect(beautifyHtml(long)).not.toContain('qp-viewpoint');
  });
  it('> 引用', () => {
    expect(beautifyHtml('> 重要的事说三遍')).toContain('<blockquote');
  });
  it('列表', () => {
    const html = beautifyHtml('- 一\n- 二\n- 三');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>一</li>');
  });
});

describe('用户金句：观察背后，藏着你所有的观点', () => {
  it('11 字 + 藏着 → 识别为观点盒', () => {
    const html = beautifyHtml('观察背后，藏着你所有的观点。');
    expect(html).toContain('qp-viewpoint');
    expect(html).toContain('观察背后');
  });

  it('类似的短金句都能识别', () => {
    const samples = [
      '本质是：人是环境的产物。',
      '真相是大家都在装睡。',
      '其实是用户没想清楚要写什么。',
      '关键是开始，而不是想清楚。',
    ];
    for (const s of samples) {
      const html = beautifyHtml(s);
      expect(html, `${s} should be viewpoint`).toContain('qp-viewpoint');
    }
  });
});

describe('自白式陈述 → 观点盒', () => {
  it('"因为我想知道..." 识别', () => {
    const html = beautifyHtml('因为我想知道，有没有人真的在认真看。');
    expect(html).toContain('qp-viewpoint');
  });
  it('"我在乎..." 识别', () => {
    const html = beautifyHtml('其实我在乎的是这个人是否真的看懂了。');
    expect(html).toContain('qp-viewpoint');
  });
  it('"我希望..." 命中强关键词 → 观点盒（自白式陈述）', () => {
    const html = beautifyHtml('我希望读者能读到这里。');
    expect(html).toContain('qp-viewpoint');
  });
});

describe('EP02 金句：重新框架句 → 观点盒', () => {
  it('"我不是没有想法，我只是看不见自己的想法" → 整段观点盒', () => {
    const html = beautifyHtml(`我不是没有想法。
我只是看不见自己的想法。

以前我以为创作是：观点 → 文章。

现在我觉得更像：观察 → 疑问 → 观点 → 文章。`);
    // 整段（多段 block 但每段都有隐形信号） → 多 qp-viewpoint
    expect((html.match(/qp-viewpoint/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('我不是没有想法');
  });
  it('"只是..." 单独触发', () => {
    const html = beautifyHtml('只是不见得能被自己看见。');
    expect(html).toContain('qp-viewpoint');
  });
});

describe('markdown 分隔线', () => {
  it('--- 变成 <hr> 而不是字面量段落', () => {
    const html = beautifyHtml('第一段。\n\n---\n\n第二段。');
    expect(html).toContain('<hr class="qp-divider"/>');
    expect(html).not.toContain('<p>---</p>');
  });
});
