// ImagesPage — 图库（参考 tensor.art 设计）
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { showToast } from '../toast';
import type { ImageRecord } from '../types';

/** 下载单张图片 */
async function downloadImage(img: ImageRecord) {
  try {
    const filePath = img.file_path || img.url;
    if (!filePath) { showToast('❌ 图片路径不存在'); return; }
    const r = await window.electronAPI.readImageDataUrl(filePath);
    if (!r?.ok || !r.dataUrl) { showToast('❌ 读取图片失败'); return; }
    const ext = r.dataUrl.match(/^data:image\/(\w+)/)?.[1] || 'png';
    const a = document.createElement('a');
    a.href = r.dataUrl;
    a.download = (img.file_name || `image-${img.id}`).replace(/\.[^.]+$/, '') + '.' + ext;
    a.click();
    showToast('✅ 图片已下载');
  } catch (err: any) { showToast('❌ 下载失败'); }
}

/** 尺寸分类 */
type SizeCategory = 'all' | 'wechat' | 'weibo' | 'xhslike' | 'zhihu' | 'toutiao' | 'bilibili' | 'portrait' | 'square' | 'landscape';

import type { LucideIcon } from 'lucide-react';
const SIZE_TABS: { key: SizeCategory; label: string; icon: LucideIcon; ratioRange?: [number, number]; note?: string }[] = [
  { key: 'all', label: '全部', icon: ImageIcon },
  { key: 'wechat', label: '公众号', icon: MessageCircle, ratioRange: [2.0, 2.7], note: '2.35:1' },
  { key: 'weibo', label: '微博', icon: Heart, ratioRange: [1.6, 2.0], note: '1.8:1' },
  { key: 'xhslike', label: '小红书', icon: Heart, ratioRange: [0.9, 1.1], note: '1:1' },
  { key: 'zhihu', label: '知乎', icon: Lightbulb, ratioRange: [1.6, 2.0], note: '1.82:1' },
  { key: 'toutiao', label: '头条', icon: Newspaper, ratioRange: [1.8, 2.2], note: '2:1' },
  { key: 'bilibili', label: 'B站', icon: Tv, ratioRange: [1.6, 2.0], note: '16:9' },
  { key: 'portrait', label: '竖版', icon: Smartphone, ratioRange: [0, 0.7] },
  { key: 'square', label: '方形', icon: Square, ratioRange: [0.85, 1.15] },
  { key: 'landscape', label: '横版', icon: Monitor, ratioRange: [1.4, 999] },
];

function getSizeCategory(img: ImageRecord): SizeCategory {
  if (!img.width || !img.height) return 'all';
  const r = img.width / img.height;
  for (const tab of SIZE_TABS) {
    if (tab.ratioRange && tab.key !== 'all') {
      const [min, max] = tab.ratioRange;
      if (r >= min && r <= max) return tab.key;
    }
  }
  return 'all';
}

