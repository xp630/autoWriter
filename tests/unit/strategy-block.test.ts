// 内容策略系统 V2：字段归一化 + strategyBlock 渲染 + 配图策略提示
import { describe, it, expect } from 'vitest';
import {
  parseStrategyResult, parseAngleResult, normalizeStrategy,
  normalizeDifferentiator, normalizeTrackFit, normalizeFeasibility, evidenceCoverage,
  buildStrategyBlock, buildImageStrategyHint,
} from '../../electron/analysis.cjs';

describe('normalizeDifferentiator · A 模式核心字段', () => {
  it('结构化对象被保留，type 命中枚举', () => {
    const d = normalizeDifferentiator({
      type: 'new_audience', description: '用男性视角解释女性婚恋选择', instruction: '全文以男友视角展开',
    });
    expect(d).toEqual({ type: 'new_audience', description: '用男性视角解释女性婚恋选择', instruction: '全文以男友视角展开' });
  });

  it('非法 type 被清空，但描述保住（不因为枚举写错就丢字段）', () => {
    const d = normalizeDifferentiator({ type: '新视角', description: 'x' });
    expect(d?.type).toBe('');
    expect(d?.description).toBe('x');
  });

  it('旧数据（纯字符串）自动包装成对象', () => {
    expect(normalizeDifferentiator('给出可算的现金流账')).toEqual({
      type: '', description: '给出可算的现金流账', instruction: '',
    });
  });

  it('空描述 / null / 空对象 → null', () => {
    expect(normalizeDifferentiator(null)).toBeNull();
    expect(normalizeDifferentiator({})).toBeNull();
    expect(normalizeDifferentiator('   ')).toBeNull();
  });
});

describe('normalizeTrackFit · 批次适配度', () => {
  it('V2 形状 score/reason/adapt_direction', () => {
    const t = normalizeTrackFit({ score: '3.2', reason: '偏财经', adapt_direction: '改成职场切口' });
    expect(t).toEqual({ score: 3.2, reason: '偏财经', adapt_direction: '改成职场切口' });
  });

  it('兼容旧形状 matches/note → 折算成分数', () => {
    expect(normalizeTrackFit({ matches: true, note: '很贴' })?.score).toBe(8);
    expect(normalizeTrackFit({ matches: false, note: '不贴' })?.score).toBe(3);
    expect(normalizeTrackFit({ matches: false, note: '不贴' })?.adapt_direction).toBe('不贴');
  });

  it('score 越界被夹到 0-10；非数字丢弃', () => {
    expect(normalizeTrackFit({ score: 42 })?.score).toBe(10);
    expect(normalizeTrackFit({ score: '很高' })?.score).toBeUndefined();
  });

  it('空对象/null → null', () => {
    expect(normalizeTrackFit({})).toBeNull();
    expect(normalizeTrackFit(null)).toBeNull();
  });
});

describe('normalizeFeasibility · B 模式可写性', () => {
  it('V2 形状 score/difficulty/reason', () => {
    expect(normalizeFeasibility({ score: 7.5, difficulty: 'hard', reason: '缺一手案例' }))
      .toEqual({ score: 7.5, difficulty: 'hard', reason: '缺一手案例' });
  });

  it('中文「易/中/难」映射到 easy/medium/hard', () => {
    expect(normalizeFeasibility('难')?.difficulty).toBe('hard');
    expect(normalizeFeasibility('易')?.difficulty).toBe('easy');
  });

  it('对象里 difficulty 用中文也映射', () => {
    expect(normalizeFeasibility({ difficulty: '中' })?.difficulty).toBe('medium');
  });

  it('完全空的对象不算 feasibility', () => {
    expect(normalizeFeasibility({})).toBeNull();
    expect(normalizeFeasibility('')).toBeNull();
  });
});

