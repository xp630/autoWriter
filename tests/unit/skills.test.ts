/**
 * skills.cjs 单元测试
 *
 * 测试 parseFrontmatter / loadAllSkills / findSkill / buildSkillInjection
 * 这些都是纯文件 I/O + 字符串处理，无副作用，可直接 require。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require_ = createRequire(import.meta.url);

describe('skills.cjs', () => {
  describe('parseFrontmatter (via loadAllSkills)', () => {
    let skills: ReturnType<typeof require_>;
    beforeAll(() => {
      skills = require_('../../electron/skills.cjs');
    });

    it('应该加载 channels 和 personas 两个目录', () => {
      const result = skills.loadAllSkills();
      expect(result).toHaveProperty('channels');
      expect(result).toHaveProperty('personas');
      expect(Array.isArray(result.channels)).toBe(true);
      expect(Array.isArray(result.personas)).toBe(true);
    });

    it('每个 skill 应有 name/path/frontmatter/body', () => {
      const { channels, personas } = skills.loadAllSkills();
      const all = [...channels, ...personas];
      // 测试夹具不一定有 skill，跳过空仓
      if (all.length === 0) return;
      for (const s of all) {
        expect(s).toHaveProperty('name');
        expect(s).toHaveProperty('path');
        expect(s).toHaveProperty('frontmatter');
        expect(s).toHaveProperty('body');
        expect(s.frontmatter.name).toBeTruthy();
      }
    });
  });

  describe('findSkill', () => {
    let skills: ReturnType<typeof require_>;
    beforeAll(() => {
      skills = require_('../../electron/skills.cjs');
    });

    it('不存在的 skill 返回 null', () => {
      const result = skills.findSkill('non-existent-skill-xxx', 'persona');
      expect(result).toBeNull();
    });
  });

  describe('buildSkillInjection', () => {
    let skills: ReturnType<typeof require_>;
    beforeAll(() => {
      skills = require_('../../electron/skills.cjs');
    });

    it('空参数返回空字符串', () => {
      const result = skills.buildSkillInjection({});
      expect(result).toBe('');
    });

    it('不存在的 skill 静默忽略（不抛错）', () => {
      const result = skills.buildSkillInjection({ persona: 'nope', channel: 'nope' });
      expect(result).toBe('');
    });

    it('存在的 skill 拼接正文', () => {
      // 临时建一个 skill 目录
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
      const tmpChannels = path.join(tmpRoot, 'channels', 'test-channel');
      const tmpPersonas = path.join(tmpRoot, 'personas', 'test-persona');
      fs.mkdirSync(tmpChannels, { recursive: true });
      fs.mkdirSync(tmpPersonas, { recursive: true });
      fs.writeFileSync(
        path.join(tmpChannels, 'SKILL.md'),
        '---\nname: test-channel\ndisplayName: 测试渠道\n---\nChannel body content',
      );
      fs.writeFileSync(
        path.join(tmpPersonas, 'SKILL.md'),
        '---\nname: test-persona\ndisplayName: 测试人设\n---\nPersona body content',
      );

      // mock skillsRoot —— 通过环境变量劫持（更干净：临时 patch module 内部变量）
      // 这里采用复制真实 skill 到一个临时目录，让 findSkill 直接读到目标
      const realRoot = path.resolve(__dirname, '../../src/skills');
      const realCh = path.join(realRoot, 'channels', 'test-channel');
      const realPe = path.join(realRoot, 'personas', 'test-persona');
      const cleanup: Array<() => void> = [];
      if (!fs.existsSync(realCh)) {
        fs.mkdirSync(realCh, { recursive: true });
        fs.writeFileSync(path.join(realCh, 'SKILL.md'), '---\nname: test-channel\ndisplayName: 测试渠道\n---\nChannel body content');
        cleanup.push(() => fs.rmSync(realCh, { recursive: true, force: true }));
      }
      if (!fs.existsSync(realPe)) {
        fs.mkdirSync(realPe, { recursive: true });
        fs.writeFileSync(path.join(realPe, 'SKILL.md'), '---\nname: test-persona\ndisplayName: 测试人设\n---\nPersona body content');
        cleanup.push(() => fs.rmSync(realPe, { recursive: true, force: true }));
      }

      try {
        const result = skills.buildSkillInjection({ persona: 'test-persona', channel: 'test-channel' });
        expect(result).toContain('测试人设');
        expect(result).toContain('Persona body content');
        expect(result).toContain('测试渠道');
        expect(result).toContain('Channel body content');
      } finally {
        cleanup.forEach((fn) => fn());
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  });
});

// ===== 架构统一守卫（2026-09-02）：所有 skill 走 skills.cjs 注册表 =====
// 之前 analysis.cjs 里 4 个 load*Skill 各自拼路径——新增一类 skill 要在两处改。
// 现在统一进 KIND_DIRS：新 kind 只需在 skills.cjs 加一行目录映射。
import { describe as d2, it as i2, expect as e2 } from 'vitest';
d2('skill 架构统一', () => {
  const path2 = require('node:path');
  const skills = require(path2.resolve(__dirname, '../../electron/skills.cjs'));
  const analysis = require(path2.resolve(__dirname, '../../electron/analysis.cjs'));

  i2('interview 与 strategy 类 skill 经统一出口可读', () => {
    const iv = skills.findSkill('idea-interview', 'interview');
    expect(iv).toBeTruthy();
    expect(iv!.body).toContain('Idea Interview');
    const ang = skills.findSkill('angle-generation', 'strategy');
    expect(ang).toBeTruthy();
  });

  i2('analysis.cjs 的 4 个 loader 均委托 loadSkillBody（不再自建路径）', () => {
    // 行为等价：loader 输出 === 注册表输出
    expect(analysis.loadInterviewSkill()).toBe(skills.loadSkillBody('interview', 'idea-interview'));
    expect(analysis.loadAngleSkill()).toBe(skills.loadSkillBody('strategy', 'angle-generation'));
    expect(analysis.loadTopicSkill()).toBe(skills.loadSkillBody('strategy', 'topic-planning'));
    expect(analysis.loadAnalysisSkill()).toBe(skills.loadSkillBody('analysis', 'content-analysis'));
  });

  i2('未知 kind 返回 null；loadSkillBody 找不到抛错', () => {
    expect(skills.findSkill('x', 'bogus-kind')).toBeNull();
    expect(() => skills.loadSkillBody('interview', 'nonexistent-skill')).toThrow(/Skill not found/);
  });
});
