// Renderer 端类型 + electronAPI 类型声明
declare global {
  interface Window {
    electronAPI: {
      getVersion: () => Promise<string>;
      detectAgents: () => Promise<Record<string, boolean>>;
      listModels: (cli: 'pi' | 'claude' | 'opencode' | 'codex') => Promise<string[]>;
      fetchUrl: (url: string) => Promise<{ title: string; text: string; byline: string; url: string; wordCount: number; usedSelector?: string }>;
      listSkills: () => Promise<{
        channels: ChannelSkill[];
        personas: PersonaSkill[];
      }>;
      // 图片 Provider
      listImageProviders: () => Promise<ImageProvider[]>;
      getImageProvider: (id: number) => Promise<ImageProvider | null>;
      saveImageProvider: (data: Partial<ImageProvider>) => Promise<any>;
      deleteImageProvider: (id: number) => Promise<any>;
      getActiveImageProviders: () => Promise<ImageProvider[]>;
      listImageModels: (providerId: string) => Promise<ImageModel[]>;
      saveImageModel: (data: Partial<ImageModel>) => Promise<any>;
      // 文章生成（全部走队列，taskId 可用于取消）
      generateOutline: (params: GenerateParams) => Promise<{ taskId: string; outline: string; elapsedMs: number }>;
      generateArticle: (params: GenerateArticleParams) => Promise<GenerateResult>;
      polishArticle: (params: { cli: 'pi' | 'claude' | 'opencode' | 'codex'; model?: string; content: string; instruction: string; channel?: string; persona?: string }) => Promise<{ taskId: string; content: string; elapsedMs: number }>;
      saveMarkdownFile: (params: { filename?: string; content: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
      updateArticle: (params: { id: number; content: string }) => Promise<{ ok: boolean; wordCount: number }>;
      saveImageFile: (params: { dataUrl: string; filename?: string }) => Promise<{ ok: boolean; url: string; path: string }>;
      generateImage: (params: { prompt: string; filename?: string; width?: number; height?: number; model?: 'flux' | 'turbo' | 'kontext' }) => Promise<{ ok: boolean; url: string; path: string; prompt: string }>;
      listArticleImages: (articleId: number) => Promise<ArticleImage[]>;
      generateImageFor: (p: { articleId: number; placeholderId: string; prompt: string; tags?: string; aspect?: string; useCraft?: boolean; craftCli?: string; providerId?: string; modelId?: string }) => Promise<{ ok: boolean; url: string; path?: string; prompt: string; imageId: number; provider?: string; model?: string }>;
      uploadImageFor: (p: { articleId: number; placeholderId: string; dataUrl: string; tags?: string }) => Promise<{ ok: boolean; url: string; imageId: number }>;
      listAllImages: () => Promise<ImageRecord[]>;
      deleteImage: (id: number) => Promise<{ ok: boolean }>;
      linkImageToArticle: (p: { articleId: number; placeholderId: string; imageId: number }) => Promise<{ ok: boolean }>;
      readImageDataUrl: (path_or_id: string) => Promise<{ ok: boolean; dataUrl: string }>;
      updateImage: (params: { id: number; tags?: string; prompt?: string; category?: string }) => Promise<{ ok: boolean }>;
      getImageRefs: (id: number) => Promise<{ article_id: number; title: string; placeholder_id: string }[]>;
      listPrompts: () => Promise<{ name: string; label: string; path: string }[]>;
      getPrompt: (name: string) => Promise<{ name: string; content: string }>;
      savePrompt: (params: { name: string; content: string }) => Promise<{ ok: boolean; name: string }>;
      listArticles: (params?: { status?: string; search?: string }) => Promise<Article[]>;
      getArticle: (id: number) => Promise<Article | null>;
      scheduleArticle: (params: { id: number; scheduled_at: string }) => Promise<{ ok: boolean }>;
      unscheduleArticle: (id: number) => Promise<{ ok: boolean }>;
      publishArticle: (id: number) => Promise<{ ok: boolean }>;
      unpublishArticle: (id: number) => Promise<{ ok: boolean }>;
      deleteArticle: (id: number) => Promise<{ ok: boolean }>;

      /** Agent 实时输出块 */
      onAgentChunk: (cb: (chunk: { type: 'stdout' | 'stderr' | 'info' | 'error' | 'done' | 'sys'; text: string }) => void) => () => void;

      /** 任务队列 */
      queueList: () => Promise<QueueSnapshot>;
      queueCancel: (taskId: string) => Promise<{ ok: boolean; reason?: string }>;
      queueClearCompleted: () => Promise<{ ok: boolean }>;
      onQueueState: (cb: (snapshot: QueueSnapshot) => void) => () => void;

      /** Scheduler */
      schedulerSnapshot: () => Promise<SchedulerSnapshot | null>;
      schedulerEnable: () => Promise<SchedulerSnapshot | null>;
      schedulerDisable: () => Promise<SchedulerSnapshot | null>;
      schedulerRunNow: (name: string) => Promise<{ ok: boolean; reason?: string; error?: string; detail?: any; durationMs?: number }>;
      schedulerSetInterval: (ms: number) => Promise<{ ok: boolean; error?: string; snapshot?: SchedulerSnapshot }>;
    };
  }
}

export interface ChannelSkill {
  name: string;
  displayName?: string;
  description?: string;
  style?: string;
  length?: string;
  tags: string[];
}

export interface PersonaSkill {
  name: string;
  displayName?: string;
  description?: string;
  tags: string[];
}

export interface GenerateParams {
  cli: 'pi' | 'claude' | 'opencode' | 'codex';
  model?: string;
  title?: string;
  keywords: string[];
  style?: string;
  length?: string;
  channel?: string;
  persona?: string;
  reference_text?: string;
  reference_urls?: string[];
}

export interface GenerateArticleParams extends GenerateParams {
  outline: string;
  need_image?: boolean;
}

export interface GenerateResult {
  taskId: string;
  id: number;
  title: string;
  content: string;
  wordCount: number;
  elapsedMs: number;
}

/** 队列任务快照 */
export interface QueueTask {
  id: string;
  type: 'outline' | 'article' | 'polish' | string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled' | 'cancelling';
  enqueuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  meta: { cli?: string; model?: string; [k: string]: any };
}

export interface QueueSnapshot {
  running: number;
  pending: number;
  completed: number;
  tasks: QueueTask[];
}

/** Scheduler 调度器快照 */
export interface SchedulerHistoryEntry {
  name: string;
  at: number;
  ok: boolean;
  durationMs: number;
  detail?: any;
  error?: string;
  manual?: boolean;
}

export interface SchedulerSnapshot {
  enabled: boolean;
  running: boolean;
  interval: number;
  lastTick: number | null;
  activeTasks: string[];
  registeredTasks: string[];
  history: SchedulerHistoryEntry[];
}

export interface ArticleImage {
  id: number;
  article_id: number;
  placeholder_id: string;
  image_id: number;
  file_name: string;
  file_path: string;
  url: string;
  prompt: string;
  source: 'ai' | 'upload';
}

export interface ImageRecord {
  id: number;
  file_name: string;
  file_path: string;
  url: string;
  prompt: string;
  original_prompt: string;
  provider: string;
  model: string;
  tags: string;
  category: string;
  width: number;
  height: number;
  aspect: string;
  size_kb: number;
  source: 'ai' | 'upload';
  created_at: string;
  used_by_articles?: string;
}

export interface Article {
  id: number;
  title: string;
  content?: string;
  outline?: string;
  status: 'draft' | 'outline' | 'generating' | 'done' | 'published';
  style: string;
  length: string;
  keywords: string;
  word_count: number;
  generation_time: number;
  model: string;
  provider: string;
  platform: string;
  scheduled_at?: string | null;
  published_at?: string | null;
  publish_error?: string | null;
  articleImages?: Record<string, ArticleImage>;
  reference_source?: string;
  created_at: string;
  updated_at: string;
}

export interface ImageProvider {
  id: number;
  provider_id: string;
  name: string;
  enabled: number;
  api_key_enc: string;
  base_url: string;
  priority: number;
  extra_config: Record<string, any> | string;
  created_at: string;
  updated_at: string;
}

export interface ImageModel {
  id: number;
  provider_id: string;
  model_id: string;
  name: string;
  is_default: number;
  enabled: number;
  extra_params: Record<string, any> | string;
  created_at: string;
}

export {};