describe('normalizeStrategy · 一行 = 一个策略', () => {
  it('B 模式默认 fact_risk=medium，素材缺口 ≥3 条时升为 high', () => {
    const low = normalizeStrategy({ title: 't', core_point: 'p' }, 'topic');
    expect(low.fact_risk).toBe('medium');
    const high = normalizeStrategy({
      title: 't', core_point: 'p',
      evidence_needed: ['数据A', '案例B', '判决C'],
    }, 'topic');
    expect(high.fact_risk).toBe('high');
  });

  it('A 模式默认 fact_risk=low', () => {
    expect(normalizeStrategy({ title: 't', core_point: 'p' }, 'reference').fact_risk).toBe('low');
  });

  it('模型显式给的 fact_risk 优先于默认值', () => {
    expect(normalizeStrategy({ title: 't', fact_risk: 'HIGH' }, 'topic').fact_risk).toBe('high');
  });

  it('非数字 value_score 不落 0，而是缺席', () => {
    expect('value_score' in normalizeStrategy({ title: 't', value_score: '很高' })).toBe(false);
  });

  it('structure 去空项，全空则字段缺席', () => {
    expect(normalizeStrategy({ title: 't', structure: ['a', '', ' ', 'b'] }).structure).toEqual(['a', 'b']);
    expect('structure' in normalizeStrategy({ title: 't', structure: ['', ' '] })).toBe(false);
  });
});

describe('parseStrategyResult · 双模式返回平铺策略', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ angle_type: `a${i}`, title: `t${i}`, core_point: `p${i}` }));

  it('A：返回 strategies（不再是 angles），并带批次 track_fit', () => {
    const r = parseStrategyResult({ angles: mk(3), track_fit: { score: 8, reason: '贴' } }, 'reference');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.strategies).toHaveLength(3);
      expect(r.angles).toBeUndefined();
      expect(r.track_fit.score).toBe(8);
    }
  });

  it('B：track_fit 强制为 null，每条策略自带 feasibility/fact_risk', () => {
    const r = parseStrategyResult({
      angles: [
        { title: 't1', core_point: 'p', feasibility: { score: 8, difficulty: 'easy', reason: '写得动' }, evidence_needed: ['要一个公开处罚文号', '要一组读者案例'] },
        ...mk(2),
      ],
    }, 'topic');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.track_fit).toBeNull();
      expect(r.strategies[0].feasibility.difficulty).toBe('easy');
      // V3：列了证据但一条都没勾 ready → 事实风险直接到 high
      //（旧规则是“≥3 条才 high”，但“列 2 条全没备”显然比“列 3 条备了 2 条”更危险）
      expect(r.strategies[0].fact_risk).toBe('high');
      expect(r.strategies[1].fact_risk).toBe('medium');   // 没列证据的 B 策略给 medium
    }
  });

  it('V3：证据全备齐 → fact_risk 降为 low', () => {
    const r = parseStrategyResult({
      angles: [{
        title: 't', core_point: 'p',
        evidence: [{ item: '官方价格', status: 'ready' }, { item: '规格对照', status: 'ready' }],
      }, ...mk(2)],
    }, 'topic');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.strategies[0].fact_risk).toBe('low');
  });

  it('V3：部分备齐 → medium', () => {
    const s = normalizeStrategy({
      title: 't', core_point: 'p',
      evidence: [{ item: 'A', status: 'ready' }, { item: 'B', status: 'todo' }, { item: 'C' }],
    }, 'topic');
    expect(s.fact_risk).toBe('medium');
  });

  it('少于 3 条失败（两模式一致）', () => {
    expect(parseStrategyResult({ angles: mk(2) }, 'reference').ok).toBe(false);
    expect(parseStrategyResult({ angles: mk(2) }, 'topic').ok).toBe(false);
  });

  it('parseAngleResult 仍可用（旧调用兼容），返回同一形状', () => {
    const r = parseAngleResult({ angles: mk(3), track_fit: { score: 5 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.strategies).toHaveLength(3);
  });
});

describe('buildStrategyBlock · A 模式（抗同质化）', () => {
  const a = {
    mode: 'reference',
    angle_type: '女性 30+ 单身经济账视角',
    title: '为什么越来越多女生宁愿单身',
    core_point: '年轻人不是拒绝婚姻，而是不愿进入低质量关系',
    target_user: '25-35 岁一线城市职场女性',
    structure: ['钩子：一张账单', '论点：三笔经济账', '结论：不必'],
    emotion: '共鸣',
    goal: '涨粉',
    differentiator: { type: 'new_audience', description: '用男性视角重新解释', instruction: '全文以丈夫视角展开' },
  };

  it('差异锚点带 type 中文名 + instruction 一起下发', () => {
    const b = buildStrategyBlock(a);
    expect(b).toContain('差异锚点');
    expect(b).toContain('新人群｜');          // type 翻成中文并用「｜」分隔
    expect(b).toContain('用男性视角重新解释');
    expect(b).toContain('全文以丈夫视角展开');
  });

  it('把差异写成硬指令，而不是一句"不得沿用"', () => {
    const b = buildStrategyBlock(a);
    expect(b).toContain('本文必须把这条差异真正写进内容里，而不是喊口号');
    expect(b).toContain('凡是与原文可能重合的表述、案例、结论，一律重写或删除');
  });

  it('缺 differentiator 时仍有底线要求', () => {
    const { differentiator, ...rest } = a;
    void differentiator;
    expect(buildStrategyBlock(rest)).toContain('不得只改标题与措辞');
  });

  it('A 模式不出现 B 的事实约束块', () => {
    expect(buildStrategyBlock(a)).not.toContain('事实约束');
  });
});

