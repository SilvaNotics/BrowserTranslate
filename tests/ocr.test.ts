import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('取消 OCR 后立即回应原任务，不会永久占用识别槽位', async () => {
  type Listener = (message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean;
  let listener: Listener | undefined;
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test',
      getURL: (s: string) => 'chrome-extension://test/' + s,
      onMessage: {
        addListener: (l: Listener) => {
          listener = l;
        },
      },
      sendMessage: () => Promise.resolve(),
    },
  });
  vi.doMock('tesseract.js', () => ({
    OEM: { LSTM_ONLY: 1 },
    createWorker: async () => ({
      recognize: () => new Promise(() => {}),
      terminate: async () => {},
    }),
  }));
  await import('../entrypoints/offscreen/main');
  const result = vi.fn();
  listener!(
    { target: 'offscreen', type: 'ocr:run', id: 'one', image: 'data:image/png;base64,x' },
    { id: 'test' },
    result,
  );
  await Promise.resolve();
  await Promise.resolve();
  listener!({ target: 'offscreen', type: 'ocr:cancel', id: 'one' }, { id: 'test' }, () => {});
  await vi.waitFor(
    () => expect(result).toHaveBeenCalledWith(expect.objectContaining({ ok: false })),
    { timeout: 1000 },
  );
});
