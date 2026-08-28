// AnalysisPanel — 展示 AI 内容分析的 7 个卡片
import {
  FileText, Globe, Hash, Lightbulb, MessageSquare,
  Sparkles, Target, Users, Wand2, XCircle,
} from 'lucide-react';
import type { ContentAnalysisResult } from '../types';

interface Props {
  analysis: ContentAnalysisResult;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  onStartWriting?: () => void;
  onGenerateAngles?: () => void;  // 未来 P1
}

const SECTIONS = [
  { key: 'basic_info', label: '基本信息', icon: FileText, accent: 'system' },
  { key: 'topic',      label: '主题',     icon: Lightbulb, accent: 'action' },
  { key: 'core_points',label: '核心观点', icon: Sparkles, accent: 'action' },
  { key: 'viral',      label: '爆点',     icon: Target, accent: 'configure' },
  { key: 'structure',  label: '结构',     icon: Hash, accent: 'system' },
  { key: 'audience',   label: '用户画像', icon: Users, accent: 'insight' },
  { key: 'adaptation', label: '可借鉴',   icon: Wand2, accent: 'configure' },
] as const;

function kvList(arr?: string[]) {
  if (!arr || !arr.length) return <div className="muted-empty">—</div>;
  return (
    <ol className="analysis-list">
      {arr.map((s, i) => <li key={i}>{s}</li>)}
    </ol>
  );
}

export function AnalysisPanel({ analysis, status, error, onStartWriting, onGenerateAngles }: Props) {
  if (status === 'failed') {
    return (
      <div className="analysis-panel analysis-failed">
        <div className="analysis-failed-head">
          <XCircle size={20} />
          <span>分析失败</span>
        </div>
        <div className="analysis-failed-body">{error || '未知错误'}</div>
      </div>
    );
  }

  return (
    <div className="analysis-panel">
      <div className="analysis-header">
        <div className="analysis-header-left">
          <Sparkles size={18} className="analysis-header-icon" />
          <span className="analysis-header-title">内容分析结果</span>
        </div>
        <div className="analysis-actions">
          {onGenerateAngles && (
            <button type="button" className="btn btn-outline btn-sm" disabled title="P1 阶段开放">
              <Wand2 size={12} /> 生成创作方向
            </button>
          )}
          {onStartWriting && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onStartWriting}>
              开始写作 <Wand2 size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="analysis-grid">
        {SECTIONS.map(({ key, label, icon: Icon, accent }) => {
          const data = (analysis as any)[key];
          return (
            <div key={key} className={`analysis-card analysis-accent-${accent}`}>
              <div className="analysis-card-head">
                <Icon size={16} strokeWidth={2} className="analysis-card-icon" />
                <span className="analysis-card-label">{label}</span>
              </div>
              <div className="analysis-card-body">
                {key === 'basic_info' && data && (
                  <div className="basic-info">
                    {data.title && <div className="basic-info-title">{data.title}</div>}
                    <div className="basic-info-meta">
                      {data.platform && <span className="kv-tag"><Globe size={11} /> {data.platform}</span>}
                      {data.author && <span className="kv-tag">👤 {data.author}</span>}
                      {data.source && data.source !== 'user input' && (
                        <span className="kv-tag mono small">{data.source.slice(0, 50)}{data.source.length > 50 ? '…' : ''}</span>
                      )}
                    </div>
                    {data.keywords?.length ? (
                      <div className="kw-row">
                        {data.keywords.map((kw: string, j: number) => (
                          <span key={j} className="kw-chip">{kw}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}

                {key === 'topic' && data && (
                  <div>
                    {data.main_topic && <div className="topic-main">{data.main_topic}</div>}
                    {data.category && <span className="kv-tag accent">{data.category}</span>}
                    {data.summary && <div className="topic-summary">{data.summary}</div>}
                  </div>
                )}

                {key === 'core_points' && kvList(data)}

                {key === 'viral' && data && (
                  <div className="viral-body">
                    {data.emotion && (
                      <div className="viral-row">
                        <span className="viral-label">主导情绪</span>
                        <span className="viral-value accent">{data.emotion}</span>
                      </div>
                    )}
                    {data.conflict && (
                      <div className="viral-row">
                        <span className="viral-label">核心冲突</span>
                        <span className="viral-value">{data.conflict}</span>
                      </div>
                    )}
                    <div className="viral-reasons">
                      <span className="viral-label">传播原因</span>
                      <ol className="analysis-list compact">{kvList(data.reasons)}</ol>
                    </div>
                  </div>
                )}

                {key === 'structure' && kvList(data)}

                {key === 'audience' && data && (
                  <div className="audience-body">
                    {data.target_user && <div className="audience-target">{data.target_user}</div>}
                    <div className="audience-pains">
                      <span className="viral-label">关注点</span>
                      {kvList(data.pain_points)}
                    </div>
                  </div>
                )}

                {key === 'adaptation' && data && (
                  <div className="adaptation-grid">
                    <div className="adaptation-col">
                      <div className="adaptation-head good">
                        <span>✓ 可借鉴</span>
                      </div>
                      {kvList(data.borrow)}
                    </div>
                    <div className="adaptation-col">
                      <div className="adaptation-head bad">
                        <span>✗ 不要复制</span>
                      </div>
                      {kvList(data.avoid_copy)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}