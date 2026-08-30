// Dashboard — 写文章应用的"首屏"，一眼看到所有关键信息
// - 当前 Agent / 模型
// - 今日文章 + 总数 + 草稿数
// - 最近生成的文章
// - 队列实时状态（嵌入 QueueBadge 数据）
// - 快速操作
import { useEffect, useState } from 'react';
import { getAgentSettings } from '../utils/storage';
import { useActiveProfile } from '../hooks/useActiveProfile';
import {
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Image as ImageIcon,
  Layers,
  PenLine,
  Plus,
  Sparkles,
  TrendingUp,
  Wand2,
  Zap,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Empty } from '../components/Empty';
import type { Article, Episode, QueueSnapshot, Season } from '../types';

interface Props {
  onNavigate: (page: string) => void;
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  draft:     { label: '草稿',     color: 'var(--muted)' },
  scheduled: { label: '⏰ 已排程', color: 'var(--accent)' },
  published: { label: '✓ 已发布', color: 'var(--line)' },
  failed:    { label: '✗ 失败',    color: 'var(--danger)' },
};

const AGENT_LABEL: Record<string, string> = {
  pi: 'pi', claude: 'Claude Code', opencode: 'opencode', codex: 'Codex CLI',
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

function statusLabel(status: string): string {
  switch (status) {
    case 'observation': return '观察';
    case 'questioning': return '疑问';
    case 'thinking':    return '思考';
    case 'drafting':    return '草稿';
    case 'published':   return '已发';
    case 'archived':    return '归档';
    default:             return status;
  }
}

export function DashboardPage({ onNavigate }: Props) {
  const profile = useActiveProfile();
  const [articles, setArticles] = useState<Article[]>([]);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [settings, setSettings] = useState<{ cli: string; model: string }>({ cli: 'claude', model: '' });
  const [agentStatus, setAgentStatus] = useState<Record<string, boolean> | null>(null);
  const [imageCount, setImageCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  // P0 Week 1：Season + Episode（创作主线）
  const [season, setSeason] = useState<Season | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);

  // 拉一次所有需要的数据
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 文章
        if (window.electronAPI?.listArticles) {
          const rows = await window.electronAPI.listArticles({ profileId: profile.id });
          if (!cancelled) setArticles(Array.isArray(rows) ? rows : []);
        }
        // agent 可用性
        if (window.electronAPI?.detectAgents) {
          const status = await window.electronAPI.detectAgents();
          if (!cancelled) setAgentStatus(status as Record<string, boolean>);
        }
        // 图库
        if (window.electronAPI?.listAllImages) {
          const imgs = await window.electronAPI.listAllImages();
          if (!cancelled) setImageCount(Array.isArray(imgs) ? imgs.length : 0);
        }
        // 设置（从 localStorage 读）
        if (!cancelled) setSettings(getAgentSettings());
        // P0 Season + Episode：创作主线
        if (window.electronAPI?.listSeasons) {
          const seasons = await window.electronAPI.listSeasons({ profileId: profile.id });
          const active = Array.isArray(seasons) && seasons.length > 0 ? seasons[0] : null;
          if (!cancelled) setSeason(active);
          if (active && window.electronAPI?.listEpisodes) {
            const eps = await window.electronAPI.listEpisodes({ seasonId: active.id, profileId: profile.id });
            if (!cancelled) setEpisodes(Array.isArray(eps) ? eps : []);
          } else if (!cancelled) {
            setEpisodes([]);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile.id]);   // 切身份后 KPI / 最近编辑 要重拉

  // 订阅队列状态
  useEffect(() => {
    if (!window.electronAPI?.onQueueState) return;
    const unsub = window.electronAPI.onQueueState(setQueue);
    window.electronAPI.queueList?.().then(setQueue);
    return unsub;
  }, []);

  // 计算 stats
  const today = new Date().toDateString();
  const todayCount = articles.filter(a => new Date(a.created_at).toDateString() === today).length;
  const draftCount = articles.filter(a => a.status === 'draft').length;
  const publishedCount = articles.filter(a => a.status === 'published' || a.published_at).length;
  const totalWords = articles.reduce((sum, a) => sum + (a.word_count || 0), 0);
  const recentArticles = [...articles]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  const currentAgentName = AGENT_LABEL[settings.cli] || settings.cli;
  const isAgentReady = agentStatus?.[settings.cli] ?? null;

  // 首次运行引导判断
  const showOnboarding = !loading
    && articles.length === 0
    && agentStatus
    && !Object.values(agentStatus).some(Boolean);

  return (
    <>
      <PageHeader
        title="仪表盘"
        subtitle={loading ? '加载中…' : `你好，今天是 ${new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}`}
      />

      {showOnboarding && (
        <div className="onboarding">
          <div className="onboarding-icon">
            <Wand2 size={28} strokeWidth={1.8} />
          </div>
          <div className="onboarding-body">
            <div className="onboarding-title">欢迎使用 autoWriter</div>
            <div className="onboarding-sub">
              先在设置里选一个 Agent CLI（推荐 Claude Code 或 pi），就可以开始写文章了。
            </div>
          </div>
          <button type="button" className="btn btn-primary onboarding-cta" onClick={() => onNavigate('settings')}>
            打开设置 <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* ===== P0 Week 1：创作主线（Season + Episode）=====
          第一层卡片：用户打开 app 第一眼看到的不再是"新建文章"，而是他的创作主线。 */}
      <Card title={season ? `${season.title}` : '还没有创作主线'} icon={Layers} accent="insight">
        {season?.subtitle && <div className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>{season.subtitle}</div>}
        {!season && !loading && (
          <Empty
            icon={Layers}
            title="还没有 Season"
            description="Season 是你一段时间的创作主线。比如：AutoWriter Season 1（半年）。点下方按钮开第一季。"
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('write')}>
                <Plus size={14} /> 开始第一季
              </button>
            }
          />
        )}
        {season && episodes.length === 0 && !loading && (
          <Empty
            icon={PenLine}
            title="Season 已开，还没有 Episode"
            description="Episode 是主线上的每一段。从一个观察开始——记下今天让你停顿了三秒的事。"
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('write')}>
                <Plus size={14} /> 记第一个观察
              </button>
            }
          />
        )}
        {season && episodes.length > 0 && (
          <div className="season-episode-list">
            {episodes.map((ep) => (
              <div key={ep.id} className="season-episode-row" onClick={() => onNavigate('write')} role="button" tabIndex={0}>
                <div className="season-ep-side">
                  <span className="season-ep-index">{ep.order_in_season || '·'}</span>
                </div>
                <div className="season-ep-main">
                  <div className="season-ep-title">
                    {ep.title || (ep.observation ? ep.observation.slice(0, 22) + '…' : '（未命名 Episode）')}
                  </div>
                  <div className="season-ep-meta">
                    <span className={`ep-status-pill ep-status-${ep.status}`}>{statusLabel(ep.status)}</span>
                    {ep.insight && <span className="season-ep-insight">“{ep.insight.slice(0, 36)}{ep.insight.length > 36 ? '…' : ''}”</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ===== KPI 卡片（4 列） ===== */}
      <div className="kpi-grid">
        <KpiCard
          icon={FileText}
          accent="action"
          label="总文章"
          value={articles.length}
          sub={`${publishedCount} 已发布`}
        />
        <KpiCard
          icon={Clock}
          accent="configure"
          label="草稿"
          value={draftCount}
          sub="待完善"
        />
        <KpiCard
          icon={TrendingUp}
          accent="system"
          label="今日新增"
          value={todayCount}
          sub={todayCount > 0 ? '✍️ 保持势头' : '还没开工'}
        />
        <KpiCard
          icon={Sparkles}
          accent="insight"
          label="累计字数"
          value={totalWords.toLocaleString()}
          sub="你的创作总量"
        />
      </div>

      {/* ===== Agent 状态 + 快速操作 ===== */}
      <div className="dash-row">
        <Card title="当前 Agent" icon={Bot} accent="action">
          <div className="agent-status">
            <div className="agent-status-main">
              <div className="agent-status-name">{currentAgentName}</div>
              <div className="agent-status-model mono">
                {settings.model || '默认模型'}
              </div>
            </div>
            <div className="agent-status-meta">
              {isAgentReady === null ? (
                <span className="badge-neutral">检测中…</span>
              ) : isAgentReady ? (
                <span className="badge-success"><CheckCircle2 size={12} /> 已安装</span>
              ) : (
                <span className="badge-danger">未检测到</span>
              )}
            </div>
          </div>
          {/* 其他 CLI 状态 */}
          {agentStatus && (
            <div className="cli-list">
              {(['pi', 'claude', 'opencode', 'codex'] as const).map(cli => (
                <div key={cli} className={`cli-row ${cli === settings.cli ? 'active' : ''}`}>
                  <span className="cli-name">{AGENT_LABEL[cli]}</span>
                  <span className="cli-status">
                    {agentStatus[cli] ? (
                      <><CheckCircle2 size={12} className="cli-ok" /> 就绪</>
                    ) : (
                      <span className="cli-missing">未安装</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-outline btn-sm dash-cta" onClick={() => onNavigate('settings')}>
            切换 Agent / 模型 <ArrowRight size={12} />
          </button>
        </Card>

        <Card title="快速开始" icon={Zap} accent="configure">
          <div className="quick-grid">
            <button type="button" className="quick-tile" onClick={() => onNavigate('write')}>
              <PenLine size={20} className="quick-tile-icon" />
              <div className="quick-tile-label">写新文章</div>
              <div className="quick-tile-sub">主题 → 大纲 → 正文</div>
            </button>
            <button type="button" className="quick-tile" onClick={() => onNavigate('images')}>
              <ImageIcon size={20} className="quick-tile-icon" />
              <div className="quick-tile-label">浏览图库</div>
              <div className="quick-tile-sub">{imageCount} 张图片</div>
            </button>
            <button type="button" className="quick-tile" onClick={() => onNavigate('topics')}>
              <Layers size={20} className="quick-tile-icon" />
              <div className="quick-tile-label">选题中心</div>
              <div className="quick-tile-sub">热点 / RSS</div>
            </button>
            <button type="button" className="quick-tile" onClick={() => onNavigate('articles')}>
              <FileText size={20} className="quick-tile-icon" />
              <div className="quick-tile-label">我的文章</div>
              <div className="quick-tile-sub">{articles.length} 篇</div>
            </button>
          </div>
        </Card>
      </div>

      {/* ===== 最近文章 ===== */}
      <Card title="最近编辑" icon={Calendar} accent="default">
        {recentArticles.length === 0 ? (
          <Empty
            icon={PenLine}
            title="还没有文章"
            description="点击「写新文章」开始你的第一篇"
            action={
              <button type="button" className="btn btn-primary" onClick={() => onNavigate('write')}>
                <Plus size={14} /> 写新文章
              </button>
            }
          />
        ) : (
          <div className="recent-list">
            {recentArticles.map(a => {
              const badge = STATUS_BADGE[
                a.published_at ? 'published' :
                a.scheduled_at ? 'scheduled' :
                a.status || 'draft'
              ] || STATUS_BADGE.draft;
              return (
                <div
                  key={a.id}
                  className="recent-row"
                  onClick={() => onNavigate('articles')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onNavigate('articles');
                  }}
                >
                  <div className="recent-main">
                    <div className="recent-title">{a.title || '(无标题)'}</div>
                    <div className="recent-meta">
                      <span>{a.word_count} 字</span>
                      <span className="dot">·</span>
                      <span>{a.model || a.provider}</span>
                      <span className="dot">·</span>
                      <span>{timeAgo(a.updated_at)}</span>
                    </div>
                  </div>
                  <span className="recent-badge" style={{ color: badge.color }}>
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ===== 队列状态卡 ===== */}
      {queue && (queue.running > 0 || queue.pending > 0) && (
        <Card title="正在生成" icon={Wand2} accent="insight">
          <div className="queue-mini">
            {queue.tasks.filter(t => t.status === 'running' || t.status === 'pending').map(t => (
              <div key={t.id} className={`queue-mini-row queue-status-${t.status}`}>
                <div className="queue-mini-main">
                  <span className="queue-mini-label">{t.label}</span>
                  <span className="queue-mini-meta">{t.meta?.cli}</span>
                </div>
                <span className={`queue-mini-badge queue-status-${t.status}`}>
                  {t.status === 'running' ? '生成中' : '排队中'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

// ===== KPI 卡片（带 icon + accent 色条） =====
function KpiCard({ icon: Icon, accent, label, value, sub }: {
  icon: any;
  accent: 'action' | 'configure' | 'system' | 'insight';
  label: string;
  value: number | string;
  sub: string;
}) {
  return (
    <div className={`kpi-card kpi-accent-${accent}`}>
      <div className="kpi-head">
        <Icon size={18} strokeWidth={2} className="kpi-icon" />
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
