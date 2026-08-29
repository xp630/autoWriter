// 本地存储统一封装
// 所有 localStorage 读写都走这里。身份（Profile）是新的核心概念：
// 一个「创作身份」打包 赛道 + 人设 + 默认风格/渠道 + Agent/模型，顶栏可切换。
// getAgentSettings/setAgentSettings 保持兼容：它们读写「当前身份」。

const KEYS = {
  agentSettings: 'aw_settings',   // 旧版兼容（首次迁移到 profile）
  profiles: 'aw_profiles',
  activeProfile: 'aw_active_profile',
  imageSettings: 'aw_image_settings',
  openArticle: 'aw_open_article',
  draft: 'aw_draft',
} as const;

// ============================================================================
// 常量：赛道列表（选题领域，与风格/人设/渠道正交）
// ============================================================================

export const TRACK_OPTIONS = [
  { value: '生活日常', hint: '生活琐事、居家、日常记录' },
  { value: '情感随笔', hint: '感悟、情绪、人际、人生体会' },
  { value: '社会观察', hint: '热点时事、现象解读、公共议题' },
  { value: 'AI 与科技', hint: 'AI、大模型、互联网、硬件' },
  { value: '软件工具', hint: '效率工具、编程、产品教程' },
  { value: '职场成长', hint: '职场、副业、个人成长' },
  { value: '育儿家庭', hint: '亲子、教育、家庭关系' },
  { value: '美食', hint: '探店、菜谱、吃' },
  { value: '旅行', hint: '游记、攻略、风景' },
  { value: '穿搭美妆', hint: '时尚、护肤、好物' },
  { value: '财经理财', hint: '投资、消费、经济' },
  { value: '健康健身', hint: '养生、运动、身心' },
  { value: '读书影视', hint: '书评、影评、文化' },
] as const;

const CLI_LIST = ['pi', 'claude', 'opencode', 'codex'];

// ============================================================================
// 类型
// ============================================================================

export type CliKind = 'pi' | 'claude' | 'opencode' | 'codex';

/** 兼容旧代码的 Agent 设置形状（实际来自当前身份） */
export interface AgentSettings {
  cli: CliKind;
  model: string;
  track: string;
  persona: string;
}

/** 创作身份：账号级配置包 */
export interface CreatorProfile {
  id: string;
  name: string;
  emoji: string;
  color: string;
  track: string;             // 赛道
  persona: string;           // 人设（skill name）
  defaultStyle: string;      // 默认风格 tech/news/opinion/story/knowledge
  defaultChannel: string;    // 默认渠道 wechat/xiaohongshu/...
  cli: CliKind;              // Agent CLI
  model: string;             // 模型
  createdAt?: number;
}

export interface ImageSettings {
  provider: string;
  model: string;
}

export interface DraftState {
  query: string;
  referenceUrl: string;
  referenceText: string;
  outline: string;
  outlineDirty: boolean;
  channel: string;
  /** @deprecated 人设升级为身份级，草稿不再保存 */
  persona?: string;
  style: string;
  length: string;
  needImage: boolean;
  /** V2.2：补上上次会话的分析 / 策略状态，避免「参考文回来了但分析丢了」的不对称 */
  analysis?: any | null;
  analysisId?: number | null;
  strategy?: any | null;
  angles?: any | null;
  step?: number;
  savedAt?: number;
}

const DEFAULT_IMAGE: ImageSettings = { provider: '', model: '' };

// ============================================================================
// 安全读写 + 订阅
// ============================================================================

