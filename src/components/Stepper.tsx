// Stepper — 写文章 3 步骤
interface Props {
  steps: { label: string }[];
  active: number; // 0-based
}

export function Stepper({ steps, active }: Props) {
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <div className={`step-item ${active === i ? 'active' : ''}`}>
            <div className="step-num">{i + 1}</div>
            <span style={{ fontSize: 13 }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className="step-line" />}
        </div>
      ))}
    </div>
  );
}