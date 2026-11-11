const { readFileSync } = require('node:fs');
const { gunzipSync } = require('node:zlib');
const Core = require('tesseract.js-core/' + process.argv[2]);
(async () => {
  const warnings = [];
  const core = await Core({ printErr: (message) => warnings.push(message) });
  for (const language of ['eng', 'chi_sim']) {
    core.FS.writeFile(
      language + '.traineddata',
      gunzipSync(readFileSync('public/ocr/lang/' + language + '.traineddata.gz')),
    );
  }
  const api = new core.TessBaseAPI();
  const status = api.Init(null, 'eng+chi_sim', 1);
  api.End();
  console.log(JSON.stringify({ status, warnings }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