function safeGet<T>(key: string, fallback: T, parse: (raw: any) => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(JSON.parse(raw));
  } catch (err) {
    console.warn(`[storage] failed to parse ${key}, using fallback:`, err);
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[storage] failed to write ${key}:`, err);
  }
}

// 简单的发布订阅：身份/列表变化时通知订阅者（供 useSyncExternalStore 用）
const listeners = new Set<() => void>();
function emitProfiles() { listeners.forEach((fn) => { try { fn(); } catch {} }); }
export function subscribeProfiles(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function sanitizeCli(v: any): CliKind {
  return CLI_LIST.includes(v) ? v : 'claude';
}

// ============================================================================
// 身份（Profile）层
// ============================================================================

const DEFAULT_PROFILE: CreatorProfile = {
  id: 'p_default', name: '默认身份', emoji: '🧑', color: '#10b981',
  track: '', persona: '', defaultStyle: 'tech', defaultChannel: 'wechat',
  cli: 'claude', model: '', createdAt: Date.now(),
};

function normalizeProfile(raw: any): CreatorProfile | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '未命名身份',
    emoji: typeof raw.emoji === 'string' ? raw.emoji : '🧑',
    color: typeof raw.color === 'string' ? raw.color : '#10b981',
    track: typeof raw.track === 'string' ? raw.track : '',
    persona: typeof raw.persona === 'string' ? raw.persona : '',
    defaultStyle: typeof raw.defaultStyle === 'string' ? raw.defaultStyle : 'tech',
    defaultChannel: typeof raw.defaultChannel === 'string' ? raw.defaultChannel : 'wechat',
    cli: sanitizeCli(raw.cli),
    model: typeof raw.model === 'string' ? raw.model : '',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

function readProfilesRaw(): CreatorProfile[] {
  return safeGet<CreatorProfile[]>(KEYS.profiles, [], (raw) =>
    Array.isArray(raw) ? raw.map(normalizeProfile).filter(Boolean) as CreatorProfile[] : [],
  );
}

/** 首次运行：从旧版 aw_settings 迁移出「默认身份」 */
function migrateFromLegacy(): CreatorProfile {
  const legacy = safeGet(KEYS.agentSettings, null as any, (raw) => raw);
  return {
    ...DEFAULT_PROFILE,
    cli: sanitizeCli(legacy?.cli),
    model: typeof legacy?.model === 'string' ? legacy.model : '',
    track: typeof legacy?.track === 'string' ? legacy.track : '',
    persona: typeof legacy?.persona === 'string' ? legacy.persona : '',
  };
}

function ensureSeeded(): CreatorProfile[] {
  let list = readProfilesRaw();
  if (list.length === 0) {
    const seeded = [migrateFromLegacy()];
    safeSet(KEYS.profiles, seeded);
    safeSet(KEYS.activeProfile, seeded[0].id);
    return seeded;
  }
  return list;
}

export function listProfiles(): CreatorProfile[] {
  return ensureSeeded();
}

export function getActiveProfileId(): string {
  const list = ensureSeeded();
  const id = safeGet<string>(KEYS.activeProfile, '', (v) => (typeof v === 'string' ? v : ''));
  return list.find((p) => p.id === id) ? id : list[0].id;
}

export function setActiveProfileId(id: string): void {
  safeSet(KEYS.activeProfile, id);
  emitProfiles();
}

export function getActiveProfile(): CreatorProfile {
  const list = ensureSeeded();
  const id = getActiveProfileId();
  return list.find((p) => p.id === id) || list[0];
}

export function updateActiveProfile(patch: Partial<CreatorProfile>): void {
  const list = ensureSeeded();
  const id = getActiveProfileId();
  const next = list.map((p) => (p.id === id ? normalizeProfile({ ...p, ...patch, id: p.id })! : p));
  safeSet(KEYS.profiles, next);
  emitProfiles();
}

const PALETTE = ['#10b981', '#f59e0b', '#5e8bff', '#8b5cf6', '#ef4444', '#14b8a6', '#e11d48'];

export function addProfile(partial: Partial<CreatorProfile> = {}): CreatorProfile {
  const list = ensureSeeded();
  const created: CreatorProfile = {
    ...DEFAULT_PROFILE,
    id: 'p_' + Date.now().toString(36),
    name: partial.name || `身份 ${list.length + 1}`,
    color: partial.color || PALETTE[list.length % PALETTE.length],
    ...partial,
    cli: sanitizeCli(partial.cli),
    createdAt: Date.now(),
  };
  safeSet(KEYS.profiles, [...list, created]);
  safeSet(KEYS.activeProfile, created.id);
  emitProfiles();
  return created;
}

export function deleteProfile(id: string): void {
  const list = ensureSeeded();
  if (list.length <= 1) return; // 至少保留一个身份
  const next = list.filter((p) => p.id !== id);
  safeSet(KEYS.profiles, next);
  if (getActiveProfileId() === id) safeSet(KEYS.activeProfile, next[0].id);
  emitProfiles();
}

// ============================================================================
// Agent 设置（兼容层：实际读写当前身份）
// ============================================================================

export function getAgentSettings(): AgentSettings {
  const p = getActiveProfile();
  return { cli: p.cli, model: p.model, track: p.track, persona: p.persona };
}

export function setAgentSettings(s: AgentSettings): void {
  updateActiveProfile({ cli: sanitizeCli(s.cli), model: s.model, track: s.track, persona: s.persona });
}

// ============================================================================
// 图片生图设置（provider + model）
// ============================================================================

export function getImageSettings(): ImageSettings {
  return safeGet(KEYS.imageSettings, DEFAULT_IMAGE, (raw) => ({
    provider: typeof raw?.provider === 'string' ? raw.provider : '',
    model: typeof raw?.model === 'string' ? raw.model : '',
  }));
}

export function setImageSettings(s: ImageSettings): void {
  safeSet(KEYS.imageSettings, s);
}

// ============================================================================
// 跨页面「打开指定文章」标识
// ============================================================================

export function getOpenArticleId(): number | null {
  return safeGet<number | null>(KEYS.openArticle, null, (raw) =>
    typeof raw === 'number' && raw > 0 ? raw : null
  );
}

export function setOpenArticleId(id: number | null): void {
  if (id === null) {
    try { localStorage.removeItem(KEYS.openArticle); } catch {}
  } else {
    safeSet(KEYS.openArticle, id);
  }
}

// ============================================================================
// WritePage 草稿（刷新不丢）
// ============================================================================

const DRAFT_VERSION = 2;  // v2：加上 analysis/strategy/angles/step，修旧 v1 不全的会丢

export function getDraft(): DraftState | null {
  return safeGet<DraftState | null>(KEYS.draft, null, (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.v !== 'number' || raw.v !== DRAFT_VERSION) return null;
    return {
      query: typeof raw.query === 'string' ? raw.query : '',
      referenceUrl: typeof raw.referenceUrl === 'string' ? raw.referenceUrl : '',
      referenceText: typeof raw.referenceText === 'string' ? raw.referenceText : '',
      outline: typeof raw.outline === 'string' ? raw.outline : '',
      outlineDirty: !!raw.outlineDirty,
      channel: typeof raw.channel === 'string' ? raw.channel : 'wechat',
      style: typeof raw.style === 'string' ? raw.style : 'tech',
      length: typeof raw.length === 'string' ? raw.length : 'medium',
      needImage: typeof raw.needImage === 'boolean' ? raw.needImage : true,
      analysis: raw.analysis ?? null,
      analysisId: typeof raw.analysisId === 'number' ? raw.analysisId : null,
      strategy: raw.strategy ?? null,
      angles: raw.angles ?? null,
      step: typeof raw.step === 'number' ? raw.step : undefined,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : undefined,
    };
  });
}

export function setDraft(d: DraftState): void {
  safeSet(KEYS.draft, { v: DRAFT_VERSION, ...d, savedAt: Date.now() });
}

export function clearDraft(): void {
  try { localStorage.removeItem(KEYS.draft); } catch {}
}

/** 是否有未清理的草稿（按钮可见性用——避免反序列化全表） */
export function hasDraft(): boolean {
  try { return localStorage.getItem(KEYS.draft) !== null; } catch { return false; }
}

// ============================================================================
// 调试
// ============================================================================

export function listAwKeys(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('aw_')) {
        try { out[k] = JSON.parse(localStorage.getItem(k) || 'null'); }
        catch { out[k] = localStorage.getItem(k); }
      }
    }
  } catch {}
  return out;
}
