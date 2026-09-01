# autoWriter-desktop · 功能清单

> 当前版本：**v0.1.0** · 最后更新：2026-08-31
> 组织方式按产品真定义：**两本账 + 四条流水**（Season 1 定稿，见 `AUTOWRITER_SEASON_1.md`）

---

## 0. 一句话定位

**观察管理系统**——不是文章生成器。
卡（生活账）：每天记观察；EP（出版账）：双周一集；系统负责放大，人负责观点。

---

## 1. 生活账 · 观察卡（Dashboard「今日观察」）

| 能力 | 状态 |
|---|---|
| 一句话存卡（回车即存，唯一必填是观察） | ✅ |
| 卡流：日期 / 观察 / 观点预览 / raw橙点 · grown绿点 | ✅ |
| 删卡（confirm） | ✅ |
| 「长成 EP」：建/挂 Episode，卡标 grown 回链 | ✅ |
| **Idea Interview v2（对话流访谈）** | ✅ |
| ├ AI 逐轮追问 ≤3 轮，判断你是否说到"可反驳的判断句" | ✅ `interview:turn` |
| ├ 收尾抛提炼句 → 确认屏「就用这句 / 我自己改」 | ✅ 终审在人 |
| ├ AI 不可用自动降级固定两问（离线可用） | ✅ |
| └ 追问规则 prompt：`src/prompts/interview.md` | ✅ |
| 观察原句的编辑框（存后改文本） | ❌ 缺口 |
| 「长成 EP」喂进已有计划位（现在只会新建集） | ❌ 待做（owner 定：不急） |

## 2. 出版账 · Season / Episode

| 能力 | 状态 |
|---|---|
| seasons/episodes 表；EP 通过 season_id 挂主线 | ✅ |
| 单一活跃季：Dashboard 取 seasons[0] | ✅ |
| 节目单：planned 计划位（EP03–08 有题入库）→ 开写自动流转 | ✅ |
| EP 编辑页：标题 / 状态下拉（计划…已发/归档）/ 草稿 / publish_url | ✅ |
| 「已发」自动盖 published_at | ✅ |
| 空 EP 保护：无题不建行 | ✅ 规则入档 |
| 多季切换 / 开新季 / 归档 UI | ❌ Season 2 前补 |
| 创作成长档案视图（Timeline） | ❌ 规划中 |

## 3. 四条流水 · A 借势拆解（WritePage 主线）

参考文 → 抓取 → 7 维分析 → 5 角度策略 → 采纳 → 大纲 → 正文 →（润色）。
V2/V3/V4 闸门代码保留、**默认不拦截**（AGENTS 已定方向）。

| 能力 | 状态 |
|---|---|
| URL 抓取（readability）+ **粘贴正文逃生口** + 失败不污染（referenceGuard） | ✅ |
| 7 维内容分析（analysis:run，独立面板，带计时） | ✅ |
| 策略层：5 互斥角度（differentiator/track_fit/feasibility/insight） | ✅ |
| 证据账 `[{item,status,ready}]`：卡流勾选 + 成立度 + fact_risk 派生 | ✅ |
| V4 三问（belief_before/after/source）+ 服务端闸门 | ✅（UI 默认折叠） |
| 大纲手改（[已修订] 标记）→ 正文 → 润色（策略注入全链路） | ✅ |
| 成稿体检 articleLint（13 规则+四检）+ QualityPanel | ✅（提示不拦截） |
| 「跳过策略」逃生口保留 | ✅ |

## 4. 四条流水 · B 命题策划（无参考文）

主题 → 直接出 5 策略（自带事实约束分级）→ 后续同 A。**3 分钟出稿推荐路径。** ✅

## 5. 四条流水 · C 快速发布（⌘3 Quick Publish，四步）

| 步 | 能力 |
|---|---|
| 1 润色 | 粘贴任意外部草稿；AI 润色指令固定"保持观点不动"，替换前确认 |
| 2 排版 | beautifyHtml 观点盒/标题/引用/列表自动识别；**点击改判**（机器初稿人终审） |
| 3 配图 | **只走正经 provider**（免费通道已下线）；图库挑选 / 排版封面 PNG（本地 Canvas 零依赖）/ 0 图可发 |
| 4 导出 | 发布稿 HTML（图内嵌 dataURL）+ 封面 PNG + 复制 Markdown |

## 6. 四条流水 · D 周记

9 段模板 + 双周节奏 + 诚实周约定 → `docs/WEEKLY_RECAP.md`（内容规划，非代码功能）

## 7. 支撑能力

| 能力 | 状态 |
|---|---|
| 身份档案 Profile（赛道/人设/Agent 隔离；文章/策略/卡/统计全隔离） | ✅ |
| 策略库页（浏览/筛选/详情/采纳记录/效果回填[转发第一位]/归档） | ✅ |
| 我的文章（列表/详情/编辑/导出 md·html·docx·pdf / aw-img 渲染） | ✅ |
| 图库（provider CRUD/生成/上传/关联文章/引用查询/删除保护） | ✅ |
| 选题中心（手动 + 存为策略来源） | ✅ |
| 博主源 rss_sources/rss_items（抓取列表） | 🟡 半壳 |
| 任务队列 QueueBadge（并发/取消/明细） | ✅ |
| 调度器 scheduler | 🟡 机制真、任务半空转 |
| 仪表盘 KPI/最近编辑/主线/观察卡 | ✅ |
| 首次引导横幅 + 「清空草稿」+ 空稿守卫 + 草稿含分析策略（v2） | ✅ |
| Agent：claude/pi/opencode/codex 检测/模型列表/流式 chunk | ✅ |
| Prompt 模板热加载（src/prompts/*.md，改文件即生效） | ✅ |
| Skills：分析/策略/写作 12 个 | ✅ |
| 快捷键 ⌘0-3；SQLite 本地存储 + API key 加密 | ✅ |
| i18n（zh/en）；主题 tokens（DESIGN.tokens.json） | ✅ |
| E2E 测试缝（test:reset-db / userdata 隔离 / cli 注入降级） | ✅ |

## 8. 质量基线（2026-08-31）

231 单测 / 114+5 e2e / tsc / build 全绿 · macOS 包已产（release/*.dmg，未签名）

## 9. 已知缺口 / 待做

1. 观察卡原句编辑 · 2. 长成 EP 喂计划位 · 3. 多季管理 UI · 4. Tensor.Art token 实配 · 5. 周记数据自动拉取 · 6. SourcesPage 真实化 · 7. EP 发布后反馈回填 UI 简化 · 8. feat/episode-mgmt-p0 分支 14 commits 未合 develop