/** 展示图片：从磁盘读 dataUrl */
function GalleryImage({ img, onClick, selected }: { img: ImageRecord; onClick: () => void; selected: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const filePath = img.file_path || img.url;
      if (filePath) {
        try {
          const r = await window.electronAPI.readImageDataUrl(filePath);
          if (!cancelled && r?.ok) { setSrc(r.dataUrl); return; }
        } catch (e) {}
      }
      if (img.url && !img.url.startsWith('aw-img')) { setSrc(img.url); return; }
    };
    load();
    return () => { cancelled = true; };
  }, [img.file_path, img.url]);

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        background: 'var(--bg3)',
        breakInside: 'avoid',
        marginBottom: 12,
        border: selected ? '3px solid #6366f1' : '2px solid transparent',
        boxShadow: selected ? '0 0 0 2px rgba(99,102,241,0.3)' : '0 2px 8px rgba(0,0,0,0.1)',
        transition: 'all 0.2s ease',
      }}
    >
      {/* 图片 */}
      <div style={{ position: 'relative', paddingTop: img.aspect === '9:16' ? '177%' : img.aspect === '3:4' ? '133%' : img.aspect === '4:3' ? '75%' : '100%' }}>
        {src ? (
          <img
            src={src}
            alt={img.prompt || img.file_name}
            onLoad={() => setLoaded(true)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: loaded ? 1 : 0,
              transition: 'opacity 0.3s',
            }}
          />
        ) : (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
            <div className="spinner" />
          </div>
        )}

        {/* 左上角角标 */}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 }}>
          {img.source === 'ai' ? (
            <span style={{ padding: '3px 7px', background: img.provider === 'tensorart' ? 'rgba(168,85,247,0.9)' : 'rgba(34,197,94,0.9)', color: '#fff', borderRadius: 5, fontSize: 10, fontWeight: 700 }}>
              {img.provider === 'tensorart' ? Palette : Globe}
            </span>
          ) : (
            <span style={{ padding: '3px 7px', background: 'rgba(255,255,255,0.85)', color: '#666', borderRadius: 5, fontSize: 10, fontWeight: 600 }}>
              📤
            </span>
          )}
          {img.category && (
            <span style={{ padding: '3px 7px', background: 'rgba(16,185,129,0.9)', color: '#fff', borderRadius: 5, fontSize: 10, fontWeight: 600 }}>
              {IMAGE_CATEGORIES.find(c => c.value === img.category)?.label.split(' ')[0] || img.category}
            </span>
          )}
        </div>

        {/* 选中角标 */}
        {selected && (
          <div style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, boxShadow: '0 2px 8px rgba(99,102,241,0.5)' }}>
            ✓
          </div>
        )}

        {/* 底部悬浮信息栏 */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', padding: '32px 10px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* 模型 */}
          {img.source === 'ai' && img.model && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
              {img.model}
            </div>
          )}
          {/* 提示词 */}
          {(img.prompt || img.file_name) && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.9)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {img.prompt || img.file_name}
            </div>
          )}
          {/* 标签 */}
          {img.tags && (
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {img.tags.split(',').slice(0, 3).map((tag, i) => (
                <span key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: 3 }}>
                  #{tag.trim()}
                </span>
              ))}
            </div>
          )}
          {/* 底部：尺寸 + 引用 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
            {img.width > 0 && img.height > 0 && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{img.width}×{img.height}</span>
            )}
            {img.used_by_articles && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>📎 {img.used_by_articles.split(',').length}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 图片预览大图 */
function ImagePreview({ img, onClose }: { img: ImageRecord; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const filePath = img.file_path || img.url;
      if (filePath) {
        const r = await window.electronAPI.readImageDataUrl(filePath);
        if (r?.ok) setSrc(r.dataUrl);
      }
    };
    load();
  }, [img]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'zoom-out',
        backdropFilter: 'blur(8px)',
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)',
          border: 'none',
          color: '#fff',
          fontSize: 20,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); downloadImage(img); }}
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '8px 16px',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        ⬇ 下载
      </button>
      {src && (
        <img
          src={src}
          style={{
            maxWidth: '92vw',
            maxHeight: '88vh',
            objectFit: 'contain',
            borderRadius: 12,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 16 }}>
        点击任意处关闭
      </div>
    </div>
  );
}

/** 预设分类 */
const IMAGE_CATEGORIES = [
  { value: '', label: '无' },
  { value: 'cover', label: '封面', icon: ImageIcon },
  { value: '配图', label: '配图', icon: Camera },
  { value: '素材', label: '素材', icon: Layers },
  { value: 'banner', label: 'Banner', icon: Smartphone },
  { value: '人物', label: '人物', icon: User },
  { value: '风景', label: '风景', icon: Mountain },
  { value: '产品', label: '📦 产品' },
];

