import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import {
  Camera,
  ChevronRight,
  Globe2,
  LoaderCircle,
  MousePointer2,
  ScanText,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  WholeWord,
} from 'lucide-react';
import { Brand, languages, ModelPicker, Toggle } from '../../src/ui/components';
import { useSettings } from '../../src/ui/use-settings';
import { rpc, taskId } from '../../src/core/rpc';
import { resolveModel } from '../../src/core/settings';
import '../../src/ui/style.css';
function Popup() {
  const { settings, update, error, setError } = useSettings();
  const [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'system';
    setConnected(false);
  }, [settings]);
  if (!settings) return <div className="loading-screen">{error || '正在打开译境…'}</div>;
  const save = (change: Parameters<typeof update>[0]) => {
    void update(change).catch(() => {});
  };
  async function connect() {
    if (!settings) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { provider, model } = resolveModel(settings, 'translation');
      await rpc({ type: 'provider:test', id: taskId(), provider, model });
      setConnected(true);
      setMessage('连接成功，可以开始翻译。');
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : '连接失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="popup">
      <header className="popup-header">
        <Brand />
        <button
          className="icon-btn"
          aria-label="打开设置"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          <Settings2 size={18} />
        </button>
      </header>
      <p className="popup-kicker">A LITTLE LESS DISTANCE</p>
      <h1>让语言，不再有距离。</h1>
      <div className="connection-card">
        <div className="connection-row">
          <span className="connection-status">
            <span className={'status-dot ' + (connected ? 'connected' : '')} />
            {connected ? '已连接' : settings.translation ? '模型已配置' : '等待连接你的模型'}
          </span>
          <button
            className="btn primary"
            onClick={() => void connect()}
            disabled={busy || !settings.translation}
          >
            {busy ? <LoaderCircle size={12} className="spin" /> : <Sparkles size={12} />}连接
          </button>
        </div>
        {settings.providers.length ? (
          <ModelPicker
            label="翻译模型"
            settings={settings}
            value={settings.translation}
            onChange={(ref) => save((s) => ({ ...s, translation: ref?.model ? ref : null }))}
          />
        ) : (
          <p className="empty-inline">
            使用你自己的 OpenAI 兼容服务。
            <br />
            <button onClick={() => void chrome.runtime.openOptionsPage()}>
              添加第一个供应商 <ChevronRight size={12} />
            </button>
          </p>
        )}
      </div>
      <div className="language-row">
        <label htmlFor="target">
          <Globe2 size={15} />
          翻译为
        </label>
        <select
          id="target"
          value={settings.targetLanguage}
          onChange={(e) => save((s) => ({ ...s, targetLanguage: e.target.value }))}
        >
          {languages.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </div>
      <p className="section-label">你的阅读方式</p>
      <Toggle
        title="划词翻译"
        description="选中文字，长按 Ctrl 400ms"
        icon={<MousePointer2 size={17} />}
        checked={settings.features.selection}
        onChange={(value) => save((s) => ({ ...s, features: { ...s.features, selection: value } }))}
      />
      <Toggle
        title="整页翻译"
        description="轻点网页悬浮球，自由切换双语"
        icon={<WholeWord size={18} />}
        checked={settings.features.page}
        onChange={(value) => save((s) => ({ ...s, features: { ...s.features, page: value } }))}
      />
      <Toggle
        title="截图翻译"
        description="Ctrl + 小键盘 *，框选即可翻译"
        icon={<ScanText size={17} />}
        checked={settings.features.screenshot}
        onChange={(value) =>
          save((s) => ({ ...s, features: { ...s.features, screenshot: value } }))
        }
      />
      <button
        className="screenshot-button"
        disabled={!settings.features.screenshot}
        onClick={() => {
          setError('');
          void rpc<string>({ type: 'capture:start', id: taskId() })
            .then(() => window.close())
            .catch((e) => setError(e.message));
        }}
      >
        <Camera size={16} />
        框选截图翻译
        <ChevronRight size={13} />
      </button>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
      <footer className="popup-footer">
        <span>自己的模型 · 自在地阅读</span>
        <button onClick={() => void chrome.runtime.openOptionsPage()}>
          <SlidersHorizontal size={12} />
          全部设置
        </button>
      </footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Popup />);
