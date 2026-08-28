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
      testImageProvider: (data: { providerId: string; token?: string }) => Promise<{ ok: boolean; toolCount?: number; message?: string }>;
      // 文章生成（全部走队列，taskId 可用于取消）
      generateOutline: (params: GenerateParams) => Promise<{ taskId: string; outline: string; elapsedMs: number }>;
      generateArticle: (params: GenerateArticleParams) => Promise<GenerateResult>;
      /** 二次润色：必须能拿到策略（否则一润就把立意/情绪/目标/差异锚点洗平）。strategy 与 articleId 二选一，后者由主进程反查 DB */
      polishArticle: (params: {
        cli: 'pi' | 'claude' | 'opencode' | 'codex'; model?: string; content: string; instruction: string;
        channel?: string; persona?: string; track?: string; analysis?: ContentAnalysisResult;
        strategy?: Strategy;
        articleId?: number;
      }) => Promise<{ taskId: string; content: string; elapsedMs: number }>;
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

      /** 内容分析 */
      runAnalysis: (params: { title?: string; content: string; platform?: string; author?: string; source_url?: string; domain?: string; profileId?: string; cli?: string; model?: string }) => Promise<{
        ok: boolean;
        id?: number;
        taskId?: string | null;
        analysis?: ContentAnalysisResult;
        error?: string;
        durationMs?: number;
      }>;
      getAnalysis: (id: number) => Promise<ContentAnalysisRecord | null>;
      listAnalyses: (params?: { limit?: number; profileId?: string }) => Promise<Array<{ id: number; title: string; platform: string; status: string; duration_ms: number; created_at: string; profile_id?: string }>>;
      deleteAnalysis: (id: number) => Promise<{ ok: boolean; changes: number }>;
      generateAngles: (params: { analysisId: number; track: string; profileId: string; cli: string; model?: string }) => Promise<{
        ok: boolean;
        id?: number;
        taskId?: string | null;
        angles?: Strategy[];
        track_fit?: TrackFit | null;
        error?: string;
      }>;
      /** @deprecated V1 兼容通道，新代码用 adoptStrategy */
      adoptAngle: (params: { id: number; index: number }) => Promise<{
        ok: boolean;
        id?: number;
        index?: number;
        angle?: Strategy;
        error?: string;
      }>;
      // ===== 内容策略系统 V2（Strategy-Driven Workflow）=====
      generateStrategy: (params: {
        mode: StrategyMode; topic?: string; analysisId?: number;
        track?: string; persona?: string; profileId?: string; cli?: string; model?: string;
      }) => Promise<{
        ok: boolean;
        taskId?: string | null;
        batchId?: string;
        mode?: StrategyMode;
        /** V2：一次生成 = N 行独立策略，每行带自己的 id */
        strategies?: Strategy[];
        track_fit?: TrackFit | null;
        durationMs?: number;
        error?: string;
      }>;
      adoptStrategy: (params: { strategyId: number; articleId?: number }) => Promise<{
        ok: boolean;
        adoptionId?: number;
        strategyId?: number;
        mode?: StrategyMode;
        error?: string;
      }>;
      listStrategies: (params?: {
        profileId?: string; mode?: StrategyMode; status?: 'candidate' | 'adopted' | 'archived';
        track?: string; search?: string; limit?: number;
      }) => Promise<Strategy[]>;
      getStrategy: (id: number) => Promise<(Strategy & { links: StrategyLink[] }) | null>;
      deleteStrategy: (id: number) => Promise<{ ok: boolean; changes: number }>;
      setStrategyStatus: (params: { id: number; status: 'candidate' | 'adopted' | 'archived' }) => Promise<{ ok: boolean; changes: number }>;
      recordStrategyResult: (params: {
        adoptionId?: number; articleId?: number;
        metrics: Partial<{ views: number; likes: number; favorites: number; comments: number; followers: number; manual_score: number; note: string }>;
      }) => Promise<{ ok: boolean; adoptionId?: number; error?: string }>;
      strategyStats: (ids: number[]) => Promise<StrategyStats[]>;
      /** 策略反查口：跨页面（导出/发布/回填/详情）靠它拿回“这篇文章当时定了什么策略” */
      articleStrategy: (articleId: number) => Promise<(Strategy & { adoptionId?: number; articleId?: number }) | null>;
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
  /** 账号级赛道，决定选题角度/案例/受众 */
  track?: string;
  reference_text?: string;
  reference_urls?: string[];
  /** AI 对参考内容的分析结果（如有），会注入到 prompt 作为上下文 */
  analysis?: ContentAnalysisResult;
  /**
   * 用户采纳的创作策略（P0-2）：拍平的角度字段 + mode + 来源定位。
   * 主进程用 buildStrategyBlock 渲染成 {{strategyBlock}} 注入大纲/正文，
   * 正文入库后回填 strategy_adoptions.article_id（策略:文章 = 1:N）。
   */
  strategy?: Angle & {
    mode?: StrategyMode;
    strategyId?: number;
    adoptionId?: number;
    index?: number;
    /** 旧字段名（P0-2 初期叫 anglesId），保留兼容 */
    anglesId?: number;
  };
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

