// EpisodePage — P0 Week 1：Episode 编辑页
// 一个 Episode = 观察 → 疑问 → 观点 → 草稿（4 个核心字段）
// 这页让用户填 + 编辑 EP（之前只能在 Dashboard 看只读）
// 设计原则（"不锁死"）：4 字段独立保存，不强求"全部填完才能写"
// Task 7：文章策划区块——AI 提议 3~5 个读者入口（过拔高红线）→ 人选一 → 补三问/scope/证据链 → 确认落 article_plans
import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileText, Lightbulb, Sparkles } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { showToast } from '../toast';
import { getAgentSettings } from '../utils/storage';
import type { ArticlePlan, ArticlePlanDraft, Episode, EpisodeStatus } from '../types';

type Props = {
  episodeId: number;
  onBack: () => void;
  onOpenPublish: () => void;
};

const STATUS_LABEL: Record<EpisodeStatus, string> = {
  planned: '计划',
  observation: '观察',
  questioning: '疑问',
  thinking: '思考',
  drafting: '草稿',
  published: '已发',
  archived: '归档',
};

/** 空槽位提醒（不拦截策划）：EP 上跟判断/素材相关的可观察列；observation/insight 只是兜底提示 */
const SLOT_LABELS: Array<{ key: keyof Episode; label: string }> = [
  { key: 'question', label: '疑问' },
  { key: 'event', label: '事件' },
  { key: 'reaction', label: '反应' },
  { key: 'development', label: '发展' },
  { key: 'shift', label: '转折' },
  { key: 'unknown', label: '未知' },
  { key: 'next', label: '下一步' },
];

/** 本地读取 episode:material 的证据行（避免触碰 types 合并的两个 EvidenceItem 面） */
type MaterialEvidence = { id: number; content: string; kind?: string };

