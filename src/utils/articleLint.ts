/**
 * articleLint — 成稿质量守卫（纯函数，无依赖，可单测）
 *
 * 定位：文章生成完成后，用一组**可执行**的检查替代"人肉读一遍感觉对不对"。
 * 每条问题都带一句可直接发给润色 Agent 的指令，所以它不只是打分，是**能一键修**。
 *
 * 规则贴着本项目契约写：
 *  - 目标字数档位来自 ipc 的 lengthMap（short 800-1200 / medium 1500-2500 / long 3000+）
 *  - 正文是 Markdown，`#` 主标题 + `##` 小节，配图占位 `[[配图:描述@picN]]`
 *  - 采纳策略后会要求「待补充」占位（V3 证据账），所以占位残留必须能被发现
 */

export type Severity = 'error' | 'warn' | 'info';

export interface LintContext {
  /** 目标长度档位 short | medium | long */
  length?: string;
  /** 采纳策略的内容目标（涨粉/评论/收藏/建立IP/商业转化）——结尾检查按它定制 */
  goal?: string;
  /** 采纳策略的情绪策略——用于判断开头是否服务于情绪 */
  emotion?: string;
  /** 未准备的证据项（成立度里 status=todo 的那些），用于提醒 */
  pendingEvidence?: string[];
  /** V4：认知位移两端，用于检查位移是否真的落地 */
  beliefBefore?: string;
  beliefAfter?: string;
}

export interface LintIssue {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** 可直接投给「二次润色」的指令；没有就是不需要/无法一键修 */
  fix?: string;
}

export interface LintResult {
  score: number;              // 0-100
  issues: LintIssue[];
  /** V4：发布前四检，未通过项同时会作为 error 出现在 issues 里 */
  quality?: QualityCheck[];
  density?: EvidenceDensity;
  stats: {
    chars: number;            // 正文字数（去 markdown 语法与占位符）
    targetChars: [number, number] | null;
    paragraphs: number;
    sections: number;
    images: number;
    titleChars: number;
    firstParaChars: number;
  };
}

/* ---------------- 文本预处理 ---------------- */

const IMG_RE = /\[\[配图:[^\]]*\]\]/g;

