/** Dependency-free, bounded workspace data model. Never persist credentials. */
export const STORAGE_KEY = 'claude-code-design:v1';
export const LIMITS = Object.freeze({ fileBytes: 500_000, workspaceBytes: 3_000_000, files: 120, contextChars: 180_000 });
const bytes = value => new TextEncoder().encode(value).length;
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const blocked = /^(?:\.git|\.svn|node_modules|\.aws|\.ssh|\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|__proto__|prototype|constructor)$/i;
export function safePath(value) {
  if (typeof value !== 'string') throw new TypeError('File path must be text.');
  const path = value.trim().replace(/\\/g, '/');
  if (!path || path.length > 240 || path.startsWith('/') || /[\x00-\x1f\x7f:%?#<>|]/.test(path)) throw new Error('Use a relative, readable file path without control characters.');
  const parts = path.split('/').filter(p => p && p !== '.');
  if (!parts.length || parts.length > 20 || parts.some(p => p === '..' || blocked.test(p)) || /\.(?:pem|key|p12|pfx|keystore)$/i.test(path)) throw new Error('Unsafe path, secret file, or dependency folder is excluded.');
  return parts.join('/');
}
export function totalBytes(files) { return Object.values(files).reduce((sum, value) => sum + bytes(value), 0); }
export function putFile(files, path, content) {
  path = safePath(path);
  if (typeof content !== 'string' || content.includes('\0')) throw new TypeError('Only text files without NUL bytes are supported.');
  if (bytes(content) > LIMITS.fileBytes) throw new Error('A file cannot exceed 500 KB (UTF-8).');
  const next = { ...files, [path]: content };
  if (Object.keys(next).length > LIMITS.files || totalBytes(next) > LIMITS.workspaceBytes) throw new Error('Workspace limit: 120 files and 3 MB (UTF-8).');
  return next;
}
export function contextFor(files, selected = []) {
  if (!Array.isArray(selected)) throw new TypeError('Select context as a list of file paths.');
  let length = 0;
  return [...new Set(selected)].map(value => {
    const path = safePath(value);
    if (!Object.hasOwn(files, path)) throw new Error(`Context file is missing: ${path}`);
    const content = files[path]; length += content.length;
    if (length > LIMITS.contextChars) throw new Error('Selected context exceeds 180,000 characters. Choose fewer files.');
    return { path, content };
  });
}
export function stageChange(files, path, content, summary = '') {
  path = safePath(path); putFile(files, path, content);
  return { id: uid(), path, content, before: Object.hasOwn(files, path) ? files[path] : null, summary: String(summary).slice(0, 500) };
}
export function applyChange(files, proposal) {
  if ((Object.hasOwn(files, proposal.path) ? files[proposal.path] : null) !== proposal.before) throw new Error('This proposal has a stale base. The file changed after it was proposed; ask for an updated change.');
  return putFile(files, proposal.path, proposal.content);
}
export function lineDiff(before, after) {
  if (before === after) return String(after ?? '').split('\n').map(text => ({ kind: 'same', text }));
  const a = before === null ? [] : String(before).split('\n'), b = String(after ?? '').split('\n');
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end), y = b.slice(start, b.length - end);
  const output = a.slice(0, start).map(text => ({ kind: 'same', text }));
  if (x.length * y.length > 500_000) {
    for (const text of x) output.push({ kind: 'remove', text });
    for (const text of y) output.push({ kind: 'add', text });
  } else {
    const rows = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) rows[i][j] = x[i] === y[j] ? 1 + rows[i + 1][j + 1] : Math.max(rows[i + 1][j], rows[i][j + 1]);
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { output.push({ kind: 'same', text: x[i++] }); j++; }
      else if (i < x.length && (j === y.length || rows[i + 1][j] >= rows[i][j + 1])) output.push({ kind: 'remove', text: x[i++] });
      else output.push({ kind: 'add', text: y[j++] });
    }
  }
  return output.concat(end ? a.slice(-end).map(text => ({ kind: 'same', text })) : []);
}
/** Escaped Markdown subset. Deliberately no images, HTML, or active model links. */
export function markdown(value) {
  const inline = text => text.split(/(`[^`]*`)/g).map(part => part.startsWith('`') ? `<code>${escapeHTML(part.slice(1, -1))}</code>` : escapeHTML(part).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')).join('');
  const lines = String(value ?? '').replace(/\r\n/g, '\n').split('\n');
  const result = []; let paragraph = [], list = false, code = null, language = '';
  const flush = () => { if (paragraph.length) { result.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; } if (list) { result.push('</ul>'); list = false; } };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (code !== null) { result.push(`<div class="code-block"><div class="code-language">${escapeHTML(language || 'code')}</div><pre><code>${escapeHTML(code.join('\n'))}</code></pre></div>`); code = null; }
      else { flush(); language = line.trim().slice(3).replace(/[^\w+-]/g, '').slice(0, 25); code = []; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line), item = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (heading) { flush(); const level = heading[1].length + 1; result.push(`<h${level}>${inline(heading[2])}</h${level}>`); }
    else if (item) { if (paragraph.length) { result.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; } if (!list) { result.push('<ul>'); list = true; } result.push(`<li>${inline(item[1])}</li>`); }
    else if (/^>\s?/.test(line)) { flush(); result.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); }
    else if (!line.trim()) flush();
    else { if (list) { result.push('</ul>'); list = false; } paragraph.push(line); }
  }
  if (code !== null) result.push(`<div class="code-block"><div class="code-language">${escapeHTML(language || 'code')}</div><pre><code>${escapeHTML(code.join('\n'))}</code></pre></div>`);
  flush(); return result.join('\n');
}
export const STARTER_FILES = Object.freeze({
  'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>A little momentum</title>\n  <link rel="stylesheet" href="style.css">\n  <script src="app.js" defer></script>\n</head>\n<body>\n  <main>\n    <div class="spark" aria-hidden="true">✳</div>\n    <p class="eyebrow">ONE SMALL STEP. INFINITE POSSIBILITY.</p>\n    <h1>Make a little<br><em>momentum.</em></h1>\n    <p>Your next great idea starts with a single step.<br>This is yours. Make it count.</p>\n    <button id="step">Take the first step <span aria-hidden="true">↗</span></button>\n    <p id="count" role="status" aria-live="polite">Every beginning is a possibility.</p>\n    <footer>Built by you. One step at a time.</footer>\n  </main>\n</body>\n</html>\n',
  'style.css': '* { box-sizing: border-box; }\nbody { margin: 0; background: #f6f3eb; color: #30352f; font: 15px/1.7 system-ui, sans-serif; }\nmain { max-width: 720px; margin: auto; padding: 60px 24px; text-align: center; }\n.spark { font-size: 56px; color: #b85439; }\n.eyebrow { font-size: 10px; letter-spacing: .2em; margin: 18px 0 30px; }\nh1 { font: 64px/.98 Georgia, serif; letter-spacing: -3px; margin: 0 0 26px; }\nem { color: #b85439; font-weight: normal; }\np { color: #74786e; }\nbutton { background: #30352f; color: #fff; border: 0; padding: 15px 24px; border-radius: 7px; cursor: pointer; font: inherit; margin-top: 18px; min-height: 48px; }\nbutton:hover { background: #b85439; }\nbutton span { margin-left: 30px; }\n#count { font-size: 12px; min-height: 2em; }\nfooter { border-top: 1px solid #deded3; margin-top: 48px; padding-top: 24px; font-size: 11px; color: #83877c; }\n@media (max-width: 420px) { h1 { font-size: 48px; } main { padding-top: 32px; } }\n',
  'app.js': "const button = document.getElementById('step');\nconst count = document.getElementById('count');\nlet steps = 0;\nbutton.addEventListener('click', () => {\n  steps++;\n  count.textContent = `${steps} ${steps === 1 ? 'step' : 'steps'} forward. Keep going.`;\n  button.textContent = 'Take another step ↗';\n});\n",
});
export function freshState() { return { version: 1, theme: 'light', projectName: 'A little momentum', files: { ...STARTER_FILES }, selectedFile: 'index.html', sessions: [], prompts: [], settings: { model: 'auto', maxTokens: 4096, system: '' } }; }
const text = (value, limit, fallback = '') => typeof value === 'string' ? value.slice(0, limit) : fallback;
const date = value => Number.isFinite(value) && value >= 0 && value <= 8e15 ? value : Date.now();
const id = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value) ? value : uid();
export function hydrate(input) {
  const state = freshState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return state;
  state.theme = ['light', 'dark', 'system'].includes(input.theme) ? input.theme : 'light';
  state.projectName = text(input.projectName, 70, state.projectName);
  if (input.files && typeof input.files === 'object' && !Array.isArray(input.files)) {
    state.files = {};
    for (const [path, content] of Object.entries(input.files).slice(0, 120)) { try { state.files = putFile(state.files, path, content); } catch { /* Untrusted backup records are excluded. */ } }
  }
  state.selectedFile = Object.hasOwn(state.files, input.selectedFile) ? input.selectedFile : Object.keys(state.files)[0] ?? '';
  const settings = input.settings ?? {};
  state.settings = { model: text(settings.model, 160, 'auto'), maxTokens: Number.isInteger(settings.maxTokens) && settings.maxTokens >= 256 && settings.maxTokens <= 8192 ? settings.maxTokens : 4096, system: text(settings.system, 8000) };
  const seen = new Set(); let remaining = 2_000_000;
  state.sessions = (Array.isArray(input.sessions) ? input.sessions : []).slice(0, 100).filter(s => s && typeof s === 'object').map(s => {
    let sid = id(s.id); if (seen.has(sid)) sid = uid(); seen.add(sid);
    const mids = new Set();
    const messages = (Array.isArray(s.messages) ? s.messages : []).slice(0, 120).filter(m => m && ['user', 'assistant'].includes(m.role)).map(m => {
      let mid = id(m.id); if (mids.has(mid)) mid = uid(); mids.add(mid);
      const value = text(m.text, Math.max(0, Math.min(100_000, remaining))); remaining -= value.length;
      return { id: mid, role: m.role, text: value, demo: m.demo === true };
    });
    return { id: sid, title: text(s.title, 100, 'Untitled session'), created: date(s.created), updated: date(s.updated), mode: ['build', 'plan', 'review', 'explain'].includes(s.mode) ? s.mode : 'build', messages, pinned: s.pinned === true, archived: s.archived === true };
  });
  state.prompts = (Array.isArray(input.prompts) ? input.prompts : []).slice(0, 50).filter(p => p && typeof p.text === 'string' && typeof p.title === 'string').map(p => ({ id: id(p.id), title: text(p.title, 80), text: text(p.text, 6000), category: 'Your prompts', icon: 'spark' }));
  return state;
}
/** A strict schema allowlist, used for every storage write and backup. */
export const persistedState = state => hydrate(state);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export function crc32(data) { let crc = 0xffffffff; for (const value of data) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
/** Standards-compliant UTF-8 STORE ZIP; no runtime dependency or remote upload. */
export function zipFiles(files) {
  const local = [], central = []; let offset = 0, count = 0;
  for (const [path, value] of Object.entries(files)) {
    const name = new TextEncoder().encode(safePath(path)), data = new TextEncoder().encode(value), crc = crc32(data);
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); header.set(name, 30);
    const record = new Uint8Array(46 + name.length), r = new DataView(record.buffer);
    r.setUint32(0, 0x02014b50, true); r.setUint16(4, 20, true); r.setUint16(6, 20, true); r.setUint16(8, 0x800, true); r.setUint32(16, crc, true); r.setUint32(20, data.length, true); r.setUint32(24, data.length, true); r.setUint16(28, name.length, true); r.setUint32(42, offset, true); record.set(name, 46);
    local.push(header, data); central.push(record); offset += header.length + data.length; count++;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, central.reduce((sum, item) => sum + item.length, 0), true); e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
