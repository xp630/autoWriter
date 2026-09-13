// quickPublishBeautify — P1: Quick Publish 的核心算法
// 把无样式的 Markdown/纯文本变成带公众号样式的 HTML
// 纯函数,可单测

/** 把纯 Markdown / 纯文本里的"观点"识别出来，渲染成带样式的 HTML
 * 识别规则（不锁死）：
 *   - **xxx**              → 观点句（核心观点，加粗+背景）
 *   - # / ## / ###          → 标题
 *   - > xxx                → 引用
 *   - - xxx / 1. xxx        → 列表
 *   - 含"其实/关键/问题是/真正的/不是/所以/因此"+ 长度 20–200 → 候选观点
 *   - 空行分块
 */
export function beautifyHtml(raw: string): string {
  // 两层关键词：strong = 即使句子短（如 8–20 字）也算观点；weak = 需 20+ 字
  const STRONG_KW = /其实|关键是|问题是|真正的|藏着|藏在|背后|本质|真相|核心|是这|而是|终于明白|终于发现|我终于|我真的|我在乎|我想知道|我希望|我相信|我期待|我害怕|看不见|没看到|看不到|未发现|我只是|只是不|不是\s/;
  const WEAK_KW = /所以|因此|意味着|关键在于|原因是|其实/;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const md = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const html = blocks.map((blk) => {
    // markdown 分隔线 --- / *** → <hr>（发布稿里的真实分隔，不是字面量）
    if (/^(-{3,}|\*{3,})\s*$/.test(blk)) return '<hr class="qp-divider"/>';
    // 整块被 **...** 包裹 → 观点盒
    const fullBold = /^\*\*[\s\S]+\*\*\s*$/.test(blk);
    // 单段标题
    const h3 = /^###\s+(.+)$/.exec(blk);
    if (h3) return `<h3 class="qp-h3">${md(h3[1])}</h3>`;
    const h2 = /^##\s+(.+)$/.exec(blk);
    if (h2) return `<h2 class="qp-h2">${md(h2[1])}</h2>`;
    // 中文序号"一、" "二、" 也识别为二级标题(公众号常见)
    const cnNum = /^([一二三四五六七八九十]+)、\s*(.+)$/.exec(blk);
    if (cnNum) return `<h2 class="qp-h2">${md(cnNum[2])}</h2>`;
    const h1 = /^#\s+(.+)$/.exec(blk);
    if (h1) return `<h1 class="qp-h1">${md(h1[1])}</h1>`;
    // 引用
    const quote = /^>\s*([\s\S]+)$/.exec(blk);
    if (quote) return `<blockquote class="qp-quote">${md(quote[1]).replace(/\n/g, '<br/>')}</blockquote>`;
    // 列表
    const listItems = blk.split('\n').map((l) => l.trim()).filter((l) => /^(-|\d+\.)\s+/.test(l));
    if (listItems.length >= 2) {
      return '<ul class="qp-list">' + listItems.map((l) => `<li>${md(l.replace(/^(-|\d+\.)\s+/, ''))}</li>`).join('') + '</ul>';
    }
    // 观点盒（Markdown 粗体整块 / 关键词命中 + 长度合理）
    const isCandidate =
      fullBold ||
      (STRONG_KW.test(blk) && blk.length >= 8 && blk.length <= 200);
    if (isCandidate) {
      return `<div class="qp-viewpoint">${md(blk).replace(/\n/g, '<br/>')}</div>`;
    }
    // 普通段落
    return `<p>${md(blk).replace(/\n/g, '<br/>')}</p>`;
  }).join('\n');
  return html;
}