/** 内容分析结果（P0）*/
/** 创作方向 */
/** 策略模式：A 借势拆解（有参考文）/ B 命题策划（只有题目） */
export type StrategyMode = 'reference' | 'topic';

/**
 * 统一策略模型（V2 §四）：一行 = 一个可执行的创作决策。
 * A/B 两种模式共用同一组字段，模式专属块各走自己的结构。
 */
export interface Strategy {
  id?: number;
  mode: StrategyMode;
  /** 来源：analysis(A 挂靠分析) | topic(B 命题) | manual(手写/以后从选题升格) */
  source_type?: 'analysis' | 'topic' | 'manual';
  /** A 模式挂靠；B 模式为 null —— 策略不依赖分析 */
  analysis_id?: number | null;
  /** 同一次生成的多个策略共享批次号，用于"这批一起看/一起归档" */
  batch_id?: string;
  topic?: string;
  profile_id?: string;
  track?: string;
  persona?: string;

  // ▲ 决策内容
  angle_type: string;
  title: string;
  /** 文章立意：这篇要表达什么 */
  core_point: string;
  target_user?: string;
  structure?: string[];
  /** 情绪策略：希望读者产生什么感觉 */
  emotion?: string;
  /** 内容目标：这篇要拿到什么结果 */
  goal?: string;
  value_score?: number | null;
  reason?: string;

  // ▲ 模式专属
  /** A：差异锚点，对抗同质化的正向抓手 */
  differentiator?: Differentiator | null;
  /** A：素材与当前账号的适配度 */
  track_fit?: TrackFit | null;
  /** B：可写性与题目价值 */
  feasibility?: Feasibility | null;
  /** B：素材缺口 */
  evidence_needed?: string[];
  /** B：AI 编造事实的风险，决定正文下发多强的事实约束 */
  fact_risk?: FactRisk;

  // ▲ 生命周期
  status?: 'candidate' | 'adopted' | 'archived';
  created_at?: string;
  updated_at?: string;
  /** 列表查询附带：被采纳过几次 */
  adoption_count?: number | null;
}

/** A 模式最重要字段。type 六选一，instruction 要能直接当正文约束 */
export interface Differentiator {
  type?: DifferentiatorType | '';
  description: string;
  instruction?: string;
}

export type DifferentiatorType =
  | 'new_position' | 'new_evidence' | 'new_audience'
  | 'new_scenario' | 'new_conclusion' | 'new_experience';

export const DIFFERENTIATOR_LABEL: Record<DifferentiatorType, string> = {
  new_position: '新立场', new_evidence: '新证据', new_audience: '新人群',
  new_scenario: '新场景', new_conclusion: '新结论', new_experience: '新经历',
};

/** A 专属：这篇素材在当前赛道值不值得写 */
export interface TrackFit {
  score?: number;
  reason?: string;
  /** score 低时给出拉回角度的具体建议 */
  adapt_direction?: string;
}

/** B 专属：题目价值 + 无素材前提下的可写性 */
export interface Feasibility {
  score?: number;
  difficulty?: 'easy' | 'medium' | 'hard' | '';
  reason?: string;
}

export const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '易', medium: '中', hard: '难',
};

export type FactRisk = 'low' | 'medium' | 'high';

/** 策略 : 文章 = 1:N 的执行记录（含 §十三 效果回填字段） */
export interface StrategyLink {
  id: number;
  article_id: number | null;
  adopted_at: string;
  views: number | null;
  likes: number | null;
  favorites: number | null;
  comments: number | null;
  followers: number | null;
  manual_score: number | null;
  note: string;
}

/** 策略战绩聚合（策略库排序用） */
export interface StrategyStats {
  strategy_id: number;
  times_adopted: number;
  reported: number;
  avg_views: number | null;
  avg_comments: number | null;
  avg_favorites: number | null;
  avg_followers: number | null;
  avg_manual_score: number | null;
}

/**
 * 用户采纳的创作策略。adoptionId 由 adoptStrategy 返回，
 * 正文入库时回填到那条执行记录（而不是覆盖某个"唯一文章 id"）。
 */
export interface StrategySelection {
  strategyId: number;
  mode: StrategyMode;
  adoptionId?: number;
  strategy: Strategy;
}

/** @deprecated V2 起统一用 Strategy；保留别名让旧的卡片代码不必同批改名 */
export type Angle = Strategy;
/** @deprecated V2 把题目价值并入 feasibility，不再有批次级 value 块 */
export type StrategyValue = Feasibility;
export interface ContentAnalysisResult {
  basic_info?: {
    title?: string;
    source?: string;
    platform?: string;
    author?: string;
    keywords?: string[];
  };
  topic?: {
    main_topic?: string;
    category?: string;
    summary?: string;
  };
  core_points?: string[];
  viral?: {
    emotion?: string;
    conflict?: string;
    reason?: string[];
  };
  structures?: string[];
  audience?: {
    target_user?: string;
    pain_points?: string[];
  };
  adaptation?: {
    borrow?: string[];
    avoid_copy?: string[];
  };
}

export interface ContentAnalysisRecord {
  id: number;
  source_url: string;
  title: string;
  platform: string;
  author: string;
  content: string;
  analysis: ContentAnalysisResult;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error: string;
  duration_ms: number;
  created_at: string;
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
