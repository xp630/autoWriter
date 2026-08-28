# AutoWriter · P0 内容决策系统（落地版）

> 状态：开发规划 → 待开工 ｜ 优先级：最高 ｜ 更新：2026-08
> 北极星：用户打开 AutoWriter 后 **5 分钟内确定今天要写什么**，并进入创作。
> 本文是对外部草案（ChatGPT 版）的**结合代码现状校正版**：凡是已实现的直接复用，表结构按真实模型改造，避免与现有系统（Profile / article_drafts / agentQueue）打架。

---

## 0. 能力现状 & 复用清单（先盘家底）

| 能力 | 完成度 | 已存在的可复用件 |
|---|---|---|
| 内容生产 | 90% | 三步流、`article:outline/article/polish`、`ArticleViewer`、`ImageSlot`、导出 |
| 内容理解 | 80% | **内容分析中心已上线**：`content_analysis` 表、`analysis:run`、`parseAnalysisJson`（JSON 容错）、`buildAnalysisContextBlock`（注入 prompt）、AnalysisPanel 7 维卡 |
| 内容决策 | 20% | 本 P0 补齐 |
| 创作身份 | ✅ | `Profile`（track/persona/defaultStyle/defaultChannel）、`useActiveProfile`、`subscribeProfiles` |
| 队列 | ✅ | `agentQueue`（并发/取消/日志归队列明细，type 已含 analysis） |

**AnalysisPanel 里已预留一个 disabled 的「🪄 生成创作方向」按钮**（`onGenerateAngles`），本 P0 直接激活它，不用从零加 UI。

---

## 1. P0 范围（与草案一致，砍掉抓取类）

- **P0-1 创作方向生成**（Angle Generator）
- **P0-2 选题中心**（Topic Hub）
- **P0-3 分析→创作 打通**（Analysis → Writing）

**不做**：博主源 / 评论分析 / 热点监控 / 自动抓取 / 内容雷达 / 云同步 / 多人账号。

闭环：`参考内容 → 内容分析 → 创作方向 → 保存选题 → 开始创作 → 生成文章`

---

## 2. P0-1 创作方向生成

### 2.1 与草案的差异（关键）
- 复用 `analysis:run` 的结果（不重分析）。
- 生成走 `agentQueue`（type=`angle`），复用 `parseAnalysisJson` 容错。
- **必须注入当前身份的赛道**（`profile.track`）→ 5 个方向从"我的赛道"切，且带 **track_fit**（内容不匹配时给出拉回角度）。
- 一个分析对应一批方向，**存一行、JSON 承载 5 个方向**（草案把每个字段拆列会漏字段且难扩展）。

### 2.2 数据模型（改造版）
```sql
CREATE TABLE IF NOT EXISTS content_angles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id  INTEGER NOT NULL,          -- 关联 content_analysis.id
  profile_id   TEXT NOT NULL,             -- 创作身份隔离（你的 vs 媳妇的）
  track        TEXT DEFAULT '',           -- 生成时所用赛道（快照）
  angles_json  TEXT NOT NULL DEFAULT '[]',-- 5 个方向数组
  status       TEXT DEFAULT 'running',    -- running|completed|failed
  error        TEXT DEFAULT '',
  duration_ms  INTEGER DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (analysis_id) REFERENCES content_analysis(id) ON DELETE CASCADE
);
```
`angles_json` 每个元素：
```json
{ "angle_type":"女性成长视角","title":"...","core_point":"...",
  "target_user":"...","structure":["钩子","论点","案例","升华"],
  "reason":"...","track_fit":{"matches":true,"note":"..."} }
```
> 注：`content_analysis` 也补一列 `profile_id`（ALTER，向后兼容），让 分析→方向→选题 全链路可按身份隔离。

### 2.3 Prompt（新建 skill）
`src/skills/analysis/angle-generation/SKILL.md`：只输出严格 JSON；输入含 7 维分析结果 + 赛道 + 领域偏好；要求：≥5 个**互斥**视角、标题有锐度、每个方向给 structure + reason + track_fit。

### 2.4 接口
- IPC `analysis:angles`（入：analysisId；出：{taskId, angles[]}）——enqueue type=`angle`，标签带赛道。
- preload：`generateAngles(analysisId)`。

### 2.5 UI
- 激活 AnalysisPanel 的「生成创作方向」→ 生成中骨架 loading（复用 `.gen-loading`）。
- 结果：方向列表卡（标题/观点/目标/结构/理由 + track_fit 角标）。
- 每方向两个动作：**保存为选题** / **开始创作**。

