import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['src','scripts','tests']) for (const name of await readdir(dir)) {
  if (!/\.(js|mjs)$/.test(name)) continue;
  const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { encoding:'utf8' });
  if (result.status) { console.error(result.stderr); process.exit(result.status); }
}
const html = await readFile('index.html', 'utf8');
if (!html.includes('Content-Security-Policy') || !html.includes('width=device-width')) throw new Error('Missing app security or responsive metadata.');
const preview = await readFile('preview.html', 'utf8');
const receiver = (await readFile('src/preview-frame.js', 'utf8')).trim();
if (!preview.includes(`<script>\n${receiver}\n</script>`)) throw new Error('Preview bootstrap must match src/preview-frame.js exactly.');
if (html.includes("'unsafe-eval'")) throw new Error('The parent application must not enable unsafe evaluation.');
console.log('JavaScript syntax, preview bootstrap, and entry metadata checks passed.');
