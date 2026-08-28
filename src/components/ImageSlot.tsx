// ImageSlot — 配图占位/成品槽（写文章页 & 我的文章共用，保证 UI+逻辑一致）
// 直观展示：无图=虚线框显示描述；有图=显示成图。点占位卡片 → AI生成/上传/图库三选一。
// 一律走 generateImageFor（持久化 + 用当前 provider + craft），与「我的文章」数据同源。
import { useState } from 'react';
import { Loader2, Sparkles, Upload, Image as ImageIcon, RefreshCw, X } from 'lucide-react';
import { showToast } from '../toast';
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
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);

  const doGenerate = async () => {
    setMenuOpen(false);
    setBusy(true);
    try {
      const r = await window.electronAPI.generateImageFor({
        articleId, placeholderId, prompt: desc, useCraft: true,
      });
      onUpdated?.(placeholderId, r.url);
      showToast(`✅ 配图已生成并入库（${r.provider}）`);
    } catch (e: any) {
      showToast('❌ 生成失败：' + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMenuOpen(false); setBusy(true);
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
      setBusy(false);
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
          <img src={url} alt={desc} className="img-slot-img" />
          <div className="img-slot-caption">
            <span className="img-slot-desc">{desc}</span>
            <button type="button" className="img-slot-repick" onClick={() => setMenuOpen((v) => !v)} title="更换配图">
              <RefreshCw size={12} /> 更换
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="img-slot-empty" disabled={busy} onClick={() => setMenuOpen((v) => !v)} title="点击选择配图方式">
          {busy ? <Loader2 size={18} className="spin" /> : <ImageIcon size={20} />}
          <span className="img-slot-empty-desc">{desc}</span>
          <span className="img-slot-empty-tip">{busy ? '处理中…' : '点击配图 · AI生成/上传/图库'}</span>
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
