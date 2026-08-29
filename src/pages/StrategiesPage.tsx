// StrategiesPage — 策略库（V2 §十二）：让策略成为可浏览、可检索、可复用的资产
import { useCallback, useEffect, useState } from 'react';
import {
  Layers, Compass, Star, Search, Archive, RotateCcw, Trash2, RefreshCw,
  FileText, CheckCircle2, AlertTriangle, Lightbulb, Users, Target, TrendingUp,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Empty } from '../components/Empty';
import { showToast } from '../toast';
import { useActiveProfile } from '../hooks/useActiveProfile';
import { setPendingStrategy } from '../utils/strategyHandoff';
import { DIFFICULTY_LABEL, NARRATIVE_BEAT_LABEL, type Narrative, type Strategy, type StrategyLink, type StrategyMode, type StrategyStats } from '../types';
import { EvidenceChecklist } from '../components/EvidenceChecklist';

type ModeFilter = 'all' | StrategyMode;
type StatusFilter = 'all' | 'unarchived' | 'candidate' | 'adopted' | 'archived';

const MODE_TEXT: Record<StrategyMode, string> = { reference: '借势拆解', topic: '命题策划' };
const STATUS_TEXT: Record<string, string> = { candidate: '候选', adopted: '已采纳', archived: '已归档' };