export function EpisodePage({ episodeId, onBack, onOpenPublish }: Props) {
  const [ep, setEp] = useState<Episode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 编辑缓冲区（避免每个按键就触发 IPC）
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  // 状态显式可控（planned→…→published/archived）：进页面取库值，用户改了以用户为准
  const [status, setStatus] = useState<EpisodeStatus>('observation');
  const [publishUrl, setPublishUrl] = useState('');

  // ===== Task 7 文章策划 =====
  const [plans, setPlans] = useState<ArticlePlan[]>([]);
  const [materialEvidence, setMaterialEvidence] = useState<MaterialEvidence[]>([]);
  const [planBusy, setPlanBusy] = useState(false);
  const [proposals, setProposals] = useState<string[]>([]);
  const [rejectedHigh, setRejectedHigh] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [readerQuestion, setReaderQuestion] = useState('');
  const [coreConflict, setCoreConflict] = useState('');
  const [discussionScope, setDiscussionScope] = useState('');
  const [evidenceIds, setEvidenceIds] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [planError, setPlanError] = useState('');

  // 拉最新行并 setForm——挂在初始加载 + focus 刷新两条路径上（T5 stale write）
  const loadRow = async () => {
    if (!window.electronAPI?.getEpisode) { setLoading(false); return; }
    const row = await window.electronAPI.getEpisode(episodeId);
    if (!row) { showToast('❌ Episode 不存在'); onBack(); return; }
    setEp(row);
    setTitle(row.title || '');
    setDraft(row.draft || '');
    setStatus((row.status as EpisodeStatus) || 'observation');
    setPublishUrl(row.publish_url || '');
    setLoading(false);
  };

  // 回读已确认方案 + EP 证据链（供策划表单勾选）
  const loadPlanData = async () => {
    if (!window.electronAPI?.planList) return;
    const r = await window.electronAPI.planList(episodeId);
    if (r?.ok) setPlans(Array.isArray(r.plans) ? r.plans : []);
    if (window.electronAPI?.episodeMaterial) {
      try {
        const m = await window.electronAPI.episodeMaterial(episodeId);
        if (m?.ok && m.evidence) setMaterialEvidence(m.evidence as unknown as MaterialEvidence[]);
      } catch { /* 材料取不到不阻塞策划 */ }
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { await loadRow(); if (cancelled) return; })();
    void loadPlanData();
    return () => { cancelled = true; };
  }, [episodeId, onBack]);

  // stale write 修复：外部写入（extract/AI 回流、其他路径）后回到本窗口，
  // 先重新拉行再 setForm——编辑页 stale state 就不会把外部写入的槽位冲成空/旧值
  useEffect(() => {
    const onFocus = () => { void loadRow(); void loadPlanData(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [episodeId, onBack]);

  // 自动按"哪一阶段字段已填"算当前状态
  const computeStatus = (): EpisodeStatus => (draft.trim() ? 'drafting' : status);

  const save = async (next?: Partial<Episode>) => {
    if (saving) return;
    if (!window.electronAPI?.saveEpisode) { showToast('❌ IPC 未就绪'); return; }
    setSaving(true);
    try {
      const newStatus: EpisodeStatus = (next?.status as EpisodeStatus) ?? status;
      const isPublishing = newStatus === 'published' && !ep?.published_at;
      const r = await window.electronAPI.saveEpisode({
        id: ep?.id,
        season_id: ep?.season_id,
        title: next?.title ?? title,
        draft: next?.draft ?? draft,
        status: newStatus,
        publish_url: publishUrl,
        published_at: isPublishing ? new Date().toISOString() : (ep?.published_at ?? null),
        order_in_season: ep?.order_in_season ?? 0,
      });
      if (r?.ok) {
        showToast('✅ 已保存');
        // 刷新 ep 引用（拿最新 status / updated_at）
        if (window.electronAPI?.getEpisode) {
          const fresh = await window.electronAPI.getEpisode(episodeId);
          if (fresh) setEp(fresh);
        }
      }
    } catch (err: any) {
      showToast('❌ 保存失败：' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  };

  // ===== Task 7 文章策划：AI 提议（过拔高红线）→ 人不代选 → 补三问/scope/证据链 → 确认落库 =====
  const planCliEnabled = Boolean(ep?.insight && String(ep.insight).trim());
  const emptySlots = ep
    ? SLOT_LABELS.filter((s) => !String(ep[s.key] || '').trim())
        .map((s) => s.label)
        .slice(0, 4)
    : [];

  const resetPlanDraft = () => {
    setProposals([]);
    setRejectedHigh([]);
    setSelected(null);
    setReaderQuestion('');
    setCoreConflict('');
    setDiscussionScope('');
    setEvidenceIds([]);
    setPlanError('');
  };

  // 重来：只退回到候选列表（保留 proposals），清空已选与表单
  const clearSelection = () => {
    setSelected(null);
    setReaderQuestion('');
    setCoreConflict('');
    setDiscussionScope('');
    setEvidenceIds([]);
    setPlanError('');
  };

  const onPropose = async () => {
    if (!window.electronAPI?.planPropose || !ep) return;
    setPlanBusy(true);
    setPlanError('');
    try {
      const settings = getAgentSettings();
      const r = await window.electronAPI.planPropose({ episodeId: ep.id, cli: settings.cli, model: settings.model });
      if (r?.ok && Array.isArray(r.proposals)) {
        setProposals(r.proposals as string[]);
        setRejectedHigh(Array.isArray(r.rejectedHigh) ? (r.rejectedHigh as string[]) : []);
        setSelected(null);
        setReaderQuestion('');
        setCoreConflict('');
        setDiscussionScope('');
        setEvidenceIds([]);
      } else {
        const why = r && 'error' in r ? (r as any).error : '';
        setPlanError('AI 提议失败' + (why ? `：${why}` : ''));
        showToast('AI 提议失败' + (why ? `：${why}` : ''));
      }
    } catch (err: any) {
      setPlanError('AI 提议出错：' + (err?.message || String(err)));
      showToast('AI 提议出错');
    } finally {
      setPlanBusy(false);
    }
  };

  const toggleEvidence = (id: number) => {
    setEvidenceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const onConfirm = async () => {
    if (!window.electronAPI?.planConfirm || !ep || !selected) return;
    const chosen = selected.trim();
    if (!chosen) return;
    setConfirming(true);
    try {
      const plan: ArticlePlanDraft = {
        proposals,
        chosen_angle: chosen,
        reader_question: readerQuestion.trim(),
        core_conflict: coreConflict.trim(),
        discussion_scope: discussionScope.trim(),
        judgment_ref: String(ep.insight || '').trim(),
        evidence_ids: evidenceIds,
      };
      const r = await window.electronAPI.planConfirm({ episodeId: ep.id, plan });
      if (r?.ok) {
        showToast('方案已确认落库');
        resetPlanDraft();
        void loadPlanData();
      } else {
        const why = r && 'error' in r ? (r as any).error : '';
        showToast('确认失败' + (why ? `：${why}` : ''));
        setPlanError('确认失败' + (why ? `：${why}` : ''));
      }
    } catch (err: any) {
      setPlanError('确认出错：' + (err?.message || String(err)));
      showToast('确认出错');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Episode" subtitle="加载中…" />
      </>
    );
  }
  if (!ep) return null;

  // status 现在是受控 state（下拉可改），不再从 ep 派生
  const canPublish = Boolean(draft.trim());

  return (
    <>
      <PageHeader
        title={`EP${ep.order_in_season || '·'} · ${ep.season_title || 'Season'}`}
        subtitle={ep.publish_url ? `已发布 · ${ep.publish_url}` : '编辑 + 完善这个 Episode'}
      />

      <div className="ep-actions-row">
        <button type="button" className="btn btn-outline btn-sm" onClick={onBack}>
          <ArrowLeft size={14} /> 返回主线
        </button>
        <span className={`ep-status-pill ep-status-${status}`}>{STATUS_LABEL[status] || status}</span>

        <button type="button" className="btn btn-outline btn-sm" onClick={() => save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        {canPublish && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpenPublish} title="去快速发布页粘贴此草稿">
            <Sparkles size={14} /> 快速发布
          </button>
        )}
      </div>

      <Card title="标题与状态">
        <input
          type="text"
          className="input ep-title-input"
          placeholder="一句话标题（如：我以为自己没有观点）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== ep.title && save()}
        />
        <div className="row ep-status-row">
          <label className="muted" style={{ fontSize: 12 }}>状态</label>
          <select
            className="input ep-status-select"
            value={status}
            onChange={(e) => {
              const v = e.target.value as EpisodeStatus;
              setStatus(v);
              void save({ status: v });
              if (v === 'published' && !publishUrl) showToast('💡 记得把公众号文章链接贴到右边');
            }}
          >
            {(Object.keys(STATUS_LABEL) as EpisodeStatus[]).map((k) => (
              <option key={k} value={k}>{STATUS_LABEL[k]}</option>
            ))}
          </select>
          <input
            type="url"
            className="input ep-url-input"
            placeholder="发布链接 publish_url（发出后贴这里）"
            value={publishUrl}
            onChange={(e) => setPublishUrl(e.target.value)}
            onBlur={() => publishUrl !== (ep.publish_url || '') && save()}
          />
        </div>
      </Card>

      <Card title="文章策划" icon={Lightbulb} accent="action">
        <p className="muted ep-hint plan-intro">
          AI 读这期 EP 提炼 3~5 个读者入口（只做提议）→ 你选一个 → 补三问与讨论边界 → 确认后落 article_plans，才允许进入正文生成。
        </p>

        <div className="plan-gate">
          <button type="button" className="btn btn-primary btn-sm plan-propose-btn" onClick={() => void onPropose()} disabled={planBusy || !planCliEnabled}>
            {planBusy ? 'AI 提议中…' : '让 AI 提议读者入口'}
          </button>
          {!planCliEnabled && (
            <span className="muted plan-gate-hint">入口需先有已确认观点（judgment）——回访谈确认一个观点后亮起。</span>
          )}
          {emptySlots.length > 0 && planCliEnabled && (
            <span className="muted plan-empty-slots">
              空槽位：{emptySlots.join('、')}（提醒，不拦截策划）
            </span>
          )}
        </div>

        {planError && <p className="plan-error">{planError}</p>}

        {proposals.length > 0 && (
          <div className="plan-candidates">
            <div className="plan-candidates-title">候选读者入口（选一个）</div>
            <div className="plan-candidate-list">
              {proposals.map((p, i) => (
                <button
                  key={`${i}-${p}`}
                  type="button"
                  className={`plan-candidate ${selected === p ? 'selected' : ''}`}
                  onClick={() => setSelected(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            {rejectedHigh.length > 0 && (
              <p className="plan-rejected-hint">{rejectedHigh.length} 个提议因拔高被拒</p>
            )}
          </div>
        )}

        {selected && (
          <div className="plan-form">
            <div className="plan-form-selected">已选：{selected}</div>
            <label className="muted plan-field-label">读者问题 reader_question（文章要回答的那一问）</label>
            <textarea
              className="textarea plan-rq"
              rows={2}
              placeholder="读者带着什么问题点开这篇？例如：为什么同事都在聊 AI 编剧，却没人在意成片？"
              value={readerQuestion}
              onChange={(e) => setReaderQuestion(e.target.value)}
            />
            <label className="muted plan-field-label">核心冲突 core_conflict</label>
            <textarea
              className="textarea plan-cc"
              rows={2}
              placeholder="这篇的张力来自哪个冲突？例如：兴奋的 AI 编剧 vs 沉默的人类编剧"
              value={coreConflict}
              onChange={(e) => setCoreConflict(e.target.value)}
            />
            <label className="muted plan-field-label">讨论边界 discussion_scope（什么不写，也写进来）</label>
            <textarea
              className="textarea plan-scope"
              rows={2}
              placeholder="不讨论：技术原理、行业预测；不替 AI 下定论"
              value={discussionScope}
              onChange={(e) => setDiscussionScope(e.target.value)}
            />
            {materialEvidence.length > 0 && (
              <div className="plan-evidence">
                <div className="muted plan-field-label">支撑证据（可多选，作为本文案证据链）</div>
                {materialEvidence.map((ev) => (
                  <label key={ev.id} className="plan-evidence-option">
                    <input
                      type="checkbox"
                      checked={evidenceIds.includes(ev.id)}
                      onChange={() => toggleEvidence(ev.id)}
                    />
                    <span>{ev.content}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="row plan-actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection}>重来</button>
              <button type="button" className="btn btn-primary btn-sm plan-confirm-btn" onClick={() => void onConfirm()} disabled={confirming}>
                {confirming ? '确认中…' : '确认并落库'}
              </button>
            </div>
          </div>
        )}

        {plans.length > 0 && (
          <div className="plan-list">
            <div className="plan-list-title">已确认方案</div>
            {plans.map((pl) => {
              let evIds: number[] = [];
              try { evIds = JSON.parse(pl.evidence_ids || '[]'); } catch { evIds = []; }
              return (
                <div key={pl.id} className="plan-row">
                  <div className="plan-row-angle">{pl.chosen_angle || '(未选题)'}</div>
                  {pl.reader_question && <div className="muted plan-row-meta">读者问题 Q：{pl.reader_question}</div>}
                  {evIds.length > 0 && <div className="muted plan-row-meta">证据链：#{evIds.join(' #')}</div>}
                  {pl.created_at && <div className="muted plan-row-meta">确认于 {String(pl.created_at).slice(0, 16).replace('T', ' ')}</div>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

            <Card title="草稿" icon={FileText} accent="default">
        <textarea
          className="textarea"
          rows={12}
          placeholder="（可选）从观点往下扩。或留空，去「快速发布」粘别处写好的稿。"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== ep.draft && save()}
        />
        <p className="muted ep-hint">
          状态：<CheckCircle2 size={11} /> 草稿非空 → 自动转 drafting。<CheckCircle2 size={11} /> 有草稿 → 可快速发布。
        </p>
      </Card>
    </>
  );
}