/** 去掉 markdown 语法噪音，得到"读者真正看到的文字" */
export function plainText(md: string): string {
  return (md || '')
    .replace(IMG_RE, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

/** 中文字数口径：非空白字符数（英文按字符计，够用于档位判断） */
export function charCount(text: string): number {
  return (text || '').replace(/\s/g, '').length;
}

/** 按空行切段（保留标题行以外的正文段） */
export function paragraphs(md: string): string[] {
  return (md || '')
    .replace(IMG_RE, '')
    .split(/\n\s*\n/)
    .map((b) => b.replace(/^#{1,6}\s+.*$/gm, '').trim())
    .filter((b) => charCount(b) > 0);
}

/* ---------------- 档位 ---------------- */

const LENGTH_RANGE: Record<string, [number, number]> = {
  short: [800, 1200],
  medium: [1500, 2500],
  long: [3000, 6000],
};

/* ---------------- 词表 ---------------- */

/** AI 高频套话：命中不代表错，但堆起来就是"一眼 AI" */
const CLICHES = [
  '在当今', '在这个', '的时代', '随着.*?的发展', '不难发现', '显而易见',
  '总而言之', '综上所述', '总的来说', '一般而言', '某种程度上', '从某种意义上',
  '让我们一起', '不禁让人', '引发深思', '值得思考', '值得注意的是',
  '赋能', '抓手', '闭环', '底层逻辑', '顶层设计', '降本增效', '生态位',
  '不仅.*更是', '不仅仅是.*更是', '既是.*也是', '在.*的当下',
  '首先.*其次.*最后', '一方面.*另一方面',
];

const PENDING_RE = /(待补充|待核实|待验证|TODO|TBD|XXX+|\[占位\]|_{3,})/g;

/* ---------------- 发布前四检（质量门） ---------------- */

export interface QualityCheck {
  id: 'opinion' | 'shift' | 'evidence' | 'savable';
  label: string;
  pass: boolean;
  why: string;
}

export interface EvidenceDensity {
  per1k: number;      // 每千字证据锚点个数
  facts: number;      // 数字/百分比
  cases: number;      // 具体主体（机构/产品/人名类）
  quotes: number;     // 引号引用
  experience: number; // 第一手经历表述
}

/**
 * 证据密度：按“能不能被反驳”数锚点。
 * “AI 发展很快”得 0；“推理成本下降 80%”得 1。区别就在数不数得出。
 */
export function measureEvidence(text: string, chars: number): EvidenceDensity {
  const t = text || '';
  const facts = (t.match(/\d+(?:\.\d+)?\s*[%％]/g) || []).length
    + (t.match(/(?:\d+(?:[.,]\d+)*)\s*(?:元|美元|万|亿|倍|个百分点|天|小时|分钟|次|篇|人|个月|年)/g) || []).length;
  const cases = (t.match(/[A-Z][A-Za-z0-9.-]{2,}|[\u4e00-\u9fa5]{2,6}(?:公司|研究院|大学|集团|银行|平台|模型|团队)/g) || []).length;
  const quotes = (t.match(/[“「][^”」]{4,}[”」]/g) || []).length;
  const experience = (t.match(/(?:我|我们)(?:见过|试过|做过|测过|跑了|算过|踩过|用过|团队|认识|朋友|同事)/g) || []).length;
  const total = facts + cases + quotes + experience;
  const per1k = chars > 0 ? Math.round((total / chars) * 1000) / 10 : 0;
  return { per1k, facts, cases, quotes, experience };
}

/** 把 belief 句切成特征片段，避开“整句一字不差才算出现”的不现实判定 */
function beliefFragments(s: string): string[] {
  return String(s || '')
    .split(/[，。、；：！？“”"'（）()\s]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 5);
}

/** belief 是否在正文里落地：任一特征片段出现即算 */
function beliefLanded(text: string, belief?: string): boolean {
  if (!belief) return false;
  const flat = text.replace(/\s/g, '');
  const frags = beliefFragments(belief);
  if (!frags.length) return belief.length >= 4 && flat.includes(belief.replace(/\s/g, ''));
  return frags.some((f) => flat.includes(f.replace(/\s/g, '')));
}

/**
 * 发布前四检。不通过就标红，因为它不是优化填项，是能不能发的问题。
 */
export function qualityChecks(md: string, ctx: LintContext = {}): QualityCheck[] {
  const text = plainText(md);
  const chars = charCount(text);
  const paras = paragraphs(md).map(plainText).filter(Boolean);
  const paraChars = paras.map(charCount);
  const has = (needle?: string) => beliefLanded(text, needle || '');

  /* ① 是否有明确观点：正文里要能指出一句判断句 */
  const opinionHit = ctx.beliefAfter && has(ctx.beliefAfter)
    ? true
    : paras.some((p) => charCount(p) <= 60 && /(?:不是|并不是|并非|真正的|本质上|关键不在|靠的是|问题在于)/.test(p));
  const opinion: QualityCheck = {
    id: 'opinion', label: '有明确观点', pass: !!opinionHit,
    why: opinionHit
      ? '正文里能指出承担主张的判断句'
      : '找不到一句能担当主张的判断句——全篇在“介绍情况”而不是“给结论”',
  };

  /* ② 是否有认知位移：旧认知得被指认过，新认知得真的写出来 */
  const contrastive = /不是.{0,24}(而是|并非|是在)|而非|真正的.{0,12}是|关键不在/.test(text);
  const oldNamed = /(多数人|很多人|大家都|常见说法|普遍认为|直觉上|常规看法|你以为|你可能觉得|听起来|表面上)/.test(text)
    || (!!ctx.beliefBefore && has(ctx.beliefBefore));
  const newWritten = has(ctx.beliefAfter);
  // 有策略上下文时严格按 belief 两端查（它能直接验证位移是否落地）；
  // 没策略时退到结构判读，否则会把正常的“不是 A 而是 B”写法误判为不合格
  const shift: QualityCheck = {
    id: 'shift', label: '有认知位移',
    pass: ctx.beliefAfter
      ? (oldNamed && newWritten)
      : (oldNamed || contrastive),
    why: ctx.beliefAfter
      ? (!oldNamed && !newWritten
        ? '既没指认旧认知，也没把新认知写出来——读者“知道了更多信息”，但想法没动'
        : !oldNamed
          ? '没先把读者原来的想法摆出来，位移就没有起点（会变成空喊）'
          : !newWritten
            ? '策略里的 belief_after 没在正文出现——位移停在设想，没落地'
            : '旧认知被指认、新认知被写出')
      : '正文里没有旧认知指认，也没有“不是 A 而是 B”这类对比结构——看起来像在介绍情况',
  };

  /* ③ 是否有证据：至少一个可被反驳的锚点 */
  const density = measureEvidence(text, chars);
  const evidence: QualityCheck = {
    id: 'evidence', label: '有证据支撑', pass: density.facts + density.cases + density.quotes + density.experience >= 2,
    why: `锚点：数字 ${density.facts}、具体主体 ${density.cases}、引用 ${density.quotes}、亲历 ${density.experience}（每千字 ${density.per1k} 个）`,
  };

  /* ④ 是否值得保存：有可拿走的结构 */
  const savableHit = (md || '').match(/^\s*(?:[-*+]|\d+\.)\s+\S/gm);
  const savable: QualityCheck = {
    id: 'savable', label: '值得保存',
    pass: (savableHit ? savableHit.length : 0) >= 3 || (paraChars.filter((n) => n > 0 && n <= 22).length >= 2 && paras.length >= 6),
    why: (savableHit && savableHit.length >= 3)
      ? `有 ${savableHit.length} 条可拿走清单/步骤`
      : '没有清单、步骤、框架这类“半年后还得翻出来看”的东西——时效内容，发完就死',
  };

  return [opinion, shift, evidence, savable];
}

/* ---------------- 主函数 ---------------- */

export function lintArticle(md: string, ctx: LintContext = {}): LintResult {
  const text = plainText(md);
  const chars = charCount(text);
  const paras = paragraphs(md);
  const paraChars = paras.map(charCount);
  const issues: LintIssue[] = [];

  const titleMatch = (md || '').match(/^\s*#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const titleChars = charCount(title);

  const sections = ((md || '').match(/^\s*##\s+\S.*$/gm) || []).length;
  const images = ((md || '').match(IMG_RE) || []).length;
  const firstPara = paras[0] || '';
  const firstParaChars = charCount(firstPara);

  const target = LENGTH_RANGE[ctx.length || 'medium'] || LENGTH_RANGE.medium;

  /* 1. 字数达标 */
  if (chars < target[0] * 0.6) {
    issues.push({
      id: 'word-count-critical', severity: 'error',
      title: `篇幅严重不足（${chars} 字，目标 ${target[0]}–${target[1]}）`,
      detail: '不到目标下限的六成，通常意味着论点没展开、案例没写透，读者会觉得"就这？"',
      fix: '在不注水的前提下把每个小节展开：补场景、补具体做法、补反例，每节至少两段',
    });
  } else if (chars < target[0]) {
    issues.push({
      id: 'word-count-low', severity: 'warn',
      title: `篇幅偏短（${chars} 字，目标 ${target[0]}–${target[1]}）`,
      detail: '低于目标下限，多半是有几节只写了一句结论没展开',
      fix: '挑出只有一段的小节，各补一个具体场景或可执行步骤，不要加形容词凑字',
    });
  } else if (chars > target[1] * 1.35) {
    issues.push({
      id: 'word-count-high', severity: 'warn',
      title: `篇幅偏长（${chars} 字，目标 ${target[0]}–${target[1]}）`,
      detail: '超出上限 35% 以上，手机端阅读会掉在中途；通常是同一层意思说了两遍',
      fix: '压缩到目标区间：合并重复表述，删掉只为过渡存在的段落，保留事实、观点和金句',
    });
  }

  /* 2. 占位残留（V3 证据账闭环） */
  const pending = text.match(PENDING_RE) || [];
  if (pending.length) {
    const named = (ctx.pendingEvidence || []).slice(0, 3);
    issues.push({
      id: 'placeholder-left', severity: 'error',
      title: `正文里有 ${pending.length} 处未补素材的占位`,
      detail: named.length
        ? `占位是正确行为（没证据就不该编），但发布前必须补上或删掉。还缺：${named.join('、')}`
        : '占位是正确行为（没证据就不该编），但发布前必须补上或删掉',
      // 不给一键润色：这是**事实问题**，AI 补不了，只能用户去查
    });
  }

  /* 3. AI 套话 */
  const hits: string[] = [];
  for (const p of CLICHES) {
    const re = new RegExp(p, 'g');
    const n = (text.match(re) || []).length;
    if (n) hits.push(n > 1 ? `${p}×${n}` : p);
  }
  if (hits.length >= 4) {
    issues.push({
      id: 'ai-cliches', severity: 'warn',
      title: `AI 套话偏多（命中 ${hits.length} 类）`,
      detail: `常见命中：${hits.slice(0, 6).join('、')}。单用没问题，堆起来读者一眼就划走`,
      fix: '逐句改写这些套话：删掉空泛过渡句，用具体事实、场景、数字（限已提供的）替代',
    });
  }

  /* 4. 段落墙（手机端） */
  const walls = paraChars.filter((n) => n > 200).length;
  if (walls) {
    issues.push({
      id: 'wall-paragraph', severity: 'warn',
      title: `${walls} 个段落超过 200 字`,
      detail: '手机上一屏都是字会直接劝退，中文长段应拆成 2–3 小段',
      fix: '把超过 200 字的段落按语义拆开，每段只讲一件事，长句拆短',
    });
  }

  /* 5. 开头钩子 */
  if (firstParaChars > 140) {
    issues.push({
      id: 'weak-opening', severity: 'warn',
      title: `首段过长（${firstParaChars} 字）`,
      detail: '开头要的是"抓一下"，不是铺垫背景。前 3 行决定读者是否继续',
      fix: '重写开头：第一句直接抛冲突、反常识结论或具体场景，控制在 80 字内，背景后移',
    });
  }

  /* 6. 金句 / 可截图传播点 */
  const punch = paraChars.filter((n) => n > 0 && n <= 22).length;
  if (!punch && chars > 600) {
    issues.push({
      id: 'no-punchline', severity: 'warn',
      title: '没有单独成段的短句（缺金句位）',
      detail: '传播靠的是能被截图的那一句。全文没有一行短句，等于没有记忆点',
      fix: '在每个大节的判断处，把最锋利的那句话单独成段（不超过 22 字），不要加解释',
    });
  }

  /* 7. 结构丢失（对照大纲要求"不增减章节"） */
  if (sections === 0 && chars > 800) {
    issues.push({
      id: 'no-sections', severity: 'error',
      title: '整篇没有一个小节标题',
      detail: '大纲要求按章节写；没有小节通常说明 AI 把大纲压平成了一段连续输出',
      fix: '按原大纲的小节标题重新分节，每个小节标题下只写它那一节的内容',
    });
  }

  /* 8. 空小节 */
  const emptySec = ((md || '').match(/^#{2,3}\s+\S[^\n]*\n(?=\s*#)/gm) || []).length;
  if (emptySec) {
    issues.push({
      id: 'empty-section', severity: 'error',
      title: `${emptySec} 个小节下面没有正文`,
      detail: '只有标题没有内容，属于生成断尾',
      fix: '为空缺的小节补写正文，若确实不需要则连同标题一起删除',
    });
  }

  /* 9. 标题长度 */
  if (title && (titleChars < 8 || titleChars > 30)) {
    issues.push({
      id: 'title-length', severity: 'info',
      title: `标题 ${titleChars} 字（建议 8–30）`,
      detail: titleChars > 30 ? '过长会被列表截断' : '太短的标题通常没有信息量',
      fix: '重写标题：保留具体名词与反差/悬念，控制在 8–30 字，不要用"关于…的思考"式空题',
    });
  }
  if (!title) {
    issues.push({
      id: 'no-title', severity: 'error',
      title: '正文缺主标题',
      detail: '导出与发布都依赖第一行 `# 标题`',
      fix: '按策略的标题方向补一个主标题放在第一行',
    });
  }

  /* 10. 配图数量 */
  if (chars > 900 && images === 0) {
    issues.push({
      id: 'no-image', severity: 'info',
      title: '全文没有配图占位',
      detail: '长文没有视觉断点，读者容易在中途流失（建议 1–3 处）',
    });
  } else if (images > 4) {
    issues.push({
      id: 'too-many-images', severity: 'info',
      title: `配图占位 ${images} 处，偏多`,
      detail: '图太多会稀释正文，且每张都要生成成本',
    });
  }

  /* 11. 结尾收束（按策略 goal 定制） */
  const tail = paras.slice(-1)[0] || '';
  const tailText = plainText(tail);
  const hasQuestion = /[？?]/.test(tailText);
  const hasAction = /(你可以|建议你|下一步|试试|列个清单|从今天|现在开|评论区|关注我|转发|收藏)/.test(tailText);
  if (!hasQuestion && !hasAction && chars > 600) {
    const goalHint: Record<string, string> = {
      评论: '结尾留一个可以站队的二选一问题，别给圆满结论',
      涨粉: '结尾给出"为什么值得关注"的预期（下一篇讲什么），一句就够',
      收藏: '把可执行部分压成一个清单放最后，让人有存下来的理由',
      建立IP: '结尾用第一人称下一次判断，让读者记住是谁说的',
      商业转化: '结尾落到一个具体场景与下一步动作，不要硬广',
    };
    issues.push({
      id: 'weak-ending', severity: 'warn',
      title: ctx.goal ? `结尾没有收束（策略目标是「${ctx.goal}」）` : '结尾没有收束',
      detail: ctx.goal && goalHint[ctx.goal]
        ? goalHint[ctx.goal]
        : '结尾既没有行动也没有悬念，读者读完没有"下一步"',
      fix: ctx.goal && goalHint[ctx.goal] ? `结尾改写：${goalHint[ctx.goal]}` : '结尾加一句可执行的下一步或一个开放问题',
    });
  }

  /* 12. 节奏机械（段长过于均匀） */
  if (paras.length >= 6) {
    const mean = paraChars.reduce((a, b) => a + b, 0) / paraChars.length;
    const sd = Math.sqrt(paraChars.reduce((a, b) => a + (b - mean) ** 2, 0) / paraChars.length);
    if (mean > 40 && sd / mean < 0.18) {
      issues.push({
        id: 'robotic-rhythm', severity: 'info',
        title: '段落长度过于均匀，节奏像模板',
        detail: '真人写作有长有短。段长方差过小读起来像说明书',
        fix: '把 1–2 处关键判断改写成独立短句段落（一句话自成一段），制造呼吸感',
      });
    }
  }

  /* 13. 近似重复段 */
  const dup = findNearDuplicates(paras);
  if (dup.length) {
    issues.push({
      id: 'duplicate-para', severity: 'warn',
      title: `${dup.length} 组段落高度相似`,
      detail: '同一层意思说了两遍，是"看着长其实没内容"的主因',
      fix: '合并语义重复的段落，只保留信息更密的那一版',
    });
  }

  /* V4：发布前四检。未通过的直接当 error 计入，因为它卡的是“能不能发”而不是“发得好不好” */
  const quality = qualityChecks(md, ctx);
  const density = measureEvidence(text, chars);
  for (const q of quality) {
    if (q.pass) continue;
    issues.push({
      id: `quality-${q.id}`,
      severity: 'error',
      title: `发布前检查未通过：${q.label}`,
      detail: q.why,
      fix: q.id === 'opinion'
        ? '在开头第三段明确写出本文主张，用一句判断句（“X 不是 A，而是 B”），并在结尾重述一次'
        : q.id === 'shift'
          ? '先把读者原来的想法用一句话摆出来（标出谁在这么想），再给出你要他改成的那个判断'
          : q.id === 'evidence'
            ? '补上可被反驳的锚点：具体数字、可查主体、一段亲历过程或一条引用；没有就先别发，占位比编造好'
            : '把可拿走的判定标准整理成编号清单，至少 3 条，放在文中而不是埋在段落里',
    });
  }

  const score = scoreOf(issues);
  return {
    score,
    issues,
    quality,
    density,
    stats: { chars, targetChars: target, paragraphs: paras.length, sections, images, titleChars, firstParaChars },
  };
}

/** 粗粒度近似重复：按字符 3-gram 重合度，避免引入分词依赖 */
function findNearDuplicates(paras: string[]): Array<[number, number]> {
  const grams = paras.map((p) => {
    const t = charCount(p) ? plainText(p).replace(/\s/g, '') : '';
    const set = new Set<string>();
    for (let i = 0; i + 3 <= t.length; i++) set.add(t.slice(i, i + 3));
    return set;
  });
  const out: Array<[number, number]> = [];
  for (let i = 0; i < grams.length; i++) {
    if (!grams[i].size) continue;
    for (let j = i + 1; j < grams.length; j++) {
      if (!grams[j].size) continue;
      let inter = 0;
      const [small, big] = grams[i].size <= grams[j].size ? [grams[i], grams[j]] : [grams[j], grams[i]];
      for (const g of small) if (big.has(g)) inter++;
      const sim = inter / small.size;
      if (sim > 0.6) out.push([i, j]);
    }
  }
  return out;
}

const PENALTY: Record<Severity, number> = { error: 18, warn: 8, info: 3 };

export function scoreOf(issues: LintIssue[]): number {
  const lost = issues.reduce((sum, i) => sum + (PENALTY[i.severity] ?? 5), 0);
  return Math.max(0, Math.min(100, 100 - lost));
}

/** 分数档位，UI 用它决定颜色 */
export function scoreBand(score: number): 'good' | 'fair' | 'poor' {
  if (score >= 85) return 'good';
  if (score >= 65) return 'fair';
  return 'poor';
}

/** 按严重度排序，同类问题多的排前面 */
export function sortIssues(issues: LintIssue[]): LintIssue[] {
  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
