import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  LoaderCircle,
  Monitor,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { Brand, External, languages, ModelNameInput, ModelPicker } from '../../src/ui/components';
import { useSettings } from '../../src/ui/use-settings';
import { rpc, taskId } from '../../src/core/rpc';
import type { ModelCatalog, Provider } from '../../src/core/types';
import '../../src/ui/style.css';
function SecretInput({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  onBlur?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="key-input">
      <input
        aria-label={label}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoComplete="off"
        spellCheck={false}
        placeholder="仅保存在本机"
      />
      <button
        type="button"
        className="icon-btn"
        aria-label={show ? '隐藏密钥' : '显示密钥'}
        onClick={() => setShow(!show)}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
function Options() {
  const { settings, update, error, setError, saving } = useSettings();
  const [draft, setDraft] = useState<Provider>(),
    [model, setModel] = useState(''),
    [busy, setBusy] = useState(''),
    [notice, setNotice] = useState(''),
    [exa, setExa] = useState('');
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'system';
  }, [settings?.theme]);
  useEffect(() => {
    setExa(settings?.exaApiKey ?? '');
  }, [settings?.exaApiKey]);
  if (!settings) return <div className="loading-screen">{error || '正在读取设置…'}</div>;
  const save = (change: Parameters<typeof update>[0]) => {
    void update(change).catch(() => {});
  };
  function edit(provider?: Provider) {
    setDraft(
      provider
        ? structuredClone(provider)
        : { id: taskId(), name: '', baseUrl: '', apiKey: '', models: [] },
    );
    setModel(provider?.models[0] ?? '');
    setNotice('');
    setError('');
  }
  async function testProvider() {
    if (!draft || !model.trim()) {
      setError('请填写要测试的模型名称。');
      return;
    }
    setBusy('test');
    setError('');
    setNotice('');
    try {
      await rpc<string>({
        type: 'provider:test',
        id: taskId(),
        provider: draft,
        model: model.trim(),
      });
      setNotice('连接成功：模型已正常返回。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接失败');
    } finally {
      setBusy('');
    }
  }
  async function fetchModels() {
    if (!draft) return;
    setBusy('models');
    setError('');
    setNotice('');
    try {
      const { models, visionModels } = await rpc<ModelCatalog>({
        type: 'provider:models',
        id: taskId(),
        provider: draft,
      });
      setDraft({ ...draft, models, visionModels });
      if (!model) setModel(models[0] ?? '');
      setNotice(
        '已获取 ' +
          models.length +
          ' 个模型，其中 ' +
          visionModels.length +
          ' 个支持视觉输入；也可手动输入。',
      );
    } catch (e) {
      setError((e instanceof Error ? e.message : '获取失败') + ' 你仍可以手动输入模型名称。');
    } finally {
      setBusy('');
    }
  }
  async function saveProvider() {
    if (!draft?.name.trim() || !draft.baseUrl.trim()) {
      setError('请填写供应商名称和 Base URL。');
      return;
    }
    const p = {
      ...draft,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      models: [...new Set([model.trim(), ...draft.models].filter(Boolean))],
    };
    try {
      await update((s) => {
        const exists = s.providers.some((item) => item.id === p.id);
        s.providers = exists
          ? s.providers.map((item) => (item.id === p.id ? p : item))
          : [...s.providers, p];
        if (!s.translation && p.models[0]) s.translation = { providerId: p.id, model: p.models[0] };
        return s;
      });
      setDraft(undefined);
      setNotice('供应商已保存。');
    } catch {
      /* shared hook displays validation failures */
    }
  }
  return (
    <div className="settings-shell">
      <aside className="sidebar">
        <Brand large />
        <nav aria-label="设置导航">
          <a href="#providers">
            <Server size={15} />
            模型连接
          </a>
          <a href="#reading">
            <BookOpen size={15} />
            阅读与翻译
          </a>
          <a href="#search">
            <Globe2 size={15} />
            联网解释
          </a>
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <p>
            密钥留在你的浏览器。
            <br />
            让工具回归简单。
          </p>
          <span>译境 v{chrome.runtime.getManifest().version}</span>
        </div>
      </aside>
      <main className="settings-main">
        <header className="settings-heading">
          <div>
            <span className="overline">MAKE IT YOURS</span>
            <h1>你的模型，你的译境。</h1>
            <p>连接熟悉的服务，找到最适合自己的阅读方式。</p>
          </div>
          <span className="saved-indicator">
            {saving ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}{' '}
            {saving ? '保存中' : '设置自动保存'}
          </span>
        </header>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="notice success" role="status">
            {notice}
          </div>
        )}
        <section id="providers" className="settings-section">
          <div className="section-heading">
            <h2>模型连接</h2>
            <button className="btn secondary" onClick={() => edit()}>
              <Plus size={14} />
              添加供应商
            </button>
          </div>
          <div className="provider-list">
            {settings.providers.map((p) => (
              <div className="provider-row" key={p.id}>
                <div className="provider-avatar">{p.name.charAt(0).toUpperCase()}</div>
                <div className="provider-description">
                  <strong>{p.name}</strong>
                  <small>{p.baseUrl}</small>
                </div>
                <button className="icon-btn" aria-label={'编辑 ' + p.name} onClick={() => edit(p)}>
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={'删除 ' + p.name}
                  onClick={() => {
                    save((s) => {
                      s.providers = s.providers.filter((item) => item.id !== p.id);
                      for (const role of ['translation', 'detail', 'vision'] as const)
                        if (s[role]?.providerId === p.id) s[role] = null;
                      return s;
                    });
                    if (draft?.id === p.id) setDraft(undefined);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          {!settings.providers.length && !draft && (
            <div className="empty-state">
              <Server size={25} />
              <div>先连接一个 OpenAI 兼容供应商。</div>
              <small>支持云端 API 和本地模型服务，无需额外部署后端。</small>
            </div>
          )}
          {draft && (
            <form
              className="settings-card provider-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveProvider();
              }}
            >
              <div className="section-heading">
                <h2>
                  {settings.providers.some((p) => p.id === draft.id) ? '编辑供应商' : '新的连接'}
                </h2>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="取消编辑供应商"
                  onClick={() => setDraft(undefined)}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="two-columns">
                <div className="field">
                  <label htmlFor="provider-name">供应商名称</label>
                  <input
                    id="provider-name"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="例如 OpenAI / 本地模型"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="provider-base">Base URL</label>
                  <input
                    id="provider-base"
                    type="url"
                    value={draft.baseUrl}
                    onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label>API Key</label>
                <SecretInput
                  label="供应商 API Key"
                  value={draft.apiKey}
                  onChange={(apiKey) => setDraft({ ...draft, apiKey })}
                />
                <small className="field-hint">
                  支持免密钥的本地服务；Base URL 填 API 根地址，自定义路径会保留。
                </small>
              </div>
              <div className="field">
                <div className="label-row">
                  <label htmlFor="provider-model">模型名称</label>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={!!busy || !draft.baseUrl}
                    onClick={() => void fetchModels()}
                  >
                    {busy === 'models' && <LoaderCircle size={11} className="spin" />}获取模型列表
                  </button>
                </div>
                <ModelNameInput
                  id="provider-model"
                  label="模型名称"
                  value={model}
                  models={draft.models}
                  onChange={setModel}
                />
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!!busy}
                  onClick={() => void testProvider()}
                >
                  {busy === 'test' && <LoaderCircle size={13} className="spin" />}测试连接
                </button>
                <span className="spacer" />
                <button type="button" className="btn ghost" onClick={() => setDraft(undefined)}>
                  取消
                </button>
                <button className="btn primary" type="submit" disabled={saving}>
                  保存供应商
                </button>
              </div>
            </form>
          )}
          {settings.providers.length > 0 && (
            <div className="settings-card" style={{ marginTop: 14 }}>
              <p className="section-description">
                为不同任务分配模型。详细解释可以跟随翻译模型，视觉识别需要支持图片输入。
              </p>
              <ModelPicker
                label="默认翻译模型"
                settings={settings}
                value={settings.translation}
                onChange={(ref) => save((s) => ({ ...s, translation: ref }))}
              />
              <ModelPicker
                label="详细解释模型"
                settings={settings}
                value={settings.detail}
                inherit
                onChange={(ref) => save((s) => ({ ...s, detail: ref }))}
              />
              <ModelPicker
                label="截图视觉模型"
                visionOnly
                settings={settings}
                value={settings.vision}
                onChange={(ref) => save((s) => ({ ...s, vision: ref }))}
              />
            </div>
          )}
        </section>
        <section id="reading" className="settings-section">
          <div className="section-heading">
            <h2>阅读与翻译</h2>
            <Monitor size={16} />
          </div>
          <div className="settings-card">
            <div className="two-columns">
              <div className="field">
                <label htmlFor="language">目标语言</label>
                <select
                  id="language"
                  value={settings.targetLanguage}
                  onChange={(e) => save((s) => ({ ...s, targetLanguage: e.target.value }))}
                >
                  {languages.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="theme">界面主题</label>
                <select
                  id="theme"
                  value={settings.theme}
                  onChange={(e) => save((s) => ({ ...s, theme: e.target.value as typeof s.theme }))}
                >
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="page-mode">整页翻译默认显示</label>
                <select
                  id="page-mode"
                  value={settings.pageMode}
                  onChange={(e) =>
                    save((s) => ({ ...s, pageMode: e.target.value as typeof s.pageMode }))
                  }
                >
                  <option value="bilingual">双语对照</option>
                  <option value="translation">仅译文</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="ocr-mode">截图文字识别</label>
                <select
                  id="ocr-mode"
                  value={settings.ocrMode}
                  onChange={(e) =>
                    save((s) => ({ ...s, ocrMode: e.target.value as typeof s.ocrMode }))
                  }
                >
                  <option value="local">本地 OCR · 中英文</option>
                  <option value="vision">视觉模型 · 上传裁剪图片</option>
                </select>
              </div>
            </div>
            <p className="settings-note">
              本地 OCR
              仅将识别出的文字发送给翻译供应商。视觉模式将框选后的图片发送给视觉供应商。两种模式均不保存截图历史。
            </p>
            <p className="settings-note">
              划词：<kbd className="shortcut">长按 Ctrl 400ms</kbd>　截图：
              <kbd className="shortcut">Ctrl + 小键盘 *</kbd> 或{' '}
              <kbd className="shortcut">Ctrl + Shift + Y</kbd>
            </p>
            <button
              className="btn ghost"
              style={{ marginTop: 6, paddingLeft: 0 }}
              onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
            >
              自定义标准快捷键 ↗
            </button>
          </div>
        </section>
        <section id="search" className="settings-section">
          <div className="section-heading">
            <h2>联网解释</h2>
            <Globe2 size={16} />
          </div>
          <div className="settings-card">
            <p className="section-description">
              点击地球图标启用联网模式并变深色，再点击“详细”，由 Exa
              搜索相关资料，再让模型结合上下文解释并列出出处。
            </p>
            <div className="field">
              <label>
                <KeyRound size={12} /> Exa API Key · 可选
              </label>
              <SecretInput label="Exa API Key" value={exa} onChange={setExa} />
              <div className="form-actions" style={{ marginTop: 8 }}>
                <small>留空可限流试用；填写自己的 Key 获得个人额度。</small>
                <span className="spacer" />
                <button
                  className="btn secondary"
                  onClick={() => save((s) => ({ ...s, exaApiKey: exa.trim() }))}
                >
                  保存搜索密钥
                </button>
              </div>
            </div>
            <p className="settings-note">
              <External href="https://dashboard.exa.ai/api-keys">获取 Exa API Key</External>
              　搜索只发送精简的选词／选句；联网解释会参考附近语境。
            </p>
          </div>
        </section>
        <p className="settings-note">
          <ShieldCheck size={13} />{' '}
          配置仅保存在本机扩展存储，不随浏览器同步。网页、搜索资料和模型输出按不可信内容处理。受限页面不可注入翻译界面。
        </p>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Options />);
