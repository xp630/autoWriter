// Empty state
interface Props {
  emoji?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function Empty({ emoji = '📝', title, description, action }: Props) {
  return (
    <div className="empty fade-up">
      <div className="empty-emoji">{emoji}</div>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{title}</h3>
      {description && <p style={{ fontSize: 13 }}>{description}</p>}
      {action && (
        <button className="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}