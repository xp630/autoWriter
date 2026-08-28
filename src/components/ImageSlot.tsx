// ImageSlot — 配图占位/成品槽（写文章页 & 我的文章共用，保证 UI+逻辑一致）
// 直观展示：无图=虚线框显示描述；有图=显示成图。点占位卡片 → AI生成/上传/图库三选一。
// 一律走 generateImageFor（持久化 + 用当前 provider + craft），与「我的文章」数据同源。
import { useEffect, useState } from 'react';
import { Loader2, Sparkles, Upload, Image as ImageIcon, RefreshCw, X } from 'lucide-react';
import { showToast } from '../toast';
import { getImageSettings, getAgentSettings } from '../utils/storage';
import { ImageLibraryGrid } from './ImageLibraryGrid';

interface Props {
  articleId: number;
  placeholderId: string;
  desc: string;
  /** 已配图则传图片 url（aw-img://），否则空 */
  url?: string;
  /** 生成时用的赛道/风格上下文（可选，透传给 prompt） */
  track?: string;
  onUpdated?: (placeholderId: string, url: string) => void;
}

export function ImageSlot({ articleId, placeholderId, desc, url, onUpdated }: Props) {
  const [busy, setBusy] = useState<'' | 'generate' | 'upload'>('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [resolved, setResolved] = useState('');

  // aw-img:// / uploads 相对路径 → dataURL（自定义协议不可靠，统一走 IPC 解析）
  useEffect(() => {
    let alive = true;
    if (!url) { setResolved(''); return; }
    if (url.startsWith('data:') || url.startsWith('http')) { setResolved(url); return; }
    (async () => {
      try {
        const r = await window.electronAPI.readImageDataUrl(url);
        if (alive && r?.ok) setResolved(r.dataUrl);
        else if (alive) setResolved('');
      } catch { if (alive) setResolved(''); }
    })();
    return () => { alive = false; };
  }, [url]);

  const doGenerate = async () => {
    setMenuOpen(false);
    setBusy('generate');
    try {
      // 读「图片生图设置」里选的当前 provider/模型；没选则交给 IPC 默认（priority）
      const img = getImageSettings();
      const r = await window.electronAPI.generateImageFor({
        articleId, placeholderId, prompt: desc, useCraft: true,
        providerId: img.provider || undefined,
        modelId: img.model || undefined,
        craftCli: getAgentSettings().cli,
      });
      onUpdated?.(placeholderId, r.url);
      showToast(`✅ 配图已生成并入库（${r.provider} / ${r.model}）`);
    } catch (e: any) {
      showToast('❌ 生成失败：' + (e.message || e));
    } finally {
      setBusy('');
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMenuOpen(false); setBusy('upload');
    try {
      const dataUrl = await new Promise<string>((res) => {
        const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(f);
      });
      const r = await window.electronAPI.uploadImageFor({ articleId, placeholderId, dataUrl });
      onUpdated?.(placeholderId, r.url);
      showToast('✅ 图片已上传并入库');
    } catch (e: any) {
      showToast('❌ 上传失败：' + (e.message || e));
    } finally {
      setBusy('');
    }
  };

  const pickFromLibrary = (img: { id: number; url?: string; file_path?: string }) => {
    const shown = img.url || img.file_path || '';
    window.electronAPI.linkImageToArticle({ articleId, placeholderId, imageId: img.id })
      .then(() => { onUpdated?.(placeholderId, shown); setLibOpen(false); showToast('✅ 已选用图库图片'); })
      .catch((e: any) => showToast('❌ ' + (e.message || e)));
  };

  return (
    <div className="img-slot">
      {url ? (
        <div className="img-slot-filled">
          {resolved
            ? <img src={resolved} alt={desc} className="img-slot-img" />
            : <div className="img-slot-loading"><Loader2 size={18} className="spin" /> 加载图片…</div>}
          {/* 已有图又点「更换→AI生成/上传」时，在当前图上盖一层加载遮罩 */}
          {busy && (
            <div className="img-slot-busy">
              <Loader2 size={22} className="spin" />
              <span>{busy === 'upload' ? '正在上传…' : 'AI 重新生成中…'}</span>
              {busy === 'generate' && <em>提示词扩写 + 出图，通常 10–30 秒</em>}
            </div>
          )}
          <div className="img-slot-caption">
            <span className="img-slot-desc">{desc}</span>
            <button type="button" className="img-slot-repick" onClick={() => setMenuOpen((v) => !v)} title="更换配图">
              <RefreshCw size={12} /> 更换
            </button>
          </div>
        </div>
      ) : busy ? (
        <div className="img-slot-generating">
          <div className="img-slot-gen-head">
            <Loader2 size={16} className="spin" />
            <span>{busy === 'upload' ? '正在上传…' : 'AI 正在生成配图…'}</span>
          </div>
          <div className="img-slot-gen-desc">{desc}</div>
          {busy === 'generate' && <div className="img-slot-gen-sub">提示词扩写 + 出图，通常 10–30 秒</div>}
          <div className="gen-skeleton"><i/><i/><i/></div>
        </div>
      ) : (
        <button type="button" className="img-slot-empty" onClick={() => setMenuOpen((v) => !v)} title="点击选择配图方式">
          <ImageIcon size={20} />
          <span className="img-slot-empty-desc">{desc}</span>
          <span className="img-slot-empty-tip">{'点击配图 · AI生成/上传/图库'}</span>
        </button>
      )}

      {/* 三选一浮层 */}
      {menuOpen && (
        <>
          <div className="img-slot-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="img-slot-menu">
            <button type="button" onClick={doGenerate}><Sparkles size={14} /> AI 生成</button>
            <label className="img-slot-menu-file">
              <Upload size={14} /> 上传本地
              <input type="file" accept="image/*" onChange={onFile} />
            </label>
            <button type="button" onClick={() => { setMenuOpen(false); setLibOpen(true); }}><ImageIcon size={14} /> 从图库选</button>
          </div>
        </>
      )}

      {/* 图库选择浮层 */}
      {libOpen && (
        <div className="img-slot-lib-overlay" onClick={() => setLibOpen(false)}>
          <div className="img-slot-lib-panel" onClick={(e) => e.stopPropagation()}>
            <div className="img-slot-lib-head">
              <span>从图库选择配图</span>
              <button type="button" onClick={() => setLibOpen(false)}><X size={15} /></button>
            </div>
            <div className="img-slot-lib-body">
              <ImageLibraryGrid onSelect={(img) => pickFromLibrary(img as any)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
