// BeliefGate — V4 生成守卫「三问必答」
// 路线图第一原则：先约束输入。三问没答完就不给生成正文。
import { useEffect, useState } from 'react';
import { ShieldAlert, Check } from 'lucide-react';
import { showToast } from '../toast';
import type { Strategy, StrategyGate } from '../types';

export function gateOf(s?: Strategy | null): StrategyGate {
  const ev = Array.isArray(s?.evidence_needed) ? s!.evidence_needed! : [];
  const ready = ev.filter((e) => e?.status === 'ready').length;
  const missing: string[] = [];
  if (!String(s?.belief_before || '').trim()) missing.push('读者原本怎么想');
  if (!String(s?.belief_after || '').trim()) missing.push('你希望读者改怎么想');
  if (ready === 0) missing.push('至少一条已备好的证据');
  return { pass: missing.length === 0, missing, ready_evidence: ready };
}

export function BeliefGate({
  strategy, onPassed,
}: {
  strategy: Strategy;            // 当前生效策略（含 id）
  onPassed?: (s: Strategy) => void;
}) {
  const initial = strategy.belief_before || '';
  const [before, setBefore] = useState(initial);
  const [source, setSource] = useState(strategy.belief_source || '');
  const [after, setAfter] = useState(strategy.belief_after || '');
  const [saving, setSaving] = useState(false);
  const [gate, setGate] = useState<StrategyGate>(() => gateOf(strategy));

  // 切换策略时要重置，否则会拿着上一篇的答案去生成这一篇
  useEffect(() => {
    setBefore(strategy.belief_before || '');
    setSource(strategy.belief_source || '');
    setAfter(strategy.belief_after || '');
    setGate(gateOf(strategy));
  }, [strategy.id, strategy.belief_before, strategy.belief_after, strategy.belief_source]);

  const dirty = before !== (strategy.belief_before || '')
    || source !== (strategy.belief_source || '')
    || after !== (strategy.belief_after || '');

  const save = async () => {
    if (!strategy.id) { showToast('❌ 该策略尚未入库，无法记录三问'); return; }
    setSaving(true);
    try {
      const r = await window.electronAPI.setStrategyBelief({
        strategyId: strategy.id, beliefBefore: before, beliefAfter: after, beliefSource: source,
      });
      if (!r.ok || !r.strategy) { showToast('❌ ' + (r.error || '保存失败')); return; }
      setGate(r.gate || gateOf(r.strategy));
      showToast(r.gate?.pass ? '✅ 三问已答完，可以生成正文' : '💾 已保存，但守卫还未通过');
      if (r.gate?.pass) onPassed?.(r.strategy);
    } catch (err: any) {
      showToast('❌ ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`bg-card ${gate.pass ? 'bg-pass' : 'bg-block'}`}>
      <div className="bg-head">
        {gate.pass ? <Check size={14} /> : <ShieldAlert size={14} />}
        <b>生成守卫 · 三问必答</b>
        <span className="bg-state">
          {gate.pass ? '已通过 — 可以生成正文' : `未通过：还缺 ${gate.missing.join('、')}`}
        </span>
      </div>

      <div className="bg-fields">
        <label className="bg-field">
          <span>1. 读者原本怎么想？</span>
          <input
            className="input"
            placeholder="例：AI 创业成功靠模型能力"
            value={before}
            maxLength={200}
            onChange={(e) => setBefore(e.target.value)}
          />
          <input
            className="input bg-source"
            placeholder="这句旧认知的出处（谁在这么想：评论区 / 同行文章 / 行业报道）"
            value={source}
            maxLength={200}
            onChange={(e) => setSource(e.target.value)}
          />
          <em className="bg-hint">出处是必填的理由：没有处境的旧认知通常是生造的稻草人，那样造出来的位移是假的</em>
        </label>

        <label className="bg-field">
          <span>2. 你希望读者改怎么想？</span>
          <input
            className="input"
            placeholder="例：AI 创业成功靠渠道能力"
            value={after}
            maxLength={200}
            onChange={(e) => setAfter(e.target.value)}
          />
          <em className="bg-hint">这一句会被强制下发给大纲、正文与润色，并检查它是否真的出现在成稿里</em>
        </label>

        <div className="bg-field">
          <span>3. 为什么值得相信？</span>
          <div className="bg-evidence">
            {gate.ready_evidence > 0
              ? <>已有 <b>{gate.ready_evidence}</b> 条勾为「已备好」的证据可以支撑</>
              : <>证据账里 <b>0</b> 条已备好。到策略卡或策略库把素材勾成「已备好」——没证据就先别写，占位比编造好</>}
          </div>
        </div>
      </div>

      <div className="bg-actions">
        <button className="btn btn-primary btn-sm" type="button" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? '保存中…' : dirty ? '保存三问' : '已保存'}
        </button>
        {!gate.pass && <span className="bg-block-hint">未通过时「生成正文」会被主进程拒绝（不是前端灰着而已）</span>}
      </div>
    </div>
  );
}