describe('buildStrategyBlock · B 模式（抗幻觉）', () => {
  const b = {
    mode: 'topic',
    angle_type: '个体账本视角',
    title: '不结婚的十年，我算了一笔账',
    core_point: '不愿进入低质量关系',
    evidence_needed: ['待核实：十年居住成本区间', '一个可检索的处罚文号'],
    fact_risk: 'high',
    emotion: '反转',
    goal: '评论',
  };

  it('标题行标明命题策划、无参考素材', () => {
    expect(buildStrategyBlock(b)).toContain('命题策划，无参考素材');
  });

  it('事实约束里带上了 fact_risk 等级', () => {
    const out = buildStrategyBlock(b);
    expect(out).toContain('事实风险=high');
    expect(out).toContain('禁止编造具体数字、百分比、日期、研究结论、人名、机构名、书名、引语、他人经历');
    expect(out).toContain('部分用户');   // 允许的普遍观察措辞
  });

  it('high 风险追加更强的约束；证据备齐后不再出现', () => {
    expect(buildStrategyBlock(b)).toContain('本篇证据严重不足');
    expect(buildStrategyBlock({ ...b, fact_risk: 'low' })).not.toContain('本篇证据严重不足');
  });

  it('ready 与 todo 分开下发：已准写的 vs 必须占位的', () => {
    const out = buildStrategyBlock({
      mode: 'topic', title: 'T', core_point: 'P', fact_risk: 'medium',
      evidence_needed: [
        { item: '官方价格', status: 'ready' },
        { item: '实测记录', status: 'todo' },
      ],
    });
    expect(out).toContain('证据账');
    expect(out).toContain('成立度 1/2（50%）');
    expect(out).toContain('用户已提供的证据，可以直接写进正文');
    expect(out).toContain('正文里必须留「待补充」占位');
    // 已备项不得出现在“还没给”名单里
    const todoSection = out.split('用户还没给的素材')[1] || '';
    expect(todoSection).not.toContain('官方价格');
    expect(todoSection).toContain('实测记录');
  });
  it('列出 evidence 待补清单（旧字符串形状仍可用）', () => {
    const out = buildStrategyBlock(b);
    expect(out).toContain('证据账');
    expect(out).toContain('待核实：十年居住成本区间');
    expect(out).toContain('一个可检索的处罚文号');
  });
  it('B 模式不提"不得沿用原文"（根本没有原文）', () => {
    expect(buildStrategyBlock(b)).not.toContain('不得沿用原文');
  });
  it('无参考素材时也不该出现 A 的差异硬指令', () => {
    expect(buildStrategyBlock(b)).not.toContain('本文必须把这条差异真正写进内容里');
  });

});


describe('buildStrategyBlock · 空值防御', () => {
  it('null / undefined / 空对象 / 只有元数据 → 空串（不污染提示词）', () => {
    expect(buildStrategyBlock(null)).toBe('');
    expect(buildStrategyBlock(undefined)).toBe('');
    expect(buildStrategyBlock({})).toBe('');
    expect(buildStrategyBlock({ strategyId: 3, adoptionId: 9, index: 1 })).toBe('');
  });

  it('只有 title 也能出最小可用块', () => {
    const out = buildStrategyBlock({ title: 'T' });
    expect(out).toContain('标题方向');
    expect(out).toContain('T');
  });
});

