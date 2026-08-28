# autoWriter-desktop · 模块完成度审计

> **审计时间**：2026-08-28 · **版本**：v0.1.0
>
> 本文基于代码真实状态（非文档自我描述）逐模块审计，包含：
> - 完成度百分比 + 详细子项
> - 后端实现 + 前端调用双向验证
> - 死代码 / 半成品 / 缺位功能标记

---

## 0. 总览

| 维度 | 数字 |
|---|---|
| 后端 IPC handler | **43 个** |
| 前端 electronAPI 调用 | **37 个**（其中 2 个是事件订阅） |
| 前后端匹配 | **100%**（无未实现 API） |
| 数据库表 | **8 个**，其中 **2 个完全未用** |
| Skills 文件 | 5 personas + 4 channels = **9 个全部加载** |
| Prompt 模板 | outline / article / polish / craft-standard / craft-flux — **5 个实际加载** |
| 单元测试 | **26 用例** / 3 套件（queue / skills / prompts） |
| E2E 测试 | **3 用例**（IPC 注册表 / IPC handler / UI smoke） |

**整体完成度**：约 **75%** — 核心写作流程稳定可用，自动化（调度 / 发布 / RSS）和高级能力（ReAct 引擎 / 暗色模式 / MCP）待做。

---

## 1. 页面模块（src/pages/）

| 页面 | 行数 | hooks | IPCs | 状态 |
|---|---|---|---|---|
| **DashboardPage** | 340 | 9 | 5 | ✅ 完成 |
| **WritePage** | 981 | 34 | 11 | ✅ 核心完成（含队列 + 配图占位） |
| **ArticlesPage** | 1113 | 29 | 20 | ✅ 完成（最大模块） |
| **TopicsPage** | 43 | 2 | 0 | ⚠️ 骨架 |
| **SourcesPage** | 22 | 0 | 0 | ❌ 纯占位 |
| **ImagesPage** | 979 | 29 | 11 | ✅ 完成 |
| **SettingsPage** | 650 | 21 | 8 | ✅ 完成 |

### 1.1 DashboardPage ✅

**功能**：KPI 卡 + 当前 Agent 状态 + 快速开始 + 最近编辑 + 队列副本 + 首次启动引导。

| 子项 | 状态 | 备注 |
|---|---|---|
| 4 个 KPI 卡（总数/草稿/今日/字数） | ✅ | |
| 当前 Agent + 全部 4 CLI 就绪状态 | ✅ | |
| 4 个快速开始磁贴 | ✅ | |
| 最近 5 篇编辑 | ✅ | 点击跳详情 |
| 队列副本（任务运行时显示） | ✅ | |
| 首次启动引导横幅 | ✅ | 未检测到任意 CLI 时显示 |

### 1.2 WritePage ✅

**功能**：三步生成（主题→大纲→正文）+ 配图占位 + 二次润色 + 5 种导出。

| 子项 | 状态 |
|---|---|
| Step 1 主题输入 + 关键词 chips | ✅ |
| URL 抓取（Electron 内置 Chromium） | ✅ |
| 参考文提炼大纲 | ✅ |
| Step 2 大纲编辑 + `[已修订]` 检测 | ✅ |
| Step 3 正文生成 + Markdown 渲染 | ✅ |
| 配图占位 `[[配图:...@id]]` | ✅ 点击触发 AI |
| 二次润色 | ✅ |
| 导出 md / docx / pdf / html / png | ✅ |
| 队列接入 + 取消按钮 | ✅ v0.1 新增 |
| 主题输入 ⌘+Enter 快捷键 | ✅ |

**遗留 TODO**：`src/components/RichEditor.tsx:124` 注释「TODO: 调用 AI 生成并插入」— Tiptap 编辑器的 AI 辅助按钮未接入。

### 1.3 ArticlesPage ✅

**功能**：列表筛选 / 搜索 / 详情 Modal / 编辑 / 排程 / 发布 / 删除。

| 子项 | 状态 |
|---|---|
| 列表（5 种状态筛选 + 搜索） | ✅ |
| 详情 Modal（编辑 + 操作面板） | ✅ |
| Tiptap 富文本编辑 + 实时保存 | ✅ |
| 配图占位选择（自动生成 / 图库选 / 上传） | ✅ |
| 二次润色 | ✅ |
| 排程（datetime-local） | ✅ schema + IPC |
| 取消排程 / 标记发布 / 取消发布 | ✅ |
| 删除（含关联清理） | ✅ |
| 导出全部格式 | ✅ |

