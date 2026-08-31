// EpisodePage — P0 Week 1：Episode 编辑页
// 一个 Episode = 观察 → 疑问 → 观点 → 草稿（4 个核心字段）
// 这页让用户填 + 编辑 EP（之前只能在 Dashboard 看只读）
// 设计原则（"不锁死"）：4 字段独立保存，不强求"全部填完才能写"
import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, FileText, Lightbulb, MessageCircle, Sparkles } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { showToast } from '../toast';
import type { Episode, EpisodeStatus } from '../types';

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

export function EpisodePage({ episodeId, onBack, onOpenPublish }: Props) {
  const [ep, setEp] = useState<Episode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 编辑缓冲区（避免每个按键就触发 IPC）
  const [title, setTitle] = useState('');
  const [observation, setObservation] = useState('');
  const [question, setQuestion] = useState('');
  const [insight, setInsight] = useState('');
  const [draft, setDraft] = useState('');
  // 状态显式可控（planned→…→published/archived）：进页面取库值，用户改了以用户为准
  const [status, setStatus] = useState<EpisodeStatus>('observation');
  const [publishUrl, setPublishUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.electronAPI?.getEpisode) { setLoading(false); return; }
      const row = await window.electronAPI.getEpisode(episodeId);
      if (cancelled) return;
      if (!row) { showToast('❌ Episode 不存在'); onBack(); return; }
      setEp(row);
      setTitle(row.title || '');
      setObservation(row.observation || '');
      setQuestion(row.question || '');
      setInsight(row.insight || '');
      setDraft(row.draft || '');
      setStatus((row.status as EpisodeStatus) || 'observation');
      setPublishUrl(row.publish_url || '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [episodeId, onBack]);

  // 自动按"哪一阶段字段已填"算当前状态
  const computeStatus = (): EpisodeStatus => {
    if (draft.trim()) return 'drafting';
    if (insight.trim()) return 'thinking';
    if (question.trim()) return 'questioning';
    if (observation.trim()) return 'observation';
    return 'observation';
  };

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
        observation: next?.observation ?? observation,
        question: next?.question ?? question,
        insight: next?.insight ?? insight,
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

  if (loading) {
    return (
      <>
        <PageHeader title="Episode" subtitle="加载中…" />
      </>
    );
  }
  if (!ep) return null;

  // status 现在是受控 state（下拉可改），不再从 ep 派生
  const filledCount = [observation, question, insight, draft].filter((s) => s?.trim()).length;
  const canPublish = Boolean(draft.trim() && insight.trim());

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
        <span className="ep-filled">{filledCount}/4 字段已填</span>
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

      <Card title="Q1 · 观察" icon={Circle} accent="action">
        <textarea
          className="textarea"
          rows={3}
          placeholder="今天你观察到了什么？"
          value={observation}
          onChange={(e) => setObservation(e.target.value)}
          onBlur={() => observation !== ep.observation && save()}
        />
        <p className="muted ep-hint">事实层。先记下来，再问。</p>
      </Card>

      <Card title="Q2 · 疑问" icon={MessageCircle} accent="configure">
        <textarea
          className="textarea"
          rows={3}
          placeholder="今天有什么事让你停顿了 3 秒？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onBlur={() => question !== ep.question && save()}
        />
        <p className="muted ep-hint">触发层。把观察变成问题，观点从问题里来。</p>
      </Card>

      <Card title="Q3 · 观点" icon={Lightbulb} accent="insight">
        <textarea
          className="textarea"
          rows={4}
          placeholder="你最想说的一句话是什么？"
          value={insight}
          onChange={(e) => setInsight(e.target.value)}
          onBlur={() => insight !== ep.insight && save()}
        />
        <p className="muted ep-hint">提炼层。一句话能概括，这一篇就有方向。</p>
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
          状态：<CheckCircle2 size={11} /> 草稿非空 → 自动转 drafting。<CheckCircle2 size={11} /> 全部填完 → 可快速发布。
        </p>
      </Card>
    </>
  );
}
