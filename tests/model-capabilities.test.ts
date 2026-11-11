import { afterEach, describe, expect, it, vi } from 'vitest';
import { listModels } from '../src/core/model';
import { validateSettings, defaultSettings } from '../src/core/settings';

const provider = {
  id: 'p',
  name: 'fixture',
  baseUrl: 'https://example.com/v1',
  apiKey: '',
  models: [],
};
afterEach(() => vi.unstubAllGlobals());

describe('OCR 视觉模型筛选', () => {
  it('根据图片输入能力筛选，输出图片和纯文本模型不进入视觉列表', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'text', architecture: { input_modalities: ['text'] } },
              {
                id: 'image-input',
                architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
              },
              {
                id: 'image-output',
                architecture: { input_modalities: ['text'], output_modalities: ['image'] },
              },
              {
                id: 'no-text-output',
                architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
              },
              { id: 'direct', input_modalities: ['image', 'text'] },
              { id: 'capability', capabilities: { vision: true } },
              { id: 'ollama', capabilities: ['completion', 'vision'] },
              { id: 'unknown' },
              null,
              { id: 123 },
            ],
          }),
        ),
    );
    await expect(listModels(provider)).resolves.toEqual({
      models: [
        'capability',
        'direct',
        'image-input',
        'image-output',
        'no-text-output',
        'ollama',
        'text',
        'unknown',
      ],
      visionModels: ['capability', 'direct', 'image-input', 'ollama'],
    });
  });

  it('缺少能力元数据时识别常见视觉型号，明确的纯文本声明覆盖名称推断', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'openai/gpt-4o-mini' },
              { id: 'gpt-4.1' },
              { id: 'gpt-4o-audio-preview' },
              { id: 'gpt-4o-mini-tts' },
              { id: 'gpt-3.5-turbo' },
              { id: 'qwen/qwen2.5-vl-7b-instruct' },
              { id: 'claude-sonnet-4-5' },
              { id: 'gemini-2.5-flash' },
              { id: 'gemini-embedding-001' },
              { id: 'gpt-4o', architecture: { input_modalities: ['text'] } },
              { id: 'qwen-vl-disabled', capabilities: { vision: false } },
            ],
          }),
        ),
    );
    const catalog = await listModels(provider);
    expect(catalog.visionModels).toEqual([
      'claude-sonnet-4-5',
      'gemini-2.5-flash',
      'gpt-4.1',
      'openai/gpt-4o-mini',
      'qwen/qwen2.5-vl-7b-instruct',
    ]);
  });

  it('持久化能力列表并兼容旧配置，拒绝伪造或损坏的能力数据', () => {
    const settings = defaultSettings();
    settings.providers = [{ ...provider, models: ['text', 'vision'], visionModels: ['vision'] }];
    expect(validateSettings(settings).providers[0]?.visionModels).toEqual(['vision']);
    expect(settings.vision).toBeNull();
    expect(settings.ocrMode).toBe('local');
    settings.providers[0]!.visionModels = ['not-in-catalog'];
    expect(() => validateSettings(settings)).toThrow();
    delete settings.providers[0]!.visionModels;
    expect(() => validateSettings(settings)).not.toThrow();
  });
});
