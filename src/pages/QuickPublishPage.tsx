// QuickPublishPage — P1 Week 1：把"已经写好的草稿"快速变成可发布的公众号稿
// 设计原则（"不锁死"）：
//   1. 不接管创作过程（不分析、不抓取、不出策略、不出大纲）
//   2. 只做最后两步：粘贴 → 复制/导出
//   3. 润色在外部（Claude / ChatGPT）完成，这条路只搬运
import { useEffect, useMemo, useRef, useState } from 'react';
import { Clipboard, ClipboardCheck, FileDown, Wand2, Zap } from 'lucide-react';
import { getAgentSettings } from '../utils/storage';
import { useActiveProfile } from '../hooks/useActiveProfile';
import { beautifyHtml } from '../utils/quickPublishBeautify';
import { PageHeader } from '../components/PageHeader';
import { showToast } from '../toast';

export function QuickPublishPage() {
  const profile = useActiveProfile();
  const agentSettings = getAgentSettings();
  const [draft, setDraft] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [polishInstruction, setPolishInstruction] = useState('润色全文：保持观点不动，改善句式与节奏');
  const [copiedMd, setCopiedMd] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // 进来自动 focus
  useEffect(() => { taRef.current?.focus(); }, []);

  const stats = useMemo(() => {
    const t = draft.trim();
    if (!t) return { chars: 0, words: 0, lines: 0 };
    const chars = t.length;
    // 中英文混合：中文按字数算，英文按空格分词
    const zh = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    const en = t.replace(/[\u4e00-\u9fa5]/g, '').trim().split(/\s+/).filter(Boolean).length;
    const lines = t.split('\n').length;
    return { chars, words: zh + en, lines };
  }, [draft]);

  /** 复制 Markdown 到剪贴板（公众号后台编辑器粘贴 Markdown 用） */
  const copyMarkdown = async () => {
    if (!draft.trim()) { showToast('❌ 内容为空'); return; }
    try {
      await navigator.clipboard.writeText(draft);
      setCopiedMd(true);
      showToast('✅ Markdown 已复制');
      setTimeout(() => setCopiedMd(false), 1500);
    } catch (err: any) {
      showToast('❌ 复制失败：' + (err?.message || '请检查剪贴板权限'));
    }
  };



  /** AI 润色（可选）。调用 article:polish IPC。
   * 注意：这条路核心是"搬运"，润色会稀释你的原意。
   * 所以默认 instruction 是"保持观点不动,改善句式与节奏"。 */
  const runPolish = async () => {
    if (!draft.trim()) { showToast('❌ 内容为空'); return; }
    if (!window.electronAPI?.polishArticle) { showToast('❌ 未连接 AI Agent'); return; }
    setPolishing(true);
    try {
      const r = await window.electronAPI.polishArticle({
        cli: agentSettings.cli,
        model: agentSettings.model || undefined,
        content: draft,
        instruction: polishInstruction,
      });
      if (r?.content && r.content.trim()) {
        setDraft(r.content);
        const sec = Math.round((r.elapsedMs || 0) / 1000);
        showToast(`✨ 润色完成（${sec}s）`);
      } else {
        showToast('❌ 润色结果为空');
      }
    } catch (err: any) {
      showToast('❌ 润色失败：' + (err?.message || String(err)));
    } finally {
      setPolishing(false);
    }
  };

  /** 导出 HTML 文件（公众号"导入 Word/Html"功能用） */
  const exportHtml = () => {
    if (!draft.trim()) { showToast('❌ 内容为空'); return; }
    const body = beautifyHtml(draft);
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>公众号文章</title><style>
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 22px 80px; background: #f8fafb; color: #111827; font-family: -apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; font-size: 17px; line-height: 1.85; max-width: 720px; margin: 0 auto; }
p { margin: 0 0 1.2em; }
h1, h2, h3 { font-weight: 800; line-height: 1.45; margin: 1.4em 0 .6em; }
.qp-h1 { font-size: 26px; color: #047857; }
.qp-h2 { font-size: 22px; border-left: 4px solid #10b981; padding-left: 12px; color: #047857; }
.qp-h3 { font-size: 19px; color: #4a4a4a; }
/* 观点盒：浅绿底 + 系统主色绿边（与 DESIGN.tokens.json primary 100/500 一致） */
.qp-viewpoint { background: #ecfdf5; border-left: 4px solid #10b981; padding: 14px 18px; margin: 1.2em 0; border-radius: 4px; font-weight: 500; }
.qp-quote { border-left: 4px solid #c8d9d3; padding: 8px 16px; margin: 1.2em 0; color: #374151; font-style: italic; background: #f1f5f4; }
.qp-list { padding-left: 1.6em; margin: 1em 0; }
strong { font-weight: 700; color: #059669; }
a { color: #059669; }
</style></head><body>${body}</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    a.href = url;
    a.download = `article-${stamp}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✅ HTML 文件已下载');
  };

  /** 一键清空 */
  const clearDraft = () => {
    if (!draft) return;
    if (!window.confirm('清空当前草稿？')) return;
    setDraft('');
    showToast('🧹 已清空');
  };

  return (
    <>
      <PageHeader
        title="快速发布"
        subtitle={'粘贴你已经在外部写好的草稿 → 复制到公众号编辑器 或 下载 HTML 文件 → 导入公众号后台'}
      />

      <div className="qp-toolbar">
        <div className="qp-stats">
          <span className="qp-stat-chip">{stats.chars.toLocaleString()} 字</span>
          <span className="qp-stat-chip">{stats.lines} 行</span>
        </div>
        <div className="qp-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              const inst = window.prompt('润色指令（默认 = 改善句式与节奏，保持观点不动）：', polishInstruction);
              if (inst === null) return;
              if (inst.trim()) setPolishInstruction(inst.trim());
              void runPolish();
            }}
            disabled={!draft.trim() || polishing}
            title="调用 AI Agent 润色（保持观点不动，仅改善句式与节奏）"
          >
            {polishing ? <span className="spin">⏳</span> : <Wand2 size={14} />}
            {polishing ? '润色中…' : 'AI 润色'}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={copyMarkdown}
            disabled={!draft.trim()}
            title="复制 Markdown 到剪贴板（公众号编辑器粘贴用）"
          >
            {copiedMd ? <ClipboardCheck size={14} /> : <Clipboard size={14} />}
            {copiedMd ? '已复制' : '复制 Markdown'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={exportHtml}
            disabled={!draft.trim()}
            title="下载 HTML 文件（公众号后台 → 导入文章 用）"
          >
            <FileDown size={14} /> 导出 HTML
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={clearDraft}
            disabled={!draft}
            title="清空当前草稿"
          >
            🧹 清空
          </button>
        </div>
      </div>

      <textarea
        ref={taRef}
        className="textarea qp-textarea"
        rows={24}
        placeholder={`粘贴草稿到这里：

- Claude / ChatGPT 对话（复制粘贴最后的成稿）
- 你在其他编辑器里写的 Markdown
- 公众号后台之前的草稿
- 任何 Markdown 文本

不分析、不抓取、不生成大纲、不生成配图 — 这些都在外部做完了。
这里只做最后一步：搬运。

快捷键：
  ⌘+A 全选 → ⌘+C 复制 / ⌘+V 粘贴
  Tab/Shift+Tab 可缩进（如果编辑器支持）`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />

      <div className="qp-hint">
        <Zap size={13} />
        <span>这条路<strong>不替代写文章</strong>——只是把"写好的稿"快速变成可发布的格式。写作过程去「写文章」页。</span>
      </div>
    </>
  );
}
