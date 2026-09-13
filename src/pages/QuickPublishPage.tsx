// QuickPublishPage — P1（v4 定稿）：四步发布流水线
//   1 润色 → 2 排版（点击改判） → 3 配图 → 4 导出
// 决策记录（2026-08-31 定稿）：
//   - 配图保留：图的职责是降低阅读成本（情绪/解释/收尾），不是装饰
//   - AI 生图保留，但**只走正经 provider**（设置 → 生图 Provider）：
//       免费通道 Pollinations 已下线（质量不可接受），provider 架构保持可插拔——
//       以后出现高质量免费源，加配置即可回来
//   - 生成必须"契合文章"：提示词自动从标题 + 观点句 + 图形角色推导，可手改
//   - 封面双路：排版封面（本地 Canvas，零依赖确定性）或 provider 生图
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clipboard, FileDown, ImageIcon, Sparkles, Wand2, X } from 'lucide-react';
import { beautifyHtml } from '../utils/quickPublishBeautify';
import { getAgentSettings } from '../utils/storage';
import { showToast } from '../toast';
import type { ImageRecord } from '../types';

type SlotKey = 'cover' | 'emotion' | 'explain' | 'closing';
const SLOT_LABEL: Record<SlotKey, string> = { cover: '封面', emotion: '情绪图', explain: '解释图', closing: '结尾图' };
const SLOT_HINT: Record<SlotKey, string> = {
  cover: '吸引点击；建议用下方"排版封面"或自选高质量图',
  emotion: '承载情绪——插在开头段之后',
  explain: '解释观点（对比/流程/框架图最佳）——插在观点盒之后',
  closing: '强化记忆——插在结尾之前',
};

const STEPS = ['润色', '排版', '配图', '导出'];

