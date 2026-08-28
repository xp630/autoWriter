import { describe, it, expect } from 'vitest';
import { parseAngleResult } from '../../electron/analysis.cjs';

describe('parseAngleResult', () => {
  it('解析完整角度 JSON（5 方向 + track_fit）', () => {
    const r = parseAngleResult({
      angles: [
        { angle_type: '女性成长视角', title: '标题1', core_point: '观点1', target_user: '25-35', structure: ['钩子', '论点'], reason: '好' },
        { angle_type: '反常识视角', title: '标题2', core_point: '观点2' },
        { angle_type: '故事案例视角', title: '标题3', core_point: '观点3' },
        { angle_type: '数据深度视角', title: '标题4', core_point: '观点4' },
        { angle_type: '社会观察视角', title: '标题5', core_point: '观点5' },
      ],
      track_fit: { score: 8, reason: '赛道一致' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.strategies.length).toBe(5);
      expect(r.track_fit?.score).toBe(8);   // V2：track_fit 从 matches/note 换成 score/reason
    }
  });

  it('track_fit 缺失不致命', () => {
    const r = parseAngleResult({
      angles: [
        { angle_type: 'a', title: 't1', core_point: 'p1' },
        { angle_type: 'b', title: 't2', core_point: 'p2' },
        { angle_type: 'c', title: 't3', core_point: 'p3' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.strategies.length).toBe(3);
      expect(r.track_fit).toBeNull();
    }
  });

  it('angles 不足 3 个 → 失败', () => {
    const r = parseAngleResult({ angles: [{ angle_type: 'a', title: 't', core_point: 'p' }] });
    expect(r.ok).toBe(false);
  });

  it('angles 不是数组 → 失败', () => {
    const r = parseAngleResult({ angles: 'not array' });
    expect(r.ok).toBe(false);
  });

  it('空数据 / 非对象 → 失败', () => {
    expect(parseAngleResult(null).ok).toBe(false);
    expect(parseAngleResult({}).ok).toBe(false);
  });

  it('含 track_fit.matches=false 不影响 5 方向返回', () => {
    const r = parseAngleResult({
      angles: Array(5).fill({ angle_type: 'x', title: 't', core_point: 'p' }),
      track_fit: { matches: false, article_track: '财经', user_track: '情感随笔', note: '不匹配' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.strategies.length).toBe(5);
      // 旧形状 matches:false 会被折算成低分，而不是丢字段
      expect(r.track_fit?.score).toBe(3);
    }
  });
});
