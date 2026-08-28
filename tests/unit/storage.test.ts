// Storage utility unit tests
// 验证：getter / setter / 默认值 / 类型守卫 / 版本迁移 / 错误处理
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAgentSettings, setAgentSettings,
  getImageSettings, setImageSettings,
  getOpenArticleId, setOpenArticleId,
  getDraft, setDraft, clearDraft,
  listAwKeys,
} from '../../src/utils/storage';

describe('storage — agent settings', () => {
  beforeEach(() => localStorage.clear());

  it('默认返回 DEFAULT (claude + 空 model)', () => {
    expect(getAgentSettings()).toEqual({ cli: 'claude', model: '' });
  });

  it('set 后 get 能取回', () => {
    setAgentSettings({ cli: 'pi', model: 'some-model' });
    expect(getAgentSettings()).toEqual({ cli: 'pi', model: 'some-model' });
  });

  it('cli 不合法时降级到默认', () => {
    localStorage.setItem('aw_settings', JSON.stringify({ cli: 'invalid-cli', model: 'x' }));
    expect(getAgentSettings().cli).toBe('claude');
  });

  it('损坏的 JSON 不抛错', () => {
    localStorage.setItem('aw_settings', 'not valid json');
    expect(getAgentSettings()).toEqual({ cli: 'claude', model: '' });
  });
});

describe('storage — image settings', () => {
  beforeEach(() => localStorage.clear());

  it('默认空', () => {
    expect(getImageSettings()).toEqual({ provider: '', model: '' });
  });

  it('set / get 往返', () => {
    setImageSettings({ provider: 'tensorart', model: 'flux-schnell' });
    expect(getImageSettings()).toEqual({ provider: 'tensorart', model: 'flux-schnell' });
  });
});

describe('storage — open article id', () => {
  beforeEach(() => localStorage.clear());

  it('默认 null', () => {
    expect(getOpenArticleId()).toBeNull();
  });

  it('set 后 get 返数字', () => {
    setOpenArticleId(42);
    expect(getOpenArticleId()).toBe(42);
  });

  it('set null 清掉 key', () => {
    setOpenArticleId(42);
    setOpenArticleId(null);
    expect(getOpenArticleId()).toBeNull();
    expect(localStorage.getItem('aw_open_article')).toBeNull();
  });

  it('非法值（非数字/0/负）返回 null', () => {
    localStorage.setItem('aw_open_article', JSON.stringify(-5));
    expect(getOpenArticleId()).toBeNull();
    localStorage.setItem('aw_open_article', JSON.stringify('not-a-number'));
    expect(getOpenArticleId()).toBeNull();
  });
});

describe('storage — draft (草稿自动保存)', () => {
  beforeEach(() => localStorage.clear());

  it('默认 null（无草稿）', () => {
    expect(getDraft()).toBeNull();
  });

  it('set 后 get 返草稿', () => {
    const draft = {
      query: '测试主题',
      referenceUrl: 'https://example.com',
      referenceText: '正文...',
      outline: '## 大纲',
      outlineDirty: true,
      channel: 'wechat',
      persona: 'warm_storyteller',
      style: 'tech',
      length: 'medium',
      needImage: true,
    };
    setDraft(draft);
    const loaded = getDraft();
    expect(loaded?.query).toBe('测试主题');
    expect(loaded?.outline).toBe('## 大纲');
    expect(loaded?.savedAt).toBeGreaterThan(0);
  });

  it('版本不匹配返回 null（迁移保护）', () => {
    localStorage.setItem('aw_draft', JSON.stringify({ v: 999, query: 'old' }));
    expect(getDraft()).toBeNull();
  });

  it('字段类型不对时降级', () => {
    localStorage.setItem('aw_draft', JSON.stringify({
      v: 1,
      query: 12345,                // 应该是 string，降级到 ''
      outlineDirty: 'yes',         // 字符串通过 !! 变成 true（JS 行为，文档化）
      channel: 'wechat',
      needImage: 0,                // 非 boolean，降级到默认 true
    }));
    const loaded = getDraft();
    expect(loaded?.query).toBe('');
    expect(loaded?.outlineDirty).toBe(true);   // !!'yes' === true
    expect(loaded?.channel).toBe('wechat');
    expect(loaded?.needImage).toBe(true);      // 默认 true
  });

  it('clearDraft 真的清除', () => {
    setDraft({ query: 'x', referenceUrl: '', referenceText: '', outline: '', outlineDirty: false, channel: 'wechat', persona: '', style: 'tech', length: 'medium', needImage: true });
    expect(getDraft()).not.toBeNull();
    clearDraft();
    expect(getDraft()).toBeNull();
  });
});

describe('storage — listAwKeys (调试)', () => {
  beforeEach(() => localStorage.clear());

  it('列出所有 aw_* key + 解析后的值', () => {
    setAgentSettings({ cli: 'pi', model: '' });
    setDraft({ query: 'q', referenceUrl: '', referenceText: '', outline: '', outlineDirty: false, channel: 'wechat', persona: '', style: 'tech', length: 'medium', needImage: true });
    const all = listAwKeys();
    expect(all).toHaveProperty('aw_settings');
    expect(all).toHaveProperty('aw_draft');
    expect(all).not.toHaveProperty('non_aw_key');
  });
});

describe('storage — 损坏数据容错', () => {
  beforeEach(() => localStorage.clear());

  it('JSON.parse 报错时返默认值（不抛）', () => {
    localStorage.setItem('aw_settings', '{garbage');
    expect(() => getAgentSettings()).not.toThrow();
    expect(getAgentSettings()).toEqual({ cli: 'claude', model: '' });
  });

  it('localStorage.setItem 报错时静默吞（不抛）', () => {
    const origSetItem = (globalThis as any).localStorage.setItem;
    (globalThis as any).localStorage.setItem = () => { throw new Error('quota exceeded'); };
    expect(() => setAgentSettings({ cli: 'pi', model: '' })).not.toThrow();
    (globalThis as any).localStorage.setItem = origSetItem;
  });
});