// ArticleViewer —— 正文渲染（写文章页 Step3 & 我的文章详情共用，保证 UI 一模一样）
// 把 [[配图:描述@picN]] 占位符渲染成直观占位/成品槽 <ImageSlot>（三选一配图 + 入库）。
import { useEffect, useState } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageSlot } from './ImageSlot';

const PLACEHOLDER_RE = /\[\[配图[：:]([^\]@]{1,60})(?:@([\w-]+))?\]\]/g;

/** aw-img / uploads 相对路径 → dataURL；http/data 直接用 */
function SlotAwareImg({ src, alt }: { src?: string; alt?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!src) return;
      if (src.startsWith('data:') || src.startsWith('http')) { if (alive) setUrl(src); return; }
      try {
        const r = await window.electronAPI.readImageDataUrl(src);
        if (alive && r?.ok) setUrl(r.dataUrl);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [src]);
  if (!url) return <div className="md-img-loading">🖼️ {alt || '图片加载中…'}</div>;
  return <img src={url} alt={alt || ''} />;
}

interface Props {
  content: string;
  articleId: number;
  /** placeholderId → 已配图路径（aw-img/uploads）；有则 ImageSlot 直接显示成品 */
  imagesMap?: Record<string, string>;
  onImageUpdated?: (placeholderId: string, url: string) => void;
  style?: React.CSSProperties;
  className?: string;
}

export function ArticleViewer({ content, articleId, imagesMap = {}, onImageUpdated, style, className }: Props) {
  const components: Components = {
    img: (p: any) => <SlotAwareImg src={String(p.src || '')} alt={String(p.alt || '')} />,
    p: ({ children }: any) => {
      const text = String(children ?? '');
      if (!PLACEHOLDER_RE.test(text)) { PLACEHOLDER_RE.lastIndex = 0; return <p>{children}</p>; }
      PLACEHOLDER_RE.lastIndex = 0;

      const parts = text.split(/(\[\[配图[：:][^\]]+\]\])/g);
      return (
        <p>
          {parts.map((part, i) => {
            const m = part.match(/\[\[配图[：:]([^\]@]{1,60})(?:@([\w-]+))?\]\]/);
            if (!m) return part;
            const desc = (m[1] || '').trim();
            const picId = m[2] || `auto${i}`;
            return (
              <ImageSlot
                key={`${picId}-${i}`}
                articleId={articleId}
                placeholderId={picId}
                desc={desc}
                url={imagesMap[picId]}
                onUpdated={onImageUpdated}
              />
            );
          })}
        </p>
      );
    },
  };

  return (
    <div className={className} style={style}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content || '_（无内容）_'}
      </ReactMarkdown>
    </div>
  );
}
