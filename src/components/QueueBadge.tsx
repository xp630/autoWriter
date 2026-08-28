// QueueBadge — 顶栏右侧小徽章，显示当前任务队列状态
// 点击展开看任务明细；每个任务可展开看它的实时生成日志（agent 输出按 taskId 归类）
import { useEffect, useState, useCallback, useRef } from 'react';
import type { QueueSnapshot, QueueTask } from '../types';
import { showToast } from '../toast';

type LogLine = { type: string; text: string; at: number };

const LOG_COLOR: Record<string, string> = {
  stdout: '#b8c4bf', info: '#38bdf8', error: '#f43f5e', stderr: '#fbbf24', done: '#14b789', sys: '#a78bfa',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  running: '生成中',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
  cancelling: '取消中',
};

const STATUS_COLOR: Record<string, string> = {
  pending: '#8b95a5',
  running: '#5e8bff',
  done: '#52c41a',
  error: '#ff4d4f',
  cancelled: '#bfbfbf',
  cancelling: '#faad14',
};

const TYPE_LABEL: Record<string, string> = {
  outline: '📝 大纲',
  article: '📄 正文',
  polish: '✨ 润色',
};

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒`;
  return `${Math.floor(s / 60)}分${s % 60}秒`;
}

export function QueueBadge() {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);  // 触发"running 已用时"刷新
  const [logsByTask, setLogsByTask] = useState<Record<string, LogLine[]>>({});
  const [openTask, setOpenTask] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 订阅队列状态
  useEffect(() => {
    if (!window.electronAPI?.onQueueState) return;
    const unsub = window.electronAPI.onQueueState(setSnapshot);
    // 拉一次初始
    window.electronAPI.queueList?.().then(setSnapshot);
    return unsub;
  }, []);

  // 订阅 agent 流式输出 → 按 taskId 归档（全局持有，跳页也不丢）
  useEffect(() => {
    if (!window.electronAPI?.onAgentChunk) return;
    const unsub = window.electronAPI.onAgentChunk((chunk: any) => {
      const id = chunk.taskId;
      if (!id) return;
      setLogsByTask((prev) => {
        const cur = prev[id] || [];
        const next = cur.length >= 400 ? [...cur.slice(-300), chunk] : [...cur, chunk];
        return { ...prev, [id]: next };
      });
    });
    return unsub;
  }, []);

  // running 期间每 1s 重新计算已用时
  useEffect(() => {
    if (!snapshot || snapshot.running === 0) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [snapshot?.running]);

  // 有任务结束时不自动收起；日志展开时滚到底
  useEffect(() => {
    if (openTask) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [openTask, logsByTask[openTask || '']?.length]);

  const active = (snapshot?.running || 0) + (snapshot?.pending || 0);

  const handleCancel = useCallback(async (taskId: string) => {
    const r = await window.electronAPI.queueCancel(taskId);
    if (r.ok) showToast('⛔ 已发送取消');
    else showToast('❌ 取消失败：' + (r.reason || 'unknown'));
  }, []);

  const handleClear = useCallback(async () => {
    await window.electronAPI.queueClearCompleted();
    showToast('🧹 已清空历史');
  }, []);

  if (!snapshot) return null;
  if (active === 0 && (snapshot?.completed || 0) === 0) return null;

  return (
    <div className="queue-badge-wrap">
      <button
        type="button"
        className="queue-badge-trigger"
        onClick={() => setExpanded((v) => !v)}
        title="点击查看任务队列"
      >
        {snapshot.running > 0 && (
          <span className="qb-running" title="生成中">
            <span className="qb-spinner" /> {snapshot.running} 生成中
          </span>
        )}
        {snapshot.pending > 0 && (
          <span className="qb-pending" title="排队中">
            ⏳ {snapshot.pending} 排队
          </span>
        )}
        {active === 0 && snapshot.completed > 0 && (
          <span className="qb-done" title="最近完成">
            ✅ {snapshot.completed}
          </span>
        )}
      </button>

      {expanded && (
        <div className="queue-badge-panel" onClick={(e) => e.stopPropagation()}>
          <div className="qbp-header">
            <span>任务队列</span>
            {snapshot.completed > 0 && (
              <button type="button" className="qbp-clear" onClick={handleClear}>清空历史</button>
            )}
          </div>
          <div className="qbp-list">
            {snapshot.tasks.length === 0 && (
              <div className="qbp-empty">无任务</div>
            )}
            {snapshot.tasks.map((t) => (
              <QueueRow
                key={t.id}
                task={t}
                tick={tick}
                logs={logsByTask[t.id] || []}
                open={openTask === t.id}
                onToggle={() => setOpenTask((cur) => (cur === t.id ? null : t.id))}
                logEndRef={logEndRef}
                onCancel={handleCancel}
              />
            ))}
          </div>
          <div className="qbp-footer">
            全局并发上限 {2} · 单类型串行
          </div>
        </div>
      )}
    </div>
  );
}

function QueueRow({ task, tick, logs, open, onToggle, logEndRef, onCancel }: {
  task: QueueTask; tick: number; logs: LogLine[]; open: boolean;
  onToggle: () => void; logEndRef: React.RefObject<HTMLDivElement>; onCancel: (id: string) => void;
}) {
  void tick;
  const isLive = task.status === 'running' || task.status === 'pending' || task.status === 'cancelling';
  const elapsedMs = task.startedAt
    ? (task.endedAt || Date.now()) - task.startedAt
    : Date.now() - task.enqueuedAt;

  return (
    <div className={`qbp-row qbp-status-${task.status}`}>
      <div className="qbp-row-main">
        <button type="button" className="qbp-expander" onClick={onToggle} title={open ? '收起日志' : '查看日志'}>
          {open ? '▾' : '▸'}
        </button>
        <span className="qbp-type">{TYPE_LABEL[task.type] || task.type}</span>
        <span className="qbp-label" title={task.label}>{task.label}</span>
        <span className="qbp-meta">
          {task.meta?.cli && <span className="qbp-cli">{task.meta.cli}</span>}
          {logs.length > 0 && <span className="qbp-logcount">{logs.length}</span>}
          {isLive && <span className="qbp-elapsed">{fmtElapsed(elapsedMs)}</span>}
        </span>
      </div>
      <div className="qbp-row-side">
        <span className="qbp-status" style={{ color: STATUS_COLOR[task.status] }}>
          {STATUS_LABEL[task.status]}
        </span>
        {isLive && (
          <button type="button" className="qbp-cancel" onClick={() => onCancel(task.id)} title="取消">
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="qbp-log">
          {logs.length === 0 ? (
            <div className="qbp-log-empty">暂无输出…</div>
          ) : (
            logs.map((l, i) => (
              l.type === 'sys' ? (
                <details key={i} className="qbp-log-sys"><summary>📝 提示词（{l.text.length} 字）</summary><pre>{l.text}</pre></details>
              ) : (
                <div key={i} className="qbp-log-line" style={{ color: LOG_COLOR[l.type] || '#b8c4bf' }}>
                  {l.text}
                </div>
              )
            ))
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}
