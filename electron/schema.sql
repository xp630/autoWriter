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
-- V2 Phase 1: 内容发现模块
-- ============================================================================

-- 博主（关注的内容源）
CREATE TABLE IF NOT EXISTS bloggers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  platform            TEXT NOT NULL,           -- xiaohongshu | douyin | wechat | shipinhao | other
  category            TEXT DEFAULT '',         -- 婚恋 / 职场 / 育儿 ...
  profile_url         TEXT DEFAULT '',
  enabled             INTEGER DEFAULT 1,
  sync_interval_hours INTEGER DEFAULT 6,
  last_synced_at      DATETIME,
  note                TEXT DEFAULT '',         -- 用户备注
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bloggers_enabled ON bloggers(enabled);
CREATE INDEX IF NOT EXISTS idx_bloggers_platform ON bloggers(platform);

-- 抓取的内容（爆款候选）
CREATE TABLE IF NOT EXISTS contents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  blogger_id          INTEGER NOT NULL,
  title               TEXT NOT NULL,
  content             TEXT DEFAULT '',         -- 正文（手动录入或抓取的纯文本）
  summary             TEXT DEFAULT '',         -- 摘要（可选）
  source_url          TEXT DEFAULT '',
  source_id           TEXT DEFAULT '',         -- 平台原生 ID（用于去重）
  source_type         TEXT DEFAULT 'manual',   -- manual | rss | playwright
  published_at        DATETIME,
  likes               INTEGER DEFAULT 0,
  favorites           INTEGER DEFAULT 0,
  comments            INTEGER DEFAULT 0,
  shares              INTEGER DEFAULT 0,
  heat_score          INTEGER DEFAULT 0,       -- likes*1 + favorites*2 + comments*3
  hit_level           TEXT DEFAULT 'normal',  -- normal | suspect | hit | sustained_hit
  ai_analyzed         INTEGER DEFAULT 0,
  ai_analysis_json    TEXT DEFAULT '',         -- 完整 AI 拆解 JSON
  analysis_at         DATETIME,
  comments_count      INTEGER DEFAULT 0,       -- 抓到/录入的评论数（冗余字段，加速列表）
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (blogger_id) REFERENCES bloggers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_contents_blogger ON contents(blogger_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_contents_heat ON contents(heat_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contents_hit_level ON contents(hit_level, heat_score DESC);
CREATE INDEX IF NOT EXISTS idx_contents_published ON contents(published_at DESC);

-- 评论
CREATE TABLE IF NOT EXISTS comments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id      INTEGER NOT NULL,
  text            TEXT NOT NULL,
  author          TEXT DEFAULT '',
  likes           INTEGER DEFAULT 0,
  sentiment       TEXT DEFAULT '',             -- 焦虑 / 认同 / 愤怒 / 中性 / 期待 / 其它
  sentiment_score REAL DEFAULT 0,              -- -1 ~ 1，< 0 负面，> 0 正面
  source          TEXT DEFAULT 'manual',       -- manual | scraped
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_sentiment ON comments(sentiment);

-- 评论聚合分析结果（一篇内容一条）
CREATE TABLE IF NOT EXISTS comment_analysis (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id              INTEGER NOT NULL UNIQUE,
  top_opinions_json       TEXT DEFAULT '[]',    -- 高频观点 TOP10
  sentiment_breakdown_json TEXT DEFAULT '{}',  -- 情绪占比 {焦虑: 40, 认同: 30, ...}
  key_points_json         TEXT DEFAULT '[]',    -- 用户关注点
  user_needs_json         TEXT DEFAULT '[]',
  user_anxieties_json     TEXT DEFAULT '[]',
  user_expectations_json  TEXT DEFAULT '[]',
  generated_topics_json   TEXT DEFAULT '[]',    -- 从评论生成的 10 条选题
  analyzed_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
);

-- 选题（替代/扩展 rss_items 的语义）
CREATE TABLE IF NOT EXISTS topics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',             -- 一句话描述
  source_type     TEXT NOT NULL,               -- hit_content | comment | manual
  source_id       INTEGER,                     -- FK: contents.id 或 comment_analysis.id
  source_label    TEXT DEFAULT '',             -- 「来自爆款 #123」/「来自评论 #456」
  angle           TEXT DEFAULT '',             -- female | male | story | resonance | controversial | counterintuitive
  reason          TEXT DEFAULT '',             -- 推荐理由
  heat_score      INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'to_write',     -- pending | to_write | writing | completed | published
  article_id      INTEGER,                     -- 已写文章后关联
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES article_drafts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topics_source ON topics(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_topics_heat ON topics(heat_score DESC);

-- 内容-选题 关联（一篇内容 / 一组评论可能生成多个选题）
CREATE TABLE IF NOT EXISTS content_topics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id      INTEGER NOT NULL,
  topic_id        INTEGER NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE,
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
  UNIQUE(content_id, topic_id)
);
