// Sidebar — 仿 autosocialX 布局，3 组分类 + inline SVG

interface NavItem {
  id: string;
  label: string;
  kbd?: string;
  icon: React.ReactNode;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: '创作',
    items: [
      { id: 'write', label: '写文章', kbd: '⌘1',
        icon: <path d="M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> },
      { id: 'articles', label: '我的文章', kbd: '⌘2',
        icon: <g strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="14" y2="17" /></g> },
    ],
  },
  {
    label: '素材',
    items: [
      { id: 'topics', label: '选题中心',
        icon: <g strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></g> },
      { id: 'images', label: '图库',
        icon: <g strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></g> },
      { id: 'sources', label: '博主源',
        icon: <g strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" /></g> },
    ],
  },
  {
    label: '配置',
    items: [
      { id: 'settings', label: '设置',
        icon: <g strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></g> },
    ],
  },
];

interface Props {
  active: string;
  onNavigate: (id: string) => void;
}

export function Sidebar({ active, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-text">autoWriter <em>v0.1</em></div>
      </div>

      {NAV_GROUPS.map((group) => (
        <nav key={group.label} className="side-group">
          <div className="side-label">{group.label}</div>
          {group.items.map((item) => (
            <div
              key={item.id}
              className={`nav-item ${active === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <svg className="nav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                {item.icon}
              </svg>
              <span>{item.label}</span>
              {item.kbd && <kbd>{item.kbd}</kbd>}
            </div>
          ))}
        </nav>
      ))}

      <div className="spacer" />
      <div style={{ padding: '12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)' }}>
        <kbd>Ctrl+R</kbd> 重载 · <kbd>Ctrl+Shift+I</kbd> 调试
      </div>
    </aside>
  );
}