// WritePage — 两步流程（主题 → 大纲 → 编辑 → 正文）
// CLI 设置从 localStorage.aw_settings 读取（设置页配置）

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '../components/PageHeader';
import { Stepper } from '../components/Stepper';
import { Card } from '../components/Card';
import { Empty } from '../components/Empty';
import { showToast } from '../toast';
import { exportArticle, EXPORT_OPTIONS } from '../utils/export';
import { Sparkles, Settings as SettingsIcon, Bot, Link2, FileEdit, Wand2, Image as ImageIcon, Loader2, ArrowRight, BarChart3 } from 'lucide-react';
import { AnalysisPanel } from '../components/AnalysisPanel';
import type { ContentAnalysisResult } from '../types';
import { getDraft, setDraft, clearDraft, type DraftState } from '../utils/storage';
import { useActiveProfile } from '../hooks/useActiveProfile';
// (FileEdit already imported for Card icon usage)


import type { ChannelSkill, PersonaSkill, GenerateResult } from '../types';

/** 智能分词：中文按 Intl.Segmenter + 标点拆分 */
function smartSplitKeywords(text: string): string[] {
  const base = text
    .split(/[,，;；|｜\n]+/)
    .flatMap(s => s.split(/\s+/))
    .map(s => s.trim())
    .filter(Boolean);
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    const out: string[] = [];
    const seg = new (Intl as any).Segmenter('zh-CN', { granularity: 'word' });
    for (const phrase of base) {
      // 短语里只要"有意义"的词（长度≥2，跳过单字 + 标点）
      for (const s of seg.segment(phrase)) {
        if (s.isWordLike && s.segment.length >= 2) out.push(s.segment);
      }
    }
    return [...new Set(out)];
  }
  return [...new Set(base)];
}

interface Settings {
  cli: 'pi' | 'claude' | 'opencode' | 'codex';
  model: string;
  track: string;    // 账号级赛道
  persona: string;  // 账号级人设（IP 口吻）
}


