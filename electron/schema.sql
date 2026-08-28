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
-- P0 内容决策系统
-- ============================================================================

-- 创作方向：基于一次内容分析生成的 N 个写作角度
CREATE TABLE IF NOT EXISTS content_angles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id     INTEGER NOT NULL,
  profile_id      TEXT DEFAULT '',
  track           TEXT DEFAULT '',
  angles_json     TEXT NOT NULL DEFAULT '{"angles":[],"track_fit":null}',
  status          TEXT DEFAULT 'running',   -- running|completed|failed
  error           TEXT DEFAULT '',
  duration_ms     INTEGER DEFAULT 0,
  adopted_index   INTEGER DEFAULT -1,       -- 用户采纳的角度下标；-1 = 未采纳
  adopted_at      DATETIME,                 -- 采纳时间
  article_id      INTEGER,                  -- 采纳后生成的文章（content_angles → article_drafts 闭环）
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (analysis_id) REFERENCES content_analysis(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_content_angles_analysis ON content_angles(analysis_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_angles_profile ON content_angles(profile_id, created_at DESC);
-- 注：adopted / article_id 两个索引引用迁移新增的列，必须在 db.cjs 的 ALTER 之后建，
--     否则旧库启动时 schema 会在列还不存在时建索引 → no such column → app 起不来。
