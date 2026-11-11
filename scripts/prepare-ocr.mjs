import { cp, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('public/ocr');
await mkdir(root + '/core', { recursive: true });
await mkdir(root + '/lang', { recursive: true });
await copyFile('node_modules/tesseract.js/dist/worker.min.js', root + '/worker.min.js');
await cp('node_modules/tesseract.js-core', root + '/core', {
  recursive: true,
  filter: (path) =>
    !path.endsWith('index.js') && !path.endsWith('package.json') && !path.endsWith('README.md'),
});
for (const language of ['eng', 'chi_sim'])
  await copyFile(
    'node_modules/@tesseract.js-data/' + language + '/4.0.0/' + language + '.traineddata.gz',
    root + '/lang/' + language + '.traineddata.gz',
  );
console.log('本地 OCR Worker、WASM 及中英文语言数据已准备。');
