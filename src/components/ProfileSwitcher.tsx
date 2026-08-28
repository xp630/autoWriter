// ProfileSwitcher — 顶栏「创作身份」切换器
// 一个身份打包 赛道+人设+默认值+Agent，切换即生效（全局订阅）
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Settings2 } from 'lucide-react';
import { useProfiles, useActiveProfile } from '../hooks/useActiveProfile';
import { addProfile, setActiveProfileId } from '../utils/storage';
import { showToast } from '../toast';

interface Props {
  /** 切到「设置」页（管理身份） */
  onManage?: () => void;
}

export function ProfileSwitcher({ onManage }: Props) {
  const profiles = useProfiles();
  const active = useActiveProfile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const pick = (id: string) => {
    setActiveProfileId(id);
    const p = profiles.find((x) => x.id === id);
    setOpen(false);
    if (p) showToast(`已切换到「${p.emoji} ${p.name}」`, 'success');
  };

  const create = () => {
    const n = profiles.length + 1;
    const p = addProfile({ name: `身份 ${n}` });
    setOpen(false);
    showToast(`已创建「${p.name}」，去设置完善赛道与人设`, 'success');
    onManage?.();
  };

  return (
    <div className="profile-switcher" ref={ref}>
      <button type="button" className="ps-trigger" onClick={() => setOpen((v) => !v)} title="切换创作身份">
        <span className="ps-avatar" style={{ background: active.color }}>{active.emoji}</span>
        <span className="ps-meta">
          <span className="ps-name">{active.name}</span>
          <span className="ps-track">{active.track || '未设赛道'}</span>
        </span>
        <ChevronDown size={14} className={`ps-caret ${open ? 'up' : ''}`} />
      </button>

      {open && (
        <div className="ps-menu">
          <div className="ps-menu-title">创作身份</div>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`ps-item ${p.id === active.id ? 'active' : ''}`}
              onClick={() => pick(p.id)}
            >
              <span className="ps-avatar sm" style={{ background: p.color }}>{p.emoji}</span>
              <span className="ps-item-meta">
                <span className="ps-item-name">{p.name}</span>
                <span className="ps-item-sub">{p.track || '未设赛道'}{p.persona ? ' · ' : ''}{personaName(p.persona)}</span>
              </span>
              {p.id === active.id && <Check size={14} className="ps-check" />}
            </button>
          ))}
          <div className="ps-divider" />
          <button type="button" className="ps-action" onClick={create}>
            <Plus size={14} /> 新建身份
          </button>
          {onManage && (
            <button type="button" className="ps-action" onClick={() => { setOpen(false); onManage(); }}>
              <Settings2 size={14} /> 管理身份 / 设置
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// 人设 name → 简短中文（这里只有 name，展示时若为空省略）
function personaName(p: string): string {
  if (!p) return '';
  const map: Record<string, string> = {
    warm_storyteller: '温暖叙事', cold_analyst: '冷静分析', knowledge_mentor: '知识科普',
    viral_copywriter: '爆款写手', authentic_seeder: '真诚种草',
  };
  return map[p] || p;
}
