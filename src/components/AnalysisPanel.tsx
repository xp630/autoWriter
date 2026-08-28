// AnalysisPanel — 展示 AI 内容分析的 7 个卡片 + 创作方向（P0-1b）
import {
  FileText, Globe, Hash, Lightbulb, MessageSquare,
  Sparkles, Target, Users, Wand2, XCircle, CheckCircle2, AlertTriangle, Loader2, BookmarkPlus, Star,
} from 'lucide-react';
import type { ContentAnalysisResult, Angle, StrategyMode, StrategyValue } from '../types';

interface Props {
  analysis: ContentAnalysisResult;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  onStartWriting?: () => void;
  onGenerateAngles?: () => void;
  angles?: Angle[] | null;
  anglesStatus?: 'idle' | 'running' | 'completed' | 'failed';
  anglesError?: string;
  trackFit?: { matches?: boolean; article_track?: string; user_track?: string; note?: string } | null;
  onSaveTopic?: (angle: Angle) => void;
  onStartWithAngle?: (angle: Angle) => void;
  /** 已采纳的角度下标（-1 = 未采纳），用于卡片上的“已采纳”标记 */
  adoptedIndex?: number;
  /** 策略模式：reference 展示分析结果 + track_fit；topic 只展示 value + 角度卡 */
  mode?: StrategyMode;
  /** B 命题策划的题面价值评估 */
  value?: StrategyValue | null;
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

export function AnalysisPanel({ analysis, status, error, onStartWriting, onGenerateAngles, angles, anglesStatus, anglesError, trackFit, onSaveTopic, onStartWithAngle, adoptedIndex = -1, mode = 'reference', value }: Props) {
  const isTopic = mode === 'topic';
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
          <span className="analysis-header-title">{isTopic ? '创作策略 · 命题策划' : '内容分析结果'}</span>
        </div>
        <div className="analysis-actions">
          {onGenerateAngles && (
            <button type="button" className="btn btn-outline btn-sm" disabled={anglesStatus === 'running'} onClick={onGenerateAngles} title={isTopic ? '只有一个题目：推演它值不值得写 + 5 个互斥角度 + 你需要补什么素材' : '基于分析结果，从当前创作身份赛道生成 5 个互斥角度'}>
              {anglesStatus === 'running'
                ? <><Loader2 size={12} className="spin" /> 生成中…</>
                : <><Wand2 size={12} /> {isTopic ? '生成创作策略' : '生成创作方向'}</>}
            </button>
          )}
          {onStartWriting && !isTopic && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onStartWriting}>
              开始写作 <Wand2 size={12} />
            </button>
          )}
        </div>
      </div>

      {!isTopic && (
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
                      <ol className="analysis-list compact">{kvList(data.reason)}</ol>
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
      )}

      {/* ===== 创作方向（P0-1b）===== */}
      {(anglesStatus === 'running') && (
        <div className="gen-loading angles-loading">
          <Loader2 size={16} className="spin" />
          <span>AI 正在从你的赛道生成 5 个创作方向…</span>
        </div>
      )}

      {trackFit && (
        <div className={`track-fit-banner ${trackFit.matches ? 'fit' : 'mismatch'}`}>
          {trackFit.matches
            ? <><CheckCircle2 size={16} /> 本文与「{trackFit.user_track || '当前'}」赛道匹配：{trackFit.note}</>
            : <><AlertTriangle size={16} /> 本文偏「{trackFit.article_track || '?'}」，与你的「{trackFit.user_track || '当前'}」赛道不匹配：{trackFit.note}</>}
        </div>
      )}

      {value && (
        <div className={`value-banner ${value.worth === false ? 'mismatch' : 'fit'}`}>
          <div className="value-banner-head">
            <Target size={14} />
            <span>题目价值{typeof value.score === 'number' ? ` ${value.score.toFixed(1)}/10` : ''}</span>
            {typeof value.worth === 'boolean' && (
              <span className="value-verdict">{value.worth ? '建议写' : '不建议写'}</span>
            )}
          </div>
          {value.audience_need && <div className="value-line"><b>人群为何关心</b>{value.audience_need}</div>}
          {value.competition && <div className="value-line"><b>竞争情况</b>{value.competition}</div>}
          {value.advice && <div className="value-line"><b>结论</b>{value.advice}</div>}
        </div>
      )}

      {anglesError && (
        <div className="angles-error">
          <XCircle size={15} /> 生成方向失败：{anglesError}
        </div>
      )}

      {angles && angles.length > 0 && (
        <div className="angles-list">
          {angles.map((a, i) => (
            <div key={i} className="angle-card">
              <div className="angle-head">
                <span className="angle-type">{a.angle_type || `方向 ${i + 1}`}</span>
                {typeof a.value_score === 'number' && (
                  <span className="angle-score" title="这个角度在当前赛道的推荐指数">
                    <Star size={11} /> {a.value_score.toFixed(1)}
                  </span>
                )}
                {adoptedIndex === i && (
                  <span className="angle-adopted"><CheckCircle2 size={11} /> 已采纳</span>
                )}
                {onStartWithAngle && (
                  <button type="button" className="btn btn-primary btn-sm angle-start" onClick={() => onStartWithAngle(a)}>
                    采用策略并开始创作 <Wand2 size={12} />
                  </button>
                )}
              </div>
              <div className="angle-title">{a.title}</div>
              {a.core_point && <div className="angle-core">{a.core_point}</div>}
              {(a.emotion || a.goal) && (
                <div className="angle-chips">
                  {a.emotion && <span className="angle-chip">情绪 · {a.emotion}</span>}
                  {a.goal && <span className="angle-chip">目标 · {a.goal}</span>}
                </div>
              )}
              <div className="angle-meta">
                {a.differentiator && (
                  <div className="angle-row">
                    <span className="viral-label">差异锚点</span>
                    <span className="angle-diff">{a.differentiator}</span>
                  </div>
                )}
                {a.target_user && <div className="angle-row"><span className="viral-label">目标用户</span><span>{a.target_user}</span></div>}
                {a.structure && a.structure.length > 0 && (
                  <div className="angle-row">
                    <span className="viral-label">推荐结构</span>
                    <ol className="analysis-list compact">{a.structure.map((s, j) => <li key={j}>{s}</li>)}</ol>
                  </div>
                )}
                {a.reason && <div className="angle-row"><span className="viral-label">推荐理由</span><span>{a.reason}</span></div>}
                {(a.feasibility || (a.evidence_needed && a.evidence_needed.length > 0)) && (
                  <div className="angle-evidence">
                    {a.feasibility && (
                      <span className={`angle-feas feas-${a.feasibility === '易' ? 'easy' : a.feasibility === '中' ? 'mid' : 'hard'}`}>
                        可写性 · {a.feasibility}
                      </span>
                    )}
                    {a.evidence_needed && a.evidence_needed.length > 0 && (
                      <>
                        <div className="angle-evidence-label">你需要补充（缺这些就只能写成空泛观点文）</div>
                        <ul className="angle-evidence-list">
                          {a.evidence_needed.map((e, j) => <li key={j}>{e}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
              {onSaveTopic && (
                <button type="button" className="btn btn-outline btn-sm angle-save" onClick={() => onSaveTopic(a)}>
                  <BookmarkPlus size={13} /> 保存为选题
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}