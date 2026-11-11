import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['scripts/prepare-ocr.mjs']);
it.each(['tesseract-core-lstm', 'tesseract-core-simd-lstm'])(
  '%s 实际初始化中英文语言包没有参数缺失警告',
  (core) => {
    const result = JSON.parse(
      execFileSync(process.execPath, ['tests/fixtures/ocr-core.cjs', core], { encoding: 'utf8' }),
    );
    expect(result).toEqual({ status: 0, warnings: [] });
  },
  15000,
);
it.each(['eng', 'chi_sim'])('打包的 %s 语言数据只包含 LSTM 组件', async (language) => {
  const data = gunzipSync(await readFile(`public/ocr/lang/${language}.traineddata.gz`));
  // Traineddata contains an entry count followed by little-endian int64 offsets.
  // Component 3 is the legacy character classifier, absent from LSTM-only data.
  expect(data.readBigInt64LE(4 + 3 * 8)).toBe(-1n);
  expect(data.readBigInt64LE(4 + 17 * 8)).toBeGreaterThan(0n);
  const source = gunzipSync(
    await readFile(
      `node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`,
    ),
  );
  const component = (buffer: Buffer, index: number) => {
    const offsets = Array.from({ length: buffer.readUInt32LE(0) }, (_, i) =>
      Number(buffer.readBigInt64LE(4 + i * 8)),
    );
    const start = offsets[index]!;
    return start === -1
      ? null
      : buffer.subarray(start, offsets.find((offset) => offset > start) ?? buffer.length);
  };
  // Repacking the config must not alter any dictionary or neural-network bytes.
  for (let index = 1; index < source.readUInt32LE(0); index++)
    expect(component(data, index)).toEqual(component(source, index));
});
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
