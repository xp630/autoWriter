-- autoWriter-desktop SQLite schema（精简版）
-- 数据存 userData/autoWriter.db

-- 图片生成 Provider 配置
CREATE TABLE IF NOT EXISTS image_providers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id   TEXT NOT NULL UNIQUE,       -- 如: pollinations, tensorart, ideogram
  name          TEXT NOT NULL,              -- 显示名称
  enabled       INTEGER DEFAULT 1,           -- 是否启用
  api_key_enc   TEXT DEFAULT '',            -- AES-256-GCM 加密存储
  base_url      TEXT DEFAULT '',            -- API 地址
  priority      INTEGER DEFAULT 0,           -- 优先级（数字越小越优先）
  extra_config  TEXT DEFAULT '{}',          -- JSON 扩展配置（每个 Provider 的特殊参数）
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Provider 对应的模型列表
CREATE TABLE IF NOT EXISTS image_models (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id   TEXT NOT NULL,              -- 关联 provider_id
  model_id      TEXT NOT NULL,              -- 如: flux, flux-schnell, stable-diffusion-xl
  name          TEXT NOT NULL,              -- 显示名称
  enabled       INTEGER DEFAULT 1,
  is_default    INTEGER DEFAULT 0,          -- 是否为该 Provider 的默认模型
  extra_params  TEXT DEFAULT '{}',          -- 模型特定参数 {width, height, steps...}
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS provider_settings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id  TEXT NOT NULL UNIQUE,
  api_key_enc  TEXT NOT NULL,              -- AES-256-GCM 加密
  base_url     TEXT DEFAULT '',
  default_model TEXT DEFAULT '',
  image_model  TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS article_drafts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT,
  outline         TEXT,
  content         TEXT,
  status          TEXT DEFAULT 'draft',     -- draft / outline / generating / done / published
  style            TEXT DEFAULT 'tech',
  length           TEXT DEFAULT 'medium',
  keywords         TEXT DEFAULT '',
  reference_source TEXT,
  word_count       INTEGER DEFAULT 0,
  generation_time  INTEGER DEFAULT 0,
  model            TEXT DEFAULT '',
  provider         TEXT DEFAULT '',
  platform         TEXT DEFAULT 'wechat',
  profile_id       TEXT DEFAULT '',                     -- 身份（账号）隔离；旧库由 db.cjs 迁移补列，历史记录为空=不隐身
  parent_id        INTEGER,
  scheduled_at     DATETIME,
  published_at     DATETIME,
  publish_error    TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rss_sources (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  category          TEXT DEFAULT 'general',
  enabled           INTEGER DEFAULT 1,
  last_synced_at    DATETIME,
  sync_interval_hours INTEGER DEFAULT 2,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rss_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL,
  guid          TEXT,
  title         TEXT,
  url           TEXT,
  summary       TEXT,
  author        TEXT,
  published_at  DATETIME,
  fetched_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_used       INTEGER DEFAULT 0,
  FOREIGN KEY (source_id) REFERENCES rss_sources(id) ON DELETE CASCADE,
  UNIQUE(source_id, guid)
);

-- 图片本体库（唯一存储，可被多篇文章引用）
CREATE TABLE IF NOT EXISTS images (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name       TEXT NOT NULL,           -- uploads 目录下的文件名（相对）
  file_path       TEXT,                    -- 完整路径或 aw-img:// 相对名
  url             TEXT,                    -- OSS/公网 URL（未来）
  prompt          TEXT DEFAULT '',         -- AI 扩写后的 prompt
  original_prompt TEXT DEFAULT '',         -- 用户原始输入的 prompt
  provider        TEXT DEFAULT '',         -- 生图的 Provider (pollinations/tensorart)
  model           TEXT DEFAULT '',         -- 生图的模型
  tags            TEXT DEFAULT '',         -- 关键词，逗号分隔（供大模型检索选择）
  category        TEXT DEFAULT '',          -- 分类：cover/配图/material/banner 等
  width           INTEGER DEFAULT 0,       -- 像素宽
  height          INTEGER DEFAULT 0,       -- 像素高
  aspect          TEXT DEFAULT '',         -- 宽高比，如 3:2 / 16:9 / 3:4 / 1:1
  size_kb         INTEGER DEFAULT 0,       -- 文件大小（KB）
  source          TEXT DEFAULT 'ai',       -- ai / upload
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_tags ON images(tags);

-- 文章-图片关联（同一张图可被多篇文章复用）
CREATE TABLE IF NOT EXISTS article_images (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id      INTEGER NOT NULL,
  placeholder_id  TEXT NOT NULL,           -- 对应正文 [[配图:描述@placeholder_id]] 里的 id
  image_id        INTEGER NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES article_drafts(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
  UNIQUE(article_id, placeholder_id)
);
CREATE INDEX IF NOT EXISTS idx_img_article ON article_images(article_id, placeholder_id);
CREATE INDEX IF NOT EXISTS idx_img_image ON article_images(image_id);

CREATE INDEX IF NOT EXISTS idx_scheduled ON article_drafts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_article_status ON article_drafts(status);
CREATE INDEX IF NOT EXISTS idx_rss_items_unused ON rss_items(is_used, published_at DESC);
-- ============================================================================
-- P0 内容分析中心
-- ============================================================================
CREATE TABLE IF NOT EXISTS content_analysis (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url      TEXT DEFAULT '',
  title           TEXT,
  platform        TEXT DEFAULT '',
  author          TEXT DEFAULT '',
  content         TEXT NOT NULL,
  analysis_json   TEXT NOT NULL DEFAULT '{}',
  status          TEXT DEFAULT 'completed',  -- pending | running | completed | failed
  error           TEXT DEFAULT '',
  duration_ms     INTEGER DEFAULT 0,
  profile_id      TEXT DEFAULT '',           -- 创作身份隔离（旧库由 db.cjs 迁移补列）
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_content_analysis_created ON content_analysis(created_at DESC);
-- 注：idx_content_analysis_profile 必须在 db.cjs 迁移之后建（旧库可能还没 profile_id 列）

-- ============================================================================
-- 内容策略系统 V2：Strategy-Driven Workflow
-- ============================================================================

-- 一行 = 一个策略（= 一个可执行的创作决策），不是一行装一批候选。
-- 理由：策略是资产，要能单独检索 / 复用 / 回填战绩（§八、§十二）。
-- 一次生成的 5 个角度 = 5 行，用 batch_id 归组。
-- 生成失败不再入库（没有“不完整的策略”），错误直接返回给 renderer 展示。
CREATE TABLE IF NOT EXISTS content_strategies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mode            TEXT NOT NULL DEFAULT 'reference',   -- reference(A 借势拆解) | topic(B 命题策划)
  source_type     TEXT DEFAULT 'analysis',             -- analysis | topic | manual
  analysis_id     INTEGER,                             -- A 模式挂靠；B 模式 NULL（不依赖分析）
  batch_id        TEXT DEFAULT '',                     -- 同一次生成的多个策略归组
  topic           TEXT DEFAULT '',                     -- B 模式的输入主题；A 模式冷存原文标题
  profile_id      TEXT DEFAULT '',                     -- 身份隔离
  track           TEXT DEFAULT '',                     -- 生成时所用赛道
  persona         TEXT DEFAULT '',
  -- ▲ 统一策略模型的决策内容（§四）
  angle_type      TEXT DEFAULT '',
  title           TEXT DEFAULT '',
  core_point      TEXT DEFAULT '',                     -- 文章立意 / thesis（主张）
  insight         TEXT DEFAULT '',                     -- V3：独特洞察。主张可以正确但无价值，洞察才是读者带走的那一句
  -- ▲ 生成守卫三问（1）。任意为空 → 禁止生成正文。故意要用户自己填：
  --   AI 可以给候选，但“读者原本怎么想 / 我要他怎么想”必须是人的判断。
  belief_before   TEXT DEFAULT '',                     -- 1. 读者原本怎么想
  belief_after    TEXT DEFAULT '',                     -- 2. 我希望读者改怎么想
  belief_source   TEXT DEFAULT '',                     -- belief_before 的出处（评论区/同行文/常见说法）——防生造稻草人共识
  target_user     TEXT DEFAULT '',
  structure       TEXT DEFAULT '[]',                   -- JSON 数组（兼容旧形状）
  narrative       TEXT DEFAULT '[]',                   -- V3：{hook,explanation,framework,action} 四拍叙事骨架，可复用
  emotion         TEXT DEFAULT '',                     -- 情绪策略
  goal            TEXT DEFAULT '',                     -- 内容目标
  value_score     REAL,                                -- 0-10 推荐指数
  -- ▲ 模式专属字段（§五 / §六），结构化存储而不是自由文本
  differentiator  TEXT,                                -- A: {type,description,instruction} 抗同质化
  track_fit       TEXT,                                -- A: {score,reason,adapt_direction}
  feasibility     TEXT,                                -- B: {score,difficulty,reason}
  evidence_needed TEXT,                                -- B: [{item,status}] V3：带状态的证据账，决定成立度
  fact_risk       TEXT DEFAULT 'low',                  -- low|medium|high：AI 编造事实的风险
  -- ▲ 生命周期
  status          TEXT DEFAULT 'candidate',            -- candidate | adopted | archived
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (analysis_id) REFERENCES content_analysis(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategies_mode ON content_strategies(mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategies_profile ON content_strategies(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON content_strategies(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategies_batch ON content_strategies(batch_id);
CREATE INDEX IF NOT EXISTS idx_strategies_track ON content_strategies(track, status);
CREATE INDEX IF NOT EXISTS idx_strategies_analysis ON content_strategies(analysis_id, created_at DESC);

-- 策略 : 文章 = 1:N。同一策略可复用到公众号/小红书/知乎/头条多篇执行结果。
-- article_id 可空 = “已采纳、文章还没生成”。
-- 效果回填字段直接挂在执行关系上（§十三）：这篇用这条策略跑出了什么结果。
CREATE TABLE IF NOT EXISTS strategy_articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id   INTEGER NOT NULL,
  article_id    INTEGER,
  adopted_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  shares        INTEGER,                                 -- 转发/分享——2粉阶段唯一优先看的指标（阅读≠认可，转发≈传播价值）
  views         INTEGER,
  likes         INTEGER,
  favorites     INTEGER,
  comments      INTEGER,
  followers     INTEGER,
  manual_score  REAL,                                  -- 用户主观分 0-10，用于修正策略评分
  note          TEXT DEFAULT '',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (strategy_id) REFERENCES content_strategies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_strategy_articles_strategy ON strategy_articles(strategy_id, adopted_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_articles_article ON strategy_articles(article_id);

-- ============================================================================
-- P0 (Week 1): Season + Episode 数据结构
-- 设计原则（"不锁死"）：
--   1. 新表是补充，不是替代；article_drafts 保留作为 Episode 的"已发布快照"
--   2. 所有新字段 nullable；不强制 EP 必须有 Article，反之亦然
--   3. observation/question/insight/draft 都是 TEXT（不用 JSON 列），灵活
--   4. article_drafts 加 season_id + episode_id 列，可空，不建外键约束
-- ============================================================================

CREATE TABLE IF NOT EXISTS seasons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,                     -- "AutoWriter Season 1"
  subtitle     TEXT DEFAULT '',                  -- "一个程序员用 AI 重构写作和思考的真实记录"
  description  TEXT DEFAULT '',
  status       TEXT DEFAULT 'active',            -- active / archived
  started_at   DATETIME,
  ended_at     DATETIME,
  profile_id   TEXT DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seasons_profile ON seasons(profile_id, status);

-- Episode 是 Season 下的核心对象
-- 状态机：observation → questioning → thinking → drafting → published → archived
CREATE TABLE IF NOT EXISTS episodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id       INTEGER,                       -- 可空：未归入 Season 的 episode
  title           TEXT DEFAULT '',               -- 短标题，如"我以为自己没有观点"
  slug            TEXT DEFAULT '',               -- 友好 ID 如 ep-002，未来可作 URL
  status          TEXT DEFAULT 'observation',    -- observation/questioning/thinking/drafting/published/archived
  -- 3 问审问器的核心字段（按"不锁死"原则，全是 TEXT 不强结构）
  observation     TEXT DEFAULT '',               -- Q1：今天你观察到了什么
  question        TEXT DEFAULT '',               -- Q2：今天有什么事让你停顿了 3 秒
  insight         TEXT DEFAULT '',               -- Q3：你最想说的一句话是什么
  -- 写
  draft           TEXT DEFAULT '',               -- 草稿（markdown）
  -- 发布后
  publish_url     TEXT DEFAULT '',               -- 公众号文章 URL
  published_at    DATETIME,
  -- 反馈
  read_count      INTEGER DEFAULT 0,
  likes           INTEGER DEFAULT 0,
  comments        INTEGER DEFAULT 0,
  -- 元
  order_in_season INTEGER DEFAULT 0,             -- Season 内顺序
  profile_id      TEXT DEFAULT '',               -- 身份隔离
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id, order_in_season);
CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_profile ON episodes(profile_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_slug ON episodes(slug) WHERE slug != '';

-- ============================================================================
-- 2026-08-31 owner 定稿：观察卡与 Episode 分离
--   观察卡 = 生活账（每天，一秒捕获，N 张）；Episode = 出版账（双周，一集）
--   N 张卡 : 0..1 个 EP——卡"长成"EP 时才回填 episode_id
-- ============================================================================
CREATE TABLE IF NOT EXISTS observations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  observation  TEXT NOT NULL DEFAULT '',        -- Q1 必填：今天观察到什么
  question     TEXT DEFAULT '',                 -- Q2 可空：什么让我停顿了
  insight      TEXT DEFAULT '',                 -- Q3 可空：可能观点
  status       TEXT DEFAULT 'raw',              -- raw / grown
  episode_id   INTEGER,                         -- 长成哪一集（可空）
  season_id    INTEGER,
  profile_id   TEXT DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_obs_status  ON observations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_episode ON observations(episode_id);
CREATE INDEX IF NOT EXISTS idx_obs_profile ON observations(profile_id, created_at DESC);
