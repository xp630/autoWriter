// 通用 Card — 支持 icon + accent variant（action / configure / system / insight）
import type { LucideIcon } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  title?: string;
  icon?: LucideIcon;        // Lucide 图标组件（替代 emoji）
  actions?: React.ReactNode;
  accent?: 'default' | 'action' | 'configure' | 'system' | 'insight' | 'danger';
  style?: React.CSSProperties;
}

export function Card({ children, title, icon: Icon, actions, accent = 'default', style }: Props) {
  return (
    <div className={`card fade-up card-accent-${accent}`} style={{ marginBottom: 16, ...style }}>
      {(title || actions) && (
        <div className="card-header">
          <div className="card-header-left">
            {Icon && <Icon className="card-header-icon" size={18} strokeWidth={2} />}
            {title && <h3 className="card-header-title">{title}</h3>}
          </div>
          {actions && <div className="card-header-actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
