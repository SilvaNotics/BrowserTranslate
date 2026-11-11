import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

// These legacy-only options remain in chi_sim's LSTM data config, but the
// LSTM-only WASM engine cannot load them. Keep the model components unchanged.
const legacyParameters = new Set([
  'language_model_ngram_on',
  'segsearch_max_char_wh_ratio',
  'language_model_ngram_space_delimited_language',
  'language_model_use_sigmoidal_certainty',
  'language_model_ngram_nonmatch_score',
  'classify_integer_matcher_multiplier',
  'assume_fixed_pitch_char_segment',
  'allow_blob_division',
]);
function prepareLanguage(compressed) {
  const data = gunzipSync(compressed);
  const count = data.readUInt32LE(0);
  const offsets = Array.from({ length: count }, (_, index) =>
    Number(data.readBigInt64LE(4 + index * 8)),
  );
  const start = offsets[0];
  if (start === -1) return compressed;
  const end = offsets.find((offset) => offset > start) ?? data.length;
  const config = Buffer.from(
    data
      .subarray(start, end)
      .toString('utf8')
      .split('\n')
      .filter((line) => !legacyParameters.has(line.trim().split(/\s+/)[0]))
      .join('\n'),
  );
  const result = Buffer.concat([data.subarray(0, start), config, data.subarray(end)]);
  const delta = config.length - (end - start);
  for (let index = 0; index < count; index++) {
    if (offsets[index] >= end)
      result.writeBigInt64LE(BigInt(offsets[index] + delta), 4 + index * 8);
  }
  return gzipSync(result);
}
const root = resolve('public/ocr');
await rm(root, { recursive: true, force: true });
await mkdir(root + '/core', { recursive: true });
await mkdir(root + '/lang', { recursive: true });
await copyFile('node_modules/tesseract.js/dist/worker.min.js', root + '/worker.min.js');
// The browser loads these self-contained LSTM builds; legacy cores and separate
// WASM binaries are unused by this extension.
for (const file of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'LICENSE'])
  await copyFile('node_modules/tesseract.js-core/' + file, root + '/core/' + file);
for (const language of ['eng', 'chi_sim'])
  await writeFile(
    root + '/lang/' + language + '.traineddata.gz',
    prepareLanguage(
      await readFile(
        'node_modules/@tesseract.js-data/' +
          language +
          '/4.0.0_best_int/' +
          language +
          '.traineddata.gz',
      ),
    ),
  );
console.log('本地 OCR Worker、WASM 及中英文语言数据已准备。');