### 1.4 TopicsPage ⚠️

**真实状态**：43 行，**2 个 useState 但 0 个 IPC 调用**。

```tsx
// 当前只有三个 tab 切换 + 占位 Empty 卡片
// 没有真实「热点数据」「RSS 抓取」「我的选题库」
```

| 子项 | 状态 |
|---|---|
| 三个 tab（热点 / RSS / 我的） | ✅ UI |
| 热点数据展示 | ❌ 假数据 / 无数据源 |
| RSS 抓取 | ❌ 后端无实现 |
| 我的选题库（保存候选） | ❌ schema 无对应表 |
| 选题 → 文章生成跳转 | ❌ 未实现 |

### 1.5 SourcesPage ❌

**真实状态**：22 行，**0 hooks, 0 IPCs**。

```tsx
// 整个文件只是 PageHeader + 一个 Empty 卡片
// 「+ 添加博主」按钮无 onClick
```

| 子项 | 状态 |
|---|---|
| 添加博主 UI | ❌ |
| 列表展示 | ❌ |
| RSS 自动抓取 | ❌ |
| 抓取内容入选题库 | ❌ |

**侧边栏显示「⌘4」快捷键但点击进入的是一个空壳页面**。建议要么实现，要么从导航移除避免误导。

### 1.6 ImagesPage ✅

**功能**：图库浏览 / 筛选 / 搜索 / 单图详情 / 标签编辑 / 删除 / 跨文章应用。

| 子项 | 状态 |
|---|---|
| 尺寸分类筛选（9 个） | ✅ |
| 类别筛选（封面 / 配图 / 素材 / Banner 等） | ✅ |
| 关键词搜索 | ✅ |
| 单图详情面板 | ✅ |
| 标签编辑 | ✅ |
| 删除（DB + 文件 + 关联） | ✅ |
| 应用到文章占位符 | ✅ |
| 多 Provider 生成（带 fallback） | ✅ |
| Craft 双层 prompt 扩写 | ✅ |

### 1.7 SettingsPage ✅

**功能**：6 个配置区，覆盖所有可调参数。

| 子项 | 状态 |
|---|---|
| Agent CLI 切换 + 检测 | ✅ |
| Model 选择（手动 / opencode 拉取） | ✅ |
| 图片生图设置（Craft 开关） | ✅ |
| 图片 Provider CRUD | ✅ |
| 模型 CRUD | ✅（虽然前端未调用 saveImageModel，需 UI 触发） |
| 提示词模板实时编辑 | ✅ |
| 数据存储查看 | ✅ |

---

## 2. 任务队列（electron/queue.cjs）✅

| 子项 | 状态 |
|---|---|
| 全局 maxConcurrent 上限 | ✅ 默认 2 |
| perTypeConcurrent 限流 | ✅ 默认 1（同类串行） |
| Pending 任务取消 | ✅ |
| Running 任务取消（AbortSignal） | ✅ SIGTERM → 2s SIGKILL |
| 实时状态广播 | ✅ `queue:state` 事件 |
| 历史记录 | ✅ 保留 50 条 |
| 13 个单元测试 | ✅ 全过 |

**完成度 100%**。详见 `electron/queue.cjs` 注释。

---

## 3. 主进程（electron/）

| 模块 | 行数 | 状态 |
|---|---|---|
| `main.cjs` | ~200 | ✅ BrowserWindow + 协议 + 测试钩子 |
| `preload.cjs` | ~70 | ✅ contextBridge 完整 |
| `ipc.cjs` | ~800 | ✅ 43 handlers |
| `agent.cjs` | ~230 | ✅ spawn + abort signal |
| `db.cjs` | — | ✅ better-sqlite3 单例 |
| `schema.sql` | — | ✅ 8 表（2 表未用） |
| `skills.cjs` | — | ✅ frontmatter 解析 |
| `prompts.cjs` | — | ✅ Mustache-like 替换 |
| `fetcher.cjs` | — | ✅ Readability 算法 |
| `image-providers.cjs` | — | ✅ 多 Provider + fallback |
| `queue.cjs` | 200 | ✅ 任务队列 |
| `init-image-providers.cjs` | — | ✅ 默认数据 seed |

