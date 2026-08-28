// TopicsPage — 选题中心（骨架）
import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Empty } from '../components/Empty';

type Tab = 'hot' | 'rss' | 'library';
const TABS: { id: Tab; label: string }[] = [
  { id: 'hot', label: '🔥 热点' },
  { id: 'rss', label: '📡 RSS' },
  { id: 'library', label: '📚 我的选题库' },
];

export function TopicsPage() {
  const [tab, setTab] = useState<Tab>('hot');
  return (
    <>
      <PageHeader
        title="选题中心"
        subtitle="从热点发现 → RSS 订阅 → 落库 → 排程 → 写作"
      />
      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-pill ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <Empty
          emoji={tab === 'hot' ? '🔥' : tab === 'rss' ? '📡' : '📚'}
          title={tab === 'hot' ? '还没有热点' : tab === 'rss' ? '还没有 RSS 订阅' : '选题库为空'}
          description="后续接入：百度 / 36kr / 少数派 / 微信订阅号"
        />
      </Card>
    </>
  );
}