// Empty State — 支持 Lucide 图标（默认 FileText）
import type { LucideIcon } from 'lucide-react';
import { FileText } from 'lucide-react';

interface Props {
  /** 兼容旧 emoji 字符串（向后兼容，新代码应传 icon） */
  emoji?: string;
  /** 推荐：传 Lucide 图标组件 */
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function Empty({ emoji, icon: Icon, title, description, action }: Props) {
  const DisplayIcon = Icon || FileText;
  return (
    <div className="empty fade-up">
      <div className="empty-icon">
        {Icon ? <DisplayIcon size={36} strokeWidth={1.5} /> : <span>{emoji || '📝'}</span>}
      </div>
      <h3 className="empty-title">{title}</h3>
      {description && <p className="empty-desc">{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