function timeAgo(s?: string | null): string {
  if (!s) return '—';
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return s;
  const diff = Date.now() - t;
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d} 天前`;
  const h = Math.floor(diff / 3600000);
  if (h > 0) return `${h} 小时前`;
  const m = Math.floor(diff / 60000);
  return m > 0 ? `${m} 分钟前` : '刚刚';
}

export function StrategiesPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const profile = useActiveProfile();
  const [mode, setMode] = useState<ModeFilter>('all');
  // 默认看「未归档」：归档的意义就是不出现在眼前。想看归档的选「已归档」或「全部状态」。
  const [status, setStatus] = useState<StatusFilter>('unarchived');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<(Strategy & { links: StrategyLink[] }) | null>(null);
  const [stats, setStats] = useState<StrategyStats[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await window.electronAPI.listStrategies({
        profileId: profile.id,
        mode: mode === 'all' ? undefined : mode,
        status,
        search: search.trim() || undefined,
        limit: 100,
      });
      setList(rows || []);
    } catch (err: any) {
      showToast('❌ 读取策略库失败：' + (err.message || err));
    } finally {
      setLoading(false);
    }
  }, [profile.id, mode, status, search]);

  useEffect(() => { void load(); }, [load]);

  /** V3：勾证据状态。成立度会变 → 事实约束会变，所以必须重拉详情 + 列表 */
  const toggleEvidence = async (strategyId: number, index: number, next: 'todo' | 'ready') => {
    const r = await window.electronAPI.setStrategyEvidence({ strategyId, index, status: next });
    if (!r.ok) { showToast('❌ ' + (r.error || '写入失败')); return; }
    showToast(next === 'ready' ? '✅ 已标为已备好，AI 可以把它写进正文' : '↩️ 已撤回为未备');
    const got = await window.electronAPI.getStrategy(strategyId);
    if (got) setDetail(got);
    void load();
  };

  const openDetail = async (id: number) => {
    try {
      const got = await window.electronAPI.getStrategy(id);
      if (!got) { showToast('❌ 策略不存在'); return; }
      setDetail(got);
      const s = await window.electronAPI.strategyStats([id]);
      setStats(s || []);
    } catch (err: any) {
      showToast('❌ ' + (err.message || err));
    }
  };

  const archive = async (id: number, to: 'archived' | 'candidate' = 'archived') => {
    const r = await window.electronAPI.setStrategyStatus({ id, status: to });
    if (!r.ok) { showToast('❌ 状态更新失败'); return; }
    showToast(to === 'archived' ? '📦 已归档（默认视图不再显示，可在「已归档」找回）' : '↩️ 已取消归档');
    if (detail?.id === id) setDetail(null);
    void load();
  };

  const remove = async (id: number) => {
    if (!confirm('删除这条策略？它的采纳与战绩记录会一并删除。')) return;
    const r = await window.electronAPI.deleteStrategy(id);
    showToast(r.ok ? '🗑️ 已删除' : '❌ 删除失败');
    if (detail?.id === id) setDetail(null);
    void load();
  };

  /** 从策略重新创作：交接给写文章页，那边会落一条新的采纳记录（1:N） */
  const reuse = (id: number) => {
    setPendingStrategy(id);
    onNavigate?.('write');
  };

  return (
    <>
      <PageHeader
        title="策略库"
        subtitle="策略是资产，文章是执行结果 —— 这里沉淀你每次「怎么写」的决策与战绩"
        actions={
          <button className="btn btn-outline btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : undefined} /> 刷新
          </button>
        }
      />

      {/* 筛选条 */}
      <div className="sl-filters">
        <div className="sl-modes">
          {(['all', 'reference', 'topic'] as ModeFilter[]).map((m) => (
            <button
              key={m}
              className={`mode-pill ${mode === m ? 'active' : ''}`}
              onClick={() => setMode(m)}
              type="button"
            >
              {m === 'reference' ? <Layers size={13} /> : m === 'topic' ? <Compass size={13} /> : <Lightbulb size={13} />}
              {m === 'all' ? '全部模式' : MODE_TEXT[m]}
            </button>
          ))}
        </div>
        <div className="sl-search">
          <Search size={14} />
          <input
            className="input"
            placeholder="搜标题 / 角度 / 立意"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input sl-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="unarchived">未归档</option>
            <option value="all">全部状态</option>
            <option value="candidate">候选</option>
            <option value="adopted">已采纳</option>
            <option value="archived">已归档</option>
          </select>
        </div>
      </div>

      {list.length === 0 && !loading ? (
        <Empty
          icon={Lightbulb}
          title="策略库还是空的"
          description="去写文章页选一个模式生成策略：有参考文选「借势拆解」，只有题目选「命题策划」。采纳过的策略会自动留在这里。"
          action={<button className="btn btn-primary btn-sm" onClick={() => onNavigate?.('write')} type="button">去生成策略</button>}
        />
      ) : (
        <div className="sl-grid">
          {list.map((s) => {
            const st = statsOf(stats, s.id);
            return (
              <div key={s.id} className={`sl-card ${detail?.id === s.id ? 'selected' : ''}`}>
                <div className="sl-card-head">
                  <span className={`sl-mode-badge ${s.mode}`}>
                    {s.mode === 'topic' ? <Compass size={11} /> : <Layers size={11} />} {MODE_TEXT[s.mode]}
                  </span>
                  <span className="sl-angle">{s.angle_type || '未命名角度'}</span>
                  {typeof s.value_score === 'number' && (
                    <span className="sl-score"><Star size={11} /> {s.value_score.toFixed(1)}</span>
                  )}
                </div>
                <div className="sl-title">{s.title}</div>
                {s.core_point && <div className="sl-core">{s.core_point}</div>}
                <div className="sl-chips">
                  {s.emotion && <span className="angle-chip">情绪 · {s.emotion}</span>}
                  {s.goal && <span className="angle-chip">目标 · {s.goal}</span>}
                  {s.fact_risk && s.fact_risk !== 'low' && (
                    <span className={`angle-risk risk-${s.fact_risk}`}>事实风险 · {s.fact_risk === 'high' ? '高' : '中'}</span>
                  )}
                  {(s.evidence_total ?? 0) > 0 && (
                    <span
                      className={`angle-chip ev-badge ev-${(s.evidence_ready ?? 0) === s.evidence_total ? 'full' : (s.evidence_ready ?? 0) === 0 ? 'none' : 'part'}`}
                      title="证据成立度：勾上的越多，正文越能写实"
                    >
                      证据 {s.evidence_ready ?? 0}/{s.evidence_total}
                    </span>
                  )}
                  <span className={`sl-status-tag st-${s.status}`}>{STATUS_TEXT[s.status || 'candidate']}</span>
                </div>
                <div className="sl-meta">
                  <span><Target size={11} /> 采用 {st?.times_adopted ?? s.adoption_count ?? 0} 次</span>
                  <span>最近 {timeAgo(st?.last_used || s.updated_at)}</span>
                </div>
                <div className="sl-actions">
                  <button className="btn btn-outline btn-sm" type="button" onClick={() => s.id && void openDetail(s.id)}>
                    详情与战绩
                  </button>
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => s.id && reuse(s.id)}>
                    从这条重新创作
                  </button>
                  <button
                    className="btn btn-ghost btn-sm sl-icon-btn"
                    type="button"
                    title={s.status === 'archived' ? '取消归档（放回未归档视图）' : '归档（从默认视图隐藏，保留采纳与战绩）'}
                    onClick={() => s.id && void archive(s.id, s.status === 'archived' ? 'candidate' : 'archived')}
                  >
                    {s.status === 'archived' ? <RotateCcw size={13} /> : <Archive size={13} />}
                  </button>
                  <button className="btn btn-ghost btn-sm sl-icon-btn danger" type="button" title="删除" onClick={() => s.id && void remove(s.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detail && (
        <StrategyDetail
          detail={detail}
          stat={statsOf(stats, detail.id)}
          onClose={() => setDetail(null)}
          onReused={() => void openDetail(detail.id!)}
          onReuse={reuse}
          onToggleEvidence={(i, next) => detail.id && void toggleEvidence(detail.id, i, next)}
        />
      )}
    </>
  );
}

/** stats 接口不带 last_used，这里从 links 兜底算 */
function statsOf(stats: StrategyStats[], id?: number): (StrategyStats & { last_used?: string }) | undefined {
  return stats.find((s) => s.strategy_id === id);
}

function StrategyDetail({
  detail, stat, onClose, onReused, onReuse, onToggleEvidence,
}: {
  detail: Strategy & { links: StrategyLink[] };
  stat?: StrategyStats & { last_used?: string };
  onClose: () => void;
  onReused: () => void;
  onReuse: (id: number) => void;
  onToggleEvidence: (index: number, next: 'todo' | 'ready') => void;
}) {
  const links = detail.links || [];
  const lastUsed = links[0]?.adopted_at;
  return (
    <div className="sl-detail" data-strategy-id={detail.id}>
      <div className="sl-detail-head">
        <div className="row" style={{ flex: 1, gap: 8, alignItems: 'center' }}>
          <FileText size={16} />
          <b>策略详情</b>
          <span className={`sl-mode-badge ${detail.mode}`}>{MODE_TEXT[detail.mode]}</span>
          {detail.analysis_id
            ? <span className="sl-link-analysis">来自分析 #{detail.analysis_id}</span>
            : <span className="sl-link-none">不依赖分析（独立资产）</span>}
        </div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>收起</button>
      </div>

      <div className="sl-detail-body">
        <div className="sl-facts">
          <Fact label="创作角度" value={detail.angle_type} />
          <Fact label="标题方向" value={detail.title} />
          <Fact label="文章立意（主张）" value={detail.core_point} strong />
          <Fact label="独特洞察（读者带走的那一句）" value={detail.insight} strong />
          {detail.narrative && Object.values(detail.narrative).some(Boolean) && (
            <div className="sl-fact-wide">
              <div className="sl-fact-label">叙事骨架</div>
              <ol className="analysis-list compact">
                {(['hook', 'explanation', 'framework', 'action'] as (keyof Narrative)[])
                  .filter((b) => detail.narrative?.[b])
                  .map((b, i) => <li key={i}><b>{NARRATIVE_BEAT_LABEL[b]}</b>　{detail.narrative![b]}</li>)}
              </ol>
            </div>
          )}
          <Fact label="目标读者" value={detail.target_user} />
          {!!detail.structure?.length && (
            <div className="sl-fact-wide">
              <div className="sl-fact-label">结构</div>
              <ol className="analysis-list compact">{detail.structure.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}
          <Fact label="情绪策略 / 内容目标" value={[detail.emotion, detail.goal].filter(Boolean).join(' · ')} />
          {detail.differentiator && (
            <Fact
              label="差异锚点"
              strong
              value={`${detail.differentiator.type ? `[${detail.differentiator.type}] ` : ''}${detail.differentiator.description}${detail.differentiator.instruction ? `　→ ${detail.differentiator.instruction}` : ''}`}
            />
          )}
          {detail.track_fit && (
            <Fact label="素材适配度" value={`score ${detail.track_fit.score ?? '—'}｜${detail.track_fit.reason || ''}${detail.track_fit.adapt_direction ? `｜建议：${detail.track_fit.adapt_direction}` : ''}`} />
          )}
          {detail.feasibility && (
            <Fact
              label="可写性"
              value={`难度 ${DIFFICULTY_LABEL[detail.feasibility.difficulty || ''] || detail.feasibility.difficulty || '—'}｜价值 ${detail.feasibility.score ?? '—'}｜${detail.feasibility.reason || ''}`}
            />
          )}
          {!!detail.evidence_needed?.length && (
            <div className="sl-fact-wide">
              <EvidenceChecklist items={detail.evidence_needed} onToggle={onToggleEvidence} />
            </div>
          )}
        </div>

        <div className="sl-summary">
          <span><Target size={13} /> 被采用 <b>{stat?.times_adopted ?? links.length}</b> 次</span>
          <span><Users size={13} /> 关联文章 <b>{links.filter(l => l.article_id != null).length}</b> 篇</span>
          <span>最近一次使用 <b>{timeAgo(lastUsed)}</b></span>
          {typeof stat?.avg_views === 'number' && <span>平均阅读 <b>{Math.round(stat.avg_views)}</b></span>}
          {typeof stat?.avg_comments === 'number' && <span>平均评论 <b>{Math.round(stat.avg_comments)}</b></span>}
          {typeof stat?.avg_favorites === 'number' && <span>平均收藏 <b>{Math.round(stat.avg_favorites)}</b></span>}
          {typeof stat?.avg_followers === 'number' && <span>平均涨粉 <b>{Math.round(stat.avg_followers)}</b></span>}
          {typeof stat?.avg_manual_score === 'number' && <span>平均主观分 <b>{stat.avg_manual_score.toFixed(1)}</b></span>}
        </div>

        <div className="sl-links">
          <div className="sl-fact-label">采用记录 · 效果回填（手动录入即可，100 条真实数据胜过 1 万条推测）</div>
          {links.length === 0 && <div className="muted-empty">还没有采纳记录</div>}
          {links.map((l) => (
            <ResultRow key={l.id} link={l} onSaved={onReused} />
          ))}
        </div>

        <div className="sl-detail-actions">
          <button className="btn btn-primary btn-sm" type="button" onClick={() => detail.id && onReuse(detail.id)}>
            从这条重新创作
          </button>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value?: string | null; strong?: boolean }) {
  if (!value) return null;
  return (
    <div className="sl-fact">
      <div className="sl-fact-label">{label}</div>
      <div className={strong ? 'sl-fact-value strong' : 'sl-fact-value'}>{value}</div>
    </div>
  );
}

/** 一条采用记录 + 内联的效果回填表单 */
function ResultRow({ link, onSaved }: { link: StrategyLink; onSaved: () => void }) {
  const FIELDS: Array<[keyof StrategyLink, string, string]> = [
    ['views', '阅读', 'number'], ['likes', '点赞', 'number'], ['favorites', '收藏', 'number'],
    ['comments', '评论', 'number'], ['followers', '涨粉', 'number'], ['manual_score', '主观分', 'number'],
  ];
  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [k] of FIELDS) init[k] = link[k] == null ? '' : String(link[k]);
    init.note = link.note || '';
    return init;
  });
  const [saving, setSaving] = useState(false);
  // 必须用函数式更新：连填多个输入时，`{ ...form }` 拿到的是过期闭包，
  // 后一次写会把前几次碰巧未提交的输入重置成空（已被 e2e 抓到：只存进了最后填的 note）。
  const patch = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const metrics: Record<string, unknown> = {};
      for (const [k] of FIELDS) {
        const raw = form[k].trim();
        if (raw === '') continue;
        const n = Number(raw);
        if (!Number.isFinite(n)) { showToast(`❌ ${k} 不是数字`); return; }
        metrics[k] = n;
      }
      metrics.note = form.note;
      if (Object.keys(metrics).length === 0) { showToast('❌ 至少要填一项'); return; }
      const r = await window.electronAPI.recordStrategyResult({ adoptionId: link.id, metrics });
      showToast(r.ok ? '✅ 战绩已记录' : '❌ ' + (r.error || '写入失败'));
      if (r.ok) onSaved();
    } catch (err: any) {
      showToast('❌ ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sl-result-row">
      <div className="sl-result-head">
        <span className="sl-result-article">
          {link.article_id != null ? <>文章 #{link.article_id}</> : <>未生成文章（已采纳）</>}
        </span>
        <span className="sl-result-time">{timeAgo(link.adopted_at)}</span>
        <span className="sl-result-fill">
          {FIELDS.map(([k, label, type]) => (
            <input
              key={String(k)}
              className="input sl-num"
              type={type}
              placeholder={label}
              aria-label={label}
              value={form[String(k)]}
              onChange={(e) => patch(String(k), e.target.value)}
            />
          ))}
          <input
            className="input sl-note"
            placeholder="备注（例：评论区吵起来了）"
            value={form.note}
            onChange={(e) => patch('note', e.target.value)}
          />
          <button className="btn btn-primary btn-sm" type="button" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : <><CheckCircle2 size={13} /> 记录</>}
          </button>
        </span>
      </div>
      {link.note && <div className="sl-result-note">{link.note}</div>}
    </div>
  );
}
