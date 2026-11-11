import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, Languages } from 'lucide-react';
import type { ModelRef, Settings } from '../core/types';
export const languages = [
  '简体中文',
  '繁體中文',
  'English',
  '日本語',
  '한국어',
  'Français',
  'Deutsch',
  'Español',
  'Русский',
  'Português',
  'العربية',
];
export function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={'brand ' + (large ? 'large' : '')}>
      <span className="brand-mark">
        <Languages size={large ? 25 : 21} />
      </span>
      <div>
        <span className="brand-name">
          译境<span className="brand-dot">.</span>
        </span>
        <span className="brand-sub">BROWSER TRANSLATE</span>
      </div>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  title,
  description,
  icon,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <label className="feature">
      <span className={'feature-icon ' + (checked ? 'on' : '')}>{icon}</span>
      <span className="feature-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="switch">
        <input
          type="checkbox"
          role="switch"
          aria-label={title}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span />
      </span>
    </label>
  );
}
export function ModelPicker({
  label,
  value,
  settings,
  onChange,
  inherit = false,
}: {
  label: string;
  value: ModelRef | null;
  settings: Settings;
  onChange: (ref: ModelRef | null) => void;
  inherit?: boolean;
}) {
  const id = useId();
  const [providerId, setProviderId] = useState(value?.providerId ?? ''),
    [model, setModel] = useState(value?.model ?? '');
  useEffect(() => {
    setProviderId(value?.providerId ?? '');
    setModel(value?.model ?? '');
  }, [value?.providerId, value?.model]);
  const provider = settings.providers.find((p) => p.id === providerId);
  return (
    <div className="model-picker">
      <label htmlFor={id + '-provider'}>{label}</label>
      <div className="model-grid">
        <select
          id={id + '-provider'}
          aria-label={label + '供应商'}
          value={provider?.id ?? ''}
          onChange={(e) => {
            const p = settings.providers.find((p) => p.id === e.target.value);
            const name = p?.models[0] ?? '';
            setProviderId(p?.id ?? '');
            setModel(name);
            if (!p) onChange(null);
            else if (name) onChange({ providerId: p.id, model: name });
          }}
        >
          <option value="">{inherit ? '跟随翻译模型' : '请选择供应商'}</option>
          {settings.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          aria-label={label + '名称'}
          placeholder="选择或输入模型名称"
          value={model}
          disabled={!provider}
          list={id + '-models'}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => {
            if (provider && model.trim())
              onChange({ providerId: provider.id, model: model.trim() });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && provider && model.trim())
              onChange({ providerId: provider.id, model: model.trim() });
          }}
        />
        <datalist id={id + '-models'}>
          {provider?.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
export function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={13} />
    </a>
  );
}
