// SettingsPage — Agent CLI + Model + 图片 Provider + 提示词模板 配置
import { useEffect, useState } from 'react';
import { Bot, Brain, Image as ImageIcon, Layers, Database, Star, RefreshCw, Save, Settings as SettingsIcon, CheckCircle2, XCircle, Loader2, Globe, Palette, Package, Clock, Play, Pause, Compass, Smile } from 'lucide-react';
import type { SchedulerSnapshot } from '../types';
import { IdentitySettingsCard } from '../components/IdentitySettingsCard';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { showToast } from '../toast';
import { setAgentSettings, setImageSettings, getAgentSettings, getImageSettings } from '../utils/storage';

interface CliStatus {
  pi: boolean;
  claude: boolean;
  opencode: boolean;
  codex: boolean;
}

interface AgentSettings {
  cli: 'pi' | 'claude' | 'opencode' | 'codex';
  model: string;
  track: string;
  persona: string;
}

interface ImageProvider {
  id: number;
  provider_id: string;
  name: string;
  enabled: boolean;
  base_url: string;
  priority: number;
  extra_config: Record<string, string>;
}

interface ImageModel {
  id: number;
  provider_id: string;
  model_id: string;
  name: string;
  enabled: boolean;
  is_default: boolean;
  extra_params: Record<string, any>;
}

const DEFAULT_SETTINGS: AgentSettings = { cli: 'claude', model: '', track: '', persona: '' };

const CLI_INFO = [
  { key: 'claude' as const, label: 'Claude Code', desc: 'Anthropic 官方 coding agent（推荐）', defaultModel: 'claude-sonnet-4-5' },
  { key: 'pi' as const, label: 'pi', desc: 'mariozechner 出品的轻量 Agent CLI', defaultModel: 'gpt-4o' },
  { key: 'opencode' as const, label: 'opencode', desc: '开源 terminal coding agent', defaultModel: 'gpt-4o' },
  { key: 'codex' as const, label: 'Codex CLI', desc: 'OpenAI 官方 coding agent', defaultModel: 'gpt-5' },
];

