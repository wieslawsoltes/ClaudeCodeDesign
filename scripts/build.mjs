import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['.nojekyll', 'index.html','preview.html','manifest.webmanifest','sw.js','src','assets']) await cp(path, `dist/${path}`, { recursive: true });
await cp('index.html', 'dist/404.html');
console.log('Static site built into dist/. No runtime dependencies, bundler, or API secrets.');