### 2.6 验收
- [ ] 每篇产出 ≥5 方向；不同赛道结果明显不同（同素材换赛道→方向措辞变化）
- [ ] 生成走队列、可取消、日志进队列明细
- [ ] 方向可保存为选题、可进入创作

---

## 3. P0-2 选题中心

### 3.1 与草案的差异（关键：避免第二套状态真相）
- **按 `profile_id` 隔离**（不然你俩选题混一锅，身份系统白做）。
- 选题状态只存 **`idea / adopted`（进了创作）**；"创作中/已完成/已发布"**从关联 `article_id` 派生**（join article_drafts.status），不手工维护两套。
- 保留来源溯源：`source_type`(manual/analysis/angle) + `source_ref`(analysisId/angleId)。

### 3.2 数据模型（改造版）
```sql
CREATE TABLE IF NOT EXISTS topics (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT DEFAULT '',
  profile_id   TEXT NOT NULL,             -- 身份隔离
  track        TEXT DEFAULT '',           -- 建议赛道（快照）
  source_type  TEXT DEFAULT 'manual',     -- manual|analysis|angle
  source_ref   TEXT DEFAULT '',           -- analysis_id / angle 索引
  ref_analysis_id INTEGER,                -- 溯源到分析
  article_id   INTEGER,                   -- 进入创作后回填；派生状态用
  status       TEXT DEFAULT 'idea',       -- idea|adopted（创作态由 article 派生）
  note         TEXT DEFAULT '',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3.3 接口
IPC `topic:list/create/update/delete/linkArticle`；`topic:list` 默认按当前 `profile_id` 过滤。

### 3.4 UI
素材 → 选题中心。看板列：`灵感池(idea)` / `已采纳(adopted)` /（派生：创作中/已完成/已发布）。支持检索、编辑、删除、一键创作、手动新建。

### 3.5 验收
- [ ] 管理 100+ 不卡；检索可用；一键进入创作
- [ ] 只显当前身份选题；创作状态跟随关联文章实际状态

---

## 4. P0-3 分析→创作 打通

### 4.1 与草案的差异
WritePage 现从**当前身份**读 track/persona/defaultChannel/style → 打通时**不要重复填这些**；只带"文章级"内容。

### 4.2 一键开始创作携带
```
analysisId / angle(选中的方向)
  → WritePage 预填：
     · query/keywords ← 分析 topic.main_topic + basic_info.keywords
     · referenceText  ← content_analysis.content
     · analysis 对象   ← 注入 prompt（已有 buildAnalysisContextBlock 通路）
     · 大纲种子        ← 选中方向的 structure[]（作为大纲初稿/参考）
     · title 建议      ← 方向 title
  赛道/人设走当前 Profile，不写死进文章
```

### 4.3 验收
- [ ] 分析/方向/选题 → 开始创作 ≤1 次点击；自动带入全部文章级信息；赛道人设沿用当前身份无需重填

---

## 5. 实施顺序与工作量（AI 结对，非人肉工期）

| 阶段 | 内容 | 依赖 | 粗估 |
|---|---|---|---|
| P0-1a | content_angles + content_analysis.profile_id 迁移 + skill + IPC + 复用 parseAnalysisJson/队列 | 现成分析件 | 半天 |
| P0-1b | AnalysisPanel 激活按钮 + 方向卡 UI + loading | P0-1a | 半天 |
| P0-2 | topics 表 + CRUD IPC + 选题中心页(看板) + profile 隔离 + 派生状态 | P0-1 | 1–1.5 天 |
| P0-3 | 开始创作预填贯通（方向/分析/选题 → WritePage） | P0-1/2 | 半天 |

> 每阶段：单测（角度解析 / topics 派生状态 / 隔离）+ E2E 一条 + build 门禁；分步提交，不碰坏现有。

---

## 6. 对草案（ChatGPT 版）的修订摘要

1. 不重造内容分析，**复用**已上线件 + 那个 disabled 按钮。
2. `content_angles` 用 `angles_json` 一表承载（草案拆列会漏字段）+ 加 `profile_id`。
3. `topics` 加 `profile_id / source_ref / ref_analysis_id / article_id`，**状态单一真相**（创作态从文章派生）。
4. angle 生成强制注入赛道 + `track_fit` 护栏（草案只笼统"注入赛道"）。
5. 队列/JSON 容错/日志明细全部复用，不新写。
6. P0-3 打通**不重复填身份级参数**。

---

## 7. P0 完成后的形态

```
内容分析 → 创作方向（按我赛道，5 视角 + 匹配提醒）→ 保存选题（分身份、状态不漂移）→ 一键创作（自动带上下文）→ 成文
```
AutoWriter：**AI Writer → AI Content Decision Studio**，实现 内容理解 → 内容决策 → 内容生产 的闭环。
