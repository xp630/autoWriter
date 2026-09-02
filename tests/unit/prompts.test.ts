/**
 * prompts.cjs 单元测试
 *
 * 测试 renderPrompt：
 *  - 模板读取
 *  - {{变量}} 替换
 *  - 不存在模板抛错
 *  - 热加载行为（同进程改文件下次读取生效）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require_ = createRequire(import.meta.url);

describe('prompts.cjs', () => {
  let prompts: ReturnType<typeof require_>;
  beforeAll(() => {
    prompts = require_('../../electron/prompts.cjs');
  });

  it('PROMPTS_DIR 指向 src/prompts', () => {
    expect(prompts.PROMPTS_DIR).toMatch(/src\/prompts$/);
  });

  it('渲染 article 模板（无变量）', () => {
    const out = prompts.renderPrompt('article', {});
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('渲染 outline 模板（带变量）', () => {
    const out = prompts.renderPrompt('outline', {
      titleHint: 'AI 写作的未来',
      keywords: 'AI, writing, automation',
    });
    expect(out).toContain('AI 写作的未来');
    expect(out).toContain('AI, writing, automation');
  });

  it('提供的变量会被 {{xxx}} 替换（验证替换机制）', () => {
    const out = prompts.renderPrompt('outline', {
      titleHint: 'X',
      keywords: 'kw',
    });
    // 提供过的 {{titleHint}} 和 {{keywords}} 必然被替换
    expect(out).not.toContain('{{titleHint}}');
    expect(out).not.toContain('{{keywords}}');
    // 但模板里其它变量（{{styleDesc}} 等）保持原样（当前行为）
    expect(out).toContain('{{styleDesc}}');
  });

  it('不存在的模板抛错', () => {
    expect(() => prompts.renderPrompt('non-existent-template-xxx', {})).toThrow(/Prompt 模板不存在/);
  });

  it('热加载：写一个新模板文件后立即生效', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-'));
    const originalDir = prompts.PROMPTS_DIR;

    // 通过 fs 写入到 PROMPTS_DIR（不能改模块内部常量，但 renderPrompt 直接拼路径）
    const realPath = path.join(originalDir, '_test_hot.md');
    fs.writeFileSync(realPath, 'Hot template: {{name}}');

    try {
      const out = prompts.renderPrompt('_test_hot', { name: 'world' });
      expect(out).toBe('Hot template: world');
    } finally {
      fs.unlinkSync(realPath);
    }
  });

  it('渲染 ep-extract 模板（Task 4 抽取契约）', () => {
    const out = prompts.renderPrompt('ep-extract', { slotState: '{}', evidence: '无', answer: 'x' });
    expect(out).toContain('只提取用户明确表达的');
    expect(out).toContain('不允许出现');
    // 五档 kind 名（英文码 + 中文档名都在契约里）
    for (const en of ['fact', 'experience', 'judgment', 'speculation', 'unknown']) expect(out).toContain(en);
    for (const zh of ['事实', '经历', '判断', '推测', '未知']) expect(out).toContain(zh);
    // 提供的三个变量都被替换，无残留
    expect(out).not.toContain('{{slotState}}');
    expect(out).not.toContain('{{evidence}}');
    expect(out).not.toContain('{{answer}}');
  });

  it('返回值去除首尾空白', () => {
    const realPath = path.join(prompts.PROMPTS_DIR, '_test_trim.md');
    fs.writeFileSync(realPath, '\n\n  content  \n\n');
    try {
      expect(prompts.renderPrompt('_test_trim', {})).toBe('content');
    } finally {
      fs.unlinkSync(realPath);
    }
  });
});
