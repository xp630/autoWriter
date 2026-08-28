/**
 * 策略库 → 写文章页 的一次性交接。
 *
 * 页面是按 `page === 'x' && <Page/>` 条件挂载的（切换即卸载/重挂），
 * 所以用模块级变量交接比 URL 参数/state 提升都简单，也不会残留：
 * take 一次即清空，避免下次进写文章页又把它塞回来。
 */
let pendingStrategyId: number | null = null;

export function setPendingStrategy(id: number): void {
  pendingStrategyId = Number(id) || null;
}

/** 读取并清空（保证只被消费一次） */
export function takePendingStrategy(): number | null {
  const v = pendingStrategyId;
  pendingStrategyId = null;
  return v;
}

export function peekPendingStrategy(): number | null {
  return pendingStrategyId;
}
