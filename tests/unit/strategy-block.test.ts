// P0-2 策略进入写作：角度归一化（推荐指数/情绪/目标）+ strategyBlock 渲染
import { describe, it, expect } from 'vitest';
import { parseAngleResult, parseStrategyResult, normalizeAngle, buildStrategyBlock } from '../../electron/analysis.cjs';

describe('normalizeAngle · 策略字段归一化', () => {
  it('保留 value_score / emotion / goal', () => {
    const a = normalizeAngle({
      angle_type: '女性成长视角', title: 'T', core_point: 'P',
      value_score: 8.5, emotion: '共鸣', goal: '涨粉',
    });
    expect(a.value_score).toBe(8.5);
    expect(a.emotion).toBe('共鸣');
    expect(a.goal).toBe('涨粉');
  });

  it('字符串分数可解析并保留一位小数', () => {
    expect(normalizeAngle({ title: 'T', value_score: '7.28' }).value_score).toBe(7.3);
  });

  it('越界分数夹到 0-10', () => {
    expect(normalizeAngle({ title: 'T', value_score: 42 }).value_score).toBe(10);
    expect(normalizeAngle({ title: 'T', value_score: -3 }).value_score).toBe(0);
  });

  it('非数字分数 → 字段缺席（不是 0，UI 才能隐藏）', () => {
    const a = normalizeAngle({ title: 'T', value_score: '很高' });
    expect('value_score' in a).toBe(false);
  });

  it('老数据（无新字段）不报错、字段缺席', () => {
    const a = normalizeAngle({ angle_type: 'x', title: 'T', core_point: 'P' });
    expect(a.emotion).toBeUndefined();
    expect(a.goal).toBeUndefined();
    expect('value_score' in a).toBe(false);
  });

  it('structure 去掉空白项，全空则字段缺席', () => {
    expect(normalizeAngle({ title: 'T', structure: ['a', '', '  ', 'b'] }).structure).toEqual(['a', 'b']);
    expect('structure' in normalizeAngle({ title: 'T', structure: ['', ' '] })).toBe(false);
  });

  it('emotion/goal 不强校枚举，原样保留（模型可能换说法）', () => {
    const a = normalizeAngle({ title: 'T', emotion: '扎心', goal: '私域引流' });
    expect(a.emotion).toBe('扎心');
    expect(a.goal).toBe('私域引流');
  });
});