export function WritePage() {
  // ===== Agent 设置（从 localStorage 读，不再页面内选）=====
  const profile = useActiveProfile();
  const settings: Settings = { cli: profile.cli, model: profile.model, track: profile.track, persona: profile.persona };

  // ===== 流程 state =====
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState('');
  const [savedQuery, setSavedQuery] = useState('');  // 保存原始关键词，大纲编辑时清空 query 也能生成
  const [referenceUrl, setReferenceUrl] = useState('');
  // 从 localStorage 恢复草稿（如果有）
  // P0 内容分析
  const [analysis, setAnalysis] = useState<ContentAnalysisResult | null>(null);
  const [analysisId, setAnalysisId] = useState<number | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [analysisError, setAnalysisError] = useState<string>('');
  const analysisDomain = settings.track;   // 账号级赛道（设置页配）
  const [referenceText, setReferenceText] = useState('');
  const [fetching, setFetching] = useState(false);

  // ===== 每次生成可变的参数（保留写文章页）=====
  const persona = settings.persona;   // 账号级人设（设置页配）
  const [channel, setChannel] = useState(profile.defaultChannel || 'wechat');
  const [style, setStyle] = useState(profile.defaultStyle || 'tech');
  const [length, setLength] = useState('medium');
  // 切换身份时同步默认风格/渠道（除非用户本篇手改过——简单起见每次切身份都重置）
  useEffect(() => {
    setChannel(profile.defaultChannel || 'wechat');
    setStyle(profile.defaultStyle || 'tech');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);
  const [needImage, setNeedImage] = useState(true);  // 生成正文时是否插入 [[配图]] 占位
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ===== Skill 列表 =====
  const [skills, setSkills] = useState<{ channels: ChannelSkill[]; personas: PersonaSkill[] }>({
    channels: [], personas: [],
  });
  useEffect(() => {
    if (!window.electronAPI?.listSkills) return;
    window.electronAPI.listSkills().then(setSkills);
  }, []);

  // ===== 大纲 + 正文 =====
  const [outline, setOutline] = useState('');
  const [outlineDirty, setOutlineDirty] = useState(false);  // 用户改没改
  const [result, setResult] = useState<GenerateResult | null>(null);

  // ===== 参考文分析 =====
  const [analyzing, setAnalyzing] = useState(false);

  // ===== 进度 / 日志 =====
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState<'idle' | 'outline' | 'article' | 'analyze'>('idle');
  const [elapsed, setElapsed] = useState(0);  // 生成已用秒数
  const [logs, setLogs] = useState<Array<{ type: string; text: string; at: number }>>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 二次润色
  const [polishing, setPolishing] = useState(false);

  // 当前正在跑的队列任务 ID（用于取消真实子进程）
  const currentTaskIdRef = useRef<string | null>(null);

  // 订阅 Agent 实时进度
  useEffect(() => {
    if (!window.electronAPI?.onAgentChunk) return;
    const unsub = window.electronAPI.onAgentChunk((chunk) => {
      setLogs((prev) => [...prev, { ...chunk, at: Date.now() }]);
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 10);
    });
    return unsub;
  }, []);

  // 生成计时：generating 期间每 500ms 刷新已用秒数
  useEffect(() => {
    if (!generating) { setElapsed(0); return; }
    setElapsed(0);
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [generating]);

  const STEPS = [
    { label: '主题 / 参考' },
    { label: '生成大纲' },
    { label: '生成正文' },
  ];

  const fetchUrl = async () => {
    if (!referenceUrl.trim()) return;
    setFetching(true);
    setLogs([]); setStage('idle');
    setLogs((prev) => [...prev, { type: 'info', text: `📡 抓取 ${referenceUrl}`, at: Date.now() }]);

    try {
      const r = await window.electronAPI.fetchUrl(referenceUrl);
      const header = `# ${r.title}\n\n来源：${r.url}\n${r.byline ? '作者：' + r.byline + '\n' : ''}字数：${r.wordCount}\n抓取方式：${r.usedSelector || 'auto'}\n\n---\n\n`;
      setReferenceText(header + r.text);
      setLogs((prev) => [...prev, { type: 'info', text: `✅ 抓取成功（${r.wordCount} 字 · ${r.usedSelector || 'auto'}）`, at: Date.now() }]);
      // 自动提炼写作框架
      await analyzeFramework(header + r.text);
    } catch (err: any) {
      setLogs((prev) => [...prev, { type: 'error', text: `❌ ${err.message}`, at: Date.now() }]);
      setReferenceText(`# 抓取失败\n\nURL：${referenceUrl}\n错误：${err.message}\n\n请改用「参考文本」字段直接粘贴`);
    } finally {
      setFetching(false);
    }
  };

  // 提炼写作框架 = 直接生成大纲（框架即大纲，参考文是模板）
  const analyzeFramework = async (textOverride?: string) => {
    const text = textOverride || referenceText;
    if (!text || text.trim().length < 100) {
      setLogs((prev) => [...prev, { type: 'error', text: '参考文太短，无法提炼框架', at: Date.now() }]);
      return;
    }
    setAnalyzing(true);
    setLogs((prev) => [...prev, { type: 'info', text: `🧩 根据参考文框架生成大纲（${settings.cli}）...`, at: Date.now() }]);

    try {
      const keywords = query.split(/[,，\s]+/).filter(Boolean);
      const r = await window.electronAPI.generateOutline({
        cli: settings.cli,
        model: settings.model || undefined,
        title: '',
        keywords,
        style,
        length,
        channel,
        persona,
        track: analysisDomain || undefined,
        reference_text: text,
        reference_urls: referenceUrl ? [referenceUrl] : [],
      });
      currentTaskIdRef.current = r.taskId;
      setOutline(r.outline);       // 同时作为大纲，进入 Step 2 可编辑
      setOutlineDirty(false);
      setStep(1);                  // 跳到大纲编辑
      setLogs((prev) => [...prev, { type: 'done', text: `✅ 大纲已按参考文框架生成（${(r.elapsedMs / 1000).toFixed(1)}s），可编辑后生成正文`, at: Date.now() }]);
    } catch (err: any) {
      const cancelled = err?.code === 'ABORTED' || /cancelled/i.test(err?.message || '');
      setLogs((prev) => [...prev, { type: cancelled ? 'info' : 'error', text: cancelled ? '⛔ 框架提炼已取消' : `❌ ${err.message}`, at: Date.now() }]);
    } finally {
      currentTaskIdRef.current = null;
      setAnalyzing(false);
    }
  };

  // ===== Step 1 → Step 2：生成大纲 =====
  const generateOutline = async () => {
    if (!query.trim()) return;
    setGenerating(true);
    setStep(1);
    setStage('outline');
    setLogs([]);
    setOutline('');
    setResult(null);
    setSavedQuery(query);  // 保存原始关键词

    try {
      const keywords = query.split(/[,，\s]+/).filter(Boolean);
      const r = await window.electronAPI.generateOutline({
        cli: settings.cli,
        model: settings.model || undefined,
        title: '',
        keywords,
        style,
        length,
        channel,
        persona,
        track: analysisDomain || undefined,
        reference_text: referenceText,
        reference_urls: referenceUrl ? [referenceUrl] : [],
        analysis: analysis || undefined,
      });
      currentTaskIdRef.current = r.taskId;
      setOutline(r.outline);
      setOutlineDirty(false);
      setLogs((prev) => [...prev, { type: 'info', text: `✅ 大纲生成完成（${(r.elapsedMs / 1000).toFixed(1)}s）`, at: Date.now() }]);
    } catch (err: any) {
      const cancelled = err?.code === 'ABORTED' || /cancelled/i.test(err?.message || '');
      setLogs((prev) => [...prev, { type: cancelled ? 'info' : 'error', text: cancelled ? '⛔ 大纲生成已取消' : `❌ ${err.message}`, at: Date.now() }]);
      if (!cancelled) setStep(0);
    } finally {
      currentTaskIdRef.current = null;
      setGenerating(false);
      setStage('idle');
    }
  };

  // ===== Step 2 → Step 3：基于大纲生成正文 =====
  const generateArticle = async () => {
    if (!outline.trim()) {
      showToast('❌ 大纲为空');
      return;
    }
    
    // 优先用原始关键词，回退到当前 query
    const rawQuery = savedQuery || query;
    const keywords = rawQuery.split(/[,，\s]+/).filter(Boolean);
    if (keywords.length === 0 && !referenceText) {
      showToast('❌ 关键词为空，请返回 Step 1 填写主题');
      return;
    }
    
    setGenerating(true);
    setStep(2);
    setStage('article');
    setLogs([]);

    try {
      const keywords = query.split(/[,，\s]+/).filter(Boolean);
      const r = await window.electronAPI.generateArticle({
        cli: settings.cli,
        model: settings.model || undefined,
        title: '',
        keywords,
        style,
        length,
        channel,
        persona,
        track: analysisDomain || undefined,
        reference_text: referenceText,
        reference_urls: referenceUrl ? [referenceUrl] : [],
        outline: outlineDirty ? outline : outline,
        need_image: needImage,
        analysis: analysis || undefined,
      });
      currentTaskIdRef.current = r.taskId;
      setResult(r);
      clearDraft();  // 入库后清草稿
      setLogs((prev) => [...prev, { type: 'info', text: `✅ 正文生成完成（${(r.elapsedMs / 1000).toFixed(1)}s · ${r.wordCount} 字）`, at: Date.now() }]);
    } catch (err: any) {
      const cancelled = err?.code === 'ABORTED' || /cancelled/i.test(err?.message || '');
      setLogs((prev) => [...prev, { type: cancelled ? 'info' : 'error', text: cancelled ? '⛔ 正文生成已取消' : `❌ ${err.message}`, at: Date.now() }]);
      if (!cancelled) showToast('❌ 生成失败：' + err.message);
    } finally {
      currentTaskIdRef.current = null;
      setGenerating(false);
      setStage('idle');
    }
  };

  // ===== 取消生成 — 真的杀掉子进程（走队列）=====
  const cancelGeneration = async () => {
    const taskId = currentTaskIdRef.current;
    if (!taskId) {
      // 没起任务（状态不一致），只清本地 UI
      setGenerating(false);
      setStage('idle');
      return;
    }
    try {
      const r = await window.electronAPI.queueCancel(taskId);
      if (r.ok) {
        setLogs((prev) => [...prev, { type: 'info', text: '⛔ 已发送取消，等待子进程退出...', at: Date.now() }]);
        showToast('⛔ 正在取消...');
      } else {
        showToast('❌ 取消失败：' + (r.reason || 'unknown'));
      }
    } catch (err: any) {
      showToast('❌ 取消失败：' + err.message);
    }
    // 不在这里 setGenerating(false) — 让 finally 块来清理，避免“取消”后状态计不准
  };

  const CLI_LABEL: Record<string, string> = { pi: 'pi', claude: 'Claude Code', opencode: 'opencode', codex: 'Codex CLI' };

  // ===== 二次润色 =====
  const polishArticle = async () => {
    if (!result) return;
    const instruction = prompt('润色指令（例：让语言更口语化 / 加上数据论据 / 压缩到 1500 字）', '让语言更犀利、有金句感');
    if (!instruction) return;
    setPolishing(true);
    setLogs((prev) => [...prev, { type: 'info', text: `✨ 二次润色: ${instruction}`, at: Date.now() }]);
    try {
      const r = await window.electronAPI.polishArticle({
        cli: settings.cli,
        model: settings.model || undefined,
        content: result.content,
        instruction,
        channel,
        persona,
        track: analysisDomain || undefined,
        analysis: analysis || undefined,
      });
      currentTaskIdRef.current = r.taskId;
      setResult({ ...result, content: r.content });
      setLogs((prev) => [...prev, { type: 'done', text: `✅ 润色完成（${(r.elapsedMs / 1000).toFixed(1)}s）`, at: Date.now() }]);
      showToast('✅ 文章已润色');
    } catch (err: any) {
      const cancelled = err?.code === 'ABORTED' || /cancelled/i.test(err?.message || '');
      setLogs((prev) => [...prev, { type: cancelled ? 'info' : 'error', text: cancelled ? '⛔ 润色已取消' : `❌ ${err.message}`, at: Date.now() }]);
      if (!cancelled) showToast('❌ 润色失败：' + err.message);
    } finally {
      currentTaskIdRef.current = null;
      setPolishing(false);
    }
  };

  // ===== 复制全文 =====
  const copyContent = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('✅ 已复制全文到剪贴板');
    } catch {
      showToast('❌ 复制失败');
    }
  };

  // ===== 导出菜单状态 =====
  const [showExportMenu, setShowExportMenu] = useState(false);

  // ===== 导出处理 =====
  const handleExport = async (format: string) => {
    if (!result) return;
    setShowExportMenu(false);
    const filename = result.title || 'article';
    try {
      await exportArticle(format, result.content, filename, result.title);
      showToast(`✅ 已导出 ${format.toUpperCase()}`);
    } catch (err: any) {
      showToast('❌ 导出失败：' + err.message);
    }
  };

  // ===== 重新生成正文 =====
  const [regenerating, setRegenerating] = useState(false);
  const regenerateArticle = async () => {
    if (!outline.trim()) {
      showToast('❌ 大纲为空，请返回 Step 2');
      return;
    }
    const rawQuery = savedQuery || query;
    const keywords = rawQuery.split(/[,，\s]+/).filter(Boolean);
    if (keywords.length === 0 && !referenceText) {
      showToast('❌ 关键词为空，请返回 Step 1 填写主题');
      return;
    }
    setRegenerating(true);
    setLogs([]);
    setStage('article');
    try {
      const r = await window.electronAPI.generateArticle({
        cli: settings.cli,
        model: settings.model || undefined,
        title: '',
        keywords,
        style,
        length,
        channel,
        persona,
        track: analysisDomain || undefined,
        reference_text: referenceText,
        reference_urls: referenceUrl ? [referenceUrl] : [],
        outline: outlineDirty ? outline : outline,
        need_image: needImage,
        analysis: analysis || undefined,
      });
      currentTaskIdRef.current = r.taskId;
      setResult(r);
      setLogs((prev) => [...prev, { type: 'info', text: `✅ 正文重新生成完成（${(r.elapsedMs / 1000).toFixed(1)}s · ${r.wordCount} 字）`, at: Date.now() }]);
      showToast('✅ 文章已重新生成');
    } catch (err: any) {
      const cancelled = err?.code === 'ABORTED' || /cancelled/i.test(err?.message || '');
      setLogs((prev) => [...prev, { type: cancelled ? 'info' : 'error', text: cancelled ? '⛔ 已取消重新生成' : `❌ ${err.message}`, at: Date.now() }]);
      if (!cancelled) showToast('❌ 重新生成失败：' + err.message);
    } finally {
      currentTaskIdRef.current = null;
      setRegenerating(false);
      setStage('idle');
    }
  };

  // ===== 配图状态 =====
  const [generatingImages, setGeneratingImages] = useState<Record<string, boolean>>({});
  const [generatedImages, setGeneratedImages] = useState<Record<string, string>>({});

  // ===== 生成单张配图 =====
  const generateImage = async (picId: string, description: string) => {
    setGeneratingImages(prev => ({ ...prev, [picId]: true }));
    try {
      // 使用 Pollinations 生成图片
      const r = await window.electronAPI.generateImage({
        prompt: description,
        filename: `配图-${picId}`,
        width: 1200,
        height: 800,
        model: 'flux',
      });

      if (!r.ok) throw new Error('生成失败');

      // 读取图片数据 URL
      const dataUrlR = await window.electronAPI.readImageDataUrl(r.path || r.url);
      if (dataUrlR.ok && dataUrlR.dataUrl) {
        setGeneratedImages(prev => ({ ...prev, [picId]: dataUrlR.dataUrl }));
        showToast(`✅ 配图生成成功`);
      } else {
        throw new Error('读取图片失败');
      }
    } catch (err: any) {
      showToast('❌ 配图生成失败：' + err.message);
    } finally {
      setGeneratingImages(prev => ({ ...prev, [picId]: false }));
    }
  };

  // P0：跑内容分析（参考文 → AI 拆解 → 结构化结果）
  const runAnalysis = async () => {
    if (!referenceText || !referenceText.trim()) {
      showToast('❌ 先抓取或粘贴参考内容');
      return;
    }
    setAnalysisStatus('running');
    setAnalysisError('');
    setLogs((prev) => [...prev, { type: 'info', text: `🧠 内容分析中（参考文 ${referenceText.length} 字）…`, at: Date.now() }]);
    try {
      const r = await window.electronAPI.runAnalysis({
        title: query || '',
        content: referenceText,
        platform: '公众号 / 用户输入',
        author: '',
        source_url: referenceUrl || '',
        domain: analysisDomain || '',
      });
      if (!r.ok) {
        setAnalysisStatus('failed');
        setAnalysisError(r.error || '分析失败');
        showToast('❌ 分析失败：' + (r.error || '未知错误'));
        return;
      }
      setAnalysisId(r.id || null);
      setAnalysis(r.analysis || {});
      setAnalysisStatus('completed');
      setLogs((prev) => [...prev, { type: 'done', text: `✅ 内容分析完成（${((r.durationMs || 0) / 1000).toFixed(1)}s · 7 个维度）`, at: Date.now() }]);
      showToast('✅ 分析完成');
    } catch (err: any) {
      setAnalysisStatus('failed');
      setAnalysisError(err.message);
      showToast('❌ ' + err.message);
    }
  };


  useEffect(() => {
    const draft = getDraft();
    if (!draft) return;
    setQuery(draft.query || '');
    setReferenceUrl(draft.referenceUrl || '');
    setReferenceText(draft.referenceText || '');
    setOutline(draft.outline || '');
    setOutlineDirty(!!draft.outlineDirty);
    setChannel(draft.channel || 'wechat');
    setStyle(draft.style || 'tech');
    setLength(draft.length || 'medium');
    setNeedImage(draft.needImage !== false);
    setLogs((prev) => [...prev, {
      type: 'info',
      text: `📝 恢复了${draft.savedAt ? ' ' + new Date(draft.savedAt).toLocaleTimeString('zh-CN') : ''}保存的草稿`,
      at: Date.now(),
    }]);
  }, []);

  // 自动保存（debounced 1.5s）
  useEffect(() => {
    const timer = setTimeout(() => {
      const draft: DraftState = {
        query, referenceUrl, referenceText, outline, outlineDirty,
        channel, style, length, needImage,
      };
      setDraft(draft);
    }, 1500);
    return () => clearTimeout(timer);
  }, [query, referenceUrl, referenceText, outline, outlineDirty, channel, style, length, needImage]);

  // ===== 解析配图占位符 =====
  const parseImagePlaceholders = (content: string): { id: string; desc: string }[] => {
    const matches = content.matchAll(/\[\[配图:([^@]+)@(\w+)\]\]/g);
    return Array.from(matches).map(m => ({ desc: m[1], id: m[2] }));
  };

  return (
    <>
      <PageHeader
        title="写文章"
        subtitle={'主题 → 大纲（可改）→ 正文 · ' + (STEPS[step]?.label || '主题 / 参考')}
      />

      {/* 当前生效的 Agent 指示（从设置读，不可改）*/}
      <div className="info-bar">
        <Bot size={14} className="info-bar-icon" />
        <span className="info-bar-label">当前 Agent</span>
        <span className="info-bar-value">{CLI_LABEL[settings.cli] || settings.cli}</span>
        {settings.model && <span className="info-bar-meta mono">· {settings.model}</span>}
        <span className="info-bar-spacer" />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => showToast('去侧边栏「设置」修改')}>
          <SettingsIcon size={14} /> 设置
        </button>
      </div>

      <Stepper steps={STEPS} active={step} />

      {/* ===== Step 1: 主题 / 参考 ===== */}
      {step === 0 && (
        <Card title="Step 1 — 主题与参考" icon={FileEdit} accent="action">
          <textarea
            className="textarea"
            rows={3}
            placeholder="想写什么主题？例如：Sora 对短视频行业的冲击（可输入多个关键词，用逗号/空格分隔）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                generateOutline();
              }
            }}
            style={{ fontSize: 14 }}
          />

          {/* 关键词 chips 预览 */}
          {query.trim() && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4 }}>
                🔑 {smartSplitKeywords(query).length} 个关键词：
              </span>
              {smartSplitKeywords(query).slice(0, 12).map((kw, i) => (
                <span key={i} className="mono kw-chip">{kw}</span>
              ))}
              {smartSplitKeywords(query).length > 12 && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>...</span>
              )}
            </div>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <input
              className="input url-input"
              type="url"
              placeholder="📎 参考文章 URL（后续接 MCP 自动抓）"
              value={referenceUrl}
              onChange={(e) => setReferenceUrl(e.target.value)}
            />
            <button className="btn btn-outline btn-sm" disabled={!referenceUrl || fetching} onClick={fetchUrl}>
              {fetching ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} 抓取
            </button>
          </div>

          <div className="analysis-row">
                        <button
              className="write-analysis-trigger"
              disabled={!referenceText || analysisStatus === 'running'}
              onClick={runAnalysis}
              title="用 AI 拆解参考内容（主题/观点/爆点/结构/用户画像/可借鉴）"
            >
              {analysisStatus === 'running' ? <Loader2 size={12} className="spin" /> : <BarChart3 size={12} />}
              {analysisStatus === 'running' ? '分析中…' : '分析内容'}
            </button>
          </div>

          {referenceText && (
            <div className="card" style={{ marginTop: 12, padding: 12, background: 'var(--bg-soft)', fontSize: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="muted">📄 参考文已就绪（{referenceText.length} 字）</span>
                <div className="row">
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={!referenceText || analyzing || !query.trim()}
                    onClick={() => analyzeFramework()}
                    title="按参考文的写作框架生成大纲（框架=大纲）"
                  >
                    {analyzing ? '⏳ 生成中…' : '🧩 按参考文框架生成大纲'}
                  </button>
                </div>
              </div>

              {/* 全文展示（可滚动，默认折叠，点开看全部）*/}
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 11 }}>
                  查看全文（{referenceText.length} 字）
                </summary>
                <pre style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11, margin: '8px 0 0', lineHeight: 1.7 }}>
                  {referenceText}
                </pre>
              </details>
            </div>
          )}

          {/* P0：内容分析结果 */}
          {(analysisStatus === 'running' || analysisStatus === 'completed' || analysisStatus === 'failed') && (
            analysisStatus === 'running' ? (
              <div className="analysis-loading">
                <Loader2 size={20} className="spin" />
                <span>正在拆解这篇内容的主题、观点、爆点、结构、用户画像…</span>
              </div>
            ) : (
              <AnalysisPanel
                analysis={analysis || {}}
                status={analysisStatus === 'failed' ? 'failed' : 'completed'}
                error={analysisError}
                onStartWriting={() => {
                  // P0 §9.3：点击「开始写作」直接触发大纲生成（会自动带上分析上下文）
                  if (!query.trim()) {
                    showToast('❌ 请先填写主题（Step 1 顶部输入框）');
                    return;
                  }
                  setStep(1);
                    void generateOutline();
                  }}
              />
            )
          )}

          <div style={{ marginTop: 12 }}>
            <button className="btn btn-sm" onClick={() => setShowAdvanced(!showAdvanced)} style={{ color: 'var(--muted)' }}>
              {showAdvanced ? '▲ 收起' : '▼'} 高级设置（{skills.channels.length} 渠道 / {skills.personas.length} 人设）
            </button>
            {showAdvanced && (
              <div className="card" style={{ marginTop: 12, padding: 14, background: 'var(--bg-soft)' }}>
                <div className="col">
                  <div className="row">
                    <label style={{ minWidth: 80, fontSize: 12, color: 'var(--muted)' }}>渠道</label>
                    <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ flex: 1 }}>
                      <option value="">— 自定义 —</option>
                      {skills.channels.map((c) => (
                        <option key={c.name} value={c.name}>{c.displayName || c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="row">
                    <label style={{ minWidth: 80, fontSize: 12, color: 'var(--muted)' }}>赛道/人设</label>
                    <IdentityChip skills={skills} track={analysisDomain} persona={persona} />
                  </div>
                  <div className="row">
                    <label style={{ minWidth: 80, fontSize: 12, color: 'var(--muted)' }}>风格</label>
                    <select className="input" value={style} onChange={(e) => setStyle(e.target.value)} style={{ flex: 1 }}>
                      <option value="tech">技术分享</option>
                      <option value="news">新闻报道</option>
                      <option value="opinion">观点评论</option>
                      <option value="story">故事叙述</option>
                      <option value="knowledge">知识科普</option>
                    </select>
                  </div>
                  <div className="row">
                    <label style={{ minWidth: 80, fontSize: 12, color: 'var(--muted)' }}>长度</label>
                    <select className="input" value={length} onChange={(e) => setLength(e.target.value)} style={{ flex: 1 }}>
                      <option value="short">短 (800-1200字)</option>
                      <option value="medium">中 (1500-2500字)</option>
                      <option value="long">长 (3000+字)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={!query.trim() || generating} onClick={generateOutline}>
              {generating && stage === 'outline' ? <><Loader2 size={14} className="spin" /> 生成大纲中…</> : <>生成大纲 <ArrowRight size={14} /></>}
            </button>
          </div>
        </Card>
      )}

      {/* ===== Step 2: 编辑大纲 ===== */}
      {step === 1 && (
        <Card title="Step 2 — 编辑大纲（可手动调整）" icon={FileEdit} accent="action">
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            💡 你可以直接修改大纲。改过的章节会被标 [已修订]，Agent 会严格遵循。
          </div>
          {generating && stage === 'outline' && !outline ? (
            <div className="gen-loading">
              <div className="gen-loading-head">
                <Loader2 size={16} className="spin" />
                <span>Agent 正在生成大纲…已用时 {elapsed}s</span>
              </div>
              <div className="gen-skeleton"><i/><i/><i/><i/><i/></div>
            </div>
          ) : (
          <textarea
            className="textarea"
            rows={12}
            value={outline}
            onChange={(e) => {
              setOutline(e.target.value);
              setOutlineDirty(true);
            }}
            style={{ fontSize: 13, lineHeight: 1.7 }}
          />
          )}

          {/* 生成正文前参数确认面板 */}
          <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--line-light)', borderRadius: 10, border: '1px solid var(--line-soft)' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--line-2)' }}>
                🎛️ 生成正文参数
              </div>
              <button
                className="btn btn-sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ color: 'var(--muted)', padding: '0 4px' }}
              >
                {showAdvanced ? '收起' : '展开'}高级设置
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              <div className="col" style={{ gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>风格</label>
                <select className="input" value={style} onChange={(e) => setStyle(e.target.value)} style={{ padding: '5px 8px', fontSize: 12 }}>
                  <option value="tech">技术分享</option>
                  <option value="news">新闻报道</option>
                  <option value="opinion">观点评论</option>
                  <option value="story">故事叙述</option>
                  <option value="knowledge">知识科普</option>
                </select>
              </div>
              <div className="col" style={{ gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>长度</label>
                <select className="input" value={length} onChange={(e) => setLength(e.target.value)} style={{ padding: '5px 8px', fontSize: 12 }}>
                  <option value="short">短 (800-1200)</option>
                  <option value="medium">中 (1500-2500)</option>
                  <option value="long">长 (3000+)</option>
                </select>
              </div>
              <div className="col" style={{ gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>渠道</label>
                <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ padding: '5px 8px', fontSize: 12 }}>
                  <option value="">— 自定义 —</option>
                  {skills.channels.map((c) => (
                    <option key={c.name} value={c.name}>{c.displayName || c.name}</option>
                  ))}
                </select>
              </div>
              <div className="col" style={{ gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>赛道/人设</label>
                <IdentityChip skills={skills} track={analysisDomain} persona={persona} compact />
              </div>
              <div className="col" style={{ gap: 4, justifyContent: 'flex-end' }}>
                <label className="row" style={{ gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={needImage} onChange={(e) => setNeedImage(e.target.checked)} />
                  🖼️ 正文自动配图（插入占位）
                </label>
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setStep(0)}>← 返回 Step 1</button>
            <div className="row">
              <button className="btn btn-outline btn-sm" disabled={generating} onClick={generateOutline}>
                🔄 重生成大纲
              </button>
              <button className="btn btn-primary" disabled={!outline.trim() || generating} onClick={generateArticle}>
                {generating && stage === 'article' ? '⏳ 生成正文中…' : '✍️ 生成正文 →'}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ===== Step 3: 正文结果 ===== */}
      {step === 2 && result && (
        <Card title={`Step 3 — ${result.title}（${result.wordCount} 字 · ${(result.elapsedMs / 1000).toFixed(1)}s）`} icon={Sparkles} accent="action">
          {/* 配图提示 */}
          {parseImagePlaceholders(result.content).length > 0 && (
            <div className="image-hint">
              <ImageIcon size={20} className="image-hint-icon" />
              <div>
                <div className="image-hint-title">
                  检测到 {parseImagePlaceholders(result.content).length} 个配图占位符
                </div>
                <div className="image-hint-sub">
                  点击占位符可 AI 生成配图，也可导出后手动处理
                </div>
              </div>
            </div>
          )}
          {/* Markdown 渲染（标题/列表/引用/代码块/表格都好看）*/}
          <div
            className="md-body"
            style={{
              maxHeight: 520,
              overflow: 'auto',
              padding: '14px 18px',
              background: 'var(--bg-soft)',
              borderRadius: 10,
              border: '1px solid var(--border)',
              fontSize: 14,
              lineHeight: 1.85,
              fontFamily: 'var(--font-serif)',
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children, node }) => {
                  // 检测段落中是否有配图占位符
                  const text = String(children);
                  const matches = text.matchAll(/\[\[配图:([^@]+)@(\w+)\]\]/g);
                  const placeholders = Array.from(matches).map(m => ({ desc: m[1], id: m[2] }));

                  if (placeholders.length === 0) {
                    return <p>{children}</p>;
                  }

                  return (
                    <p>
                      {text.split(/(\[\[配图:[^\]]+\]\])/).map((part, i) => {
                        const match = part.match(/\[\[配图:([^@]+)@(\w+)\]\]/);
                        if (!match) return part;
                        const [, desc, picId] = match;
                        const existingImage = generatedImages[picId];
                        const isGenerating = generatingImages[picId];

                        if (existingImage) {
                          return (
                            <div key={i} style={{ margin: '20px 0', textAlign: 'center' }}>
                              <img src={existingImage} alt={desc} style={{ maxWidth: '100%', borderRadius: 12, boxShadow: 'var(--shadow-md)' }} />
                              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{desc}</p>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={i}
                            onClick={() => generateImage(picId, desc)}
                            style={{
                              margin: '20px 0',
                              padding: '24px',
                              background: isGenerating ? 'var(--line-light)' : 'var(--line-light)',
                              border: '2px dashed var(--line)',
                              borderRadius: 12,
                              textAlign: 'center',
                              cursor: isGenerating ? 'default' : 'pointer',
                              transition: 'all 0.2s',
                            }}
                          >
                            {isGenerating ? (
                              <span>⏳ 正在生成：{desc}</span>
                            ) : (
                              <>
                                <div style={{ fontSize: 24, marginBottom: 8 }}>🖼️</div>
                                <strong style={{ color: 'var(--line-2)' }}>点击生成配图</strong>
                                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{desc}</p>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </p>
                  );
                },
              }}
            >
              {result.content}
            </ReactMarkdown>
          </div>
          <div style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}>
            {/* 左侧：工具按钮 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={polishArticle}
                disabled={polishing}
                style={{
                  padding: '7px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--ink-3)',
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {polishing ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} 二次润色
              </button>
              <button
                onClick={regenerateArticle}
                disabled={regenerating}
                style={{
                  padding: '7px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--ink-3)',
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {regenerating ? '⏳' : '🔄'} 重新生成
              </button>
              <button
                onClick={() => copyContent(result.content)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--ink-3)',
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                📋 复制
              </button>
            </div>
            {/* 右侧：导出按钮 */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                style={{
                  padding: '7px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--line)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                📥 导出 {showExportMenu ? '▲' : '▼'}
              </button>
              {showExportMenu && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    right: 0,
                    marginBottom: 8,
                    background: '#fff',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    boxShadow: 'var(--shadow-lg)',
                    padding: 6,
                    minWidth: 150,
                    zIndex: 1001,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handleExport('docx')}
                    className="menu-item"
                  >📄 Word</button>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="menu-item"
                  >📑 PDF</button>
                  <button
                    onClick={() => handleExport('md')}
                    className="menu-item"
                  >📝 Markdown</button>
                  <button
                    onClick={() => handleExport('html')}
                    className="menu-item"
                  >🌐 HTML</button>
                  <button
                    onClick={() => handleExport('png')}
                    className="menu-item"
                  >🖼️ 图片</button>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ===== 生成中醒目提示 ===== */}
      {generating && (
        <Card style={{ marginBottom: 16, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 32 }}>
              <span className="gen-spinner">⚙️</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>
                {stage === 'outline' ? '🖋️ 正在生成大纲…' : stage === 'article' ? '✍️ 正在生成正文…' : stage === 'analyze' ? '🧩 正在分析参考文框架…' : '⏳ 处理中…'}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                已用时 <span className="mono" style={{ fontWeight: 600 }}>{elapsed}s</span> · 可查看下方日志了解进度
              </div>
            </div>
            <button 
              className="btn btn-outline"
              onClick={cancelGeneration}
              style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
            >
              ⛔ 取消
            </button>
          </div>
        </Card>
      )}

      {/* ===== 日志面板（仅在生成中或有日志时显示） ===== */}
      {(logs.length > 0 || generating) && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
            📊 {stage === 'outline' ? '生成大纲中' : stage === 'article' ? '生成正文中' : stage === 'analyze' ? '分析中' : '日志'}
            {generating && <span className="pulse-dot" style={{ marginLeft: 8 }} />}
          </div>
          <div
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              overflowX: 'hidden',
              wordBreak: 'break-word',
              padding: 10,
              background: '#0e1413',
              color: '#b8c4bf',
              borderRadius: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>等待 agent 输出...</div>
            ) : (
              logs.map((l, i) => {
                const colorMap: Record<string, string> = {
                  stdout: '#b8c4bf', info: '#38bdf8', error: '#f43f5e', stderr: '#fbbf24', done: '#14b789', sys: '#a78bfa',
                };
                // sys = 完整提示词，默认折叠，避免刷屏撑大面板
                if (l.type === 'sys') {
                  return (
                    <details key={i} className="log-sys">
                      <summary>📝 提示词（{l.text.length} 字）</summary>
                      <pre>{l.text}</pre>
                    </details>
                  );
                }
                return (
                  <div key={i} style={{ color: colorMap[l.type] || '#b8c4bf' }}>
                    <span style={{ color: 'var(--muted)', marginRight: 6 }}>
                      {new Date(l.at).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                    {l.text}
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </>
  );
}


// 身份 chip：只读显示账号级「赛道 + 人设」，去设置页改
function IdentityChip({ skills, track, persona, compact }: {
  skills: { channels: ChannelSkill[]; personas: PersonaSkill[] };
  track: string; persona: string; compact?: boolean;
}) {
  const trackLabel = track || '未设赛道';
  const p = skills.personas.find(x => x.name === persona);
  const personaLabel = p ? (p.displayName || p.name) : '未设人设';
  return (
    <span className={compact ? 'identity-chip identity-chip-compact' : 'identity-chip'}
          title="赛道与人设在「设置 → 我的赛道与人设」里配置（账号级，设一次）">
      <span className="identity-track">{trackLabel}</span>
      <span className="identity-sep">·</span>
      <span className="identity-persona">{personaLabel}</span>
    </span>
  );
}
