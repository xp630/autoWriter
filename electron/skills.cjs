// Skill 加载器 — 启动时扫描 src/skills/ 目录
const fs = require('node:fs');
const path = require('node:path');

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: { name: '' }, body: raw };
  const yaml = m[1];
  const body = m[2].trim();
  const frontmatter = { name: '' };
  for (const line of yaml.split('\n')) {
    const lm = line.match(/^([\w-]+):\s*(.*)$/);
    if (!lm) continue;
    const key = lm[1];
    let value = lm[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      // 数组值：[a, b, c] → ["a", "b", "c"]
      value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (value.startsWith('"') || value.startsWith("'")) {
      value = value.replace(/^["']|["']$/g, '');
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function loadSkillsInDir(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const raw = fs.readFileSync(skillFile, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);
    if (!frontmatter.name) continue;
    out.push({ kind: path.basename(dir), name: frontmatter.name, path: skillFile, frontmatter, body });
  }
  return out;
}

function loadAllSkills() {
  // 相对于 electron/ 同级的 src/skills/
  const skillsRoot = path.resolve(__dirname, '..', 'src', 'skills');
  return {
    channels: loadSkillsInDir(path.join(skillsRoot, 'channels')),
    personas: loadSkillsInDir(path.join(skillsRoot, 'personas')),
    analysis: loadSkillsInDir(path.join(skillsRoot, 'analysis')),
  };
}

// kind → 目录的统一映射（之前只认 channel/analysis/persona——strategy/interview 没进表，
// 逼得 analysis.cjs 里 4 个 load*Skill 各自拼路径、各自剥 frontmatter，重复且易漂移）
const KIND_DIRS = {
  channel: 'channels', persona: 'personas', analysis: 'analysis',
  strategy: 'strategy', interview: 'interview',
};

function findSkill(name, kind) {
  const skillsRoot = path.resolve(__dirname, '..', 'src', 'skills');
  const dirName = KIND_DIRS[kind];
  if (!dirName) return null;
  const skillFile = path.join(skillsRoot, dirName, name, 'SKILL.md');
  if (!fs.existsSync(skillFile)) return null;
  const raw = fs.readFileSync(skillFile, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);
  return { kind, name, path: skillFile, frontmatter, body };
}

/** 所有 loader 的统一出口：按 kind+name 读 skill 正文（已剥 frontmatter）。找不到抛错。 */
function loadSkillBody(kind, name) {
  const skill = findSkill(name, kind);
  if (!skill) throw new Error(`Skill not found: ${kind}/${name}`);
  return skill.body;
}

function buildSkillInjection({ channel, persona }) {
  const parts = [];
  if (persona) {
    const p = findSkill(persona, 'persona');
    if (p) parts.push(`## 写作人设：${p.frontmatter.displayName || p.name}\n${p.body}`);
  }
  if (channel) {
    const c = findSkill(channel, 'channel');
    if (c) parts.push(`## 发布渠道：${c.frontmatter.displayName || c.name}\n${c.body}`);
  }
  return parts.join('\n\n---\n\n');
}

module.exports = { loadAllSkills, findSkill, buildSkillInjection, loadSkillBody };