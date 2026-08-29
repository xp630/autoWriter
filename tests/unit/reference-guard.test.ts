// referenceGuard 单测：约束输入 —— 烂输入不该有资格消耗一次 AI 调用
import { describe, it, expect } from 'vitest';
import { assessReference, referenceQualityNote, MIN_REFERENCE_CHARS } from '../../src/utils/referenceGuard';

/** 一段够长、像正文的中文样本 */
const REAL = '文章标题\n\n'
  + '这里是一段真实存在的正文内容，它讨论的是轻量模型与贵价模型之间如何取舍，'
  + '并给出了四个可操作的判断问题：能否机器校验、错一次代价多大、有没有更便宜的能过、谁来兜底。'
  + '回答完这四问，多数场景都能落到一个够用档，真正答不上来的才需要留给贵价去解决。'
  + '贵的从来不是调用费，而是你为了怕不够好所花的排查时间，这笔账从来不体现在发票上。'
  + '更常见的情况是你并不知道便宜档能不能过，于是默认全用贵的，这个默认值本身就很值钱。';

describe('assessReference · 判可用', () => {
  it('正常正文 → 可用', () => {
    const a = assessReference(REAL);
    expect(a.usable).toBe(true);
    expect(a.chars).toBeGreaterThanOrEqual(MIN_REFERENCE_CHARS);
    expect(a.reason).toBeUndefined();
  });
});

describe('assessReference · 判不可用', () => {
  it('空 / null → 不可用，并给出下一步', () => {
    for (const t of ['', null, undefined, '   \n ']) {
      const a = assessReference(t as string);
      expect(a.usable).toBe(false);
      expect(a.hint).toContain('粘贴');
    }
  });

  it('抓取失败的错误文案 → 必须判为不可用（这条是本模块存在的理由）', () => {
    const err = `# 抓取失败\n\nURL：https://mp.weixin.qq.com/s/xxx\n错误：403 Forbidden\n\n请改用「参考文本」字段直接粘贴`;
    const a = assessReference(err);
    expect(a.usable).toBe(false);
    expect(a.reason).toContain('抓回来的不像正文');
  });

  it('各类反爬/登录墙文案都不给过', () => {
    const pages = [
      '安全验证 请输入验证码 以确认您不是机器人 ' + '。'.repeat(300),
      '请登录 后查看完整内容 扫码登录 ' + '。'.repeat(300),
      'This page is Access Denied 403 Forbidden ' + 'x'.repeat(300),
      'robots.txt 反爬策略已触发 请稍后再试 ' + '。'.repeat(300),
    ];
    for (const p of pages) expect(assessReference(p).usable, p.slice(0, 18)).toBe(false);
  });

  it('错误特征优先于长度：够长也不给过', () => {
    const long = ('抓取失败 请检查链接是否可访问 ' + REAL).repeat(2);
    expect(assessReference(long).chars).toBeGreaterThan(MIN_REFERENCE_CHARS);
    expect(assessReference(long).usable).toBe(false);
  });

  it('过短 → 不可用，并引导改用命题策划', () => {
    const a = assessReference('AI 发展很快，企业都在应用。');
    expect(a.usable).toBe(false);
    expect(a.reason).toContain('只有');
    expect(a.hint).toContain('命题策划');
  });

  it('重复字符堆长度不算内容（200 个"很"骗不过去）', () => {
    expect(assessReference('很'.repeat(400)).usable).toBe(false);
    expect(assessReference('哈哈哈哈'.repeat(80)).usable).toBe(false);
  });

  it('目录页/列表页：短 + 导航噪声密集 → 不可用', () => {
    const nav = '下一篇 查看更多 热门标签 扫码关注 ' + '这里只有一些标题文字没有正文内容哦'.repeat(12);
    const a = assessReference(nav);
    expect(a.chars).toBeLessThan(500);
    expect(a.usable).toBe(false);
    expect(a.reason).toContain('目录页');
  });

  it('长文里出现"下一篇/广告"不误伤（只有短文本才按目录页判）', () => {
    const longWithNav = REAL + REAL + '\n下一篇：另一篇文章\n';
    expect(assessReference(longWithNav).usable).toBe(true);
  });
});

describe('referenceQualityNote', () => {
  it('不可用时给出原因', () => {
    expect(referenceQualityNote('太短')).toContain('只有');
  });
  it('超长正常文本提示只取前 3000 字', () => {
    expect(referenceQualityNote(REAL.repeat(90))).toContain('前 3000 字');
  });
  it('普通长度合格文本不给多余提示', () => {
    expect(referenceQualityNote(REAL)).toBeNull();
  });
});