describe('buildImageStrategyHint · 策略驱动配图（§十一）', () => {
  it('emotion 定画面气质', () => {
    const h = buildImageStrategyHint({ emotion: '愤怒' });
    expect(h).toContain('创作策略约束');
    expect(h).toContain('情绪基调');
    expect(h).toContain('高对比');
  });

  it('goal 定图像作用：收藏→信息图、涨粉→人物记忆点、评论→对立', () => {
    expect(buildImageStrategyHint({ goal: '收藏' })).toContain('信息图');
    expect(buildImageStrategyHint({ goal: '涨粉' })).toContain('记忆点');
    expect(buildImageStrategyHint({ goal: '评论' })).toContain('站队');
  });

  it('两者都有时一起给', () => {
    const h = buildImageStrategyHint({ emotion: '治愈', goal: '建立IP' });
    expect(h).toContain('柔光');
    expect(h).toContain('真实工作');
  });

  it('无策略 / 无 emotion 无 goal / 枚举外措辞 → 空串（不乱加约束）', () => {
    expect(buildImageStrategyHint(null)).toBe('');
    expect(buildImageStrategyHint({})).toBe('');
    expect(buildImageStrategyHint({ emotion: '扎心', goal: '私域引流' })).toBe('');
  });
});

describe('V3 拆分：主张 vs 洞察、narrative 四拍、成立度', () => {
  it('frame/thesis 作为别名被接受，insight 独立保留', () => {
    const s = normalizeStrategy({ frame: '制度归因', thesis: '够用 AI 在变便宜', insight: '场景匹配比追旗舰重要' }, 'topic');
    expect(s.angle_type).toBe('制度归因');
    expect(s.core_point).toBe('够用 AI 在变便宜');
    expect(s.insight).toBe('场景匹配比追旗舰重要');
  });

  it('narrative 四拍被保留，并反推出 structure（旧读取方不空）', () => {
    const s = normalizeStrategy({
      title: 'T', core_point: 'P',
      narrative: { hook: '价格表', explanation: '为何变便宜', framework: '四问选模', action: '列清单' },
    }, 'topic');
    expect(s.narrative.hook).toBe('价格表');
    expect(s.narrative.action).toBe('列清单');
    expect(s.structure).toEqual(['价格表', '为何变便宜', '四问选模', '列清单']);
  });

  it('中文拍名也能认（钩子/行动）', () => {
    const s = normalizeStrategy({ title: 'T', narrative: { '钩子': 'A', '行动': 'B' } }, 'topic');
    expect(s.narrative).toEqual({ hook: 'A', explanation: '', framework: '', action: 'B' });
  });

  it('旧 structure 数组按下标归成四拍；超出部分归入 action 不丢内容', () => {
    expect(normalizeStrategy({ title: 'T', structure: ['h', 'e', 'f', 'a'] }, 'topic').narrative)
      .toEqual({ hook: 'h', explanation: 'e', framework: 'f', action: 'a' });
    expect(normalizeStrategy({ title: 'T', structure: ['h', 'e', 'f', 'a1', 'a2'] }, 'topic').narrative.action)
      .toBe('a1；a2');
  });

  it('evidenceCoverage：新形状与旧字符串都算得出', () => {
    expect(evidenceCoverage({ evidence_needed: [{ item: 'a', status: 'ready' }, { item: 'b', status: 'todo' }] }))
      .toEqual({ evidence_total: 2, evidence_ready: 1, evidence_coverage: 0.5 });
    const legacy = evidenceCoverage({ evidence_needed: ['只有字符串', '旧数据'] });
    expect(legacy.evidence_total).toBe(2);
    expect(legacy.evidence_ready).toBe(0);      // 没确认过的就是没素材
    expect(evidenceCoverage({})).toEqual({ evidence_total: 0, evidence_ready: 0, evidence_coverage: null });
  });

  it('提示词里主张与洞察各一行，并强制洞察可被复述', () => {
    const out = buildStrategyBlock({
      mode: 'topic', core_point: '够用 AI 在变便宜', insight: '场景匹配比追旗舰重要',
    });
    expect(out).toContain('核心主张（全文要证明它）');
    expect(out).toContain('独特洞察（读者要带走的那一句）');
    expect(out).toContain('可被人复述的话');
  });

  it('narrative 存在时按四拍下发，不再用旧的“结构要求”标题', () => {
    const out = buildStrategyBlock({
      mode: 'topic', title: 'T',
      narrative: { hook: '价格表', explanation: '原因', framework: '四问', action: '清单' },
    });
    expect(out).toContain('叙事骨架');
    expect(out).toContain('1. 钩子：价格表');
    expect(out).toContain('4. 行动/结尾：清单');
    expect(out).not.toContain('结构要求');
  });



});
