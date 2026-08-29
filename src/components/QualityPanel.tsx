// QualityPanel — V4 成稿体检：发布前四检 + 可一键修正的问题清单
import { useMemo } from 'react';
import { Check, X, Sparkles, Gauge } from 'lucide-react';
import { lintArticle, scoreBand, sortIssues, type LintContext } from '../utils/articleLint';

export function QualityPanel({
  md, ctx, busy, onFix,
}: {
  md: string;
  ctx: LintContext;
  busy?: boolean;
  onFix?: (title: string, fix: string) => void;
}) {
  const result = useMemo(() => lintArticle(md, ctx), [md, ctx]);
  const band = scoreBand(result.score);
  const fixable = sortIssues(result.issues).filter((i) => i.fix);
  const rest = sortIssues(result.issues).filter((i) => !i.fix);

  return (
    <div className="qc-card">
      <div className="qc-head">
        <Gauge size={14} />
        <b>成稿体检</b>
        <span className={`qc-score qc-${band}`}>{result.score} 分</span>
        <span className="qc-meta">
          {result.stats.chars} 字
          {result.stats.targetChars ? ` / 目标 ${result.stats.targetChars[0]}–${result.stats.targetChars[1]}` : ''}
          {' · '}证据密度 {result.density ? `${result.density.per1k}/千字` : '—'}
        </span>
      </div>

      {/* 发布前四检 —— 这四条卡的是"能不能发"，不是"发得好不好" */}
      <div className="qc-checks">
        {(result.quality || []).map((q) => (
          <span key={q.id} className={`qc-chip ${q.pass ? 'pass' : 'fail'}`} title={q.why}>
            {q.pass ? <Check size={11} /> : <X size={11} />} {q.label}
          </span>
        ))}
      </div>

      {fixable.length > 0 && (
        <div className="qc-issues">
          {fixable.map((i) => (
            <div className="qc-row" key={i.id}>
              <div className="qc-row-text">
                <div className="qc-row-title">{i.title}</div>
                <div className="qc-row-detail">{i.detail}</div>
              </div>
              {onFix && (
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onFix(i.title, i.fix!)}
                  title="会把这句话作为润色指令交给 Agent 重跑一次"
                >
                  <Sparkles size={12} /> 一键修正
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <ul className="qc-rest">
          {rest.map((i) => <li key={i.id} className="qc-rest-item">{i.title} — {i.detail}</li>)}
        </ul>
      )}

      {result.issues.length === 0 && (
        <div className="qc-ok">没查出问题。注意：体检只能挡形式与结构问题，"这句话值不值得写"仍然只有你能判断。</div>
      )}
    </div>
  );
}
