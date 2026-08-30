// QuickPublishPage — P1 Week 1（v2）：五步发布流水线
//   1 润色 → 2 排版 → 3 封面 → 4 配图 → 5 导出
// 设计原则（"不锁死"）：
//   - 每一步都可跳过；封面/配图缺任何一张都不阻塞导出
//   - 不接管创作（分析/策略/大纲都不在这里）
//   - 图片嵌入 dataURL 让 HTML 文件自带图；公众号端仍会要求重新上传（平台限制，UI 已提示）
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clipboard, FileDown, Image as ImageIcon, Sparkles, Wand2, X } from 'lucide-react';
import { beautifyHtml } from '../utils/quickPublishBeautify';
import { getAgentSettings } from '../utils/storage';
import { showToast } from '../toast';
import type { ImageRecord } from '../types';

type RoleKey = 'cover' | 'emotion' | 'explain' | 'closing';
const ROLE_LABEL: Record<RoleKey, string> = { cover: '封面', emotion: '情绪图', explain: '解释图', closing: '结尾图' };
const ROLE_HINT: Record<RoleKey, string> = {
  cover: '吸引点击，留标题空间，2.35:1',
  emotion: '承载段内情绪，放在开头之后',
  explain: '解释核心观点，放在观点盒之后',
  closing: '强化记忆，放在结尾之前',
};

const STEPS = ['润色', '排版', '封面', '配图', '导出'];

