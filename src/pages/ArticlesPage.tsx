// ArticlesPage — 我的文章（列表 + 详情 modal + 润色/排程/删除）
import { useEffect, useMemo, useState, useRef } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Empty } from '../components/Empty';
import { FileText } from 'lucide-react';
import { RichEditor } from '../components/RichEditor';
import { ImageLibraryGrid } from '../components/ImageLibraryGrid';
import { exportWord } from '../utils/export';

/** 渲染图片：本地路径走 IPC 读 dataUrl，绕开 aw-img 协议中文问题 */
function DataImg({ src, alt }: { src?: string; alt?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!src) return;
        // 本地方案：aw-img:// 或 uploads/... 相对路径 → 走 IPC 读 dataUrl
        if (src.startsWith('aw-img') || src.startsWith('uploads/') || src.startsWith('~')) {
          const r = await window.electronAPI.readImageDataUrl(src);
          if (!cancelled && r?.ok) setDataUrl(r.dataUrl);
        } else {
          setDataUrl(src);  // http/data 直接用
        }
      } catch { if (!cancelled) setDataUrl(null); }
    })();
    return () => { cancelled = true; };
  }, [src]);
  if (!dataUrl) return <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>🖼️ {alt || '图片加载中…'}</div>;
  return <img src={dataUrl} alt={alt || ''} style={{ maxWidth: '100%', borderRadius: 6 }} />;
}

/** ReactMarkdown 自定义组件：图片用 DataImg */
const mdComponents: Components = {
  img: (props) => <DataImg src={String(props.src || '')} alt={String(props.alt || '')} />,
};
import { showToast } from '../toast';
import { getAgentSettings, getImageSettings, getOpenArticleId, setOpenArticleId } from '../utils/storage';
import { adaptForPlatform, PLATFORMS } from '../utils/platform';
import type { Article } from '../types';

type Filter = 'all' | 'draft' | 'scheduled' | 'published' | 'failed';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'draft', label: '草稿' },
  { id: 'scheduled', label: '定时' },
  { id: 'published', label: '已发布' },
  { id: 'failed', label: '失败' },
];

function statusOf(a: Article): string {
  if (a.publish_error) return 'failed';
  if (a.published_at) return 'published';
  if (a.scheduled_at) return 'scheduled';
  return a.status || 'draft';
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', scheduled: '⏰ 已排程', published: '✓ 已发布', failed: '✗ 失败',
};

