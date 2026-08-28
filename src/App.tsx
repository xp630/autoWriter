// autoWriter-desktop 主入口
// 仿 autosocialX 布局：3 组分类侧边栏 + 玻璃质感
// 默认落地页：Dashboard（仪表盘）

import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { QueueBadge } from './components/QueueBadge';
import { DashboardPage } from './pages/DashboardPage';
import { WritePage } from './pages/WritePage';
import { ArticlesPage } from './pages/ArticlesPage';
import { TopicsPage } from './pages/TopicsPage';
import { SourcesPage } from './pages/SourcesPage';
import { ImagesPage } from './pages/ImagesPage';
import { SettingsPage } from './pages/SettingsPage';

type PageName = 'dashboard' | 'write' | 'articles' | 'topics' | 'sources' | 'images' | 'settings';

const PAGES: PageName[] = ['dashboard', 'write', 'articles', 'topics', 'sources', 'images', 'settings'];

export default function App() {
  const [page, setPage] = useState<PageName>('dashboard');

  const handleNav = (id: string) => {
    if (PAGES.includes(id as PageName)) {
      setPage(id as PageName);
    }
  };

  // 图库引用 → 打开指定文章（跳转"我的文章"并打开）
  useEffect(() => {
    const onOpenArticle = (e: Event) => {
      const id = (e as CustomEvent).detail;
      localStorage.setItem('aw_open_article', String(id));
      setPage('articles');
    };
    window.addEventListener('aw-open-article', onOpenArticle);
    return () => window.removeEventListener('aw-open-article', onOpenArticle);
  }, []);

  // ⌘0..⌘6 键盘快捷键（⌘0 = Dashboard，⌘1..6 = 侧边栏顺序）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        const map: Record<string, PageName> = {
          '0': 'dashboard',
          '1': 'write', '2': 'articles',
          '3': 'topics', '4': 'sources',
          '5': 'images', '6': 'settings',
        };
        const target = map[e.key];
        if (target) {
          e.preventDefault();
          setPage(target);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app-layout">
      <Sidebar active={page} onNavigate={handleNav} />
      <main className="main">
        <QueueBadge />
        {page === 'dashboard' && <DashboardPage onNavigate={handleNav} />}
        {page === 'write' && <WritePage />}
        {page === 'articles' && <ArticlesPage />}
        {page === 'topics' && <TopicsPage />}
        {page === 'sources' && <SourcesPage />}
        {page === 'images' && <ImagesPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
