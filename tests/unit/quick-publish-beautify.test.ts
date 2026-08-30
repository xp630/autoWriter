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
