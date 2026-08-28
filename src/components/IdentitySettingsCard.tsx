// IdentitySettingsCard — 创作身份管理（账号级 Profile 系统）
// 编辑当前身份：赛道 + 人设 + 默认风格 + 默认渠道
// 管理多身份：切换 / 改名 / 新建 / 删除
import { useEffect, useState } from 'react';
import { Check, Compass, Smile, Plus, Trash2, Star } from 'lucide-react';
import { Card } from '../components/Card';
import { useProfiles, useActiveProfile } from '../hooks/useActiveProfile';
import {
  updateActiveProfile, setActiveProfileId, addProfile, deleteProfile, TRACK_OPTIONS,
} from '../utils/storage';
import { showToast } from '../toast';

const STYLE_OPTIONS = [
  { value: 'tech', label: '技术分享' },
  { value: 'news', label: '新闻报道' },
  { value: 'opinion', label: '观点评论' },
  { value: 'story', label: '故事叙述' },
  { value: 'knowledge', label: '知识科普' },
];
const CHANNEL_OPTIONS = [
  { value: 'wechat', label: '公众号' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'toutiao', label: '头条' },
  { value: 'zhihu', label: '知乎' },
];
const EMOJIS = ['🧑', '👩', '👨', '🧔', '👧', '🦊', '🐼', '🤖', '✍️', '🎯', '🌸', '🔥'];

interface PersonaLite { name: string; displayName?: string; description?: string }

export function IdentitySettingsCard() {
  const profiles = useProfiles();
  const active = useActiveProfile();
  const [personas, setPersonas] = useState<PersonaLite[]>([]);

  useEffect(() => {
    if (!window.electronAPI?.listSkills) return;
    window.electronAPI.listSkills().then((r: any) => setPersonas(r.personas || [])).catch(() => {});
  }, []);

  const onAdd = () => {
    addProfile({ name: `身份 ${profiles.length + 1}` });
    showToast('已创建新身份，请在下方完善', 'success');
  };

  const onDelete = (id: string) => {
    if (profiles.length <= 1) { showToast('至少保留一个身份', 'error'); return; }
    const p = profiles.find((x) => x.id === id);
    if (!confirm(`删除身份「${p?.name}」？（文章数据不受影响）`)) return;
    deleteProfile(id);
  };

  const personaLabel = (name: string) => personas.find((p) => p.name === name)?.displayName || name;

  return (
    <>
      {/* 身份列表 */}
      <Card title="创作身份" icon={Star} accent="system">
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          一个身份打包「赛道 + 人设 + 默认风格/渠道 + Agent」。多人共用本机时，各自建一个，顶栏一键切换。
        </p>
        <div className="profile-list">
          {profiles.map((p) => (
            <div key={p.id} className={`profile-row ${p.id === active.id ? 'active' : ''}`}>
              <button type="button" className="profile-pick" onClick={() => setActiveProfileId(p.id)} title="设为当前身份">
                <span className="profile-avatar" style={{ background: p.color }}>{p.emoji}</span>
                <span className="profile-info">
                  <span className="profile-name">{p.name}</span>
                  <span className="profile-sub">{p.track || '未设赛道'}{p.persona ? ' · ' + personaLabel(p.persona) : ''}</span>
                </span>
                {p.id === active.id && <Check size={15} className="profile-check" />}
              </button>
              <button type="button" className="profile-del" onClick={() => onDelete(p.id)} title="删除身份">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm profile-add" onClick={onAdd}>
            <Plus size={13} /> 新建身份
          </button>
        </div>
      </Card>

      {/* 编辑当前身份 */}
      <Card title={`编辑「${active.name}」`} icon={Compass} accent="action">
        <div className="col" style={{ gap: 12 }}>
          <div className="identity-field">
            <label>身份名</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                defaultValue={active.name}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== active.name) { updateActiveProfile({ name: v }); } }}
              />
              <select className="input emoji-picker" value={active.emoji} onChange={(e) => updateActiveProfile({ emoji: e.target.value })}>
                {EMOJIS.map((em) => <option key={em} value={em}>{em}</option>)}
              </select>
            </div>
          </div>

          <div className="identity-field">
            <label><Compass size={12} style={{ verticalAlign: -2 }} /> 赛道（选题领域 · 影响大纲角度）</label>
            <select className="input" value={active.track} onChange={(e) => updateActiveProfile({ track: e.target.value })}>
              <option value="">— 不设赛道 —</option>
              {TRACK_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.value} — {t.hint}</option>)}
            </select>
          </div>

          <div className="identity-field">
            <label><Smile size={12} style={{ verticalAlign: -2 }} /> 人设（IP 口吻 · 只管语气不碰选题）</label>
            <select className="input" value={active.persona} onChange={(e) => updateActiveProfile({ persona: e.target.value })}>
              <option value="">— 默认（不注入人设）—</option>
              {personas.map((p) => (
                <option key={p.name} value={p.name}>{p.displayName || p.name}{p.description ? ` — ${p.description.slice(0, 24)}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="row" style={{ gap: 12 }}>
            <div className="identity-field" style={{ flex: 1 }}>
              <label>默认风格</label>
              <select className="input" value={active.defaultStyle} onChange={(e) => updateActiveProfile({ defaultStyle: e.target.value })}>
                {STYLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="identity-field" style={{ flex: 1 }}>
              <label>默认渠道</label>
              <select className="input" value={active.defaultChannel} onChange={(e) => updateActiveProfile({ defaultChannel: e.target.value })}>
                {CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <p className="identity-hint">
            赛道/人设是「我是谁」（一次配好）；风格/渠道是「这篇怎么写」（在写文章页仍可临时改，这里设的是默认值）。
          </p>
        </div>
      </Card>
    </>
  );
}
