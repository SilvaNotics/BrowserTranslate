import { afterEach, expect, it, vi } from 'vitest';
import { translatePageBatch } from '../src/background/page';
import { defaultSettings } from '../src/core/settings';

afterEach(() => vi.unstubAllGlobals());

it('短中文链接使用各自语言上下文，日文和英文链接仍发送给模型', async () => {
  let requested: unknown;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(init.body)).messages[1].content);
    requested = input;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(
                input.map((s: { id: string }) => ({ id: s.id, text: '翻译结果' })),
              ),
            },
          },
        ],
      }),
    );
  });
  const result = await translatePageBatch(
    settings(),
    [
      { id: 'zh', text: '直播', language: 'zh-CN' },
      { id: 'ja', text: '台本', language: 'ja' },
      { id: 'en', text: 'Watch now', language: 'zh-CN' },
    ],
    new AbortController().signal,
  );
  expect(requested).toEqual([
    { id: '0', text: '台本' },
    { id: '1', text: 'Watch now' },
  ]);
  expect(result.find((s) => s.id === 'zh')).toMatchObject({ text: '直播', skipped: true });
  expect(result.filter((s) => !s.skipped)).toHaveLength(2);
});

function settings() {
  return {
    ...defaultSettings(),
    providers: [
      { id: 'p', name: 'fixture', baseUrl: 'https://example.com/v1', apiKey: '', models: [] },
    ],
    translation: { providerId: 'p', model: 'fixture' },
  };
}

it.each(['简体中文', 'English'])(
  '整页请求对 %s 使用目标语言的 ASCII 补全标记规则',
  async (language) => {
    let systemPrompt = '';
    let input: unknown;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      systemPrompt = body.messages[0].content;
      input = JSON.parse(body.messages[1].content);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"0","text":"fixture"}]' } }] }),
      );
    });
    const segment = { id: 'original-id', text: 'value_name = ___' };
    await translatePageBatch(
      { ...settings(), targetLanguage: language },
      [segment],
      new AbortController().signal,
    );
    expect(input).toEqual([{ id: '0', text: segment.text }]);
    expect(systemPrompt).toContain('翻译为' + language);
    expect(systemPrompt).toContain('ASCII 方括号 []');
    expect(systemPrompt).toContain(
      '方括号内的所有文字（包括无法可靠推断时的占位提示）必须使用目标语言',
    );
    expect(systemPrompt).toContain('用目标语言表达“待补全”并放入 []');
    expect(systemPrompt).toContain('空缺标记 [待补全] 或【待补全】');
    expect(systemPrompt).not.toContain('用【】');
    expect(systemPrompt).not.toContain('保留【待补全】');
    expect(systemPrompt).toContain('只返回JSON数组，保留每项id，将text替换为译文，不增删项目');
  },
);

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
    [{ id: 'a', text: 'paragraph', language: 42 }],
    [{ id: 'a', text: 'paragraph', language: 'z'.repeat(101) }],
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
