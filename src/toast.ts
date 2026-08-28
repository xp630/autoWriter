// 全局 toast（任意文件调 showToast 即可）
// 提到独立文件，避免在多文件重复创建

let toastTimer: number | null = null;

export function showToast(msg: string, type: 'info' | 'success' | 'error' = 'info', duration = 2000) {
  let el = document.getElementById('aw-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aw-toast';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '32px',
      right: '32px',
      zIndex: '99999',  // 比所有 modal（1000）都高
      background: 'var(--ink)',
      color: 'white',
      padding: '12px 20px',
      borderRadius: '12px',
      fontSize: '14px',
      fontWeight: '500',
      boxShadow: '0 12px 36px rgba(0,0,0,0.25)',
      maxWidth: '420px',
      opacity: '0',
      transition: 'opacity 0.2s, transform 0.2s',
      transform: 'translateY(8px)',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
  }
  // 颜色按 type
  const bg = type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--line-2)' : 'var(--ink)';
  el.style.background = bg;
  el.textContent = msg;
  // 显示动画
  requestAnimationFrame(() => {
    el!.style.opacity = '1';
    el!.style.transform = 'translateY(0)';
  });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el!.style.opacity = '0';
    el!.style.transform = 'translateY(8px)';
  }, duration);
}

// 启动时挂一个占位元素（确保 init 后能看到）
if (typeof document !== 'undefined' && !document.getElementById('aw-toast')) {
  showToast('autoWriter 启动完成', 'success', 1500);
}