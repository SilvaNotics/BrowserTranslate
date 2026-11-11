import { describe, it, expect, vi } from 'vitest';
import {
  defaultSettings,
  publicSettings,
  validateSettings,
  resolveModel,
} from '../src/core/settings';
import { apiUrl, complete, parseBatch } from '../src/core/model';
import { parseSources, sanitizeCitations } from '../src/core/exa';
import { cropBounds } from '../src/core/capture';
import { isSupportedUrl } from '../src/core/rpc';

describe('配置与凭据隔离', () => {
  it('旧配置自动补上整页并发设置，并拒绝超出上限和非整数的并发数', () => {
    const legacy = { ...defaultSettings() } as Record<string, unknown>;
    delete legacy.pageConcurrency;
    expect(validateSettings(legacy).pageConcurrency).toBe(4);
    for (const value of [0, 7, 1.5, '4', null]) {
      expect(() => validateSettings({ ...defaultSettings(), pageConcurrency: value })).toThrow();
    }
    expect(validateSettings({ ...defaultSettings(), pageConcurrency: 6 }).pageConcurrency).toBe(6);
  });
  it('多个供应商、手动模型与各用途独立选择', () => {
    const settings = defaultSettings();
    settings.providers = ['a', 'b'].map((id) => ({
      id,
      name: id,
      baseUrl: 'https://example.com/v1',
      apiKey: '',
      models: [],
    }));
    settings.translation = { providerId: 'a', model: 'manual-model' };
    expect(resolveModel(settings, 'detail').model).toBe('manual-model');
    settings.vision = { providerId: 'b', model: 'vision-model' };
    expect(resolveModel(settings, 'vision').provider.id).toBe('b');
    settings.translation = { providerId: 'b', model: 'another-manual' };
    expect(resolveModel(settings, 'translation').model).toBe('another-manual');
  });
  it('默认三种功能打开，仅暴露无密钥的供应商', () => {
    const settings = defaultSettings();
    settings.exaApiKey = 'private-exa';
    settings.providers.push({
      id: 'p',
      name: '本地',
      baseUrl: 'http://localhost:8000/custom/v1',
      apiKey: 'private-model',
      models: ['text'],
    });
    expect(publicSettings(settings)).not.toHaveProperty('exaApiKey');
    expect(publicSettings(settings).providers[0]).not.toHaveProperty('apiKey');
    expect(Object.values(settings.features).every(Boolean)).toBe(true);
  });
  it('拒绝损坏的配置与非 http 端点', () => {
    expect(() => validateSettings({})).toThrow();
    const settings = defaultSettings();
    settings.providers.push({
      id: 'p',
      name: 'bad',
      baseUrl: 'javascript:alert(1)',
      apiKey: '',
      models: [],
    });
    expect(() => validateSettings(settings)).toThrow();
  });
});
describe('OpenAI 兼容接口', () => {
  it.each([
    [429, '限流'],
    [400, '支持图片'],
    [500, 'HTTP 500'],
  ])('HTTP %s 返回清晰错误', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('sensitive response', { status: Number(status) })),
    );
    await expect(
      complete(
        { id: 'p', name: 'x', baseUrl: 'https://example.com/v1', apiKey: '', models: [] },
        'm',
        's',
        't',
      ),
    ).rejects.toThrow(String(message));
  });
  it('不可达端点与用户取消给出不同提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    const provider = {
      id: 'p',
      name: 'x',
      baseUrl: 'https://example.com/v1',
      apiKey: '',
      models: [],
    };
    await expect(complete(provider, 'm', 's', 't')).rejects.toThrow('无法连接');
    const controller = new AbortController();
    controller.abort();
    await expect(complete(provider, 'm', 's', 't', controller.signal)).rejects.toThrow('已取消');
  });
  it('保留自定义 API 路径且不重复拼接 v1', () =>
    expect(apiUrl('https://example.com/custom/v1/', 'models')).toBe(
      'https://example.com/custom/v1/models',
    ));
  it('认证失败时错误不泄漏凭据及原始响应', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('secret-key', { status: 401 })),
    );
    await expect(
      complete(
        { id: 'p', name: 'x', baseUrl: 'https://example.com/v1', apiKey: 'secret-key', models: [] },
        'm',
        'sys',
        'hello',
      ),
    ).rejects.toThrow('API Key');
  });
  it('解析批量响应时按 id 校验，拒绝缺失和重复', () => {
    expect(parseBatch('```json\n[{"id":"a","text":"你好"}]\n```', ['a'])).toEqual([
      { id: 'a', text: '你好' },
    ]);
    expect(() => parseBatch('[{"id":"a","text":"a"},{"id":"a","text":"b"}]', ['a', 'b'])).toThrow();
  });
});
describe('联网出处', () => {
  it('只收录实际搜索结果中的 http 链接并去重', () => {
    const sources = parseSources(
      'Title: Example\nURL: https://example.com/a\nText: A fact\n\nTitle: Duplicate\nURL: https://example.com/a\nText: duplicated\n\nTitle: Unsafe\nURL: javascript:alert(1)',
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]?.title).toBe('Example');
    expect(sanitizeCitations('解释[1] 和伪造[9]', sources)).toBe('解释[1] 和伪造');
  });
});
describe('截图边界', () => {
  it('按实际图像尺寸换算，在高 DPI 与缩放下精确裁剪', () => {
    expect(
      cropBounds(
        { x: 10, y: 20, width: 100, height: 50, viewportWidth: 800, viewportHeight: 600 },
        1600,
        1200,
      ),
    ).toEqual({ x: 20, y: 40, width: 200, height: 100 });
  });
  it('拒绝超出可视区域或过小选框', () =>
    expect(() =>
      cropBounds(
        { x: -1, y: 0, width: 2, height: 3, viewportWidth: 800, viewportHeight: 600 },
        1600,
        1200,
      ),
    ).toThrow());
  it('受限页面显示不可用', () => {
    expect(isSupportedUrl('chrome://settings')).toBe(false);
    expect(isSupportedUrl('https://example.com/a.pdf')).toBe(false);
    expect(isSupportedUrl('https://example.com')).toBe(true);
  });
});