describe('parseAngleResult · 归一化已接入', () => {
  it('5 个角度的策略字段被规范化', () => {
    const r = parseAngleResult({
      angles: [
        { angle_type: 'a', title: 't1', core_point: 'p1', value_score: '9.4', emotion: '反转', goal: '评论' },
        { angle_type: 'b', title: 't2', core_point: 'p2', value_score: 6 },
        { angle_type: 'c', title: 't3', core_point: 'p3' },
        { angle_type: 'd', title: 't4', core_point: 'p4' },
        { angle_type: 'e', title: 't5', core_point: 'p5' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.angles[0].value_score).toBe(9.4);
      expect(r.angles[0].emotion).toBe('反转');
      expect(r.angles[1].value_score).toBe(6);
      expect(r.angles[2].value_score).toBeUndefined();
    }
  });
});

describe('buildStrategyBlock · 提示词渲染', () => {
  const full = {
    angle_type: '女性 30+ 单身经济账视角',
    title: '为什么越来越多女生宁愿单身，也不愿将就',
    core_point: '年轻人不是拒绝婚姻，而是不愿进入低质量关系',
    target_user: '25-35 岁一线城市职场女性',
    structure: ['钩子：账单数字', '论点：三笔经济账', '案例：35 岁独居', '行动：先富自己'],
    emotion: '共鸣',
    goal: '涨粉',
  };

  it('六项齐全时全部渲染，并按序号输出结构', () => {
    const b = buildStrategyBlock(full);
    expect(b).toContain('本次创作策略');
    expect(b).toContain('女性 30+ 单身经济账视角');
    expect(b).toContain('文章立意');
    expect(b).toContain('不愿进入低质量关系');
    expect(b).toContain('目标读者');
    expect(b).toContain('情绪策略');
    expect(b).toContain('内容目标');
    expect(b).toContain('1. 钩子：账单数字');
    expect(b).toContain('4. 行动：先富自己');
  });

  it('情绪/目标命中枚举时附带写法约束', () => {
    const b = buildStrategyBlock(full);
    expect(b).toContain('你是不是也');      // 共鸣 → 场景指认
    expect(b).toContain('关注动机');        // 涨粉 → 结尾关注动机
  });

  it('情绪/目标不在枚举时仍原样输出，不编造约束', () => {
    const b = buildStrategyBlock({ title: 'T', emotion: '扎心', goal: '私域引流' });
    expect(b).toContain('扎心');
    expect(b).toContain('私域引流');
    expect(b).not.toContain('你是不是也');
  });

  it('显式禁止沿用原文观点与结构（解决与原文重复）', () => {
    expect(buildStrategyBlock(full)).toContain('不得沿用原文的观点、例子与结构');
  });

  it('缺 core_point 时降级措辞，不提「文章立意」', () => {
    const b = buildStrategyBlock({ title: 'T', emotion: '治愈' });
    expect(b).toContain('按上面指定的角度、情绪、目标重写');
    expect(b).not.toContain('文章立意');
  });

  it('A 模式：differentiator 被当作正向指令输出（治同质化不能只靠负向禁止）', () => {
    const b = buildStrategyBlock({
      title: 'T',
      differentiator: '原文止于同情个体选择，本稿给出单身十年现金流账',
    });
    expect(b).toContain('差异锚点');
    expect(b).toContain('单身十年现金流账');
    expect(b).toContain('凡是与原文可能重合的表述、案例、结论，一律重写或删除');
  });

  it('A 模式无 differentiator 时仍给“不得只改标题”底线要求', () => {
    const b = buildStrategyBlock({ title: 'T' });
    expect(b).toContain('不得只改标题与措辞');
  });
});

describe('buildStrategyBlock · B 命题策划模式', () => {
  const bAngle = {
    mode: 'topic',
    angle_type: '个体账本视角',
    title: '不结婚的十年，我算了一笔账',
    core_point: '年轻人不是拒绝婚姻，而是不愿进入低质量关系',
    target_user: '25-35 岁一线城市职场女性',
    structure: ['开头：一张账单', '归因：风险而非观念', '结尾：抛问题'],
    feasibility: '中',
    evidence_needed: ['待核实：目标城市十年居住成本区间', '一个可检索的行政处罚文号作同类参照'],
    emotion: '共鸣',
    goal: '评论',
  };

  it('标题行声明为命题策划、无参考素材', () => {
    const b = buildStrategyBlock(bAngle);
    expect(b).toContain('命题策划，无参考素材');
  });

  it('输出硬事实约束（禁编造数字/日期/人名/案例/第一手经历）', () => {
    const b = buildStrategyBlock(bAngle);
    expect(b).toContain('事实约束');
    expect(b).toContain('禁止编造具体数字、百分比、日期、研究结论、人名、机构名、书名、引语、他人经历');
    expect(b).toContain('不得替用户编造第一手经历');
    expect(b).toContain('待补充');
    expect(b).toContain('普遍观察式表述');
  });

  it('列出 evidence_needed 待补清单', () => {
    const b = buildStrategyBlock(bAngle);
    expect(b).toContain('本角度需要用户补充的素材');
    expect(b).toContain('1. 待核实：目标城市十年居住成本区间');
    expect(b).toContain('2. 一个可检索的行政处罚文号作同类参照');
  });

  it('B 模式不提“不得沿用原文”（根本没有原文）', () => {
    expect(buildStrategyBlock(bAngle)).not.toContain('不得沿用原文');
  });

  it('B 模式仍注入立意/结构/情绪/目标', () => {
    const b = buildStrategyBlock(bAngle);
    expect(b).toContain('不愿进入低质量关系');
    expect(b).toContain('1. 开头：一张账单');
    expect(b).toContain('情绪策略');
    expect(b).toContain('内容目标');
  });

  it('evidence_needed 缺失时不编造占位标题', () => {
    const b = buildStrategyBlock({ mode: 'topic', title: 'T' });
    expect(b).not.toContain('需要用户补充的素材');
  });
});

describe('parseStrategyResult · 双模式', () => {
  const mk = (n: number) => Array(n).fill(0).map((_, i) => ({
    angle_type: `a${i}`, title: `t${i}`, core_point: `p${i}`,
  }));

  it('A 模式取 track_fit、忽略 value', () => {
    const r = parseStrategyResult({ angles: mk(3), track_fit: { matches: true, note: 'x' }, value: { worth: true } }, 'reference');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe('reference');
      expect(r.track_fit?.matches).toBe(true);
      expect(r.value).toBeNull();
    }
  });

  it('B 模式取 value、track_fit 强制为 null', () => {
    const r = parseStrategyResult({ angles: mk(3), track_fit: { matches: true }, value: { worth: false, score: '4.5', advice: '换口子' } }, 'topic');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe('topic');
      expect(r.track_fit).toBeNull();
      expect(r.value?.worth).toBe(false);
      expect(r.value?.score).toBe(4.5);
      expect(r.value?.advice).toBe('换口子');
    }
  });

  it('B 模式 angles 里的 feasibility / evidence_needed / differentiator 被保留', () => {
    const r = parseStrategyResult({
      angles: [
        { angle_type: 'a', title: 't', core_point: 'p', feasibility: '难', differentiator: '新在结论', evidence_needed: ['要一个文号', ' ', '要一段公开数据'] },
        ...mk(2),
      ],
      value: { worth: true },
    }, 'topic');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.angles[0];
      expect(a.feasibility).toBe('难');
      expect(a.differentiator).toBe('新在结论');
      expect(a.evidence_needed).toEqual(['要一个文号', '要一段公开数据']);  // 去空项
    }
  });

  it('evidence_needed 不是数组时丢弃而不是抛错', () => {
    const r = parseStrategyResult({
      angles: [{ title: 't', evidence_needed: '很多' }, ...mk(2)],
      value: {},
    }, 'topic');
    expect(r.ok).toBe(true);
    if (r.ok) expect('evidence_needed' in r.angles[0]).toBe(false);
  });

  it('默认 mode 为 reference（向后兼容旧调用）', () => {
    const r = parseAngleResult({ angles: mk(3), track_fit: { matches: false } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe('reference');
  });

  it('B 模式不足 3 个角度仍然失败', () => {
    expect(parseStrategyResult({ angles: mk(2), value: { worth: true } }, 'topic').ok).toBe(false);
  });
});

describe('buildStrategyBlock · 空值与最小输入', () => {
  it('只有 title 也能出块（最小可用）', () => {
    const b = buildStrategyBlock({ title: 'T' });
    expect(b).toContain('标题方向');
    expect(b).toContain('T');
  });

  it('空对象 / null / 无任何字段 → 空串（不污染提示词）', () => {
    expect(buildStrategyBlock(null)).toBe('');
    expect(buildStrategyBlock(undefined)).toBe('');
    expect(buildStrategyBlock({})).toBe('');
    expect(buildStrategyBlock({ anglesId: 3, index: 1 })).toBe('');  // 只有元数据不算策略
  });
});
