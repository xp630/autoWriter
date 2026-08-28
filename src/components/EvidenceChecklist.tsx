// EvidenceChecklist — V3 证据账：成立度由用户亲手勾上来，不是 AI 猜的
import { CheckCircle2, Circle } from 'lucide-react';
import type { EvidenceItem } from '../types';

export function coverageOf(items: EvidenceItem[]) {
  const total = items.length;
  const ready = items.filter((e) => e?.status === 'ready').length;
  return { total, ready, pct: total ? Math.round((ready / total) * 100) : null };
}

/**
 * 前面的字段决定"想写什么"，这一项决定"这篇到底能不能成立"。
 * 所以它不是清单展示，而是闸门：勾了 ready 的证据才允许写进正文，
 * 没勾的主进程会强制正文留「待补充」占位（见 buildStrategyBlock）。
 */
export function EvidenceChecklist({
  items, onToggle, compact,
}: {
  items: EvidenceItem[];
  onToggle?: (index: number, next: 'todo' | 'ready') => void;
  compact?: boolean;
}) {
  const { total, ready, pct } = coverageOf(items);
  if (!total) return null;
  const cls = ready === total ? 'full' : ready === 0 ? 'none' : 'part';
  return (
    <div className={`ev-root ${compact ? 'ev-compact' : ''}`}>
      <div className="ev-head">
        <span className="ev-label">证据账 · 决定这篇能不能成立</span>
        <span className={`ev-cov ev-cov-${cls}`}>{ready}/{total}{pct !== null ? ` · ${pct}%` : ''}</span>
      </div>
      <ul className="ev-list">
        {items.map((e, i) => (
          <li key={i} className={`ev-item ${e.status === 'ready' ? 'is-ready' : ''}`}>
            <button
              type="button"
              className="ev-toggle"
              disabled={!onToggle}
              title={e.status === 'ready' ? '已备好（可写进正文）— 点击撤销' : '标记为已备好，AI 才能把它写进正文'}
              onClick={() => onToggle?.(i, e.status === 'ready' ? 'todo' : 'ready')}
            >
              {e.status === 'ready' ? <CheckCircle2 size={13} /> : <Circle size={13} />}
            </button>
            <span className="ev-text">{e.item}</span>
          </li>
        ))}
      </ul>
      {ready < total && (
        <div className="ev-hint">
          还差 {total - ready} 项。未勾上的素材，正文里会强制留「待补充」占位，AI 不会替你编。
        </div>
      )}
      {ready === total && <div className="ev-hint ev-hint-ok">证据齐了，这篇可以写实。</div>}
    </div>
  );
}
