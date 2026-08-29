/**
 * referenceGuard — 「参考文是否值得分析」的判定（纯函数，可单测）
 *
 * 为什么需要它：抓取失败时旧代码会把「# 抓取失败 / 错误：xxx」当成正文塞进去，
 * 于是「分析内容」按钮从灰变亮，AI 认真分析一段错误信息，产出一本正经的 7 维分析，
 * 再往下生成策略——整条链被污染，而且每一步看起来都成功了。
 *
 * 这是路线图「先约束输入」的最内层：烂输入不该有资格消耗一次 AI 调用。
 */

export interface ReferenceAssessment {
  usable: boolean;
  chars: number;            // 去空白后的字符数
  reason?: string;          // 不可用的原因（可直接展示给用户）
  /** 建议动作，用于把用户引到正确的下一步而不是只报错 */
  hint?: string;
}

/** 错误页 / 反爬页特征——出现这些基本说明抓回来的不是正文 */
const ERROR_PATTERNS = [
  '抓取失败', '请改用', '访问受限', '安全验证', '请输入验证码', '滑动验证',
  '请登录', '需要登录', '登录后查看', '403', 'Forbidden', '404', 'Not Found',
  'robots.txt', '反爬', '加载失败', '页面不存在', 'Access Denied', 'Are you a robot',
];

/** 至少要这么长才值得分析：低于此值多半是摘要、标题党或抓取残片 */
export const MIN_REFERENCE_CHARS = 200;

/** 目录页/导航页常见噪声（只在短文本时判，避免误伤真正文里的“下一篇”） */
// 必须是 /g：非全局的 match() 永远只返回 1 个命中，下面的 >= 3 就永远不成立
const NAV_NOISE = /(下一篇|上一篇|查看更多|加载更多|热门标签|扫码关注|广告|版权声明)/g;

export function assessReference(text?: string | null): ReferenceAssessment {
  const raw = String(text || '');
  const chars = raw.replace(/\s/g, '').length;

  if (chars === 0) {
    return { usable: false, chars, reason: '还没有参考内容', hint: '抓取 URL，或直接粘贴正文' };
  }

  // 错误页特征优先于长度判断：错误文案往往本身就有 100+ 字，会被误当成"够长"
  const hit = ERROR_PATTERNS.find((p) => raw.includes(p));
  if (hit) {
    return {
      usable: false, chars,
      reason: `抓回来的不像正文（命中「${hit}」）`,
      hint: '多半是被登录墙/反爬挡住了。换一篇，或直接粘贴正文',
    };
  }

  if (chars < MIN_REFERENCE_CHARS) {
    return {
      usable: false, chars,
      reason: `正文只有 ${chars} 字，不足以支撑 7 维分析`,
      hint: '至少 ' + MIN_REFERENCE_CHARS + ' 字。太短的内容建议直接当"选题"走命题策划',
    };
  }

  // 重复擑出来的长度不算内容（例如 200 个“很”）。
  // 注意不能用“不同字占比”：中文常用字就那么些，文章越长占比必然越低，
  // 用占比会把 7000 字的正常文章误判为垃圾（实测跑出来的假阳性）。
  // 所以改成看“不同字个数”绝对值：真实文章随便就上百个不同字。
  const distinct = new Set(raw.replace(/\s/g, '')).size;
  if (distinct < 20) {
    return {
      usable: false, chars,
      reason: '正文是少量字符重复堆出来的，没有可分析的信息',
      hint: '检查是否抓到了验证码页/占位页；或改用命题策划',
    };
  }

  // 短文本 + 全是导航噪声 → 目录页
  if (chars < 500 && (raw.match(NAV_NOISE) || []).length >= 3) {
    return {
      usable: false, chars,
      reason: '抓到的更像是目录页/列表页，不是一篇文章',
      hint: '打开具体文章页再抓取，或直接粘贴正文',
    };
  }

  return { usable: true, chars };
}

/** 抓回来的文本里，有多少比例看起来是正文（用于给出温和提示，不做拦截） */
export function referenceQualityNote(text?: string | null): string | null {
  const a = assessReference(text);
  if (!a.usable) return a.reason || null;
  if (a.chars > 12000) return '正文很长（' + a.chars + ' 字），分析时只会取前 3000 字，注意代表性';
  return null;
}