export function QuickPublishPage() {
  const settings = getAgentSettings();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [boxOverrides, setBoxOverrides] = useState<Record<number, boolean>>({});
  const [slots, setSlots] = useState<Record<SlotKey, string | null>>({ cover: null, emotion: null, explain: null, closing: null });
  const [galleryFor, setGalleryFor] = useState<SlotKey | null>(null);
  const [gallery, setGallery] = useState<ImageRecord[] | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { taRef.current?.focus(); }, []);

  const stats = useMemo(() => ({ zh: (draft.match(/[\u4e00-\u9fa5]/g) || []).length }), [draft]);
  const titleLine = useMemo(() => {
    const m = /^#\s+(.+)$/m.exec(draft);
    return m ? m[1].trim() : (draft.trim().split('\n')[0] || '').slice(0, 24);
  }, [draft]);
  const insightLine = useMemo(() => {
    const blocks = draft.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    const kw = /其实|真正的|藏着|藏在|背后|本质|真相|核心|而是|我想|看不见/;
    const hit = blocks.find((b) => (b.startsWith('**') && b.endsWith('**')) || (kw.test(b) && b.length >= 8 && b.length <= 120));
    return (hit || titleLine || '').replace(/\*\*/g, '').slice(0, 40);
  }, [draft, titleLine]);

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

  // ── 排版步 ──────────────────────────────────────────
  const draftBlocks = useMemo(() => (draft.trim() ? beautifyHtml(draft).split('\n') : []), [draft]);
  const isBox = (b: string) => b.includes('qp-viewpoint');
  const flipped = (b: string, i: number) => (boxOverrides[i] ? !isBox(b) : isBox(b));
  const toggleBox = (i: number) => setBoxOverrides((o) => ({ ...o, [i]: !o[i] }));
  const boxTotal = draftBlocks.filter((b, i) => flipped(b, i)).length;

  /**
   * 改判的唯一实现：预览与导出共用。
   * bug 回归记录（owner 实测）：之前降级只在导出里做、预览靠外层 wrapper 加框——
   * 外层 class 能"加框"（升级可见），摘不掉内层 .qp-viewpoint（降级不可见）。
   * 现在统一：改判直接作用在块 HTML 本身，预览所见即导出所得。
   */
  const blockHtml = (b: string, i: number): string => {
    if (!boxOverrides[i]) return b;
    return isBox(b)
      ? b.replace(' class="qp-viewpoint"', '')
      : `<div class="qp-viewpoint">${b.replace(/^<p>/, '').replace(/<\/p>$/, '')}</div>`;
  };

  // ── 配图步 ──────────────────────────────────────────
  const [busy, setBusy] = useState<SlotKey | null>(null);
  const [prompts, setPrompts] = useState<Record<SlotKey, string>>({ cover: '', emotion: '', explain: '', closing: '' });

  /** 契合文章的自动提示词：标题 + 观点句 + 图形角色（解释图按内容判型：对比/流程/框架） */
  const autoPrompts = (): Record<SlotKey, string> => {
    const diagram = /对比|两种|差别|贵|便宜/.test(insightLine) ? '左右两栏对比图'
      : /流程|步骤|先|再|然后|→/.test(insightLine) ? '从左到右流程图'
      : /框架|四|三层|模型|三问|四问/.test(insightLine) ? '结构化框架图'
      : '概念信息图';
    return {
      cover: `杂志封面插画：「${titleLine || insightLine}」。极简，大量留白给标题位，不出现任何文字`,
      emotion: `场景插画：一个人深夜看手机屏幕的微光，安静、若有所思，真实克制，低饱和配色，不要文字`,
      explain: `${diagram}：「${insightLine}」。简洁清晰，图形为主，极少文字，翡翠绿与米白配色`,
      closing: `概念插画：一颗种子在安静的画面里发芽，留白大，克制，收束感，不要文字`,
    };
  };
  useEffect(() => {
    if (step === 2 && !prompts.cover && draft.trim()) setPrompts(autoPrompts());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, draft]);

  const genImage = async (slot: SlotKey) => {
    const p = (prompts[slot] || autoPrompts()[slot]).trim();
    if (!p) { showToast('❌ 先写提示词'); return; }
    if (!window.electronAPI?.generateImage) { showToast('❌ 生图接口未就绪'); return; }
    setBusy(slot);
    try {
      const dims = slot === 'cover' ? { width: 1200, height: 510 } : { width: 1080, height: 720 };
      const r = await window.electronAPI.generateImage({ prompt: p, ...dims, tags: `qp,${slot}` });
      if (!r.ok) { showToast('⚠️ ' + (r.error || '生图失败')); return; }
      if (r.url) { setSlots((x) => ({ ...x, [slot]: r.url! })); showToast(`✅ ${SLOT_LABEL[slot]}已生成（${r.provider || 'provider'}）`); }
    } catch (err: any) { showToast('❌ ' + (err?.message || String(err))); }
    finally { setBusy(null); }
  };

  const openGallery = async (slot: SlotKey) => {
    setGalleryFor(slot);
    if (!gallery && window.electronAPI?.listAllImages) {
      try { setGallery(await window.electronAPI.listAllImages()); } catch { setGallery([]); }
    }
  };

  // ── 导出 ────────────────────────────────────────────
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

  const download = (name: string, href: string) => {
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  };

  const exportHtml = async () => {
    if (!draft.trim()) { showToast('❌ 内容为空'); return; }
    const toData = async (u: string): Promise<string> => {
      try { const r: any = await window.electronAPI.readImageDataUrl(u); return r?.dataUrl || u; } catch { return u; }
    };
    const fig = async (slot: SlotKey): Promise<string | null> => {
      const u = slots[slot]; if (!u) return null;
      return `<figure class="qp-fig"><img src="${await toData(u)}" alt="${SLOT_LABEL[slot]}"/><figcaption>${SLOT_LABEL[slot]}</figcaption></figure>`;
    };
    const blocks = draftBlocks.map(blockHtml);
    const firstViewpoint = blocks.findIndex((b) => b.includes('qp-viewpoint'));
    const [cover, emotion, explain, closing] = await Promise.all([
      fig('cover'), fig('emotion'), fig('explain'), fig('closing'),
    ]);
    const out: string[] = [];
    blocks.forEach((b, i) => {
      if (i === 0 && cover) out.push(cover);
      out.push(b);
      if (i === 0 && emotion) out.push(emotion);
      if (i === firstViewpoint && explain) out.push(explain);
      if (i === blocks.length - 2 && closing) out.push(closing);
    });
    const html = `<!doctype html>\n<html lang="zh-CN">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titleLine || '公众号文章'}</title>\n<style>\n${EXPORT_CSS}\n</style></head>\n<body>\n${out.join('\n')}\n</body>\n</html>`;
    download(`发布稿-${(titleLine || 'article').slice(0, 12)}-${new Date().toISOString().slice(0, 10)}.html`,
      URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })));
    showToast('✅ 发布稿已下载（公众号后台 → 导入文章 → 选此文件）');
  };

  /** 排版封面：本地 Canvas 标题卡——确定性质量，不走任何生图 API */
  const exportCover = () => {
    const W = 1200, H = 510;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); if (!g) return;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#f8fafb'); bg.addColorStop(1, '#ecfdf5');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#10b981'; g.lineWidth = 3; g.lineCap = 'round';
    g.fillStyle = 'rgba(16,185,129,0.15)';
    g.beginPath(); g.arc(960, 330, 26, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(960, 330); g.bezierCurveTo(960, 280, 940, 260, 938, 232); g.stroke();
    g.fillStyle = 'rgba(16,185,129,0.35)';
    g.beginPath(); g.moveTo(938, 252); g.bezierCurveTo(916, 240, 906, 218, 918, 202); g.bezierCurveTo(940, 196, 950, 216, 938, 252); g.fill();
    g.beginPath(); g.moveTo(948, 236); g.bezierCurveTo(966, 220, 992, 218, 1000, 236); g.bezierCurveTo(996, 258, 968, 258, 948, 236); g.fill();
    g.strokeStyle = '#059669'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(860, 400); g.lineTo(1060, 400); g.stroke();
    const font = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
    g.fillStyle = '#6b7280'; g.font = `26px ${font}`;
    g.fillText('AutoWriter Season 1 · 观察日志', 80, 150);
    const title = (titleLine || '未命名').slice(0, 12);
    const splitAt = title.length > 7 ? 4 + Math.floor((title.length - 7) / 2) : title.length;
    g.fillStyle = '#111827'; g.font = `800 64px ${font}`;
    g.fillText(title.slice(0, splitAt), 80, 260);
    g.fillStyle = '#047857';
    g.fillText(title.slice(splitAt), 80, 340);
    if (insightLine && !insightLine.startsWith(title)) {
      g.fillStyle = '#374151'; g.font = `24px ${font}`;
      g.fillText(insightLine.slice(0, 28), 80, 430);
    }
    download(`封面-${title}.png`, c.toDataURL('image/png'));
    showToast('✅ 排版封面已下载（本地渲染，零 AI 生图）');
  };

  const copyMarkdown = async () => {
    try { await navigator.clipboard.writeText(draft); showToast('✅ 原稿 Markdown 已复制'); }
    catch { showToast('❌ 复制失败'); }
  };

  const imgCount = Object.values(slots).filter(Boolean).length;

  return (
    <>
      <div className="qp-steps" role="tablist" aria-label="快速发布四步">
        {STEPS.map((label, i) => (
          <button key={label} type="button" role="tab" aria-selected={step === i}
            className={`qp-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            onClick={() => setStep(i)}>
            <span className="qp-step-no">{i < step ? <Check size={12} /> : i + 1}</span>
            {label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="qp-panel">
          <div className="qp-panel-head">
            <div>
              <strong>粘贴草稿，可选 AI 润色</strong>
              <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>指令固定"保持观点不动"；不润色直接下一步也行</span>
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
            placeholder={'把你的草稿粘贴到这里：Claude/ChatGPT 成稿、Markdown、零散记录都行。'} />
        </div>
      )}

      {step === 1 && (
        <div className="qp-panel">
          <div className="qp-panel-head">
            <div>
              <strong>自动排版 · 可点击改判</strong>
              <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>点任意段落切换观点盒——机器做初稿，你做终审</span>
            </div>
            {Object.keys(boxOverrides).length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBoxOverrides({})}>恢复机器判断</button>
            )}
          </div>
          <div className="qp-preview">
            {draftBlocks.map((b, i) => (
              <div key={i} className="qp-block-wrap"
                onClick={() => toggleBox(i)} title="点击切换：观点盒 ⇄ 普通段">
                <span dangerouslySetInnerHTML={{ __html: blockHtml(b, i) }} />
              </div>
            ))}
            {draftBlocks.length === 0 && <p className="muted">（草稿为空）</p>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="qp-panel">
          <div className="qp-panel-head">
            <div>
              <strong>配图（可选）</strong>
              <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                图的职责是降低阅读成本——每张必须有角色；挑不到合适的图，**宁可不放**
              </span>
            </div>
          </div>
          {(Object.keys(SLOT_LABEL) as SlotKey[]).map((slot) => (
            <div key={slot} className="qp-role-block">
              <div className="qp-role-label">
                {SLOT_LABEL[slot]}
                <span className="muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{SLOT_HINT[slot]}</span>
              </div>
              {slots[slot] ? (
                <div className="qp-slot-preview">
                  <img src={slots[slot]!} alt={SLOT_LABEL[slot]} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSlots((x) => ({ ...x, [slot]: null }))}>移除</button>
                </div>
              ) : (
                <div>
                  <textarea
                    className="textarea"
                    rows={2}
                    style={{ fontSize: 12, marginBottom: 6 }}
                    value={prompts[slot]}
                    onChange={(e) => setPrompts((x) => ({ ...x, [slot]: e.target.value }))}
                    placeholder="生图提示词（已按你的标题与观点自动生成，可改）"
                  />
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => genImage(slot)} disabled={busy === slot}>
                      {busy === slot ? <Sparkles size={13} className="spin" /> : <Wand2 size={13} />}
                      {busy === slot ? '生成中…（走 Provider，约 30–120s）' : `生成${SLOT_LABEL[slot]}`}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openGallery(slot)}>
                      <ImageIcon size={13} /> 从图库选
                    </button>
                    {slot === 'cover' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={exportCover}>或下载"排版封面"</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="qp-panel">
          <div className="qp-panel-head">
            <div><strong>导出发布</strong>
              <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>选中的图会以 dataURL 内嵌进 HTML；公众号导入后仍需补传一次（平台限制）</span>
            </div>
          </div>
          <div className="qp-export-summary">
            <div>标题：{titleLine || '（取第一段）'}</div>
            <div>正文：{stats.zh} 字 · 观点盒 {boxTotal} 个 · 配图 {imgCount}/4 张（0 张也完全可以发）</div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button type="button" className="btn btn-primary" onClick={exportHtml}><FileDown size={14} /> 下载发布稿 HTML</button>
            <button type="button" className="btn btn-outline" onClick={exportCover}><ImageIcon size={14} /> 下载排版封面 PNG</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyMarkdown}><Clipboard size={14} /> 复制 Markdown</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>发布路径：公众号后台 → 图文编辑器 → ⋯ → 导入 → 选 HTML；封面在"上传封面图"处选 PNG。</p>
        </div>
      )}

      <div className="qp-nav">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft size={13} /> 上一步
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep((s) => Math.min(3, s + 1))}>跳过此步</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep((s) => Math.min(3, s + 1))} disabled={step === 3}>
          {step === 2 ? '去导出' : '下一步'} <ArrowRight size={13} />
        </button>
      </div>

      {galleryFor && (
        <div className="qp-gallery-mask" onClick={() => setGalleryFor(null)}>
          <div className="qp-gallery" onClick={(e) => e.stopPropagation()}>
            <div className="qp-gallery-head">
              <strong>从图库选择 · {SLOT_LABEL[galleryFor]}</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGalleryFor(null)}><X size={14} /></button>
            </div>
            <div className="qp-gallery-grid">
              {(gallery || []).map((img) => (
                <button key={img.id} type="button" className="qp-gallery-cell" title={img.prompt}
                  onClick={() => { setSlots((x) => ({ ...x, [galleryFor]: img.url || img.file_path })); setGalleryFor(null); showToast(`✅ 已选为${SLOT_LABEL[galleryFor]}`); }}>
                  <img src={img.url || img.file_path} alt={img.prompt} loading="lazy" />
                </button>
              ))}
              {gallery && gallery.length === 0 && <div className="muted" style={{ padding: 20 }}>图库为空。先去「图库」页上传你在别处做好的图。</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
