import type { Settings, PublicSettings, ModelRef, Provider } from './types';
export const SETTINGS_KEY = 'settings';
export function defaultSettings(): Settings {
  return {
    version: 1,
    providers: [],
    translation: null,
    detail: null,
    vision: null,
    targetLanguage: '简体中文',
    features: { selection: true, page: true, screenshot: true },
    pageMode: 'bilingual',
    ocrMode: 'local',
    theme: 'system',
    exaApiKey: '',
  };
}
export function publicSettings(s: Settings): PublicSettings {
  const { exaApiKey: _key, providers, ...rest } = s;
  return { ...rest, providers: providers.map(({ apiKey: _secret, ...p }) => p) };
}
export function validateSettings(value: unknown): Settings {
  const s = value as Settings;
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.providers) ||
    !s.features ||
    typeof s.targetLanguage !== 'string' ||
    !s.targetLanguage.trim() ||
    s.targetLanguage.length > 80
  )
    throw new Error('配置格式不正确');
  const ids = new Set<string>();
  for (const p of s.providers) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      ids.has(p.id) ||
      typeof p.name !== 'string' ||
      typeof p.apiKey !== 'string' ||
      !Array.isArray(p.models) ||
      p.models.some((m) => typeof m !== 'string')
    )
      throw new Error('供应商配置不正确');
    if (
      p.visionModels !== undefined &&
      (!Array.isArray(p.visionModels) ||
        p.visionModels.some((model) => typeof model !== 'string' || !p.models.includes(model)))
    )
      throw new Error('视觉模型能力列表不正确');
    const url = new URL(p.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Base URL 需要是 HTTP 或 HTTPS API 根地址');
    ids.add(p.id);
  }
  for (const role of [s.translation, s.detail, s.vision])
    if (role && (!ids.has(role.providerId) || typeof role.model !== 'string' || !role.model.trim()))
      throw new Error('请选择有效的供应商和模型');
  if (
    !['selection', 'page', 'screenshot'].every(
      (key) => typeof s.features[key as keyof typeof s.features] === 'boolean',
    ) ||
    !['local', 'vision'].includes(s.ocrMode) ||
    !['bilingual', 'translation'].includes(s.pageMode) ||
    !['system', 'light', 'dark'].includes(s.theme) ||
    typeof s.exaApiKey !== 'string'
  )
    throw new Error('功能配置不正确');
  return structuredClone(s);
}
export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] ? validateSettings(data[SETTINGS_KEY]) : defaultSettings();
}
export async function saveSettings(s: Settings): Promise<Settings> {
  const valid = validateSettings(s);
  await chrome.storage.local.set({ [SETTINGS_KEY]: valid });
  return valid;
}
export function resolveModel(
  s: Settings,
  role: 'translation' | 'detail' | 'vision',
): { provider: Provider; model: string } {
  const ref: ModelRef | null = s[role] ?? (role === 'detail' ? s.translation : null);
  const provider = s.providers.find((p) => p.id === ref?.providerId);
  if (!provider || !ref?.model)
    throw new Error(
      role === 'vision'
        ? '请先在设置中选择支持图片的视觉模型。'
        : '请先点击扩展图标，在设置中添加供应商并选择翻译模型。',
    );
  return { provider, model: ref.model };
}