---

## 4. 数据库表使用情况

| 表 | 状态 | 用途 |
|---|---|---|
| `image_providers` | ✅ 活跃 | 7 处 db.prepare |
| `image_models` | ✅ 活跃 | 8 处 db.prepare |
| `provider_settings` | 🟡 兼容 | 3 处（保留旧版 Provider 配置） |
| `article_drafts` | ✅ 活跃 | 文章主表，5 处 UPDATE + 3 处 SELECT + 1 INSERT |
| `rss_sources` | ❌ **完全未用** | 仅 schema 中存在 |
| `rss_items` | ❌ **完全未用** | 仅 schema 中存在 |
| `images` | ✅ 活跃 | 图库主表 |
| `article_images` | ✅ 活跃 | 文章-图片关联 |

**建议**：要么实现 RSS 抓取（FEATURES §10 P0），要么移除这 2 个表保持 schema 整洁。

---

## 5. Skills 加载（electron/skills.cjs）

**加载机制**：`loadAllSkills()` 扫描 `src/skills/{personas,channels}/` 目录，解析 SKILL.md 的 frontmatter。

**已加载 9 个**：

| 类型 | 名称 | 用途 |
|---|---|---|
| Persona | authentic_seeder | 真实种草 |
| Persona | cold_analyst | 冷静分析 |
| Persona | knowledge_mentor | 知识导师 |
| Persona | viral_copywriter | 爆款写手 |
| Persona | warm_storyteller | 温暖叙事 |
| Channel | toutiao | 头条 |
| Channel | wechat | 公众号 |
| Channel | xiaohongshu | 小红书 |
| Channel | zhihu | 知乎 |

**调用方**：
- `WritePage` Step 1「高级」面板显示可选项
- IPC `article:outline` 和 `article:article` 都调用 `buildSkillInjection({ channel, persona })` 注入 prompt

**完成度 100%**。无遗留问题。

---

## 6. Prompt 模板（src/prompts/）

| 文件 | 是否实际加载 | 用途 |
|---|---|---|
| `outline.md` | ✅ | 大纲生成 |
| `article.md` | ✅ | 正文生成 |
| `polish.md` | ✅ | 二次润色 |
| `image/craft.md` | 🟡 兜底 | 旧版兼容（craft-standard 找不到时用） |
| `image/craft-standard.md` | ✅ | 通用 prompt 扩写 |
| `image/craft-flux.md` | ✅ | Flux 专属优化 |

**编辑流程**：设置页可实时编辑保存。无需重启。

**完成度 100%**。唯一缺位是缺少其他模型的 craft 模板（`craft-sdxl.md` / `craft-kontext.md`），但因为有 standard 兜底，不阻塞使用。

---

## 7. 测试覆盖

### 7.1 单元测试（vitest）— 26 用例

| 套件 | 用例 | 覆盖 |
|---|---|---|
| `queue.test.ts` | 13 | 任务队列全部行为 |
| `prompts.test.ts` | 7 | 模板变量替换 |
| `skills.test.ts` | 6 | frontmatter 解析 |

### 7.2 E2E 测试（playwright）— 3 用例

| 套件 | 覆盖 |
|---|---|
| `ipc-registry.spec.ts` | 全部 IPC channel 注册一致性 |
| `ipc-handlers.spec.ts` | 每个 handler 可被 invoke（最小 smoke） |
| `ui-smoke.spec.ts` | 应用启动 + 关键页面可渲染 |

### 7.3 测试钩子

5 个 test:* channels 在 `AUTOWRITER_TEST_MODE=1` 时注册：
- `test:list-channels`
- `test:invoke`
- `test:reset-db`
- `test:userdata`
- `test:exec-sql`

**完成度 90%**。可改进：
- ArticlesPage / WritePage / ImagesPage 缺单元测试
- 队列真实取消流程缺 e2e

---

## 8. 自动化流程（未实现）