export function QuickPublishPage() {
  const settings = getAgentSettings();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState('');
  const [polishing, setPolishing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const [slots, setSlots] = useState<Record<RoleKey, string | null>>({ cover: null, emotion: null, explain: null, closing: null });
  const [prompts, setPrompts] = useState<Record<RoleKey, string>>({ cover: '', emotion: '', explain: '', closing: '' });
  const [busy, setBusy] = useState<RoleKey | null>(null);
  const [galleryFor, setGalleryFor] = useState<RoleKey | null>(null);
  const [gallery, setGallery] = useState<ImageRecord[] | null>(null);

  useEffect(() => { taRef.current?.focus(); }, []);

  const stats = useMemo(() => {
    const t = draft.trim();
    const zh = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    return { chars: t.length, zh };
  }, [draft]);

  // ── 自动提示词：从草稿提炼标题 / 观点句 / 图形类型 ──────────────
  const titleLine = useMemo(() => {
    const m = /^#\s+(.+)$/m.exec(draft);
    return m ? m[1].trim() : (draft.trim().split('\n')[0] || '').slice(0, 24);
  }, [draft]);
  const insightLine = useMemo(() => {
    const blocks = draft.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    const kw = /其实|真正的|藏着|背后|本质|真相|核心|而是|我想|看不见/;
    const hit = blocks.find((b) => (b.startsWith('**') && b.endsWith('**')) || (kw.test(b) && b.length >= 8 && b.length <= 120));
    return (hit || titleLine || '').replace(/\*\*/g, '').slice(0, 60);
  }, [draft, titleLine]);

  const autoPrompts = (): Record<RoleKey, string> => {
    const diagram = /对比|两种|差别|贵|便宜/.test(insightLine) ? '左右两栏对比图' :
      /流程|步骤|先|再|然后|→/.test(insightLine) ? '从左到右流程图' :
      /框架|四|三层|模型|三问|四问/.test(insightLine) ? '结构化框架图' : '概念信息图';
    return {
      cover: `${titleLine || insightLine}，极简杂志封面插画，主题：${insightLine}，构图留白给标题，画面中不要出现任何文字`,
      emotion: `${insightLine} —— 场景插画，承载这句话的情绪，真实克制，不要出现文字`,
      explain: `${diagram}：「${insightLine}」，简洁清晰，低饱和配色，图形为主、文字极少`,
      closing: `${insightLine} —— 结尾意象图，安静，留白，引人回味，不要出现文字`,
    };
  };
  // 进入 3/4 步时若提示词还是空的就自动填
  useEffect(() => {
    if (step >= 2 && !prompts.cover) setPrompts(autoPrompts());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, draft]);

  const runPolish = async () => {
    if (!draft.trim()) { showToast('❌ 内容为空'); return; }
    if (!window.electronAPI?.polishArticle) { showToast('❌ 未连接 AI Agent'); return; }
    setPolishing(true);
    try {
      const r = await window.electronAPI.polishArticle({
        cli: settings.cli, model: settings.model || undefined, content: draft,
        instruction: '润色全文：保持观点不动，改善句式与节奏，不做结构性改动',
      });
      if (r?.content?.trim()) {
        if (window.confirm('润色完成。用润色稿替换当前草稿？（取消 = 保留原稿）')) setDraft(r.content);
        showToast(`✨ 润色完成（${Math.round((r.elapsedMs || 0) / 1000)}s）`);
      } else showToast('❌ 润色结果为空');
    } catch (err: any) { showToast('❌ 润色失败：' + (err?.message || String(err))); }
    finally { setPolishing(false); }
  };

  const genImage = async (role: RoleKey) => {
    const p = prompts[role]?.trim();
    if (!p) { showToast('❌ 先写提示词'); return; }
    if (!window.electronAPI?.generateImage) { showToast('❌ 生图接口未就绪'); return; }
    setBusy(role);
    try {
      const dims = role === 'cover' ? { width: 1200, height: 510 } : { width: 1080, height: 720 };
      const r: any = await window.electronAPI.generateImage({ prompt: p, ...dims });
      const url = r?.url || r?.image?.url || r?.path || null;
      if (!url) throw new Error('生图返回为空');
      setSlots((s) => ({ ...s, [role]: url }));
      showToast(`✅ ${ROLE_LABEL[role]}已生成`);
    } catch (err: any) { showToast(`❌ ${ROLE_LABEL[role]}生成失败：` + (err?.message || String(err))); }
    finally { setBusy(null); }
  };

  const openGallery = async (role: RoleKey) => {
    setGalleryFor(role);
    if (!gallery && window.electronAPI?.listAllImages) {
      try { setGallery(await window.electronAPI.listAllImages()); } catch { setGallery([]); }
    }
  };

  // ── 导出 ─────────────────────────────────────────────
  const EXPORT_CSS = `* { box-sizing: border-box; }
body { margin: 0; padding: 28px 22px 80px; background: #f8fafb; color: #111827; font-family: -apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; font-size: 17px; line-height: 1.85; max-width: 720px; margin: 0 auto; }
p { margin: 0 0 1.2em; }
h1, h2, h3 { font-weight: 800; line-height: 1.45; margin: 1.4em 0 .6em; }
.qp-h1 { font-size: 26px; color: #047857; }
.qp-h2 { font-size: 22px; border-left: 4px solid #10b981; padding-left: 12px; color: #047857; }
.qp-h3 { font-size: 19px; color: #4a4a4a; }
.qp-viewpoint { background: #ecfdf5; border-left: 4px solid #10b981; padding: 14px 18px; margin: 1.2em 0; border-radius: 4px; font-weight: 500; }
.qp-quote { border-left: 4px solid #c8d9d3; padding: 8px 16px; margin: 1.2em 0; color: #374151; font-style: italic; background: #f1f5f4; }
.qp-list { padding-left: 1.6em; margin: 1em 0; }
.qp-divider { border: 0; height: 1px; background: #e2ebe7; margin: 2.2em auto; width: 48px; }
.qp-fig { margin: 1.6em 0; }
.qp-fig img { width: 100%; height: auto; border-radius: 6px; display: block; }
.qp-fig figcaption { font-size: 12px; color: #6b7280; text-align: center; margin-top: 6px; }
strong { font-weight: 700; color: #059669; }
a { color: #059669; }`;

  const buildFinalHtml = async (): Promise<string> => {
    const blocks = beautifyHtml(draft).split('\n');
    // 图片转 dataURL（文件自带图）
    const toData = async (u: string): Promise<string> => {
      try { const r = await window.electronAPI.readImageDataUrl(u); return (r as any)?.dataUrl || u; } catch { return u; }
    };
    const fig = async (role: RoleKey): Promise<string | null> => {
      const u = slots[role]; if (!u) return null;
      return `<figure class="qp-fig"><img src="${await toData(u)}" alt="${ROLE_LABEL[role]}"/><figcaption>${ROLE_LABEL[role]} · ${titleLine || ''}</figcaption></figure>`;
    };
    const firstViewpoint = blocks.findIndex((b) => b.includes('qp-viewpoint'));
    const closing = await fig('closing'); const explain = await fig('explain');
    const emotion = await fig('emotion'); const cover = await fig('cover');
    const out: string[] = [];
    blocks.forEach((b, i) => {
      if (i === 0 && cover) out.push(cover);
      out.push(b);
      if (i === 0 && emotion) out.push(emotion);
      if (i === firstViewpoint && explain) out.push(explain);
      if (i === blocks.length - 2 && closing) out.push(closing);
    });
    return `<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titleLine || '公众号文章'}</title>\n<style>\n${EXPORT_CSS}\n</style></head>\n<body>\n${out.join('\n')}\n</body>\n</html>`;
  };

  const exportHtml = async () => {
    if (!draft.trim()) { showToast('❌ 内容为空'); return; }
    try {
      const html = await buildFinalHtml();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ep-${(titleLine || 'article').slice(0, 12)}-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('✅ 发布稿已下载（公众号后台 → 导入文章 → 选此文件）');
    } catch (err: any) { showToast('❌ 导出失败：' + (err?.message || String(err))); }
  };

  const copyMarkdown = async () => {
    try { await navigator.clipboard.writeText(draft); showToast('✅ 原稿 Markdown 已复制'); }
    catch { showToast('❌ 复制失败'); }
  };

  const imgCount = Object.values(slots).filter(Boolean).length;

  return (
    <>
      <div className="qp-steps" role="tablist" aria-label="快速发布五步">
        {STEPS.map((label, i) => (
          <button key={label} type="button" role="tab" aria-selected={step === i}
            className={`qp-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            onClick={() => setStep(i)}>
            <span className="qp-step-no">{i < step ? <Check size={12} /> : i + 1}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Step 1 润色 */}
      {step === 0 && (
        <div className="qp-panel">
          <div className="qp-panel-head">
            <div>
              <strong>粘贴草稿，可选 AI 润色</strong>
              <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>观点不放进润色改——指令固定为"保持观点不动"</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={runPolish} disabled={!draft.trim() || polishing}>
                {polishing ? <Sparkles size={14} className="spin" /> : <Wand2 size={14} />} {polishing ? '润色中…' : 'AI 润色'}
              </button>
              <span className="muted" style={{ fontSize: 12 }}>{stats.zh} 字</span>
            </div>
          </div>
          <textarea ref={taRef} className="textarea qp-textarea" rows={22} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={'把你的草稿粘贴到这里：Claude/ChatGPT 成稿、Markdown、零散记录都行。\n\n润色是可选的——不润色直接进下一步也行。'} />
        </div>
      )}

      {/* Step 2 排版 */}
      {step === 1 && (
        <div className="qp-panel">
          <div className="qp-panel-head">
            <div>
              <strong>自动排版预览</strong>
              <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>观点盒 / 标题 / 引用 / 列表已自动识别；不满意的句子回第 1 步加 ** 包裹</span>
            </div>
          </div>
          <div className="qp-preview" dangerouslySetInnerHTML={{ __html: beautifyHtml(draft) || '<p className="muted">（草稿为空）</p>' }} />
        </div>
      )}

      {/* Step 3 封面 */}
      {step === 2 && (
        <div className="qp-panel">
          <div className="qp-panel-head">
            <div><strong>封面图</strong><span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{ROLE_HINT.cover}</span></div>
          </div>
          <ImageSlotUI role="cover" slots={slots} prompts={prompts} busy={busy}
            setPrompt={(v) => setPrompts((p) => ({ ...p, cover: v }))}
            onGenerate={genImage} onPickFromGallery={openGallery}
            onClear={() => setSlots((s) => ({ ...s, cover: null }))} />
        </div>
      )}

      {/* Step 4 配图 */}
      {step === 3 && (
        <div className="qp-panel">
          <div className="qp-panel-head">
            <div><strong>正文配图</strong><span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>每张图必须有角色——作用优先于好看；全部可跳过</span></div>
          </div>
          {(['emotion', 'explain', 'closing'] as RoleKey[]).map((r) => (
            <div key={r} className="qp-role-block">
              <div className="qp-role-label">{ROLE_LABEL[r]}<span className="muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{ROLE_HINT[r]}</span></div>
              <ImageSlotUI role={r} slots={slots} prompts={prompts} busy={busy}
                setPrompt={(v) => setPrompts((p) => ({ ...p, [r]: v }))}
                onGenerate={genImage} onPickFromGallery={openGallery}
                onClear={() => setSlots((s) => ({ ...s, [r]: null }))} compact />
            </div>
          ))}
        </div>
      )}

      {/* Step 5 导出 */}
      {step === 4 && (
        <div className="qp-panel">
          <div className="qp-panel-head">
            <div><strong>导出发布</strong><span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>HTML 文件已内嵌全部图片；公众号导入后请在图位置点选重新上传（平台限制）</span></div>
          </div>
          <div className="qp-export-summary">
            <div>标题：{titleLine || '（取第一段）'}</div>
            <div>正文：{stats.zh} 字</div>
            <div>配图：{imgCount}/4 张{imgCount < 4 && <span className="muted">（缺 {4 - imgCount} 张，不影响导出）</span>}</div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button type="button" className="btn btn-primary" onClick={exportHtml}><FileDown size={14} /> 下载发布稿 HTML</button>
            <button type="button" className="btn btn-outline" onClick={copyMarkdown}><Clipboard size={14} /> 复制原稿 Markdown</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>发布路径：公众号后台 → 图文编辑器 → ⋯ → 导入 → 选这个 HTML 文件 → 补传图片 → 发表。</p>
        </div>
      )}

      {/* 底部导航 */}
      <div className="qp-nav">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft size={13} /> 上一步
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep((s) => Math.min(4, s + 1))}>
          跳过此步
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep((s) => Math.min(4, s + 1))} disabled={step === 4}>
          {step === 3 ? '去导出' : '下一步'} <ArrowRight size={13} />
        </button>
      </div>

      {/* 图库选择弹层 */}
      {galleryFor && (
        <div className="qp-gallery-mask" onClick={() => setGalleryFor(null)}>
          <div className="qp-gallery" onClick={(e) => e.stopPropagation()}>
            <div className="qp-gallery-head">
              <strong>从图库选择 · {ROLE_LABEL[galleryFor]}</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGalleryFor(null)}><X size={14} /></button>
            </div>
            <div className="qp-gallery-grid">
              {(gallery || []).map((img) => (
                <button key={img.id} type="button" className="qp-gallery-cell" title={img.prompt}
                  onClick={() => { setSlots((s) => ({ ...s, [galleryFor]: img.url || img.file_path })); setGalleryFor(null); showToast(`✅ 已选为${ROLE_LABEL[galleryFor]}`); }}>
                  <img src={img.url || img.file_path} alt={img.prompt} loading="lazy" />
                </button>
              ))}
              {gallery && gallery.length === 0 && <div className="muted" style={{ padding: 20 }}>图库还没有图，先用"生成"或去图库页上传。</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── 单个图片槽位 UI ────────────────────────────────────────
function ImageSlotUI({ role, slots, prompts, busy, setPrompt, onGenerate, onPickFromGallery, onClear, compact }: {
  role: RoleKey; slots: Record<RoleKey, string | null>; prompts: Record<RoleKey, string>; busy: RoleKey | null;
  setPrompt: (v: string) => void; onGenerate: (r: RoleKey) => void; onPickFromGallery: (r: RoleKey) => void; onClear: () => void; compact?: boolean;
}) {
  const url = slots[role];
  return (
    <div className={`qp-slot ${compact ? 'qp-slot-compact' : ''}`}>
      {url ? (
        <div className="qp-slot-preview">
          <img src={url} alt={ROLE_LABEL[role]} />
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>移除</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onPickFromGallery(role)}><ImageIcon size={13} /> 换图</button>
          </div>
        </div>
      ) : (
        <>
          <textarea className="textarea" rows={compact ? 2 : 3} value={prompts[role]} onChange={(e) => setPrompt(e.target.value)}
            placeholder="生图提示词（已按你的标题与观点自动填，可改）" />
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onGenerate(role)} disabled={busy === role}>
              {busy === role ? <Sparkles size={13} className="spin" /> : <Wand2 size={13} />} {busy === role ? '生成中（约 30–60s）…' : `生成${ROLE_LABEL[role]}`}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onPickFromGallery(role)}><ImageIcon size={13} /> 从图库选</button>
          </div>
        </>
      )}
    </div>
  );
}
