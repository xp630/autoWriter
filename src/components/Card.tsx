// 通用 Card
interface Props {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Card({ children, title, actions, style }: Props) {
  return (
    <div className="card fade-up" style={{ marginBottom: 16, ...style }}>
      {(title || actions) && (
        <div className="row" style={{ marginBottom: 12 }}>
          {title && <h3 style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}