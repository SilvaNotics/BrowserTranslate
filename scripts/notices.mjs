import { readFile, readdir, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = [
  'BrowserTranslate third-party notices\nGenerated from installed production dependencies.\n',
];
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path || meta.dev) continue;
  try {
    const pkg = JSON.parse(await readFile(path + '/package.json', 'utf8'));
    const files = (await readdir(path)).filter((name) =>
      /^(licen[cs]e|copying|notice)(\.|$)/i.test(name),
    );
    const texts = await Promise.all(
      files.map((file) => readFile(path + '/' + file, 'utf8').catch(() => '')),
    );
    notices.push(
      '\n---\n' +
        pkg.name +
        ' ' +
        pkg.version +
        '\nLicense: ' +
        (pkg.license ?? 'See package source') +
        '\n' +
        texts.join('\n'),
    );
  } catch {
    /* Optional platform dependencies may not be installed. */
  }
}
await writeFile('public/THIRD_PARTY_NOTICES.txt', notices.join('\n'));
