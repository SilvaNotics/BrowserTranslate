import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, Languages } from 'lucide-react';
import type { ModelRef, Settings } from '../core/types';
import { knownVisionModel } from '../core/model-capabilities';
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
export function ModelNameInput({
  id,
  label,
  value,
  models,
  disabled = false,
  onChange,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  models: string[];
  disabled?: boolean;
  onChange: (model: string) => void;
  onCommit?: (model: string) => void;
}) {
  const [manual, setManual] = useState(false);
  const showManual = manual || (!!value && !models.includes(value)) || !models.length;
  return (
    <div className="model-name-input">
      <select
        id={id}
        aria-label={label}
        value={showManual ? '' : value || '__unselected'}
        disabled={disabled}
        onChange={(e) => {
          const name = e.target.value;
          setManual(!name);
          if (name) {
            onChange(name);
            onCommit?.(name);
          }
        }}
      >
        <option value="__unselected" disabled hidden>
          请选择模型
        </option>
        <option value="">手动输入模型 ID</option>
        {models.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {showManual && (
        <input
          aria-label={label + '（手动输入）'}
          placeholder="输入精确模型 ID"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.(value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit?.(value);
          }}
        />
      )}
    </div>
  );
}
export function ModelPicker({
  label,
  value,
  settings,
  onChange,
  inherit = false,
  visionOnly = false,
}: {
  label: string;
  value: ModelRef | null;
  settings: Settings;
  onChange: (ref: ModelRef | null) => void;
  inherit?: boolean;
  visionOnly?: boolean;
}) {
  const id = useId();
  const [providerId, setProviderId] = useState(value?.providerId ?? ''),
    [model, setModel] = useState(value?.model ?? '');
  useEffect(() => {
    setProviderId(value?.providerId ?? '');
    setModel(value?.model ?? '');
  }, [value?.providerId, value?.model]);
  const provider = settings.providers.find((p) => p.id === providerId);
  const models = provider
    ? visionOnly
      ? (provider.visionModels ?? provider.models.filter(knownVisionModel))
      : provider.models
    : [];
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
            const name = visionOnly ? '' : (p?.models[0] ?? '');
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
        <ModelNameInput
          key={provider?.id ?? ''}
          id={id + '-model'}
          label={label + '名称'}
          value={model}
          models={models}
          disabled={!provider}
          onChange={setModel}
          onCommit={(name) => {
            if (provider && name.trim()) onChange({ providerId: provider.id, model: name.trim() });
          }}
        />
      </div>
      {visionOnly && provider && (
        <small className="field-hint">
          {models.length
            ? '仅显示支持图片输入的模型，请选择用于 OCR 的模型。'
            : '未识别到视觉模型，请重新获取模型列表，或手动输入已确认支持图片的模型 ID。'}
        </small>
      )}
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