export function ArticlesPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Article | null>(null);  // 详情 modal
  const [polishing, setPolishing] = useState(false);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');  // datetime-local 选的时间
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [polishInstruction, setPolishInstruction] = useState('');
  const [showPolishPanel, setShowPolishPanel] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);  // 更多菜单
  const [showExportMenu, setShowExportMenu] = useState(false);  // 导出菜单
  const [showCoverPanel, setShowCoverPanel] = useState(false);  // 封面生成面板
  const [selectedAspect, setSelectedAspect] = useState('2.35:1');  // 选中的封面比例
  const [editMode, setEditMode] = useState(false);  // 手动编辑 vs 渲染预览
  const [articleImages, setArticleImages] = useState<Record<string, string>>({});  // placeholder_id → url
  const [showImagePicker, setShowImagePicker] = useState(false);  // 配图选择弹窗
  const [pickerStep, setPickerStep] = useState<'list' | 'select' | 'library'>('list');  // list=占位符列表, select=选择图源, library=图库选择
  const [libraryImages, setLibraryImages] = useState<any[]>([]);  // 图库图片列表
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [allPlaceholders, setAllPlaceholders] = useState<{desc: string, id: string, index: number, done?: boolean}[]>([]);  // 所有占位符
  const [pickerPlaceholder, setPickerPlaceholder] = useState<{desc: string, id: string, index: number} | null>(null);  // 当前选择的占位符

  const load = () => {
    if (!window.electronAPI?.listArticles) return;
    setLoading(true);
    window.electronAPI.listArticles({ status: filter, search }).then((rows) => {
      setArticles(rows as Article[]);
      setLoading(false);
    });
  };

  useEffect(load, [filter]);

  // 点击外部关闭更多菜单
  useEffect(() => {
    if (!showMoreMenu && !showExportMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.more-menu-container') && !target.closest('.export-menu-container')) {
        setShowMoreMenu(false);
        setShowExportMenu(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showMoreMenu, showExportMenu]);

  // 图库引用跳转：若 App 设置了待打开文章 id，加载列表后自动打开
  useEffect(() => {
    const pendingId = getOpenArticleId();
    if (!pendingId) return;
    setOpenArticleId(null);  // 一次性消费
    if (window.electronAPI?.getArticle) {
      window.electronAPI.getArticle(pendingId).then((a) => {
        if (a) openArticle(a);
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 打开文章：拉图片关联（placeholder_id → url）
  const openArticle = async (a: Article) => {
    setSelected(a);
    setEditMode(false);
    try {
      if (window.electronAPI?.listArticleImages) {
        const imgs = await window.electronAPI.listArticleImages(a.id);
        const map: Record<string, string> = {};
        for (const img of imgs) { map[img.placeholder_id] = img.file_path; }  // 用相对路径（assets/x.jpg），markdown 可正常解析
        setArticleImages(map);
      }
    } catch (err: any) { console.warn('[openArticle] 拉图片失败:', err.message); }
  };

  // 渲染预处理：把 [[配图:描述@picN]] 占位符替换为 markdown 图或待配图块
  const renderedContent = useMemo(() => {
    const md = selected?.content || '';
    return md.replace(/\[\[配图[：:]([^\]@]{1,60})(?:@([\w-]+))?\]\]/g, (full, desc: string, picId?: string) => {
      const id = picId || '';
      const url = id ? articleImages[id] : undefined;
      console.log('[render] 占位符', full, '→ id:', id, 'url:', url);
      if (url) {
        return `![${desc.trim()}](${url})`;
      }
      // 无图 → 灰色待配图块（用 HTML 占位，ReactMarkdown 默认允许）
      return `\n\n<div class="img-placeholder">🖼️ ${desc.trim()} <span>(待配图${id ? ' · ' + id : ''})</span></div>\n\n`;
    });
  }, [selected?.content, articleImages]);

  // ===== 操作 =====
  const schedule = async () => {
    if (!selected || !scheduleTime) {
      showToast('请先选一个发布时间');
      return;
    }
    try {
      // datetime-local 格式：2026-08-30T09:00 → 转 ISO 字符串
      const iso = new Date(scheduleTime).toISOString();
      await window.electronAPI.scheduleArticle({ id: selected.id, scheduled_at: iso });
      showToast('✅ 已加入排程：' + new Date(iso).toLocaleString('zh-CN', { hour12: false }));
      setShowSchedulePanel(false);
      setScheduleTime('');
      setSelected(null);
      load();
    } catch (err: any) { showToast('❌ ' + err.message); }
  };

  const unschedule = async (id: number) => {
    await window.electronAPI.unscheduleArticle(id);
    showToast('已取消排程');
    load();
  };

  const publish = async (id: number) => {
    await window.electronAPI.publishArticle(id);
    showToast('✅ 已标记为已发布');
    load();
  };

  const unpublish = async (id: number) => {
    await window.electronAPI.unpublishArticle(id);
    showToast('已取消发布');
    load();
  };

  const del = async (id: number) => {
    if (!confirm('确定删除？此操作不可恢复')) return;
    await window.electronAPI.deleteArticle(id);
    showToast('已删除');
    load();
  };

  // 二次润色（详情 modal 里）
  const polish = async () => {
    if (!selected || !selected.content) return;
    if (!polishInstruction.trim()) { showToast('请输入润色指令'); return; }
    setPolishing(true);
    try {
      const settings = getAgentSettings();
      const r = await window.electronAPI.polishArticle({
        cli: settings.cli || 'claude',
        model: settings.model || undefined,
        content: selected.content,
        instruction: polishInstruction,
        channel: settings.channel,
        persona: settings.persona,
      });
      const updated = { ...selected, content: r.content, word_count: r.content.length };
      setSelected(updated);
      setShowPolishPanel(false);
      setPolishInstruction('');
      showToast(`✅ 润色完成（${(r.elapsedMs / 1000).toFixed(1)}s），点"保存修改"入库`);
    } catch (err: any) { showToast('❌ ' + err.message); }
    finally { setPolishing(false); }
  };

  // 扫描 [[配图:描述]] 纯文本占位符 → 调 Pollinations 生成 → 替换为 ![描述](file://url)
  const generatePlaceholderImages = async () => {
    if (!selected) return;
    
    // 读取生图设置
    let providerId = '', modelId = '';
    try {
      const s = getImageSettings();
      providerId = s.provider || '';
      modelId = s.model || '';
    } catch {}
    
    // 显示使用的模型
    const providerName = providerId === 'tensorart' ? '🎨 Tensor.art' : providerId === 'pollinations' ? '🌐 Pollinations' : '自动';
    showToast(`📸 将使用: ${providerName}${modelId ? ' · ' + modelId : ''}`);
    
    console.log('[image-gen] start, article:', selected.id, 'provider:', providerId, 'model:', modelId);
    setGeneratingImages(true);
    try {
      // 占位符格式 [[配图:描述@picN]]（兼容无 @picN 的旧格式）
      const re = /\[\[配图[：:]([^\]@]{1,60})(?:@([\w-]+))?\]\]/g;
      const matches = [...(selected.content || '').matchAll(re)];
      console.log('[image-gen] placeholders:', matches.length, matches.map(m => ({ desc: m[1], id: m[2] || `pic${matches.indexOf(m) + 1}` })));
      if (matches.length === 0) {
        showToast('📌 没有发现 [[配图:描述@picN]] 占位符。重新生成文章（agent 会自动标），或在编辑模式手动插入。');
        return;
      }
      for (let i = 0; i < matches.length; i++) {
        const desc = matches[i][1] || '插图';
        // 若占位符没带 @picN，按位置推断 picN（注意重复 id）
        let picId = matches[i][2];
        if (!picId) {
          // 找之前同描述已分配的 id，否则用 "pic" + (全局第 N 个占位)
          picId = `pic${i + 1}`;
        }
        showToast(`🎨 配图 ${i + 1}/${matches.length}：[${picId}] ${desc.slice(0, 20)}...`);
        try {
          await window.electronAPI.generateImageFor({
            articleId: selected.id,
            placeholderId: picId,
            prompt: desc,
            tags: desc.slice(0, 50),
            aspect: '3:2',
            useCraft: true,  // AI 扩写提示词提升质量
            providerId,
            modelId,
          });
        } catch (err: any) {
          showToast('❌ 第 ' + (i + 1) + ' 张失败：' + err.message);
        }
      }
      // 重新拉图片关联用于渲染
      try {
        const imgs = await window.electronAPI.listArticleImages(selected.id);
        setSelected((s) => s ? { ...s, articleImages: imgs as any } : s);
      } catch {}
      showToast(`✅ 配图完成（${matches.length} 张已入库图库）`);
    } finally {
      setGeneratingImages(false);
    }
  };

  // 加载图库图片
  const loadLibraryImages = async () => {
    setLibraryLoading(true);
    try {
      const imgs = await window.electronAPI.listAllImages();
      console.log('[图库] 加载到', imgs?.length || 0, '张图片');
      console.log('[图库] 第一张:', imgs?.[0]);
      setLibraryImages(imgs || []);
      if (!imgs || imgs.length === 0) {
        showToast('📭 图库为空，先去生成一些图片吧');
      }
    } catch (err: any) {
      console.error('加载图库失败:', err);
      showToast('❌ 加载图库失败: ' + err.message);
    } finally {
      setLibraryLoading(false);
    }
  };

  // 单个占位符 AI 生成
  const generateSinglePlaceholder = async (p: {desc: string, id: string, index: number}) => {
    if (!selected) return;
    setGeneratingImages(true);
    try {
      let providerId = '', modelId = '';
      try {
        const s = getImageSettings();
        providerId = s.provider || '';
        modelId = s.model || '';
      } catch {}
      
      const providerName = providerId === 'tensorart' ? '🎨 Tensor.art' : providerId === 'pollinations' ? '🌐 Pollinations' : '自动';
      showToast(`📸 生成中: ${providerName}${modelId ? ' · ' + modelId : ''}`);
      
      await window.electronAPI.generateImageFor({
        articleId: selected.id,
        placeholderId: p.id,
        prompt: p.desc,
        tags: p.desc.slice(0, 50),
        aspect: '3:2',
        useCraft: true,
        providerId,
        modelId,
      });
      
      // 标记完成
      setAllPlaceholders(prev => prev.map(item => 
        item.id === p.id ? { ...item, done: true } : item
      ));
      
      // 更新文章图片关联
      const imgs = await window.electronAPI.listArticleImages(selected.id);
      setSelected((s) => s ? { ...s, articleImages: imgs as any } : s);
      showToast('✅ 生成完成');
    } catch (err: any) {
      showToast('❌ 生成失败: ' + err.message);
    } finally {
      setGeneratingImages(false);
    }
  };

  // 选择图库图片作为配图
  const selectImageFromLibrary = async (img: any) => {
    if (!selected || !pickerPlaceholder) return;
    try {
      await window.electronAPI.linkImageToArticle({
        articleId: selected.id,
        placeholderId: pickerPlaceholder.id,
        imageId: img.id,
      });
      // 标记完成
      setAllPlaceholders(prev => prev.map(p => 
        p.id === pickerPlaceholder.id ? { ...p, done: true } : p
      ));
      // 更新文章图片关联
      const imgUrl = img.url || img.file_path;
      setArticleImages(prev => ({ ...prev, [pickerPlaceholder.id]: imgUrl }));
      setSelected((s) => s ? { ...s, articleImages: { ...(s.articleImages || {}), [pickerPlaceholder.id]: imgUrl } } : s);
      showToast('✅ 已选择配图');
    } catch (err: any) {
      showToast('❌ 选择失败: ' + err.message);
    }
  };

  // 导出为 DOCX
  const exportDocx = async () => {
    if (!selected) return;
    try {
      await exportWord(selected.content || '', selected.title || '文章');
      showToast('✅ 已导出 DOCX');
    } catch (err: any) {
      showToast('❌ 导出失败: ' + err.message);
    }
  };

  // 导出为 PDF
  const exportPdf = () => {
    if (!selected) return;
    window.print();
  };

  // 复制为平台格式（图片转 base64 嵌入）
  const copyAsPlatform = async (platformId: string) => {
    if (!selected) return;
    const p = PLATFORMS.find(platform => platform.id === platformId);
    if (!p) return;

    let adapted = adaptForPlatform(platformId as any, selected.title || '', selected.content || '');

    // 解析 [[配图:描述@picN]] 占位符，替换为 base64 图片
    const placeholderMatches = [...adapted.matchAll(/\[\[配图:([^@\]]+)@([^\]]+)\]\]/g)];
    if (placeholderMatches.length > 0) {
      // 加载文章关联的图片
      const articleImgs = await window.electronAPI.listArticleImages(selected.id);
      const imgMap: Record<string, string> = {};
      for (const img of (articleImgs as any[])) {
        imgMap[img.placeholder_id] = img.file_path;
      }
      for (const m of placeholderMatches) {
        const [full, desc, placeholderId] = m;
        const filePath = imgMap[placeholderId];
        if (filePath) {
          try {
            const r = await window.electronAPI.readImageDataUrl(filePath);
            if (r?.ok && r.dataUrl) {
              adapted = adapted.replace(full, `![${desc}](${r.dataUrl})`);
            }
          } catch {}
        }
      }
    }

    try {
      await navigator.clipboard.writeText(adapted);
      showToast(`✅ 已复制为「${p.name}」格式，粘贴即可发布`);
    } catch {
      showToast('❌ 复制失败，请手动复制');
    }
    setShowExportMenu(false);
  };

  // 生成封面
  const generateCover = async (aspect: string) => {
    if (!selected) return;
    
    const title = selected.title || '';
    if (!title) {
      showToast('❌ 文章标题为空');
      return;
    }
    
    showToast('🎨 正在生成封面...');
    
    try {
      let providerId = '', modelId = '';
      try {
        const s = getImageSettings();
        providerId = s.provider || '';
        modelId = s.model || '';
      } catch {}
      
      const prompt = `${title}，杂志封面风格，简约大气，高质量`;
      
      const result = await window.electronAPI.generateImageFor({
        articleId: selected.id,
        placeholderId: 'cover',
        prompt,
        tags: title.slice(0, 50),
        aspect,
        useCraft: true,
        providerId,
        modelId,
      });
      
      if (result.ok) {
        showToast('✅ 封面生成完成');
        setSelected((s) => s ? { ...s } : s);
      }
    } catch (err: any) {
      showToast('❌ 封面生成失败: ' + err.message);
    }
  };

  /** 封面尺寸选项 */
  const COVER_SIZES = [
    { label: '微信公众号', aspect: '2.35:1', px: '900×383', icon: '💚' },
    { label: '微博', aspect: '1.8:1', px: '900×500', icon: '🔴' },
    { label: '小红书', aspect: '1:1', px: '1080×1080', icon: '🔴' },
    { label: '知乎', aspect: '1.82:1', px: '840×460', icon: '💡' },
    { label: '今日头条', aspect: '2:1', px: '1200×600', icon: '📰' },
    { label: 'B站 / 通用', aspect: '16:9', px: '1920×1080', icon: '🎬' },
  ];

  // 打开配图弹窗
  const openImagePicker = () => {
    // 解析占位符
    const re = /\[\[配图[：:]([^\]@]{1,60})(?:@([\w-]+))?\]\]/g;
    const matches = [...(selected?.content || '').matchAll(re)];
    if (matches.length === 0) {
      showToast('📌 没有发现 [[配图:描述]] 占位符');
      return;
    }
    const placeholders = matches.map((m, i) => ({
      desc: m[1] || '配图',
      id: m[2] || `pic${i + 1}`,
      index: i,
      done: !!articleImages[m[2] || `pic${i + 1}`],  // 已处理的标记
    }));
    setAllPlaceholders(placeholders);
    setPickerStep('list');
    setShowImagePicker(true);
    loadLibraryImages();
  };

  // 选择某个占位符进行配图
  const selectPlaceholder = (p: {desc: string, id: string, index: number, done?: boolean}) => {
    setPickerPlaceholder(p);
    // 如果已完成的，先清除关联
    if (p.done) {
      setAllPlaceholders(prev => prev.map(item => 
        item.id === p.id ? { ...item, done: false } : item
      ));
    }
    setPickerStep('select');
  };

  // 完成当前占位符配图
  const completePlaceholder = (method: 'generate' | 'library') => {
    // 标记完成
    setAllPlaceholders(prev => prev.map(p => 
      p.id === pickerPlaceholder?.id ? { ...p, done: true } : p
    ));
    // 返回列表
    setPickerStep('list');
    setPickerPlaceholder(null);
    showToast('✅ ' + (method === 'generate' ? 'AI生成' : '图库选择') + ' 完成');
  };

  // 保存润色后的内容
  const savePolished = async () => {
    if (!selected) {
      console.warn('[save] no selected');
      showToast('❌ 没有选中文章');
      return;
    }
    console.log('[save] start, id:', selected.id, 'content length:', selected.content?.length);
    try {
      // 客户端也去反斜杠（双保险）
      const cleaned = (selected.content || '').replace(/\\([\[\]()<>#*_`~])/g, '$1');
      const result = await window.electronAPI.updateArticle({ id: selected.id, content: cleaned });
      // 同时更新本地 state
      setSelected((s) => s ? { ...s, content: cleaned } : s);
      console.log('[save] success:', result);
      showToast('✅ 已保存到数据库（' + (result.wordCount || 0) + ' 字）');
      load();
    } catch (err: any) {
      console.error('[save] error:', err);
      showToast('❌ ' + (err.message || '保存失败'));
    }
  };

  return (
    <>
      <PageHeader title="我的文章" subtitle="所有草稿 / 定时 / 已发布都在这里" />

      {/* 过滤 + 搜索 */}
      <div className="tab-bar">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`tab-pill ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <input
          className="input"
          placeholder="🔍 搜索标题"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          style={{ maxWidth: 240, marginLeft: 'auto', borderRadius: 999 }}
        />
      </div>

      {/* 列表 */}
      <Card>
        {loading ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : articles.length === 0 ? (
          <Empty icon={FileText} title="还没有文章" description="去「写文章」生成第一篇" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {articles.map((a) => {
              const st = statusOf(a);
              return (
                <div
                  key={a.id}
                  className="card"
                  style={{ padding: 14, background: 'var(--bg-soft)', cursor: 'pointer' }}
                  onClick={() => openArticle(a)}
                >
                  <div className="row" style={{ marginBottom: 6 }}>
                    <div style={{ flex: 1, fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 15 }}>
                      {a.title || '(无标题)'}
                    </div>
                    <span className={`card-status s-${st}`}>{STATUS_LABEL[st] || st}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
                    📝 {a.word_count || 0} 字 · 🤖 {a.model || a.provider || '-'} · {a.platform || ''} ·{' '}
                    {new Date(a.updated_at || a.created_at).toLocaleString('zh-CN', { hour12: false })}
                    {a.scheduled_at && ` · ⏰ ${new Date(a.scheduled_at as any).toLocaleString('zh-CN', { hour12: false })}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 详情 modal */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: 'min(800px, 92vw)', maxHeight: '88vh',
              display: 'flex', flexDirection: 'column',
              padding: 0, overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            {/* 头部 */}
            <div className="row" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600 }}>
                  {selected.title || '(无标题)'}
                </h2>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {selected.word_count || 0} 字 · {selected.model || '-'} · {new Date(selected.updated_at || selected.created_at).toLocaleString('zh-CN', { hour12: false })}
                </div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setSelected(null)}>✕</button>
            </div>

            {/* 正文（Markdown 渲染 或 富文本编辑）*/}
            <div
              className="md-body"
              style={{
                flex: 1, overflow: 'auto', padding: '18px 24px',
                fontFamily: 'var(--font-serif)', fontSize: 14, lineHeight: 1.85,
              }}
            >
              {editMode ? (
                <RichEditor
                  initialMarkdown={selected.content || ''}
                  onChange={(md) => setSelected({ ...selected, content: md })}
                />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml={false} components={mdComponents}>
                  {renderedContent || '_（无内容）_'}
                </ReactMarkdown>
              )}
            </div>

            {/* 操作栏 */}
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--border)',
              background: '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}>
              {/* 左侧：编辑/保存 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setEditMode(!editMode)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: editMode ? 'var(--line-soft)' : 'transparent',
                    color: editMode ? 'var(--line-2)' : 'var(--ink-3)',
                    fontWeight: 500,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {editMode ? '👁️ 预览' : '✏️ 编辑'}
                </button>
                <button
                  onClick={savePolished}
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
                  💾 保存
                </button>
              </div>

              {/* 中间：工具按钮 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => navigator.clipboard.writeText(selected.content || '')}
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
                <button
                  disabled={generatingImages}
                  onClick={openImagePicker}
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
                  {generatingImages ? '⏳' : '🎨'} 配图
                </button>
                <button
                  disabled={polishing}
                  onClick={() => setShowPolishPanel(!showPolishPanel)}
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
                  {polishing ? '⏳' : '✨'} 润色
                </button>
              </div>

              {/* 右侧：导出+更多 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* 导出下拉菜单 */}
                <div style={{ position: 'relative' }} className="export-menu-container">
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
                        borderRadius: 12,
                        boxShadow: 'var(--shadow-lg)',
                        padding: 8,
                        minWidth: 180,
                        zIndex: 1001,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 导出格式 */}
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, padding: '4px 6px 6px', textTransform: 'uppercase', letterSpacing: 1 }}>导出</div>
                      <button style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--ink-2)', fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { exportDocx(); setShowExportMenu(false); }}>📄 Word (.docx)</button>
                      <button style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--ink-2)', fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { exportPdf(); setShowExportMenu(false); }}>📑 PDF</button>
                      <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                      {/* 平台格式 */}
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, padding: '4px 6px 6px', textTransform: 'uppercase', letterSpacing: 1 }}>复制为平台格式</div>
                      {PLATFORMS.map(p => (
                        <button
                          key={p.id}
                          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--ink-2)', fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                          onClick={() => copyAsPlatform(p.id)}
                        >
                          <span>{p.icon}</span> {p.name}
                        </button>
                      ))}
                      <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                      {/* 封面 */}
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, padding: '4px 6px 6px', textTransform: 'uppercase', letterSpacing: 1 }}>封面</div>
                      <button style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--ink-2)', fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { setShowExportMenu(false); setShowCoverPanel(true); }}>🖼️ 生成封面</button>
                    </div>
                  )}
                </div>

                {/* 更多操作 */}
                <div style={{ position: 'relative' }} className="more-menu-container">
                  <button
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--ink-3)',
                      fontWeight: 500,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    •••
                  </button>
                  {showMoreMenu && (
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
                        minWidth: 130,
                        zIndex: 1001,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(statusOf(selected) !== 'published' && statusOf(selected) !== 'failed') && (
                        <button style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--ink-2)', fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }} onClick={() => { setShowSchedulePanel(true); setShowMoreMenu(false); }}>📅 排程发布</button>
                      )}
                      {(statusOf(selected) === 'draft' || statusOf(selected) === 'done' || statusOf(selected) === 'scheduled') && (
                        <button style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: 'none', background: 'transparent', color: '#10b981', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }} onClick={() => { publish(selected.id); setShowMoreMenu(false); }}>✅ 标记已发布</button>
                      )}
                      {statusOf(selected) === 'published' && (
                        <button style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: 'none', background: 'transparent', color: '#f59e0b', fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }} onClick={() => { unpublish(selected.id); setShowMoreMenu(false); }}>↩️ 取消发布</button>
                      )}
                      {statusOf(selected) === 'scheduled' && (
                        <button style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--ink-2)', fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }} onClick={() => { unschedule(selected.id); setShowMoreMenu(false); }}>❌ 取消排程</button>
                      )}
                      <button style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: 'none', background: 'transparent', color: '#ef4444', fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }} onClick={() => { if (confirm('确定要删除这篇文章吗？')) { del(selected.id); setSelected(null); } setShowMoreMenu(false); }}>🗑️ 删除</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 排程面板（datetime-local） */}
            {showSchedulePanel && (
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-soft)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>⏰ 发布时间：</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary btn-sm" onClick={schedule} disabled={!scheduleTime}>
                  确认排程
                </button>
              </div>
            )}

            {/* 润色指令面板 */}
            {showPolishPanel && (
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-soft)' }}>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 6 }}>✍️ 润色指令：</div>
                <textarea
                  className="textarea"
                  rows={2}
                  value={polishInstruction}
                  onChange={(e) => setPolishInstruction(e.target.value)}
                  placeholder="例：让语言更犀利、有金句感 / 加上数据论据 / 压缩到 1500 字"
                  style={{ fontSize: 13 }}
                />
                <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setShowPolishPanel(false)}>取消</button>
                  <button className="btn btn-primary btn-sm" onClick={polish} disabled={polishing || !polishInstruction.trim()}>
                    {polishing ? '⏳ 润色中…' : '✨ 开始润色'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 封面生成面板 */}
      {showCoverPanel && (
        <div
          onClick={() => setShowCoverPanel(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)', borderRadius: 16, padding: 0,
              width: 'min(500px, 95vw)',
            }}
          >
            {/* 标题 */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>🖼️ 生成封面</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>{selected?.title}</p>
              </div>
              <button onClick={() => setShowCoverPanel(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>✕</button>
            </div>

            {/* 尺寸选择 */}
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12, fontWeight: 500 }}>选择平台尺寸：</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {COVER_SIZES.map(size => (
                  <button
                    key={size.aspect}
                    onClick={() => setSelectedAspect(size.aspect)}
                    style={{
                      padding: '12px 8px',
                      borderRadius: 8,
                      border: `2px solid ${selectedAspect === size.aspect ? 'var(--line)' : 'var(--border)'}`,
                      background: selectedAspect === size.aspect ? 'var(--line-light)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{size.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: selectedAspect === size.aspect ? 'var(--line-2)' : 'var(--ink-2)' }}>{size.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{size.px}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)' }}>{size.aspect}</div>
                  </button>
                ))}
              </div>

              {/* 预览比例提示 */}
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-soft)', borderRadius: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                📐 当前比例 {selectedAspect} · 基于标题「{selected?.title?.slice(0, 20)}」生成
              </div>
            </div>

            {/* 底部按钮 */}
            <div style={{ padding: '0 20px 20px', display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowCoverPanel(false)}
                style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 13 }}
              >
                取消
              </button>
              <button
                onClick={async () => {
                  setShowCoverPanel(false);
                  await generateCover(selectedAspect);
                }}
                style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: 'var(--line)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                🎨 生成封面
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 配图选择弹窗 */}
      {showImagePicker && (
        <div
          onClick={() => setShowImagePicker(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)', borderRadius: 16, padding: 0,
              width: 'min(600px, 95vw)', maxHeight: 'min(600px, 90vh)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            {/* 标题栏 */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>🎨 配图 ({allPlaceholders.filter(p => p.done).length}/{allPlaceholders.length})</h3>
              <button onClick={() => setShowImagePicker(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>✕</button>
            </div>

            {/* 内容区 */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {pickerStep === 'list' ? (
                // 步骤1: 占位符列表
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {allPlaceholders.map((p, i) => (
                    <div
                      key={p.id}
                      onClick={() => !p.done && selectPlaceholder(p)}
                      style={{
                        padding: '14px 16px', borderRadius: 10,
                        background: p.done ? 'var(--bg-soft)' : 'var(--bg)',
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 12,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                      <div style={{ 
                        width: 28, height: 28, borderRadius: '50%', 
                        background: p.done ? 'var(--line)' : 'var(--bg-soft)',
                        color: p.done ? '#fff' : 'var(--muted)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 600,
                      }}>
                        {p.done ? '✓' : i + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{p.desc}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>ID: {p.id}</div>
                      </div>
                      {p.done ? (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>点击重新编辑</span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>待处理</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : pickerStep === 'select' ? (
                // 步骤2: 选择图源
                <div>
                  <button
                    onClick={() => setPickerStep('list')}
                    style={{ background: 'none', border: 'none', color: 'var(--line)', cursor: 'pointer', fontSize: 13, marginBottom: 16 }}
                  >
                    ← 返回列表
                  </button>
                  <div style={{ background: 'var(--bg-soft)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>📝 当前处理</div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{pickerPlaceholder?.desc}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>ID: {pickerPlaceholder?.id}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setShowImagePicker(false);
                        generateSinglePlaceholder(pickerPlaceholder!);
                      }}
                      style={{ padding: '14px', fontSize: 15 }}
                    >
                      🤖 AI 生成
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={() => {
                        setPickerStep('library');
                        loadLibraryImages();
                      }}
                      style={{ padding: '14px', fontSize: 15 }}
                    >
                      🖼️ 从图库选择
                    </button>
                  </div>
                </div>
              ) : (
                // 步骤3: 图库选择
                <div>
                  <button
                    onClick={() => setPickerStep('select')}
                    style={{ background: 'none', border: 'none', color: 'var(--line)', cursor: 'pointer', fontSize: 13, marginBottom: 16 }}
                  >
                    ← 返回选择
                  </button>
                  <ImageLibraryGrid
                    onSelect={selectImageFromLibrary}
                    columns={4}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}