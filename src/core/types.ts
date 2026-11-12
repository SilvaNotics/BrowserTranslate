export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  visionModels?: string[];
}
export interface ModelCatalog {
  models: string[];
  visionModels: string[];
}
export interface ModelRef {
  providerId: string;
  model: string;
}
export interface Settings {
  version: 1;
  providers: Provider[];
  translation: ModelRef | null;
  detail: ModelRef | null;
  vision: ModelRef | null;
  targetLanguage: string;
  features: { selection: boolean; page: boolean; screenshot: boolean };
  pageMode: 'bilingual' | 'translation';
  pageConcurrency: number;
  ocrMode: 'local' | 'vision';
  theme: 'system' | 'light' | 'dark';
  exaApiKey: string;
}
export type PublicSettings = Omit<Settings, 'providers' | 'exaApiKey'> & {
  providers: Omit<Provider, 'apiKey'>[];
};
export interface Source {
  id: number;
  title: string;
  url: string;
  text: string;
}
export interface DetailResult {
  text: string;
  sources: Source[];
  verified: boolean;
  warning?: string;
}
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}
export interface Segment {
  id: string;
  text: string;
  language?: string;
  skipped?: boolean;
}
export type Request =
  | { type: 'settings:get'; id: string }
  | { type: 'settings:save'; id: string; settings: Settings }
  | { type: 'settings:public'; id: string }
  | { type: 'provider:models'; id: string; provider: Provider }
  | { type: 'provider:test'; id: string; provider: Provider; model: string }
  | { type: 'translate'; id: string; text: string }
  | { type: 'detail'; id: string; text: string; context?: string; online?: boolean }
  | { type: 'page:batch'; id: string; segments: Segment[] }
  | { type: 'capture:start'; id: string }
  | { type: 'capture:recognize'; id: string; region: Region }
  | { type: 'cancel'; id: string; taskId: string };
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