/** 图片编辑弹窗 */
function ImageEditModal({ img, allTags, onClose, onDelete, onSave }: {
  img: ImageRecord;
  allTags: string[];
  onClose: () => void;
  onDelete: () => void;
  onSave: (tags: string, prompt: string, category: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [tags, setTags] = useState(img.tags || '');
  const [prompt, setPrompt] = useState(img.prompt || '');
  const [category, setCategory] = useState(img.category || '');
  const [refs, setRefs] = useState<{ article_id: number; title: string }[]>([]);

  useEffect(() => {
    const load = async () => {
      const filePath = img.file_path || img.url;
      if (filePath) {
        const r = await window.electronAPI.readImageDataUrl(filePath);
        if (r?.ok) setSrc(r.dataUrl);
      }
      const r = await window.electronAPI.getImageRefs(img.id);
      setRefs(r || []);
    };
    load();
  }, [img]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        zIndex: 1000,
      }}
    >
      {/* 顶栏 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 800,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          background: 'var(--bg)',
          borderRadius: '12px 12px 0 0',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* 左：图片信息 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {img.source === 'ai' && (
            <span style={{ padding: '4px 10px', background: img.provider === 'tensorart' ? '#a855f7' : '#22c55e', color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
              {img.provider === 'tensorart' ? '🎨 Tensor' : '🌐 Pollinations'}
            </span>
          )}
          {img.width > 0 && (
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{img.width}×{img.height} · {img.aspect}</span>
          )}
          {img.category && (
            <span style={{ padding: '3px 8px', background: 'var(--line-light)', color: 'var(--line-2)', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
              {IMAGE_CATEGORIES.find(c => c.value === img.category)?.label.split(' ')[1] || img.category}
            </span>
          )}
        </div>

        {/* 右 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
      </div>

      {/* 图片区域 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 800,
          background: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          overflow: 'hidden',
        }}
      >
        {src ? (
          <img
            src={src}
            style={{
              maxWidth: '100%',
              maxHeight: '50vh',
              borderRadius: 8,
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
              objectFit: 'contain',
            }}
          />
        ) : (
          <div className="spinner" />
        )}
      </div>

      {/* 底部详情面板 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 800,
          background: 'var(--bg)',
          borderRadius: '0 0 12px 12px',
          borderTop: '1px solid var(--border)',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          maxHeight: '50vh',
          overflow: 'auto',
        }}
      >
        {/* 分类 */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 8, fontWeight: 600 }}>📁 分类</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {IMAGE_CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    border: `1.5px solid ${category === cat.value ? 'var(--line)' : 'var(--border)'}`,
                    background: category === cat.value ? 'var(--line-light)' : 'transparent',
                    color: category === cat.value ? 'var(--line-2)' : 'var(--muted)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* 操作 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, paddingTop: 22 }}>
            <button
              onClick={() => downloadImage(img)}
              style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--ink-3)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              ⬇ 下载
            </button>
            <button
              onClick={onDelete}
              style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
            >
              🗑 删除
            </button>
            <button
              onClick={() => { onSave(tags, prompt, category); onClose(); }}
              style={{ padding: '8px 16px', background: 'var(--line)', border: 'none', color: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >
              💾 保存
            </button>
          </div>
        </div>

        {/* 标签 */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600 }}>🏷️ 标签</label>
          <input
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="逗号分隔"
            style={{ fontSize: 13 }}
          />
          {allTags.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {allTags.slice(0, 20).map(tag => {
                const active = tags.split(',').map(t => t.trim()).includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      const current = tags.split(',').map(t => t.trim()).filter(Boolean);
                      if (active) setTags(current.filter(t => t !== tag).join(', '));
                      else setTags([...current, tag].join(', '));
                    }}
                    style={{
                      padding: '3px 10px', borderRadius: 999,
                      border: '1px solid var(--border)',
                      background: active ? 'var(--line-light)' : 'transparent',
                      color: active ? 'var(--line-2)' : 'var(--muted)',
                      fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 提示词 + 引用文章 */}
        {(img.source === 'ai' && img.prompt) || refs.length > 0 ? (
          <div style={{ display: 'flex', gap: 16 }}>
            {img.source === 'ai' && img.prompt && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>📝 AI 提示词</div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6, background: 'var(--bg-soft)', padding: 10, borderRadius: 8, maxHeight: 80, overflow: 'auto', wordBreak: 'break-word' }}>
                  {img.prompt}
                </div>
              </div>
            )}
            {refs.length > 0 && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>📎 引用文章（{refs.length}）</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 80, overflow: 'auto' }}>
                  {refs.map((r, i) => (
                    <div
                      key={i}
                      style={{ fontSize: 12, padding: '6px 10px', background: 'var(--bg-soft)', borderRadius: 6, cursor: 'pointer', color: 'var(--line)' }}
                      onClick={() => { window.dispatchEvent(new CustomEvent('aw-open-article', { detail: r.article_id })); onClose(); }}
                    >
                      📄 {r.title?.slice(0, 32) || `#${r.article_id}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ImagesPage() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [filter, setFilter] = useState<'all' | 'ai' | 'upload'>('all');
  const [sizeFilter, setSizeFilter] = useState<SizeCategory>('all');
  const [catFilter, setCatFilter] = useState('');  // 分类筛选
  const [searchTag, setSearchTag] = useState('');
  const [editImg, setEditImg] = useState<ImageRecord | null>(null);
  const [generating, setGenerating] = useState(false);
  const [promptInput, setPromptInput] = useState('');
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!window.electronAPI?.listAllImages) return;
    setLoading(true);
    try {
      const rows = await window.electronAPI.listAllImages();
      setImages(rows);
    } catch (err: any) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // 上传
  const handleUpload = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const tags = file.name.replace(/\.[^.]+$/, '');
        const r = await window.electronAPI.uploadImageFor({
          articleId: 0,
          placeholderId: `lib-${Date.now()}`,
          dataUrl: reader.result as string,
          tags,
        });
        if (r.ok) { showToast('✅ 已上传到图库'); load(); }
        else showToast('❌ 上传失败');
      } catch (err: any) { showToast('❌ ' + err.message); }
    };
    reader.readAsDataURL(file);
  };

  // 生图
  const generateByPrompt = async () => {
    if (!promptInput.trim()) { showToast('请输入提示词'); return; }
    setGenerating(true);
    let providerId = '', modelId = '';
    try {
      const imgSettings = localStorage.getItem('aw_image_settings');
      if (imgSettings) {
        const s = JSON.parse(imgSettings);
        providerId = s.provider || '';
        modelId = s.model || '';
        showToast(`生图使用: ${providerId || '自动'} / ${modelId || '默认'}`);
      } else {
        showToast('未找到设置，将使用默认');
      }
    } catch (e) { console.error('读取设置失败', e); }
    try {
      const r = await window.electronAPI.generateImageFor({
        articleId: 0,
        placeholderId: `lib-${Date.now()}`,
        prompt: promptInput,
        tags: promptInput.slice(0, 50),
        useCraft: true,
        providerId,
        modelId,
      });
      if (r.ok) {
        showToast(`✅ 已生成${r.provider ? ` (${r.provider})` : ''}`);
        setPromptInput('');
        setShowGenerateForm(false);
        load();
      } else {
        showToast('❌ 生成失败');
      }
    } catch (err: any) { showToast('❌ ' + err.message); }
    finally { setGenerating(false); }
  };

  // 选择
  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    setSelectedIds(selectedIds.size === filteredImages.length ? new Set() : new Set(filteredImages.map(img => img.id)));
  };

  const batchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`删除选中的 ${selectedIds.size} 张图片？`)) return;
    let deleted = 0;
    for (const id of selectedIds) {
      try { await window.electronAPI.deleteImage(id); deleted++; } catch {}
    }
    showToast(`✅ 已删除 ${deleted} 张`);
    setSelectedIds(new Set());
    setSelectMode(false);
    load();
  };

  // 过滤
  const filteredImages = images.filter(img => {
    if (filter === 'ai' && img.source !== 'ai') return false;
    if (filter === 'upload' && img.source !== 'upload') return false;
    if (sizeFilter !== 'all' && getSizeCategory(img) !== sizeFilter) return false;
    if (catFilter && img.category !== catFilter) return false;
    if (searchTag && !img.tags?.toLowerCase().includes(searchTag.toLowerCase())) return false;
    return true;
  });

  const aiCount = images.filter(i => i.source === 'ai').length;
  const uploadCount = images.filter(i => i.source === 'upload').length;
  
  // 当前生图设置
  const [currentProvider, setCurrentProvider] = useState('');
  const [currentModel, setCurrentModel] = useState('');
  useEffect(() => {
    try {
      const raw = localStorage.getItem('aw_image_settings');
      if (raw) {
        const s = JSON.parse(raw);
        setCurrentProvider(s.provider || '');
        setCurrentModel(s.model || '');
      }
    } catch {}
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* 顶部工具栏 */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        padding: '12px 24px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 1400, margin: '0 auto' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>📸 图库</h1>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {images.length} 张图片 · {aiCount} AI · {uploadCount} 上传
              {currentProvider && (
                <span style={{ marginLeft: 12, padding: '2px 8px', background: 'var(--bg-soft)', borderRadius: 4, fontSize: 11 }}>
                  {currentProvider === 'tensorart' ? '🎨 Tensor.art' : '🌐 Pollinations'}
                  {currentModel && ` · ${currentModel}`}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {/* 搜索 */}
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                placeholder="搜索标签…"
                value={searchTag}
                onChange={(e) => setSearchTag(e.target.value)}
                style={{ width: 180, fontSize: 13, paddingLeft: 36 }}
              />
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14 }}>🔍</span>
            </div>

            {/* 操作按钮 */}
            <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()}>
              📤 上传
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => {
              Array.from(e.target.files || []).forEach(handleUpload);
              e.target.value = '';
            }} />
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setShowGenerateForm(!showGenerateForm)}
            >
              ✨ 生图
            </button>
            {images.length > 0 && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
                style={selectMode ? { background: 'var(--line-light)' } : {}}
              >
                {selectMode ? '✓ 选择模式' : '☑️ 批量'}
              </button>
            )}
          </div>
        </div>

        {/* 生图表单 */}
        {showGenerateForm && (
          <div style={{
            maxWidth: 1400,
            margin: '16px auto 0',
            padding: 16,
            background: 'var(--bg-soft)',
            borderRadius: 12,
            border: '1px solid var(--border)',
          }}>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <input
                className="input"
                placeholder="描述你想要的图片，如：深圳南山夜景写字楼，蓝调，氛围感"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                disabled={generating}
                style={{ flex: 1, minWidth: 300 }}
              />
              <button
                className="btn btn-primary btn-sm"
                disabled={generating || !promptInput.trim()}
                onClick={generateByPrompt}
                style={{ minWidth: 100 }}
              >
                {generating ? '⏳ 生成中…' : '🎨 生成'}
              </button>
            </div>
            {generating && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--bg)', borderRadius: 8, fontSize: 13, color: 'var(--muted)' }}>
                ⚙️ 正在生成图片，请稍候（Tensor.art 可能需要 10-30 秒）…
              </div>
            )}
            {!generating && currentProvider && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                将使用: {currentProvider === 'tensorart' ? '🎨 Tensor.art' : '🌐 Pollinations'}
                {currentModel && ` · ${currentModel}`}
                <button
                  onClick={() => window.location.href = '/settings'}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--line)', cursor: 'pointer', fontSize: 11 }}
                >
                  [修改设置]
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 过滤 */}
        <div style={{ maxWidth: 1400, margin: '16px auto 0', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* 来源过滤 */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { key: 'all', label: '全部', count: images.length },
              { key: 'ai', label: '🤖 AI', count: aiCount },
              { key: 'upload', label: '📤 上传', count: uploadCount },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key as any)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 999,
                  border: 'none',
                  background: filter === tab.key ? 'var(--line)' : 'transparent',
                  color: filter === tab.key ? '#fff' : 'var(--muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: filter === tab.key ? 600 : 400,
                }}
              >
                {tab.label} {tab.count}
              </button>
            ))}
          </div>

          {/* 分隔线 */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

          {/* 尺寸过滤 */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {SIZE_TABS.map(tab => {
              const catCount = images.filter(i => tab.key === 'all' || getSizeCategory(i) === tab.key).length;
              const active = sizeFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setSizeFilter(tab.key)}
                  title={tab.note || undefined}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 999,
                    border: active ? '1px solid var(--line)' : '1px solid var(--border)',
                    background: active ? 'var(--line-light)' : 'transparent',
                    color: active ? 'var(--line-2)' : 'var(--muted)',
                    fontSize: 12,
                    cursor: 'pointer',
                    fontWeight: active ? 600 : 400,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <tab.icon size={12} strokeWidth={2} />
                  {tab.label}
                  {catCount > 0 && <span style={{ fontSize: 10, opacity: 0.7 }}>({catCount})</span>}
                </button>
              );
            })}
          </div>

          {/* 分类过滤 */}
          {(() => {
            const cats = [...new Set(images.map(i => i.category).filter(Boolean))];
            if (cats.length === 0) return null;
            return (
              <>
                <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setCatFilter('')}
                    style={{
                      padding: '5px 10px', borderRadius: 999,
                      border: !catFilter ? '1px solid var(--line)' : '1px solid var(--border)',
                      background: !catFilter ? 'var(--line-light)' : 'transparent',
                      color: !catFilter ? 'var(--line-2)' : 'var(--muted)',
                      fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    📁 全部
                  </button>
                  {cats.map(c => {
                    const catInfo = IMAGE_CATEGORIES.find(x => x.value === c);
                    return (
                      <button
                        key={c}
                        onClick={() => setCatFilter(catFilter === c ? '' : c)}
                        style={{
                          padding: '5px 10px', borderRadius: 999,
                          border: catFilter === c ? '1px solid var(--line)' : '1px solid var(--border)',
                          background: catFilter === c ? 'var(--line-light)' : 'transparent',
                          color: catFilter === c ? 'var(--line-2)' : 'var(--muted)',
                          fontSize: 12, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {catInfo?.label || c}
                        <span style={{ fontSize: 10, opacity: 0.7 }}>({images.filter(i => i.category === c).length})</span>
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* 批量操作栏 */}
      {selectMode && selectedIds.size > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 200,
          background: 'var(--ink)',
          borderRadius: 999,
          padding: '12px 20px',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}>
          <span style={{ color: '#fff', fontSize: 14 }}>
            已选 {selectedIds.size} 张
          </span>
          <button onClick={selectAll} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            {selectedIds.size === filteredImages.length ? '取消全选' : '全选'}
          </button>
          <button
            onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >
            取消
          </button>
          <button
            onClick={batchDelete}
            style={{ background: '#ef4444', border: 'none', color: '#fff', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            🗑 删除
          </button>
        </div>
      )}

      {/* 图片瀑布流 */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <div className="spinner" style={{ width: 40, height: 40 }} />
          </div>
        ) : filteredImages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 80, color: 'var(--muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🖼️</div>
            <div style={{ fontSize: 16, marginBottom: 8 }}>图库是空的</div>
            <div style={{ fontSize: 13 }}>上传图片或用 AI 生成第一张吧</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {filteredImages.map(img => (
              <GalleryImage
                key={img.id}
                img={img}
                selected={selectedIds.has(img.id)}
                onClick={() => {
                  if (selectMode) {
                    toggleSelect(img.id);
                  } else {
                    setEditImg(img);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>


      {/* 编辑弹窗 */}
      {editImg && (
        <ImageEditModal
          img={editImg}
          allTags={[...new Set(images.flatMap(i => (i.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean)))]}
          onClose={() => setEditImg(null)}
          onDelete={async () => {
            if (confirm('确定删除这张图？')) {
              await window.electronAPI.deleteImage(editImg.id);
              showToast('已删除');
              setEditImg(null);
              load();
            }
          }}
          onSave={async (tags, prompt, category) => {
            await window.electronAPI.updateImage({ id: editImg.id, tags, prompt, category });
            showToast('✅ 已保存');
            load();
          }}
        />
      )}
    </div>
  );
}
