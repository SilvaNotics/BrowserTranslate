import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/core/settings';
import type { DetailResult, Request, Response } from '../src/core/types';

const search = vi.hoisted(() => vi.fn());
vi.mock('../src/core/exa', async (original) => ({
  ...(await original<typeof import('../src/core/exa')>()),
  searchExa: search,
}));
afterEach(() => vi.unstubAllGlobals());
let background: typeof import('../entrypoints/background');
beforeAll(async () => {
  vi.stubGlobal('defineBackground', (setup: () => void) => setup);
  background = await import('../entrypoints/background');
});

it('详细默认只调用解释模型，只有显式联网才查询 Exa', async () => {
  const settings = defaultSettings();
  settings.providers = [
    { id: 'p', name: 'fixture', baseUrl: 'https://example.com/v1', apiKey: '', models: [] },
  ];
  settings.translation = { providerId: 'p', model: 'fixture' };
  let listener: (
    request: Request,
    sender: chrome.runtime.MessageSender,
    respond: (response: Response<DetailResult>) => void,
  ) => void;
  const event = { addListener: () => {} };
  vi.stubGlobal('chrome', {
    storage: {
      local: { setAccessLevel: async () => {}, get: async () => ({ settings }) },
      onChanged: event,
    },
    runtime: {
      id: 'fixture',
      getURL: () => 'chrome-extension://fixture/',
      onMessage: {
        addListener: (handler: typeof listener) => {
          listener = handler;
        },
      },
    },
    commands: { onCommand: event },
    tabs: { onRemoved: event, onUpdated: event },
  });
  vi.stubGlobal('fetch', async () => {
    return new Response(JSON.stringify({ choices: [{ message: { content: '模型解释[1]' } }] }));
  });
  search.mockReset();
  search.mockResolvedValue([
    { id: 1, title: 'Reference', url: 'https://example.com/reference', text: 'Source text' },
  ]);
  (background.default as unknown as () => void)();
  const send = (online?: boolean) =>
    new Promise<Response<DetailResult>>((resolve) =>
      listener!(
        {
          type: 'detail',
          id: crypto.randomUUID(),
          text: 'socket',
          ...(online === undefined ? {} : { online }),
        },
        { id: 'fixture', url: 'https://example.com/article', tab: { id: 1 } as chrome.tabs.Tab },
        resolve,
      ),
    );
  try {
    const offline = await send();
    expect(offline).toMatchObject({
      ok: true,
      data: { verified: false, sources: [], text: '模型解释' },
    });
    expect(search).not.toHaveBeenCalled();
    const online = await send(true);
    expect(online).toMatchObject({ ok: true, data: { verified: true, text: '模型解释[1]' } });
    expect(search).toHaveBeenCalledOnce();
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});