| 流程 | 状态 | 影响 |
|---|---|---|
| **调度器**（扫 `scheduled_at` 自动发布） | ❌ 完全无代码 | 排程的文章不会自动触发 |
| **RSS 抓取**（`rss-parser` 入 `rss_items`） | ❌ 完全无代码 | 选题中心 / 博主源都没数据源 |
| **Publisher**（公众号 / 小红书 / 微博） | ❌ 无代码 | 「标记发布」只是改状态，不真发布 |
| **Agent ReAct Loop** | ❌ 当前是 spawn shim | 不能 Reason→Act→Observe 多步 |
| **MCP 客户端** | ❌ 无代码 | 无法连接外部 MCP server |

这 5 项是 P0/P1 路线图的核心。

---

## 9. 设计系统

| 子项 | 状态 |
|---|---|
| DESIGN.md 规范 | ✅ 16 KB 完整 |
| DESIGN.tokens.json | ✅ 完整 token |
| CSS 变量系统 | ✅ 28 个变量 |
| Card accent 变体 | ✅ 6 种（action / configure / system / insight / danger / default） |
| Lucide 图标 | ✅ 已替换所有 emoji-as-icon（遗留 ~13 处内容型 emoji，如日志） |
| 暗色模式 | ❌ DESIGN.md 提及但未实现 |
| 动画 / motion | ✅ t-fast / t / t-slow + spring easing |

---

## 10. 工程化

| 项 | 状态 |
|---|---|
| Git + 远程 GitHub | ✅ develop + main + branch protection |
| CODEOWNERS | ✅ 自动指派 @xp630 |
| ESLint | ✅ 配置但未集成 CI |
| TypeScript strict | ✅ 几乎 0 错误（仅 RichEditor / export.ts 有遗留） |
| 单元测试 CI | ⚠️ `.github/workflows/test.yml` 存在但需验证 |
| 发布 workflow | ❌ 未实现 |
| 错误边界 | ❌ 无 React ErrorBoundary |
| 性能优化（memo / callback） | 🟡 仅 7 处使用 |

---

## 11. 已识别的问题清单

### 🔴 关键（影响用户）

1. **TopicsPage 是空壳**（43 行，0 IPC）——「热点」和「我的选题库」无数据源
2. **SourcesPage 是空壳**（22 行）——整个页面只有一个 Empty 卡片
3. **调度器未实现** —— 排程发布只是 UI，无后台循环
4. **Publisher 未实现** —— 「标记发布」只是改 DB 状态

### 🟡 中等（影响体验）

5. **`provider_settings` 表是遗留** —— 新版用 `image_providers`，旧表保留但只 3 处引用
6. **`saveImageModel` / `image:provider:delete` 后端有但前端无 UI 暴露**
7. **`file:save-image` 后端有但前端无 API 暴露**（preload 没列）
8. **`image:provider:get-active` 后端有但前端从未调用**（实际取数走 `images:list`）
9. **RichEditor 中 `TODO: 调用 AI 生成并插入` 未完成**

### 🟢 低（影响美观）

10. **暗色模式未实现** —— DESIGN.md 提及但 CSS 无 `[data-theme="dark"]` 块
11. **13 处内容型 emoji 残留**（日志行 / 列表项）—— 已替换装饰型，但内容型保留是有意的
12. **无 React ErrorBoundary** —— 组件 throw 时整页空白

---

## 12. 后续优先级建议

### P0（必须做，否则「自动化」叙事不成立）

1. **调度器**（1-2 天）—— setInterval 扫表 + 触发 publisher 占位
2. **SourcesPage 移除或实现**（0.5 天）—— 二选一
3. **TopicsPage 数据源**（1-2 天）—— 接入「我的选题」表或干脆砍掉

### P1（用户能感知差异）

4. **Publisher：公众号**（3-5 天）—— playwright + 草稿模式
5. **RSS 抓取**（1 天）—— 已有 schema，只需 rss-parser + cron
6. **暗色模式**（2 天）—— 加 `[data-theme="dark"]` 块
7. **error boundary**（0.5 天）—— 避免白屏

### P2（技术债）

8. **ReAct Engine**（5-7 天）—— 替代 spawn shim
9. **MCP 客户端**（3-5 天）—— 外部工具接入
10. **性能优化**（2 天）—— memoize 列表渲染
11. **死代码清理**（1 天）—— provider_settings / unused IPC

---

**审计方法**：直接 grep + read 源码 + 前端/后端调用对账。所有「❌ / ⚠️」均经过实际代码验证，非主观判断。

**下次审计建议**：每次重大功能合并后更新本文件「11. 已识别的问题清单」一节。
