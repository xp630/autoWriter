// 本地存储统一封装
// 所有 localStorage 读写都走这里，避免散落在 5 个文件 11 处直接 JSON.parse
// Schema 变化时只改这一处，其他文件零改动

const KEYS = {
  agentSettings: 'aw_settings',
  imageSettings: 'aw_image_settings',
  openArticle: 'aw_open_article',
  draft: 'aw_draft',
} as const;

// ============================================================================
// 类型定义（与实际存储的 JSON 形状对齐）
// ============================================================================

export interface AgentSettings {
  cli: 'pi' | 'claude' | 'opencode' | 'codex';
  model: string;
}

export interface ImageSettings {
  provider: string;   // pollinations / tensorart / ideogram / ''
  model: string;
}

export interface DraftState {
  query: string;
  referenceUrl: string;
  referenceText: string;
  outline: string;
  outlineDirty: boolean;
  channel: string;
  persona: string;
  style: string;
  length: string;
  needImage: boolean;
  // 不保存 result（content 可能很大，且文章入库后就不再需要）
  savedAt?: number;
}

const DEFAULT_AGENT: AgentSettings = { cli: 'claude', model: '' };
const DEFAULT_IMAGE: ImageSettings = { provider: '', model: '' };

// ============================================================================
// 安全读写工具
// ============================================================================

function safeGet<T>(key: string, fallback: T, parse: (raw: any) => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
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

// ============================================================================
// Agent 设置（CLI + model）
// ============================================================================

export function getAgentSettings(): AgentSettings {
  return safeGet(KEYS.agentSettings, DEFAULT_AGENT, (raw) => ({
    cli: raw?.cli && ['pi', 'claude', 'opencode', 'codex'].includes(raw.cli) ? raw.cli : DEFAULT_AGENT.cli,
    model: typeof raw?.model === 'string' ? raw.model : '',
  }));
}

export function setAgentSettings(s: AgentSettings): void {
  safeSet(KEYS.agentSettings, s);
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
// WritePage 草稿（query / outline / 设置 等，刷新不丢）
// ============================================================================

const DRAFT_VERSION = 1;

export function getDraft(): DraftState | null {
  return safeGet<DraftState | null>(KEYS.draft, null, (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    // 版本检查
    if (typeof raw.v !== 'number' || raw.v !== DRAFT_VERSION) return null;
    // 字段白名单 + 类型守卫
    return {
      query: typeof raw.query === 'string' ? raw.query : '',
      referenceUrl: typeof raw.referenceUrl === 'string' ? raw.referenceUrl : '',
      referenceText: typeof raw.referenceText === 'string' ? raw.referenceText : '',
      outline: typeof raw.outline === 'string' ? raw.outline : '',
      outlineDirty: !!raw.outlineDirty,
      channel: typeof raw.channel === 'string' ? raw.channel : 'wechat',
      persona: typeof raw.persona === 'string' ? raw.persona : '',
      style: typeof raw.style === 'string' ? raw.style : 'tech',
      length: typeof raw.length === 'string' ? raw.length : 'medium',
      needImage: typeof raw.needImage === 'boolean' ? raw.needImage : true,
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

// ============================================================================
// 调试用：列出所有 aw_* key
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