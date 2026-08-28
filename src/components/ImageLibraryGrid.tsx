// 图库网格组件 - 可复用的图片选择网格
import { useState, useEffect } from 'react';

interface ImageRecord {
  id: number;
  url?: string;
  file_path?: string;
  prompt?: string;
  provider?: string;
  model?: string;
}

interface Props {
  onSelect: (img: ImageRecord) => void;
  columns?: number;
}

export function ImageLibraryGrid({ onSelect, columns = 4 }: Props) {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = async () => {
    setLoading(true);
    setError(null);
    try {
      const imgs = await window.electronAPI.listAllImages();
      setImages(imgs || []);
    } catch (err: any) {
      console.error('加载图库失败:', err);
      setError('加载失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const filteredImages = images.filter(img => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (img.prompt || '').toLowerCase().includes(q) ||
           (img.provider || '').toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <div className="spinner" />
        <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>正在加载图库...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
        <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>
        <button className="btn btn-outline btn-sm" onClick={loadImages}>
          🔄 重试
        </button>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, background: 'var(--bg-soft)', borderRadius: 12 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>📭</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>图库为空</div>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          先去「图库」页面生成一些图片吧
        </div>
        <button 
          className="btn btn-primary btn-sm" 
          style={{ marginTop: 16 }}
          onClick={() => window.location.href = '/images'}
        >
          🖼️ 前往图库
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* 搜索框 */}
      <div style={{ marginBottom: 12 }}>
        <input
          className="input"
          placeholder="🔍 搜索图片描述..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', borderRadius: 8 }}
        />
      </div>
      
      {/* 图片网格 */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 10, 
        maxHeight: 400, 
        overflow: 'auto',
      }}>
        {filteredImages.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
            🔍 没有找到匹配的图片
          </div>
        ) : (
          filteredImages.map((img) => {
            const imgSrc = img.url || img.file_path;
            return (
              <div
                key={img.id}
                onClick={() => onSelect(img)}
                style={{
                  borderRadius: 8, 
                  overflow: 'hidden', 
                  cursor: 'pointer',
                  border: '2px solid transparent', 
                  transition: 'all 0.2s',
                  aspectRatio: '1', 
                  background: 'var(--bg-soft)',
                  position: 'relative',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'transparent';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {imgSrc ? (
                  <img
                    src={imgSrc}
                    alt={img.prompt || '图片'}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    height: '100%', 
                    color: 'var(--muted)', 
                    fontSize: 12 
                  }}>
                    无URL
                  </div>
                )}
                
                {/* Provider 标签 */}
                {img.provider && (
                  <div style={{
                    position: 'absolute',
                    bottom: 4,
                    left: 4,
                    padding: '2px 6px',
                    background: 'rgba(0,0,0,0.6)',
                    borderRadius: 4,
                    fontSize: 10,
                    color: '#fff',
                  }}>
                    {img.provider === 'tensorart' ? '🎨' : '🌐'}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 统计 */}
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
        {search ? `找到 ${filteredImages.length} 张 (共 ${images.length} 张)` : `共 ${images.length} 张图片`}
      </div>
    </div>
  );
}
