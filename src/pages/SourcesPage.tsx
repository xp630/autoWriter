// SourcesPage — 博主源管理（骨架）
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Empty } from '../components/Empty';

export function SourcesPage() {
  return (
    <>
      <PageHeader
        title="博主源"
        subtitle="订阅关注的公众号 / 博主，自动入库"
        actions={<button className="btn btn-primary">+ 添加博主</button>}
      />
      <Card>
        <Empty
          emoji="📡"
          title="还没有博主源"
          description="添加公众号或博主，后续接入自动抓取"
        />
      </Card>
    </>
  );
}