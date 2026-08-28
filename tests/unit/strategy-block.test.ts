// P0-2 策略进入写作：角度归一化（推荐指数/情绪/目标）+ strategyBlock 渲染
import { describe, it, expect } from 'vitest';
import { parseAngleResult, normalizeAngle, buildStrategyBlock } from '../../electron/analysis.cjs';

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
    expect(b).toContain('按上面指定的角度、情绪、目标来写');
    expect(b).not.toContain('文章立意');
  });

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