export function SettingsPage() {
  const [status, setStatus] = useState<CliStatus>({ pi: false, claude: false, opencode: false, codex: false });
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // 图片生图设置
  const [activeProvider, setActiveProvider] = useState<string>('');
  const [activeModel, setActiveModel] = useState<string>('');

  // 图片 Provider 状态
  const [imageProviders, setImageProviders] = useState<ImageProvider[]>([]);
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [editingProvider, setEditingProvider] = useState<ImageProvider | null>(null);
  const [providerForm, setProviderForm] = useState({ accessToken: '', timeout: 180000 });
  const [testingProvider, setTestingProvider] = useState(false);

  // 提示词模板管理
  const [prompts, setPrompts] = useState<{ name: string; label: string; path: string }[]>([]);
  const [activePrompt, setActivePrompt] = useState<string>('outline');
  const [promptContent, setPromptContent] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);

  // 加载图片 Providers
  const loadImageProviders = async () => {
    if (!window.electronAPI?.listImageProviders) return;
    try {
      const list = await window.electronAPI.listImageProviders();
      setImageProviders(list as unknown as ImageProvider[]);
      
      // 加载所有 Provider 的模型
      if (list.length > 0) {
        const allModels: ImageModel[] = [];
        for (const p of list) {
          const m = await window.electronAPI.listImageModels(p.provider_id);
          allModels.push(...(m as unknown as ImageModel[]));
        }
        setImageModels(allModels);
      }
    } catch (err: any) { console.error('加载 Provider 失败:', err); }
  };

  // 测试 Provider 连接（走主进程 IPC，无 CORS）
  const testProvider = async (provider: ImageProvider, token: string) => {
    if (!token) { showToast('❌ 请先输入 Access Token'); return; }
    setTestingProvider(true);
    try {
      const r = await window.electronAPI.testImageProvider({ providerId: provider.provider_id, token });
      if (r.ok) showToast(`✅ 连接成功${r.toolCount != null ? `，可用工具 ${r.toolCount} 个` : (r.message ? `：${r.message}` : '')}`);
      else showToast(`❌ 连接失败: ${r.message || 'Token 无效'}`);
    } catch (err: any) {
      showToast(`❌ 连接失败: ${err.message}`);
    } finally {
      setTestingProvider(false);
    }
  };

  // 保存 Provider 配置
  const saveProvider = async (provider: ImageProvider) => {
    if (!window.electronAPI?.saveImageProvider) return;
    try {
      await window.electronAPI.saveImageProvider({
        provider_id: provider.provider_id,
        name: provider.name,
        base_url: provider.base_url,
        priority: provider.priority,
        extra_config: typeof provider.extra_config === 'string' ? JSON.parse(provider.extra_config) : provider.extra_config,
        enabled: Boolean(provider.enabled) ? 1 : 0,
      });
      showToast('✅ Provider 配置已保存');
      setEditingProvider(null);
      loadImageProviders();
    } catch (err: any) { showToast('❌ 保存失败: ' + err.message); }
  };

  // 加载提示词
  const loadPrompts = async () => {
    if (!window.electronAPI?.listPrompts) return;
    try {
      const list = await window.electronAPI.listPrompts();
      setPrompts(list);
      if (list.length && !list.some(p => p.name === activePrompt)) setActivePrompt(list[0].name);
    } catch (err: any) { showToast('❌ 读取模板失败: ' + err.message); }
  };

  const loadPromptContent = async (name: string) => {
    if (!window.electronAPI?.getPrompt) return;
    try {
      const r = await window.electronAPI.getPrompt(name);
      setPromptContent(r.content);
      setPromptDirty(false);
    } catch (err: any) { showToast('❌ 读取模板失败: ' + err.message); }
  };

  // 加载图片生图设置
  const loadImageSettings = () => {
    const imgSettings = getImageSettings();
    setActiveProvider(imgSettings.provider);
    setActiveModel(imgSettings.model);
  };

  const saveImageSettings = () => {
    const imgSettings = {
      provider: activeProvider,
      model: activeModel,
    };
    setImageSettings(imgSettings);
    showToast(`✅ 已保存: ${imgSettings.provider || '自动'} / ${imgSettings.model || '默认'}`);
  };

  useEffect(() => { loadPrompts(); loadImageProviders(); loadImageSettings(); }, []);
  useEffect(() => { if (activePrompt) loadPromptContent(activePrompt); }, [activePrompt]);

  const savePrompt = async () => {
    if (!window.electronAPI?.savePrompt) return;
    try {
      await window.electronAPI.savePrompt({ name: activePrompt, content: promptContent });
      setPromptSaved(true);
      setPromptDirty(false);
      showToast('✅ 提示词已保存，下次生成立即生效');
      setTimeout(() => setPromptSaved(false), 2000);
    } catch (err: any) { showToast('❌ 保存失败: ' + err.message); }
  };

  useEffect(() => {
    if (!window.electronAPI?.detectAgents) return;
    window.electronAPI.detectAgents().then((s) =>
      setStatus({ pi: !!s.pi, claude: !!s.claude, opencode: !!s.opencode, codex: !!s.codex })
    );
    setSettings(prev => ({ ...prev, ...getAgentSettings() }));
  }, []);

  const selectCli = (cli: AgentSettings['cli']) => {
    setSettings({ ...settings, cli, model: '' });
    setSaved(false);
  };

  const updateModel = (model: string) => {
    setSettings({ ...settings, model });
    setSaved(false);
  };

  const save = () => {
    setAgentSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const fetchModels = async () => {
    if (!window.electronAPI?.listModels) return;
    setLoadingModels(true);
    setModels([]);
    try {
      const list = await window.electronAPI.listModels(settings.cli);
      setModels(list);
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (status[settings.cli]) fetchModels();
  }, [settings.cli]);

  return (
    <>
      <PageHeader title="设置" subtitle="创作身份 / Agent CLI / Model / 图片 Provider / 提示词模板" />

      {/* 创作身份（赛道 + 人设 + 默认风格/渠道，多身份切换）*/}
      <IdentitySettingsCard />

      {/* Agent CLI 选择 */}
      <Card title="Agent CLI（全局）" icon={Bot} accent="action">
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          选一个已登录的 Agent CLI。所有写文章任务都派给它。
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {CLI_INFO.map((c) => {
            const available = status[c.key];
            const selected = settings.cli === c.key;
            return (
              <button
                key={c.key}
                onClick={() => available && selectCli(c.key)}
                disabled={!available}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  background: selected ? 'var(--line-light)' : 'var(--bg-soft)',
                  border: `1.5px solid ${selected ? 'var(--line)' : 'var(--border)'}`,
                  borderRadius: 10,
                  cursor: available ? 'pointer' : 'not-allowed',
                  opacity: available ? 1 : 0.5,
                  textAlign: 'left',
                  font: 'inherit',
                }}
              >
                <span style={{ fontSize: 18 }}>
                  {available === undefined ? <Loader2 size={14} className="spin" /> : available ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.desc}</div>
                </div>
                {selected && <span style={{ color: 'var(--line-2)', fontSize: 16 }}>✓</span>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Model 选择 */}
      <Card title="Model（针对当前 CLI）" icon={Brain} accent="configure">
        <div className="row" style={{ alignItems: 'center' }}>
          <label style={{ minWidth: 80, fontSize: 13, color: 'var(--ink-2)' }}>Model ID</label>
          <input
            className="input"
            value={settings.model}
            onChange={(e) => updateModel(e.target.value)}
            placeholder="点右侧「拉取模型」自动列出"
            style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
          />
          {settings.cli === 'opencode' && (
            <button
              className="btn btn-outline btn-sm"
              disabled={!status.opencode || loadingModels}
              onClick={fetchModels}
            >
              {loadingModels ? <><Loader2 size={14} className="spin" /> 拉取中…</> : <><RefreshCw size={14} /> 拉取模型</>}
            </button>
          )}
        </div>
        {models.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
              点选填入（{models.length} 个可用）：
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {models.map((m) => (
                <button
                  key={m}
                  onClick={() => updateModel(m)}
                  className="mono"
                  style={{
                    padding: '4px 10px',
                    background: settings.model === m ? 'var(--line)' : 'var(--bg-soft)',
                    color: settings.model === m ? '#fff' : 'var(--ink-2)',
                    border: `1px solid ${settings.model === m ? 'var(--line)' : 'var(--border)'}`,
                    borderRadius: 999,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 保存 */}
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={save}>
          {saved ? <><CheckCircle2 size={14} /> 已保存</> : <><Save size={14} /> 保存设置</>}
        </button>
      </div>

      {/* ========== 图片生图设置 ========== */}
      <Card title="图片生图设置" icon={ImageIcon} accent="configure">
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          选择使用的 Provider 和模型。设置后生图将使用此配置。
        </div>
        
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--muted)' }}>
              Provider（生图服务）
            </label>
            <select
              className="input"
              value={activeProvider}
              onChange={(e) => {
                setActiveProvider(e.target.value);
                // 清空模型选择，等用户选模型
                setActiveModel('');
              }}
            >
              <option value="">— 自动选择 —</option>
              {imageProviders.filter(p => p.enabled).map(p => (
                <option key={p.provider_id} value={p.provider_id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--muted)' }}>
              模型
            </label>
            <select
              className="input"
              value={activeModel}
              onChange={(e) => setActiveModel(e.target.value)}
              disabled={!activeProvider}
            >
              <option value="">— 使用默认 —</option>
              {activeProvider && imageModels
                .filter(m => m.provider_id === activeProvider && m.enabled)
                .map(m => (
                  <option key={m.model_id} value={m.model_id}>
                    {m.name}
                  </option>
                ))
              }
            </select>
          </div>
        </div>
        
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }}>
          {activeProvider && (
            <span>
              当前：{imageProviders.find(p => p.provider_id === activeProvider)?.name}
              {activeModel && ` · ${imageModels.find(m => m.model_id === activeModel)?.name || activeModel}`}
              {!activeModel && '（使用默认模型）'}
            </span>
          )}
          {!activeProvider && <span>未指定，将按 Provider 优先级自动选择</span>}
        </div>
        
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={saveImageSettings}>
            <Save size={14} /> 保存生图设置
          </button>
        </div>
      </Card>

      {/* ========== 图片 Provider 配置 ========== */}
      <Card title="图片 Provider（生图服务）" icon={Layers} accent="action">
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          配置图片生成服务。支持多个 Provider，失败时自动切换。按优先级排序。
        </div>

        {/* Provider 列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {imageProviders.map((p) => {
            const providerModels = imageModels.filter(m => m.provider_id === p.provider_id);
            const defaultModel = providerModels.find(m => m.is_default);
            
            return (
              <div
                key={p.id}
                style={{
                  padding: 12,
                  background: 'var(--bg-soft)',
                  borderRadius: 10,
                  border: `1px solid ${p.enabled ? 'var(--line-soft)' : 'var(--border)'}`,
                  opacity: p.enabled ? 1 : 0.6,
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>
                      {p.provider_id === 'pollinations' ? <Globe size={14} /> : p.provider_id === 'tensorart' ? <Palette size={14} /> : <Package size={14} />}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {p.provider_id} · {defaultModel?.name || '无默认模型'}
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {p.enabled ? <><CheckCircle2 size={14} /> 已启用</> : <><XCircle size={14} /> 已禁用</>}
                    </span>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setEditingProvider(p);
                        const config = typeof p.extra_config === 'string' ? JSON.parse(p.extra_config || '{}') : (p.extra_config || {});
                        setProviderForm({
                          accessToken: config.accessToken || '',
                          timeout: config.timeout || 180000,
                        });
                      }}
                    >
                      <SettingsIcon size={14} /> 配置
                    </button>
                  </div>
                </div>

                {/* 模型列表 */}
                {providerModels.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                      可用模型：
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {providerModels.filter(m => m.enabled).map((m) => (
                        <span
                          key={m.id}
                          style={{
                            padding: '2px 8px',
                            background: m.is_default ? 'var(--line-light)' : 'var(--bg)',
                            border: `1px solid ${m.is_default ? 'var(--line)' : 'var(--border)'}`,
                            borderRadius: 999,
                            fontSize: 10,
                            color: m.is_default ? 'var(--line-2)' : 'var(--muted)',
                          }}
                        >
                          {m.name} {m.is_default && <Star size={12} style={{ color: 'var(--accent)', marginLeft: 4 }} fill="currentColor" />}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {imageProviders.length === 0 && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>
            暂无 Provider，请重启应用
          </div>
        )}
      </Card>

      {/* Provider 配置弹窗 */}
      {editingProvider && (
        <div
          onClick={() => setEditingProvider(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: 'min(480px, 92vw)', padding: 20 }}
          >
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}><SettingsIcon size={18} /> 配置 {editingProvider.name}</div>
              <button className="btn btn-outline btn-sm" onClick={() => setEditingProvider(null)}>✕</button>
            </div>

            {/* 启用/禁用 */}
            <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
              <label style={{ flex: 1 }}>启用此 Provider</label>
              <input
                type="checkbox"
                checked={editingProvider.enabled}
                onChange={(e) => setEditingProvider({ ...editingProvider, enabled: e.target.checked })}
              />
            </div>

            {/* 优先级 */}
            <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
              <label style={{ flex: 1 }}>优先级（数字越小越优先）</label>
              <input
                className="input"
                type="number"
                value={editingProvider.priority}
                onChange={(e) => setEditingProvider({ ...editingProvider, priority: parseInt(e.target.value) || 99 })}
                style={{ width: 80, textAlign: 'center' }}
              />
            </div>

            {/* API Token（Tensor.art 需要） */}
            {editingProvider.provider_id === 'tensorart' && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--muted)' }}>
                  Access Token（从 tensor.art 获取）
                </label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    type="password"
                    value={providerForm.accessToken}
                    onChange={(e) => {
                      setProviderForm({ ...providerForm, accessToken: e.target.value });
                      setEditingProvider({
                        ...editingProvider,
                        extra_config: { ...editingProvider.extra_config, accessToken: e.target.value },
                      });
                    }}
                    placeholder="ak_tensor_xxxxx"
                    style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  />
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => testProvider(editingProvider, providerForm.accessToken)}
                    disabled={!providerForm.accessToken || testingProvider}
                  >
                    {testingProvider ? <><Loader2 size={12} className="spin" /> 测试中…</> : '🧪 测试'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  从 tensor.art 个人资料页获取 Access Key
                </div>
              </div>
            )}

            {/* Pollinations 无需配置 */}
            {editingProvider.provider_id === 'pollinations' && (
              <div style={{ padding: 12, background: 'var(--line-light)', borderRadius: 8, fontSize: 12, color: 'var(--ink-2)' }}>
                ✅ Pollinations 是免费服务，无需 API Key，直接启用即可
              </div>
            )}

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setEditingProvider(null)}>
                取消
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => saveProvider(editingProvider)}>
                <Save size={14} /> 保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提示词模板管理 */}
      <Card title="提示词模板" icon={SettingsIcon} accent="insight">
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
          在线编辑写作提示词，保存后立即生效。
        </div>

        <div className="tab-bar" style={{ marginBottom: 10 }}>
          {prompts.map((p) => (
            <button
              key={p.name}
              className={`tab-pill ${activePrompt === p.name ? 'active' : ''}`}
              onClick={() => setActivePrompt(p.name)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            正在编辑：<code className="mono">{activePrompt}.md</code>
          </span>
          <span style={{ flex: 1 }} />
          {promptDirty && <span style={{ fontSize: 11, color: 'var(--warm)' }}>未保存</span>}
          <button className="btn btn-primary btn-sm" onClick={savePrompt} style={{ marginLeft: 8 }}>
            {promptSaved ? <><CheckCircle2 size={14} /> 已保存</> : <><Save size={14} /> 保存模板</>}
          </button>
        </div>
        <textarea
          className="textarea mono"
          rows={16}
          value={promptContent}
          onChange={(e) => { setPromptContent(e.target.value); setPromptDirty(true); }}
          style={{ fontSize: 12, lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}
          spellCheck={false}
        />
      </Card>

      {/* 调度器状态 */}
      <SchedulerCard />

      {/* 数据存储 */}
      <Card title="数据存储" icon={Database} accent="system">
        <div className="muted" style={{ fontSize: 12 }}>
          所有文章 / 设置存在本地 SQLite：
          <code className="mono" style={{ display: 'block', marginTop: 4, padding: 8, background: 'var(--bg-soft)', borderRadius: 4 }}>
            ~/Library/Application Support/autowriter-desktop/autoWriter.db
          </code>
        </div>
      </Card>
    </>
  );
}

// ===== SchedulerCard =====
function SchedulerCard() {
  const [snap, setSnap] = useState<SchedulerSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    if (!window.electronAPI?.schedulerSnapshot) return;
    const s = await window.electronAPI.schedulerSnapshot();
    setSnap(s);
  };

  useEffect(() => { refresh(); }, []);

  const toggle = async () => {
    setBusy('toggle');
    if (snap?.enabled) await window.electronAPI.schedulerDisable();
    else await window.electronAPI.schedulerEnable();
    await refresh();
    setBusy(null);
  };

  const runNow = async (name: string) => {
    setBusy(name);
    const r = await window.electronAPI.schedulerRunNow(name);
    showToast(r.ok ? `✅ ${name} 跑完` : `❌ ${r.reason || r.error}`);
    await refresh();
    setBusy(null);
  };

  if (!snap) return (
    <Card title="后台调度器" icon={Clock} accent="system">
      <div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>未启动（应用未就绪）</div>
    </Card>
  );

  const tickAgo = snap.lastTick ? `${Math.max(0, Math.floor((Date.now() - snap.lastTick) / 1000))} 秒前` : '尚未运行';
  const intervalSec = Math.round(snap.interval / 1000);

  return (
    <Card title="后台调度器" icon={Clock} accent="system">
      <div className="scheduler-meta">
        <div className="scheduler-stat">
          <span className="scheduler-stat-label">状态</span>
          <span className={'scheduler-stat-value ' + (snap.enabled ? 'on' : 'off')}>
            {snap.enabled ? '● 运行中' : '○ 已停用'}
          </span>
        </div>
        <div className="scheduler-stat">
          <span className="scheduler-stat-label">间隔</span>
          <span className="scheduler-stat-value mono">{intervalSec}s</span>
        </div>
        <div className="scheduler-stat">
          <span className="scheduler-stat-label">上次 tick</span>
          <span className="scheduler-stat-value">{tickAgo}</span>
        </div>
      </div>

      <div className="scheduler-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={toggle} disabled={busy !== null}>
          {snap.enabled ? <><Pause size={12} /> 停用</> : <><Play size={12} /> 启用</>}
        </button>
      </div>

      <div className="scheduler-tasks">
        <div className="scheduler-section-title">已注册任务</div>
        {snap.registeredTasks.map((name) => {
          const lastRun = snap.history.find((h) => h.name === name);
          return (
            <div key={name} className="scheduler-task-row">
              <div className="scheduler-task-main">
                <span className="scheduler-task-name">{name}</span>
                {lastRun && (
                  <span className={'scheduler-task-status ' + (lastRun.ok ? 'ok' : 'err')}>
                    {lastRun.ok ? <><CheckCircle2 size={11} /> {lastRun.durationMs}ms</> : <><XCircle size={11} /> {lastRun.error}</>}
                  </span>
                )}
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => runNow(name)} disabled={busy !== null}>
                {busy === name ? <Loader2 size={11} className="spin" /> : <Play size={11} />} 立即跑
              </button>
            </div>
          );
        })}
      </div>

      {snap.history.length > 0 && (
        <details className="scheduler-history">
          <summary>历史 ({snap.history.length})</summary>
          <div className="scheduler-history-list">
            {snap.history.slice(0, 10).map((h, i) => (
              <div key={i} className={'scheduler-history-row ' + (h.ok ? 'ok' : 'err')}>
                <span className="mono scheduler-history-time">{new Date(h.at).toLocaleTimeString('zh-CN')}</span>
                <span className="scheduler-history-name">{h.name}</span>
                <span className="scheduler-history-dur">{h.durationMs}ms</span>
                {h.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
