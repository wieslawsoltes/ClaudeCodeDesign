import { safePath, putFile, LIMITS } from './core.js';
const supported = /\.(?:html?|css|[cm]?js|jsx|tsx?|json|md|txt|svg|xml|ya?ml|toml|py|cs|rs|go|java|sql|sh|c|cpp|h|svelte|vue)$/i;
export function isTextPath(path) {
  try { path = safePath(path); } catch { return false; }
  return supported.test(path) || /(?:^|\/)(?:LICENSE|README|Dockerfile|Makefile|\.gitignore)$/i.test(path);
}
export async function importLocalFiles(input, base = {}) {
  let files = { ...base }; const imported = [], skipped = [], items = Array.from(input);
  for (const file of items.slice(0, LIMITS.files)) {
    const raw = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
    try {
      const path = safePath(raw);
      if (!isTextPath(path)) throw new Error('Unsupported or secret file type.');
      if (file.size > LIMITS.fileBytes) throw new Error('Exceeds 500 KB.');
      files = putFile(files, path, await file.text()); imported.push(path);
    } catch (error) { skipped.push(`${raw}: ${error.message}`); }
  }
  if (items.length > LIMITS.files) skipped.push(`Only the first ${LIMITS.files} selected files were considered.`);
  return { files, imported: [...new Set(imported)], skipped };
}
export function parseRepository(value) {
  let path = String(value).trim();
  if (/^https:\/\//i.test(path)) {
    const url = new URL(path);
    if (url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Use a public github.com repository URL without credentials or query parameters.');
    path = url.pathname.replace(/^\/|\/$/g, '');
  }
  path = path.replace(/\.git$/, '');
  if (!/^[a-z\d](?:[a-z\d-]{0,38})\/[\w.-]+$/i.test(path) || path.split('/').some(p => ['.', '..'].includes(p))) throw new Error('Enter owner/repository or its https://github.com/owner/repository URL.');
  return path;
}
export async function importPublicRepository(value, { signal, fetchImpl = fetch, onProgress } = {}) {
  const repo = parseRepository(value), prefix = `https://api.github.com/repos/${repo}`;
  const get = async path => {
    signal?.throwIfAborted();
    const response = await fetchImpl(prefix + path, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub public API rate limit reached. Try again later or import local files.' : `GitHub returned HTTP ${response.status}. Check that the repository is public.`);
    return response.json();
  };
  const info = await get('');
  if (typeof info.default_branch !== 'string') throw new Error('The repository has no readable default branch.');
  const tree = await get(`/git/trees/${encodeURIComponent(info.default_branch)}?recursive=1`);
  if (!Array.isArray(tree.tree)) throw new Error('GitHub did not return a file tree.');
  const skipped = tree.truncated ? ['The GitHub tree is truncated. Import a local folder for a complete project.'] : [];
  const entries = tree.tree.filter(item => item.type === 'blob' && isTextPath(item.path) && item.size <= LIMITS.fileBytes && /^[a-f\d]{40,64}$/i.test(item.sha)).sort((a, b) => a.path.localeCompare(b.path));
  if (entries.length > 24) skipped.push(`${entries.length} supported files found; public import is limited to 24 files. Use local folder import for larger projects.`);
  let files = {}; const imported = [];
  for (const entry of entries.slice(0, 24)) {
    onProgress?.(entry.path);
    const blob = await get(`/git/blobs/${entry.sha}`);
    try {
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('Unsupported GitHub blob encoding.');
      const raw = atob(blob.content.replace(/\s/g, ''));
      const content = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
      const path = safePath(entry.path); files = putFile(files, path, content); imported.push(path);
    } catch (error) { skipped.push(`${entry.path}: ${error.message}`); }
  }
  return { files, imported, skipped, name: repo.split('/')[1] };
}
function projectPath(reference, entry) {
  if (!reference || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(reference)) return null;
  try {
    const url = new URL(reference, `https://workspace.invalid/${entry}`);
    return safePath(decodeURIComponent(url.pathname.slice(1)));
  } catch { return null; }
}
export const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
/** Never mount untrusted content in the parent document. Templates stay inert. */
export function previewDocument(files, entry = 'index.html') {
  entry = safePath(entry);
  if (!Object.hasOwn(files, entry) || !/\.html?$/i.test(entry)) throw new Error('Choose an existing HTML entry file.');
  const template = document.createElement('template'); template.innerHTML = files[entry];
  // Includes nested templates; their eventual clones must not bypass the policy.
  const clean = fragment => {
    for (const nested of fragment.querySelectorAll('template')) clean(nested.content);
    for (const element of fragment.querySelectorAll('base,meta[http-equiv],iframe,frame,frameset,object,embed,portal')) element.remove();
    for (const link of fragment.querySelectorAll('link')) {
      const path = projectPath(link.getAttribute('href'), entry);
      if (link.rel === 'stylesheet' && path && Object.hasOwn(files, path)) {
        const style = document.createElement('style'); style.textContent = files[path]; link.replaceWith(style);
      } else link.remove();
    }
    for (const script of fragment.querySelectorAll('script')) {
      if (!script.hasAttribute('src')) continue;
      const path = projectPath(script.getAttribute('src'), entry);
      if (path && Object.hasOwn(files, path) && /\.[cm]?js$/i.test(path)) {
        script.removeAttribute('src'); script.removeAttribute('integrity'); script.removeAttribute('crossorigin');
        script.textContent = files[path].replace(/<\/script/gi, '<\\/script');
      } else script.remove();
    }
    for (const anchor of fragment.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('#')) anchor.removeAttribute('href');
      anchor.removeAttribute('target'); anchor.removeAttribute('ping'); anchor.removeAttribute('download');
    }
  };
  clean(template.content);
  // Inline scripts are deferred to the end so imported `defer` files see the DOM.
  const scripts = [...template.content.querySelectorAll('script')]; scripts.forEach(script => script.remove());
  const body = template.innerHTML;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}${scripts.map(s => s.outerHTML).join('\n')}</body></html>`;
}
