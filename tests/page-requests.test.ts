import { afterEach, expect, it, vi } from 'vitest';
import { translatePageBatch } from '../src/background/page';
import { defaultSettings } from '../src/core/settings';

afterEach(() => vi.unstubAllGlobals());

function settings() {
  return {
    ...defaultSettings(),
    providers: [
      { id: 'p', name: 'fixture', baseUrl: 'https://example.com/v1', apiKey: '', models: [] },
    ],
    translation: { providerId: 'p', model: 'fixture' },
  };
}

it('请求使用短 ID 减少模型输出，乱序返回仍映射到原段落', async () => {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(JSON.parse(body.messages[1].content)).toEqual([
      { id: '0', text: 'First paragraph' },
      { id: '1', text: 'Second paragraph' },
    ]);
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: '[{"id":"1","text":"第二段"},{"id":"0","text":"第一段"}]' } },
        ],
      }),
    );
  });
  const translated = await translatePageBatch(
    settings(),
    [
      { id: 'original-long-identifier-a', text: 'First paragraph' },
      { id: 'original-long-identifier-b', text: 'Second paragraph' },
    ],
    new AbortController().signal,
  );
  expect(translated).toEqual([
    { id: 'original-long-identifier-b', text: '第二段' },
    { id: 'original-long-identifier-a', text: '第一段' },
  ]);
});

it('拒绝超限、重复 ID 和损坏的分块，格式错误时不发送模型请求', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const invalid: unknown[] = [
    [],
    Array.from({ length: 25 }, (_, i) => ({ id: String(i), text: 'paragraph' })),
    [{ id: 'a', text: 'x'.repeat(4001) }],
    [
      { id: 'a', text: 'x'.repeat(2001) },
      { id: 'b', text: 'y'.repeat(2000) },
    ],
    [
      { id: 'a', text: 'First' },
      { id: 'a', text: 'Second' },
    ],
    [null],
    [{ id: 1, text: 'paragraph' }],
  ];
  for (const segments of invalid) {
    await expect(
      translatePageBatch(settings(), segments as never, new AbortController().signal),
    ).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('目标语言段落不发送给模型，混合批次只请求需要翻译的内容', async () => {
  vi.stubGlobal('chrome', {
    i18n: {
      detectLanguage: async () => ({
        isReliable: true,
        languages: [{ language: 'zh', percentage: 100 }],
      }),
    },
  });
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const input = JSON.parse(body.messages[1].content);
    expect(input).toEqual([{ id: '0', text: 'Translate this English paragraph.' }]);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '[{"id":"0","text":"请翻译这个英文段落。"}]' } }],
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  const chinese = { id: 'zh', text: '这个段落本来就是中文，不需要再进行翻译。' };
  expect(await translatePageBatch(settings(), [chinese], new AbortController().signal)).toEqual([
    { ...chinese, skipped: true },
  ]);
  expect(fetch).not.toHaveBeenCalled();
  expect(
    await translatePageBatch(
      settings(),
      [chinese, { id: 'en', text: 'Translate this English paragraph.' }],
      new AbortController().signal,
    ),
  ).toEqual([
    { ...chinese, skipped: true },
    { id: 'en', text: '请翻译这个英文段落。' },
  ]);
  expect(fetch).toHaveBeenCalledOnce();
});
