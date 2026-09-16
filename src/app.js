import { STORAGE_KEY, freshState, hydrate, persistedState, uid, escapeHTML as esc, safePath, putFile, totalBytes, stageChange, applyChange, lineDiff, markdown, zipFiles, contextFor } from './core.js';
import { ANTHROPIC_ORIGIN, endpointOrigin, listModels, runAgent } from './api.js';
import { previewDocument, importLocalFiles, importPublicRepository } from './preview.js';
import { AmbientRenderer } from './gpu.js';
import { icon, mark } from './icons.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const root = $('#app'), modal = $('#modal');
let storageWarning = false;
let state;
try { state = hydrate(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { state = freshState(); storageWarning = true; }
const credentials = { key: '', origin: ANTHROPIC_ORIGIN };
const ui = { draft: '', mode: 'build', selected: [], models: [], sessionFilter: 'all', sessionSearch: '', promptFilter: 'All', fileSearch: '', editorView: 'code', previewSize: 'desktop', previewEntry: 'index.html', activity: [], proposals: [], undo: [], drawer: false, demo: true };
let currentRoute = routeFromHash(), activeRun = null, renderer = null, saveTimer, toastTimer, paintFrame, previousFocus;
const MODES = { build: 'Build', plan: 'Plan', review: 'Review', explain: 'Explain' };
const PROMPTS = [
  { id: 'interface', title: 'Build an interface', category: 'Design', icon: 'layers', description: 'From a rough idea to a polished experience.', text: 'Build a beautiful, accessible landing page for a small independent design studio. Use plain HTML, CSS, and JavaScript. Include responsive layouts, thoughtful typography, and functional navigation. Propose complete files for review.' },
  { id: 'bug', title: 'Find & fix a bug', category: 'Code', icon: 'bug', description: 'A fresh perspective on a stubborn problem.', text: 'Review the attached files for bugs. Explain each finding with file references and propose a minimal, correct fix. Do not claim to run tests.' },
  { id: 'explore', title: 'Explore a codebase', category: 'Understand', icon: 'search', description: 'Get the big picture, without the guesswork.', text: 'Explain the architecture of the attached project, identify its entry points, and describe how the components work together. Note any missing context.' },
  { id: 'refine', title: 'Make it better', category: 'Code', icon: 'spark', description: 'Less friction. Cleaner code. Better details.', text: 'Review the attached code for a focused refactor. Preserve behavior, reduce unnecessary complexity, and improve naming and accessibility. Propose full updated files for review.' },
  { id: 'tests', title: 'Test the edge cases', category: 'Code', icon: 'shield', description: 'Turn assumptions into reproducible checks.', text: 'Write comprehensive tests for the attached code, including edge cases and errors. Explain how to run them. Clearly distinguish proposed tests from tests actually executed.' },
  { id: 'accessible', title: 'Design for everyone', category: 'Design', icon: 'sun', description: 'Make the keyboard and touch experience count.', text: 'Audit the attached HTML and CSS for accessibility. Focus on semantics, keyboard navigation, labels, contrast, motion preferences, and mobile touch targets. Propose fixes.' },
  { id: 'plan', title: 'Plan the next chapter', category: 'Understand', icon: 'branch', description: 'A clear route from where you are to what is next.', text: 'Create a phased implementation plan for this project. Identify requirements, reusable modules, dependencies, risks, and concrete verification gates. Do not edit files yet.' },
  { id: 'docs', title: 'Tell the code’s story', category: 'Understand', icon: 'file', description: 'Documentation your future self will thank you for.', text: 'Write a practical README for the attached project: overview, setup, architecture, usage examples, testing, and honest limitations. Propose README.md for review.' },
];

function routeFromHash() {
  const [page = 'home', id = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { page: ['home','sessions','session','files','library','changes','preview'].includes(page) ? page : 'home', id };
}
function navigate(page, id = '') {
  ui.drawer = false;
  const hash = `#${page}${id ? `/${id}` : ''}`;
  if (location.hash === hash) { currentRoute = { page, id }; render(); }
  else location.hash = hash;
}
function persist() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState(state))); return true; }
  catch { if (!storageWarning) toast('Browser storage is full or unavailable. Export a backup before closing.'); storageWarning = true; return false; }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500); }
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 4500);
}
function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]').content = dark ? '#1d201e' : '#faf9f6';
  renderer?.paint(performance.now());
}
function modelName() { return ui.models.find(m => m.id === state.settings.model)?.name ?? state.settings.model.replace(/^claude-/, 'Claude ').replace(/-/g, ' '); }
function sessionById(id = currentRoute.id) { return state.sessions.find(s => s.id === id); }
function recentSessions() { return state.sessions.filter(s => !s.archived).sort((a,b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated); }
function timeLabel(timestamp) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp); }
function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard.'); }
  catch { openDialog('Copy content', '<p class="small-copy">Clipboard access is unavailable. Select and copy the text below.</p><label class="field"><span>Content</span><textarea id="manual-copy" rows="8">' + esc(text) + '</textarea></label>'); $('#manual-copy').select(); }
}
function toolbarButton(action, name, label, extra = '') { return `<button class="icon-button ${extra}" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}">${icon(name)}</button>`; }
function footer() { return `<footer class="footer"><span>Built for your flow. Not your feed.</span><div class="footer-shortcuts"><button class="text-button" data-action="commands"><kbd>⌘ K</kbd> Find anything</button><button class="text-button" data-action="help"><kbd>?</kbd> Shortcuts</button></div><button class="text-button" data-action="about">Independent redesign ${icon('arrow')}</button></footer>`; }

function sidebar() {
  const nav = [['home','home','Workspace'], ['sessions','chat','Sessions'], ['files','folder','Files'], ['library','library','Prompt library'], ['changes','branch','Changes']];
  return `<button class="scrim" data-action="close-drawer" aria-label="Close navigation" tabindex="-1"></button><aside class="sidebar" id="sidebar" aria-label="Primary navigation"><button class="brand" data-route="home" aria-label="Claude Code Design home">${mark()}<span class="brand-name">claude<span class="code-tag">code</span></span></button>${toolbarButton('close-drawer','close','Close navigation','drawer-close')}<p class="independent-label">AN INDEPENDENT REDESIGN</p><button class="workspace-switch" data-action="project"><span class="workspace-avatar">P</span><span>Personal workspace</span>${icon('down')}</button><button class="new-session" data-action="new">${icon('plus')} New session <kbd>⌘ ⇧ O</kbd></button><nav class="side-nav">${nav.map(([page, glyph, label]) => `<button class="nav-item ${currentRoute.page === page || page === 'sessions' && currentRoute.page === 'session' ? 'active' : ''}" data-route="${page}" ${currentRoute.page === page ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${page === 'sessions' && state.sessions.length ? `<span class="nav-count">${state.sessions.length}</span>` : page === 'changes' && ui.proposals.length ? `<span class="nav-count">${ui.proposals.length}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-recent"><div class="side-caption">Recent sessions <span>↗</span></div>${recentSessions().slice(0, 5).map(s => `<button class="recent-link" data-route="session" data-id="${s.id}">${icon(s.pinned ? 'pin' : 'chat')}<span>${esc(s.title)}</span></button>`).join('') || '<p class="recent-empty">A fresh start.<br>Your next idea belongs here.</p>'}</div><div class="sidebar-note">${icon('spark')}<h3>${credentials.key ? 'Connected. In your control.' : 'Your ideas. Your keys.'}</h3><p>${credentials.key ? 'Files stay local until you choose to share them with your model.' : 'Bring your Claude API key. Keep the workspace, and the control, yours.'}</p><button class="text-button" data-action="connect">${credentials.key ? 'Manage connection' : 'Connect your API'} ${icon('arrow')}</button></div><div class="sidebar-bottom"><span class="status-dot ${navigator.onLine ? '' : 'offline'}"></span><span>${navigator.onLine ? 'Local-first, by design' : 'Offline · local tools ready'}</span>${toolbarButton('theme', document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon','Toggle color theme')}</div></aside>`;
}
function header() {
  const titles = { home: 'Overview', sessions: 'Sessions', session: 'Session', files: 'Files', library: 'Prompt library', changes: 'Review changes', preview: 'Preview' };
  return `<header class="topbar">${toolbarButton('open-drawer','menu','Open navigation','mobile-menu')}<div class="breadcrumb"><span>Personal workspace</span>${icon('chevron')}<span class="crumb-current">${titles[currentRoute.page]}</span></div><div class="header-actions"><button class="status-badge" data-action="demo"><span class="status-dot ${ui.demo ? 'demo' : ''}"></span>${ui.demo ? 'Demo mode' : 'Live API'}</button>${toolbarButton('commands','search','Search commands','header-search')}<span class="divider"></span>${toolbarButton('settings','settings','Workspace settings')}<button class="button primary connect-button" data-action="connect">${icon(credentials.key ? 'check' : 'key')}<span>${credentials.key ? 'Connected' : 'Connect API'}</span></button></div></header>`;
}
function mobileNav() {
  return `<nav class="mobile-nav" aria-label="Mobile navigation">${[['home','home','Workspace'],['sessions','chat','Sessions'],['files','folder','Files'],['library','library','Prompts'],['changes','branch','Changes']].map(([page,glyph,label]) => `<button data-route="${page}" class="${currentRoute.page === page || page === 'sessions' && currentRoute.page === 'session' ? 'active' : ''}">${icon(glyph)}${label}${page === 'changes' && ui.proposals.length ? `<span class="nav-count">${ui.proposals.length}</span>` : ''}</button>`).join('')}</nav>`;
}
function composer(chat = false) {
  const runningHere = Boolean(activeRun && (!chat || activeRun.sessionId === currentRoute.id));
  return `<div class="${chat ? 'chat-composer' : ''}"><form class="composer" id="compose-form"><label class="sr-only" for="prompt">Message Claude</label><textarea id="prompt" rows="2" maxlength="24000" placeholder="${chat ? 'Keep the good ideas going…' : 'What would you like to build?'}" ${runningHere ? 'disabled' : ''}>${esc(ui.draft)}</textarea><div class="context-chips">${ui.selected.map(path => `<button class="context-chip" type="button" data-action="context" title="Review shared context">${esc(path)}</button>`).join('')}</div><div class="composer-toolbar"><button class="context-button" type="button" data-action="context" aria-label="Choose file context">${icon('plus')}<span>${ui.selected.length ? `${ui.selected.length} files` : 'Add context'}</span></button><select class="mode-select" id="mode" aria-label="Assistant mode">${Object.entries(MODES).map(([key,label]) => `<option value="${key}" ${ui.mode === key ? 'selected' : ''}>${label} mode</option>`).join('')}</select><button class="model-select" type="button" data-action="models" title="Choose model"><span>${ui.demo ? 'Local demo' : esc(modelName())}</span>${icon('down')}</button>${runningHere ? `<button class="send-button" type="button" data-action="stop" aria-label="Stop response">${icon('stop')}</button>` : `<button class="send-button" type="submit" aria-label="Send message" ${!ui.draft.trim() || activeRun ? 'disabled' : ''}>${icon('send')}</button>`}</div></form><div class="composer-hint"><span>${icon('shield')}${ui.demo ? 'Demo stays local.' : 'Only selected context is sent.'} <button class="text-button" data-action="${ui.demo ? 'connect' : 'context'}">${ui.demo ? 'Connect for live Claude.' : 'Review context.'}</button></span><span class="keyboard-hint">${chat ? 'Check important outputs.' : 'Enter to send'} <span aria-hidden="true">·</span> Shift + Enter for a new line</span></div></div>`;
}
function homeView() {
  const sessions = recentSessions().slice(0, 2);
  return `<section class="hero"><div class="hero-copy"><div class="eyebrow">${icon('spark')} A space to think. A place to build.</div><h1>Great ideas<br>start with <em>a spark.</em></h1><p>Meet your next coding partner. Go from that first<br>what if to something worth shipping.</p></div><div class="hero-art" aria-label="Animated generative torus"><canvas class="ambient-canvas" id="ambient" aria-hidden="true"></canvas><span class="art-corner tl"></span><span class="art-corner br"></span><span class="render-label"><span class="status-dot"></span><span id="renderer-status">Initializing</span></span><span class="art-label">Human curiosity. Infinite possibility.</span></div></section>${composer()}<section class="quick-section"><div class="section-heading"><h2>A little direction?</h2><button class="text-button" data-route="library">Explore prompts ${icon('arrow')}</button></div><div class="quick-grid">${PROMPTS.slice(0,4).map(p => `<button class="quick-card" data-action="use-prompt" data-id="${p.id}">${icon(p.icon)}${icon('arrow','arrow-icon')}<h3>${p.title}</h3><p>${p.description}</p></button>`).join('')}</div></section><section class="recent-section"><div class="section-heading"><div><h2>${sessions.length ? 'Pick up where you left off' : 'Your next chapter starts here'}</h2><p>${sessions.length ? 'Your conversations, right where you left them.' : 'A small starting point. A world of possibilities.'}</p></div><button class="text-button" data-action="import">${icon('plus')} Import project</button></div>${sessions.length ? `<div class="home-session-list">${sessions.map(s => sessionCard(s)).join('')}</div>` : `<div class="start-grid"><button class="card interactive starter-card" data-route="preview"><div class="starter-illustration">${icon('layers')}</div><div><h3>A little momentum</h3><p>An interactive starter, ready to make your own.</p><span class="badge green" style="margin-top:8px">Included project ${icon('arrow')}</span></div></button><button class="card interactive starter-card bring-project" data-action="import"><div class="card-icon">${icon('folder')}</div><div><h3>Bring your own project</h3><p>Local files or a public GitHub repo.<br>Your context. Your starting point.</p></div>${icon('arrow')}</button></div>`}</section>${footer()}`;
}
function sessionCard(s) {
  const snippet = s.messages.find(m => m.role === 'user')?.text ?? 'A fresh conversation, ready for your next idea.';
  return `<article class="card session-card"><div class="session-card-top"><span class="badge ${s.messages.some(m => m.demo) ? 'orange' : 'green'}">${s.messages.some(m => m.demo) ? 'Demo session' : 'Local session'}</span><span class="badge">${MODES[s.mode] ?? 'Build'}</span></div><button class="session-open" data-route="session" data-id="${s.id}"><h3>${esc(s.title)}</h3><p class="session-snippet">${esc(snippet)}</p></button><div class="card-foot"><time datetime="${new Date(s.updated).toISOString()}">${timeLabel(s.updated)} · ${s.messages.length} messages</time><div class="session-actions">${[['pin',s.pinned ? 'Unpin session' : 'Pin session','pin'],['rename','Rename session','edit'],['archive',s.archived ? 'Unarchive session' : 'Archive session','archive'],['delete-session','Delete session','trash']].map(([action,label,glyph]) => `<button class="icon-button ${action === 'pin' && s.pinned ? 'accent' : ''}" data-action="${action}" data-id="${s.id}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`).join('')}</div></div></article>`;
}
function filteredSessions() {
  return state.sessions.filter(s => ui.sessionFilter === 'archived' ? s.archived : !s.archived && (ui.sessionFilter !== 'pinned' || s.pinned)).filter(s => `${s.title} ${s.messages.map(m => m.text).join(' ')}`.toLowerCase().includes(ui.sessionSearch.toLowerCase())).sort((a,b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
}
function sessionsView() {
  return `<div class="page-heading"><div><div class="eyebrow">The story so far</div><h1>Good ideas have a history.</h1><p>Find a thread, follow a thought, or start something entirely new.</p></div><button class="button primary" data-action="new">${icon('plus')} New session</button></div><label class="search-field">${icon('search')}<input id="session-search" aria-label="Search sessions" placeholder="Search titles and conversations…" value="${esc(ui.sessionSearch)}"></label><div class="filters">${['all','pinned','archived'].map(f => `<button class="filter ${ui.sessionFilter === f ? 'active' : ''}" data-action="filter-session" data-id="${f}" aria-pressed="${ui.sessionFilter === f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div><div id="session-results">${sessionResults()}</div>${footer()}`;
}
function sessionResults() { const sessions = filteredSessions(); return sessions.length ? `<div class="card-grid">${sessions.map(sessionCard).join('')}</div>` : `<div class="empty-state">${icon('chat')}<h2>${ui.sessionSearch ? 'No matching conversations.' : 'Every great project starts somewhere.'}</h2><p>${ui.sessionSearch ? 'Try another phrase or a different filter.' : 'Start a conversation. Your sessions are saved in this browser, with no account required.'}</p><button class="button" data-action="new">Start a session ${icon('arrow')}</button></div>`; }
function libraryView() {
  const prompts = [...PROMPTS, ...state.prompts].filter(p => ui.promptFilter === 'All' || p.category === ui.promptFilter);
  return `<div class="page-heading"><div><div class="eyebrow">A head start, thoughtfully made</div><h1>Skip the blank page.</h1><p>Considered prompts for better questions, clearer code, and bigger possibilities.</p></div><button class="button" data-action="new-prompt">${icon('plus')} Your own prompt</button></div><div class="filters">${['All','Design','Code','Understand','Your prompts'].map(c => `<button class="filter ${ui.promptFilter === c ? 'active' : ''}" data-action="filter-prompt" data-id="${c}" aria-pressed="${ui.promptFilter === c}">${c}</button>`).join('')}</div><div class="card-grid">${prompts.map(p => `<article class="card prompt-card"><div class="session-card-top"><div class="card-icon">${icon(p.icon)}</div><span class="badge">${p.category}</span></div><h3>${esc(p.title)}</h3><p>${esc(p.description ?? p.text.slice(0, 160))}</p><div class="card-foot"><button class="button small" data-action="use-prompt" data-id="${p.id}">Use prompt ${icon('arrow')}</button><div><button class="icon-button" data-action="copy-prompt" data-id="${p.id}" aria-label="Copy prompt">${icon('copy')}</button>${p.category === 'Your prompts' ? `<button class="icon-button" data-action="delete-prompt" data-id="${p.id}" aria-label="Delete prompt">${icon('trash')}</button>` : ''}</div></div></article>`).join('')}</div>${prompts.length ? '' : '<div class="empty-state"><h2>Make it your own.</h2><p>Save the prompts you return to, right here.</p><button class="button" data-action="new-prompt">Create a prompt</button></div>'}${footer()}`;
}
function messageView(message) {
  return `<article class="message ${message.role}" data-message="${message.id}"><div class="message-header">${message.role === 'assistant' ? mark() : '<span class="message-avatar">Y</span>'}<span>${message.role === 'assistant' ? 'Claude' : 'You'}</span>${message.demo ? '<span class="badge orange">Local demo</span>' : ''}<button class="text-button" data-action="copy-message" data-id="${message.id}" aria-label="Copy message">${icon('copy')}</button></div><div class="message-body">${message.role === 'assistant' ? markdown(message.text) : esc(message.text)}</div></article>`;
}
function chatView() {
  const session = sessionById();
  if (!session) return '<div class="empty-state"><h2>This session is not in this browser.</h2><p>Sessions are local, not public share links. Import a backup or create a new conversation.</p><button class="button" data-action="new">New session</button></div>';
  ui.mode = session.mode;
  return `<div class="chat-heading"><div><div class="eyebrow">A conversation with possibility</div><h1>${esc(session.title)}</h1></div><div class="toolbar"><button class="text-button" data-action="rename" data-id="${session.id}">${icon('edit')}<span>Rename</span></button><button class="text-button" data-action="export-session">${icon('download')}<span>Export</span></button></div></div>${ui.demo ? '<div class="notice">' + icon('info') + '<span><strong>Local demonstration.</strong> Responses are scripted examples, not live model output. Connect your API key to work with Claude.</span></div>' : ''}<div id="messages" class="messages">${session.messages.map(messageView).join('') || '<div class="empty-state"><h2>What is on your mind?</h2><p>Add selected files for context, choose a mode, and describe your next step.</p></div>'}</div><div id="activity-slot">${activityView()}</div><div id="pending-slot">${pendingBanner()}</div>${session.usage ? `<div class="usage-line">${session.usage.input.toLocaleString()} input · ${session.usage.output.toLocaleString()} output tokens · ${session.usage.requests} request(s)</div>` : ''}${composer(true)}`;
}
function activityView() { return ui.activity.length && ui.activitySession === currentRoute.id ? `<details class="activity-panel" ${activeRun ? 'open' : ''}><summary>${activeRun ? 'Working' : 'Activity'} · ${esc(ui.activity.at(-1).text)}</summary><div class="activity-list">${ui.activity.map(a => `<div>${icon(a.type === 'warning' ? 'info' : 'check')}<span>${esc(a.text)}</span></div>`).join('')}</div></details>` : ''; }
function pendingBanner() { return ui.proposals.length ? `<div class="pending-banner"><span>${ui.proposals.length} proposed ${ui.proposals.length === 1 ? 'file' : 'files'} · Nothing applied yet.</span><button class="button small" data-route="changes">Review changes ${icon('arrow')}</button></div>` : ''; }
function treeFiles() { return Object.keys(state.files).sort().filter(p => p.toLowerCase().includes(ui.fileSearch.toLowerCase())).map(path => `<button class="tree-file ${state.selectedFile === path ? 'active' : ''}" data-action="select-file" data-id="${esc(path)}" title="${esc(path)}"><span class="file-type ${esc(path.split('.').at(-1))}">${esc(path.split('.').at(-1).slice(0,3))}</span><span>${esc(path)}</span></button>`).join(''); }
function filesView() {
  const path = state.selectedFile, content = state.files[path] ?? '';
  return `<div class="page-heading files-heading"><div><div class="eyebrow">${esc(state.projectName)} · Browser workspace</div><h1>Make it yours.</h1><p>Edit locally. Preview safely. Share context only when you choose.</p></div><div class="toolbar"><button class="button small" data-action="import">${icon('upload')} Import</button><button class="button small" data-action="new-file">${icon('plus')} New file</button><button class="button small" data-action="export-project">${icon('download')} Export ZIP</button></div></div><div class="files-workspace"><aside class="file-tree" aria-label="Project files"><div class="tree-header">${icon('folder')} EXPLORER <span class="muted">${Object.keys(state.files).length}</span></div><label class="search-field tree-search">${icon('search')}<input id="file-search" aria-label="Filter files" placeholder="Find a file…" value="${esc(ui.fileSearch)}"></label><div class="tree-files" id="tree-files">${treeFiles()}</div><div class="tree-bottom">${icon('shield')} ${Math.round(totalBytes(state.files) / 1024)} KB · local storage</div></aside><section class="editor-panel" aria-label="File editor"><div class="editor-toolbar"><span class="editor-name" title="${esc(path)}">${esc(path || 'No file selected')}</span><div class="segmented"><button class="${ui.editorView === 'code' ? 'active' : ''}" data-action="editor-code">${icon('code')} Code</button><button class="${ui.editorView === 'preview' ? 'active' : ''}" data-action="editor-preview">${icon('play')} Preview</button></div>${toolbarButton('undo-file','undo','Undo last approved or file operation')}${toolbarButton('rename-file','edit','Rename file','secondary-editor-action')}${toolbarButton('download-file','download','Download current file','secondary-editor-action')}${toolbarButton('delete-file','trash','Delete current file')}</div>${ui.editorView === 'code' ? `<div class="editor-stage"><pre class="editor-highlight" id="editor-highlight" aria-hidden="true"></pre><textarea id="editor" aria-label="Code editor" wrap="off" autocapitalize="off" autocomplete="off" spellcheck="false" ${!path ? 'disabled' : ''}>${esc(content)}</textarea><pre class="line-numbers" id="line-numbers" aria-hidden="true"></pre></div>` : `<div class="preview-wrap" id="preview-host"></div>`}<div class="editor-status"><span id="save-status">${storageWarning ? 'Storage unavailable — export a backup' : 'Saved in this browser'}</span><span id="cursor-status">${content.split('\n').length} lines · UTF-8</span></div></section></div><div class="notice preview-notice">${icon('shield')}<span>Plain HTML, CSS, and JavaScript previews run in an isolated frame. Network requests, forms, and parent access are blocked. npm, terminal commands, and framework builds are not executed.</span></div>`;
}
function previewView() {
  return `<div class="page-heading"><div><div class="eyebrow">See the possibility</div><h1>A little more real.</h1><p>Your HTML project, in an isolated, interactive preview.</p></div><div class="toolbar"><button class="button small" data-route="files">${icon('code')} Edit files</button><button class="button small" data-action="export-project">${icon('download')} Export ZIP</button></div></div><div class="full-preview"><div class="preview-toolbar"><select id="preview-entry" aria-label="HTML entry file">${Object.keys(state.files).filter(f => /\.html?$/i.test(f)).map(f => `<option ${f === ui.previewEntry ? 'selected' : ''} value="${esc(f)}">${esc(f)}</option>`).join('')}</select><div class="segmented">${[['desktop','desktop'],['tablet','tablet'],['mobile','mobile']].map(([size,glyph]) => `<button class="${ui.previewSize === size ? 'active' : ''}" data-action="preview-size" data-id="${size}" aria-label="${size} preview" aria-pressed="${ui.previewSize === size}">${icon(glyph)}</button>`).join('')}</div>${toolbarButton('refresh-preview','refresh','Reload preview')}</div><div class="preview-wrap" id="preview-host"></div></div><div class="notice preview-notice">${icon('shield')}<span><strong>Sandboxed, not published.</strong> This preview cannot read your API key or workspace storage. Local stylesheet and script references are inlined; external resources and module dependency resolution are not supported.</span></div>`;
}
function changesView() {
  return `<div class="page-heading"><div><div class="eyebrow">You are in the driver’s seat</div><h1>Good changes. Your call.</h1><p>Review every proposal before it becomes part of your workspace.</p></div><button class="button small" data-action="undo-file" ${!ui.undo.length ? 'disabled' : ''}>${icon('undo')} Undo last change</button></div>${ui.proposals.length ? ui.proposals.map(p => `<article class="change-card"><div class="change-head"><div><h3>${esc(p.path)}</h3><p>${esc(p.summary)}</p></div><span class="badge ${p.before === null ? 'green' : 'orange'}">${p.before === null ? 'New file' : 'Modified'}</span></div><pre class="diff" aria-label="Proposed changes">${lineDiff(p.before, p.content).map(line => `<span class="diff-line ${line.kind}">${line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '} ${esc(line.text)}</span>`).join('')}</pre><div class="change-foot"><button class="button small" data-action="reject-change" data-id="${p.id}">${icon('close')} Reject</button><button class="button small primary" data-action="apply-change" data-id="${p.id}">${icon('check')} Approve & apply</button></div></article>`).join('') : `<div class="empty-state">${icon('branch')}<h2>Nothing to review. All clear.</h2><p>Ask Claude to propose a change. Files appear here for approval, never as surprise edits.</p><button class="button" data-action="new">Start a session ${icon('arrow')}</button></div>`}${footer()}`;
}
function render() {
  renderer?.destroy(); renderer = null;
  applyTheme();
  const view = { home: homeView, sessions: sessionsView, session: chatView, library: libraryView, files: filesView, changes: changesView, preview: previewView }[currentRoute.page];
  root.innerHTML = `${sidebar()}<div class="shell">${header()}<main id="main" tabindex="-1" class="main ${['files','preview'].includes(currentRoute.page) ? 'wide' : currentRoute.page === 'session' ? 'chat-main' : ''}">${view()}</main></div>${mobileNav()}`;
  document.body.classList.toggle('sidebar-open', ui.drawer);
  const compact = matchMedia('(max-width: 760px)').matches;
  $('#sidebar').inert = compact && !ui.drawer;
  $('.shell').inert = compact && ui.drawer;
  $('.mobile-nav').inert = compact && ui.drawer;
  if (compact && ui.drawer) { $('#sidebar').setAttribute('role', 'dialog'); $('#sidebar').setAttribute('aria-modal', 'true'); }
  if ($('#ambient')) renderer = new AmbientRenderer($('#ambient'), text => { const label = $('#renderer-status'); if (label) label.textContent = text; });
  if ($('#editor')) initEditor();
  if ($('#preview-host')) mountPreview();
  if (storageWarning && !ui.storageNotified) { ui.storageNotified = true; toast('Storage is unavailable or full. Use Export backup to keep your work.'); }
}

function highlight(code) {
  if (code.length > 100_000) return esc(code);
  const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|class|new|import|export|from|async|await|throw|true|false|null)\b|<\/?[\w-]+|\b\d+(?:\.\d+)?\b/g;
  let result = '', last = 0;
  for (const m of code.matchAll(re)) {
    result += esc(code.slice(last, m.index));
    const type = /^(\/\/|\/\*|<!--)/.test(m[0]) ? 'comment' : /^["'`]/.test(m[0]) ? 'string' : m[0].startsWith('<') ? 'tag' : /^\d/.test(m[0]) ? 'number' : 'keyword';
    result += `<span class="syntax-${type}">${esc(m[0])}</span>`; last = m.index + m[0].length;
  }
  return result + esc(code.slice(last));
}
function syncEditor() {
  const editor = $('#editor'); if (!editor) return;
  $('#editor-highlight').innerHTML = highlight(editor.value) + '\n';
  $('#line-numbers').textContent = Array.from({ length: editor.value.split('\n').length }, (_, i) => i + 1).join('\n');
  $('#editor-highlight').style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  $('#line-numbers').style.transform = `translateY(${-editor.scrollTop}px)`;
  const before = editor.value.slice(0, editor.selectionStart), line = before.split('\n').length, column = before.length - before.lastIndexOf('\n');
  $('#cursor-status').textContent = `Ln ${line}, Col ${column} · UTF-8`;
}
function initEditor() {
  const editor = $('#editor'); syncEditor();
  editor.addEventListener('scroll', () => {
    $('#editor-highlight').style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
    $('#line-numbers').style.transform = `translateY(${-editor.scrollTop}px)`;
  }, { passive: true });
  editor.addEventListener('keyup', syncEditor);
  editor.addEventListener('click', syncEditor);
  editor.addEventListener('keydown', event => {
    if (event.key === 'Tab') { event.preventDefault(); const start = editor.selectionStart, end = editor.selectionEnd; editor.setRangeText('  ', start, end, 'end'); editor.dispatchEvent(new Event('input', { bubbles: true })); }
  });
}
function mountPreview() {
  const host = $('#preview-host'); if (!host) return;
  let entry = currentRoute.page === 'files' && /\.html?$/i.test(state.selectedFile) ? state.selectedFile : ui.previewEntry;
  if (!Object.hasOwn(state.files, entry) || !/\.html?$/i.test(entry)) entry = Object.keys(state.files).find(f => /\.html?$/i.test(f));
  if (!entry) { host.innerHTML = '<div class="empty-state"><h2>Start with an HTML file.</h2><p>Create or import index.html, then come back to see it in action.</p></div>'; return; }
  ui.previewEntry = entry;
  try {
    const html = previewDocument(state.files, entry);
    const frame = document.createElement('iframe'); frame.className = `preview-frame ${ui.previewSize}`; frame.title = `Isolated preview of ${entry}`; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    frame.src = new URL('./preview.html', document.baseURI).href;
    frame.addEventListener('load', () => { frame.contentWindow.postMessage({ type: 'render-preview', html }, '*'); }, { once: true });
    host.replaceChildren(frame);
  } catch (error) { host.textContent = error.message; }
}
function openDialog(title, body, subtitle = '') {
  ui.dialogAbort?.abort(); ui.dialogAbort = null;
  previousFocus = document.activeElement;
  modal.innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${toolbarButton('close-dialog','close','Close dialog')}</div><div class="dialog-body">${body}</div>`;
  if (!modal.open) modal.showModal();
}
function closeDialog() { ui.dialogAbort?.abort(); ui.dialogAbort = null; modal.close(); }
modal.addEventListener('close', () => { if (modal.open) return; ui.dialogAbort?.abort(); ui.dialogAbort = null; modal.innerHTML = ''; ui.importAbort?.abort(); ui.importAbort = null; previousFocus?.isConnected && previousFocus.focus(); });
modal.addEventListener('click', event => { if (event.target === modal) { const r = modal.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });
function formError(message) { const node = $('#dialog-error'); if (node) node.textContent = message; else toast(message); }
function connectDialog() {
  openDialog('A connection. On your terms.', `<form id="connect-form"><div class="notice">${icon('shield')}<span><strong>This is an independent app, not an Anthropic sign-in.</strong> Use an API key, never your Claude password. The key stays in memory and is forgotten when this page reloads.</span></div><label class="field"><span>Anthropic API key</span><input id="api-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(credentials.key)}" required><small>Sent only to the endpoint below. Model requests may incur charges from your API provider.</small></label><label class="field"><span>Connection endpoint</span><select id="endpoint-type"><option value="direct" ${credentials.origin === ANTHROPIC_ORIGIN ? 'selected' : ''}>Direct to Anthropic — api.anthropic.com</option><option value="proxy" ${credentials.origin !== ANTHROPIC_ORIGIN ? 'selected' : ''}>Your trusted Anthropic-compatible proxy</option></select></label><label class="field" id="proxy-field" ${credentials.origin === ANTHROPIC_ORIGIN ? 'hidden' : ''}><span>Trusted proxy origin</span><input id="proxy-origin" type="url" placeholder="https://your-proxy.example" value="${credentials.origin === ANTHROPIC_ORIGIN ? '' : esc(credentials.origin)}"><small>The proxy must support /v1/messages, /v1/models, streaming, and CORS. It will receive your API key and selected context.</small></label><label class="check-label"><input id="key-consent" type="checkbox" required><span>I trust this app and the selected endpoint. I understand browser-held keys can be accessed by extensions or compromised page scripts.</span></label><div id="dialog-error" class="dialog-error" role="alert"></div><div class="dialog-foot">${credentials.key ? '<button class="button danger" type="button" data-action="disconnect">Disconnect</button>' : ''}<button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" id="connect-submit" type="submit">${icon('key')} Connect & test</button></div><p class="small-copy">Connection testing requests your model list; it does not generate text. Use a limited-budget key. For shared production use, put credentials behind your own authenticated backend.</p></form>`, 'Bring your key. Keep control of your context.');
}
function modelsDialog() {
  openDialog('The right partner for the task.', `<form id="models-form"><p class="small-copy">Use a model ID available to your API account. Refresh the list after connecting; no model availability or pricing is assumed.</p><label class="field"><span>Model ID</span><input id="model-id" list="model-list" value="${esc(state.settings.model)}" required spellcheck="false"><datalist id="model-list">${ui.models.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</datalist></label><label class="field"><span>Maximum response tokens</span><input id="max-tokens" type="number" min="256" max="8192" step="1" required value="${state.settings.maxTokens}"><small>Each assistant turn is capped at six API requests. No automatic retries. Costs depend on your provider and model.</small></label><label class="check-label"><input id="demo-mode" type="checkbox" ${ui.demo ? 'checked' : ''}><span><strong>Local demo mode</strong><br>Use scripted examples with no API requests. Turn off for live responses after connecting a key.</span></label><div id="dialog-error" class="dialog-error" role="alert"></div><div class="dialog-foot"><button class="button" type="button" data-action="refresh-models" ${!credentials.key ? 'disabled' : ''}>${icon('refresh')} Refresh models</button><button class="button primary" type="submit">Save model settings</button></div></form>`);
}
function settingsDialog() {
  openDialog('Make yourself at home.', `<form id="settings-form"><label class="field"><span>Appearance</span><select id="theme-select">${['light','dark','system'].map(t => `<option value="${t}" ${state.theme === t ? 'selected' : ''}>${t[0].toUpperCase()+t.slice(1)}</option>`).join('')}</select></label><label class="field"><span>Instructions for your coding partner</span><textarea id="system-instructions" maxlength="8000" rows="4" placeholder="For example: Prefer plain JavaScript, accessible HTML, and small reusable modules.">${esc(state.settings.system)}</textarea><small>These instructions are sent with live API requests.</small></label><div class="notice">${icon('shield')}<span>Sessions, prompts, and files are saved in this browser. API keys are never included in storage or workspace backups. Pending proposals and undo history last for this page session.</span></div><div class="toolbar" style="margin-top:18px"><button class="button small" type="button" data-action="backup">${icon('download')} Export backup</button><button class="button small" type="button" data-action="restore">${icon('upload')} Restore backup</button><button class="button small danger" type="button" data-action="clear-data">Clear local data</button></div><div class="dialog-foot"><button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">Save preferences</button></div></form>`, 'A quieter workspace, tuned to the way you work.');
}
function contextDialog() {
  openDialog('A little context goes a long way.', `<form id="context-form"><div class="notice warning">${icon('info')}<span>Only checked files are sent to the model and available to its read/search tools. Importing or opening a file does not share it. Review for secrets before attaching.</span></div><div class="toolbar" style="margin-top:15px"><button class="text-button" type="button" data-action="select-all-context">Select all</button><button class="text-button" type="button" data-action="clear-context">Clear selection</button></div><div class="context-list">${Object.keys(state.files).sort().map(path => `<label class="context-file"><input type="checkbox" name="context" value="${esc(path)}" ${ui.selected.includes(path) ? 'checked' : ''}>${icon('file')}<span>${esc(path)}</span><small>${(state.files[path].length / 1000).toFixed(1)}k chars</small></label>`).join('') || '<p class="small-copy">No files yet. Import a project from the Files view.</p>'}</div><div id="dialog-error" class="dialog-error" role="alert"></div><div class="dialog-foot"><button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">Use selected context</button></div></form>`);
}
function importDialog() {
  openDialog('Bring your world with you.', `<div class="notice">${icon('folder')}<span>Import text files into your browser workspace. Existing files with the same paths are replaced only after confirmation. Secret files, binaries, and dependency folders are excluded.</span></div><div class="toolbar" style="margin:20px 0"><button class="button" data-action="import-files">${icon('file')} Choose files</button><button class="button" data-action="import-folder">${icon('folder')} Choose folder</button></div><form id="github-form"><label class="field"><span>Or import a public GitHub repository</span><input id="github-url" placeholder="owner/repository" required autocomplete="off"><small>Read-only import, up to 24 text files. Public GitHub rate limits apply. No GitHub token is requested or stored. No commits or deployments are performed from this app.</small></label><div id="dialog-error" class="dialog-error" role="alert"></div><div class="dialog-foot"><button class="button primary" id="github-submit" type="submit">${icon('github')} Import repository</button></div></form><p class="small-copy">Limits: 500 KB per text file, 3 MB per workspace, 120 local files per import. Export ZIP downloads your actual source files.</p>`);
}
function inputDialog(title, label, value, action, id = '') {
  openDialog(title, `<form id="input-form" data-operation="${action}" data-id="${esc(id)}"><label class="field"><span>${esc(label)}</span><input id="dialog-input" value="${esc(value)}" maxlength="220" required></label><div id="dialog-error" class="dialog-error" role="alert"></div><div class="dialog-foot"><button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">Save</button></div></form>`);
  $('#dialog-input').focus(); $('#dialog-input').select();
}
function confirmDialog(title, message, action, id = '') {
  openDialog(title, `<p class="small-copy">${esc(message)}</p><div class="dialog-foot"><button class="button" data-action="close-dialog">Cancel</button><button class="button danger" data-action="${action}" data-id="${esc(id)}">Confirm</button></div>`);
}
function commandDialog() {
  const commands = [ ['new','plus','New session','⌘ ⇧ O'], ['go-files','folder','Open project files',''], ['go-preview','play','Open live preview',''], ['connect','key','Connect your API key',''], ['go-library','library','Explore prompt library',''], ['theme','moon','Toggle color theme',''], ['import','upload','Import a project',''], ['settings','settings','Workspace settings',''], ['backup','download','Export workspace backup',''], ['help','info','Keyboard shortcuts','?'] ];
  openDialog('Find your flow.', `<label class="search-field">${icon('search')}<input id="command-search" placeholder="What would you like to do?" aria-label="Search commands" autocomplete="off"></label><div class="command-list" id="command-list">${commands.map(([action,glyph,label,key]) => `<button class="command" data-action="${action}" data-command="${esc(label.toLowerCase())}">${icon(glyph)}<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`).join('')}</div>`);
  $('#command-search').focus();
}
function helpDialog() {
  openDialog('A few small shortcuts.', `<table class="help-table"><tr><td>Command palette</td><td><kbd>⌘ / Ctrl K</kbd></td></tr><tr><td>New session</td><td><kbd>⌘ / Ctrl ⇧ O</kbd></td></tr><tr><td>Send message</td><td><kbd>Enter</kbd></td></tr><tr><td>New line</td><td><kbd>Shift Enter</kbd></td></tr><tr><td>Save local editor</td><td><kbd>⌘ / Ctrl S</kbd></td></tr><tr><td>Indent code</td><td><kbd>Tab</kbd></td></tr><tr><td>Close a dialog or menu</td><td><kbd>Esc</kbd></td></tr></table><p class="small-copy" style="margin-top:17px">API requests are foreground-only. Switching tabs does not create background agents. Use the Stop button to cancel an active request.</p>`);
}
function aboutDialog() {
  openDialog('A space to build.', `<div style="display:flex;gap:14px;align-items:center;margin:6px 0 22px">${mark()}<div><strong>Claude Code Design</strong><p class="small-copy">Independent redesign · Version 1.0.0</p></div></div><p class="small-copy">Made with plain HTML, CSS, and JavaScript. Progressively enhanced with WebGPU. Designed for a keyboard, a touchscreen, and a little curiosity.</p><div class="notice" style="margin-top:18px">${icon('info')}<span>This is not the official Claude Code product and is not affiliated with or endorsed by Anthropic. It uses the Anthropic Messages API when you connect your own key. It does not include the Claude Code CLI, cloud agents, a terminal, remote git writes, team collaboration, or automatic deployment of generated projects.</span></div><div class="dialog-foot"><a class="button" href="https://github.com/wieslawsoltes/ClaudeCodeDesign" target="_blank" rel="noopener noreferrer">${icon('github')} Source code</a><button class="button primary" data-action="close-dialog">Back to building</button></div>`);
}
function commitFiles(next) {
  const paths = [...new Set([...Object.keys(state.files), ...Object.keys(next)])];
  const changes = paths.filter(path => state.files[path] !== next[path]).map(path => ({ path, before: state.files[path] ?? null, after: next[path] ?? null }));
  if (changes.length) { ui.undo.push(changes); if (ui.undo.length > 12) ui.undo.shift(); }
  state.files = next;
}
function ensureNotRunning() { if (activeRun) { toast('Stop the current response before changing the workspace or connection.'); return false; } return true; }
function newSession() {
  if (!ensureNotRunning()) return;
  if (state.sessions.length >= 100) { toast('Session limit reached. Export and delete an old session first.'); return; }
  const session = { id: uid(), title: 'A new possibility', created: Date.now(), updated: Date.now(), mode: ui.mode, messages: [], pinned: false, archived: false };
  state.sessions.unshift(session); ui.draft = ''; persist(); navigate('session', session.id); setTimeout(() => $('#prompt')?.focus(), 50);
}
function addProposal(proposal) {
  // Keep only the newest unapproved proposal per file; workspace is untouched.
  ui.proposals = ui.proposals.filter(p => p.path !== proposal.path);
  ui.proposals.push(proposal);
  if ($('#pending-slot')) $('#pending-slot').innerHTML = pendingBanner();
}
async function demoResponse(session, message, signal) {
  const mode = session.mode;
  const text = mode === 'plan' ? '## A clear path forward\n\nThis is a **scripted local demonstration**, not a live Claude response.\n\n- Define the behavior and who it serves.\n- Build the smallest useful HTML, CSS, and JavaScript version.\n- Check keyboard navigation, touch targets, and small screens.\n- Review the changes, then export the actual source.\n\nConnect your API key for a plan tailored to your request and selected files.' : mode === 'explain' ? '## A little context\n\nThis is a **scripted local demonstration**, not code analysis by an AI.\n\nThe included starter uses three familiar pieces: `index.html` defines the page, `style.css` sets the visual design, and `app.js` increments a counter when you click the button.\n\nOpen **Files → Preview** to try it. Import your own project and connect an API key for a real explanation of your code.' : '## Let’s make a little progress.\n\nThis is a **scripted local demonstration**, not a live AI response. Your prompt was not sent anywhere.\n\nI’ll show how the review flow works by staging a small example change. Nothing is applied automatically.\n\n- Open **Review changes** below.\n- Inspect the proposed lines and choose **Approve & apply**.\n- Visit **Files → Preview** to see the result, or export the project as a ZIP.\n\nConnect your API key for real, request-specific coding assistance.';
  ui.activity.push({ type: 'demo', text: 'Running a labeled local example · no API request' });
  for (const chunk of text.match(/.{1,20}(?:\s|$)|.{1,20}/gs) ?? []) {
    signal.throwIfAborted(); message.text += chunk; scheduleMessagePaint(message);
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  if (['build','review'].includes(mode)) {
    const path = Object.hasOwn(state.files, 'style.css') ? 'style.css' : 'demo-note.md';
    const content = path === 'style.css' ? state.files[path] + '\n/* Demo proposal: visible keyboard focus and reduced motion. */\n:focus-visible { outline: 3px solid #ad563d; outline-offset: 4px; }\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after { scroll-behavior: auto !important; }\n}\n' : '# Demo review flow\n\nThis file was proposed by the local scripted demonstration. No AI request was made.\n';
    addProposal(stageChange(state.files, path, content, 'Local example: a reviewable change, not AI-generated code.'));
    ui.activity.push({ type: 'demo', text: `Staged ${path} for review · workspace unchanged` });
  }
}
function scheduleMessagePaint(message) {
  cancelAnimationFrame(paintFrame);
  paintFrame = requestAnimationFrame(() => {
    const body = $(`[data-message="${message.id}"] .message-body`);
    if (body) {
      const nearBottom = window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 230;
      body.innerHTML = markdown(message.text) + (activeRun ? '<span class="streaming-dot" aria-label="Response streaming"></span>' : '');
      if (nearBottom) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    }
    if ($('#activity-slot')) $('#activity-slot').innerHTML = activityView();
    saveSoon();
  });
}
async function sendMessage() {
  if (activeRun || !ui.draft.trim()) return;
  if (!ui.demo && !credentials.key) { connectDialog(); return; }
  try { contextFor(state.files, ui.selected); } catch (error) { toast(error.message); return; }
  let session = sessionById();
  if (currentRoute.page !== 'session' || !session) {
    if (state.sessions.length >= 100) { toast('Export and remove an older session before creating another.'); return; }
    session = { id: uid(), title: '', created: Date.now(), updated: Date.now(), mode: ui.mode, messages: [] };
    state.sessions.unshift(session);
  }
  if (session.messages.length >= 118) { toast('This session reached its 120-message limit. Export it and start a new conversation.'); return; }
  const prompt = ui.draft.trim(); ui.draft = ''; session.mode = ui.mode;
  if (!session.messages.length) session.title = prompt.length > 60 ? prompt.slice(0, 57) + '…' : prompt;
  session.updated = Date.now(); session.archived = false;
  const user = { id: uid(), role: 'user', text: prompt, demo: ui.demo }, answer = { id: uid(), role: 'assistant', text: '', demo: ui.demo };
  session.messages.push(user, answer);
  const controller = new AbortController();
  activeRun = { controller, sessionId: session.id }; ui.activity = []; ui.activitySession = session.id;
  currentRoute = { page: 'session', id: session.id };
  history.replaceState(null, '', `#session/${session.id}`); render(); persist();
  const files = { ...state.files }, selected = [...ui.selected], wasDemo = ui.demo;
  try {
    if (wasDemo) await demoResponse(session, answer, controller.signal);
    else await runAgent({ ...credentials, ...state.settings, mode: session.mode, messages: session.messages.filter(m => m !== answer && !m.demo), files, selected, signal: controller.signal,
      onText: text => { answer.text += text; scheduleMessagePaint(answer); },
      onActivity: activity => { ui.activity.push(activity); if ($('#activity-slot')) $('#activity-slot').innerHTML = activityView(); },
      onProposal: addProposal,
      onUsage: usage => { session.usage = usage; },
    });
    if (!answer.text.trim()) answer.text = 'The request completed without a text response. Review the activity log and any proposed changes.';
    ui.activity.push({ type: 'complete', text: wasDemo ? 'Demo complete · no tokens billed by this app' : 'Response complete · review any proposed changes' });
  } catch (error) {
    const stopped = controller.signal.aborted;
    const safeError = String(error.message).split(credentials.key || '\0').join('[redacted]').replace(/sk-ant-[\w-]+/g, '[redacted key]');
    answer.text += `\n\n> ${stopped ? 'Stopped by you. Partial output is preserved.' : `Request interrupted: ${safeError}`}`;
    ui.activity.push({ type: 'warning', text: stopped ? 'Stopped by you' : safeError });
  } finally {
    activeRun = null; session.updated = Date.now(); cancelAnimationFrame(paintFrame); persist();
    if (currentRoute.page === 'session' && currentRoute.id === session.id) render();
    else toast(wasDemo ? 'Your local demo is ready.' : 'Your response is ready.');
  }
}
async function acceptImport(result, name) {
  if (!result.imported.length) { formError('No supported files were imported. ' + result.skipped.slice(0,3).join(' ')); return; }
  ui.pendingImport = { ...result, name };
  const overlap = result.imported.filter(path => Object.hasOwn(state.files, path));
  openDialog('Your project is ready.', `<p class="small-copy">${result.imported.length} text files loaded. ${overlap.length ? `${overlap.length} existing paths will be replaced.` : 'Existing files with different names are kept.'} No files have been shared with an AI.</p>${result.skipped.length ? `<details class="activity-panel"><summary>${result.skipped.length} import notices</summary><div class="dialog-body small-copy">${result.skipped.map(esc).join('<br>')}</div></details>` : ''}<div class="dialog-foot"><button class="button" data-action="close-dialog">Cancel</button><button class="button primary" data-action="confirm-import">Import into workspace</button></div>`);
}

async function handleAction(action, button) {
  if (button?.classList.contains('command') && ['new', 'theme', 'backup'].includes(action)) closeDialog();
  const id = button?.dataset.id;
  switch (action) {
    case 'new': if (modal.open) closeDialog(); newSession(); break;
    case 'connect': if (ensureNotRunning()) connectDialog(); break;
    case 'models': modelsDialog(); break;
    case 'settings': settingsDialog(); break;
    case 'commands': commandDialog(); break;
    case 'help': helpDialog(); break;
    case 'about': aboutDialog(); break;
    case 'context': contextDialog(); break;
    case 'close-dialog': closeDialog(); break;
    case 'theme': state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; persist(); render(); break;
    case 'demo': modelsDialog(); break;
    case 'stop': activeRun?.controller.abort(); break;
    case 'open-drawer':
      ui.drawer = true; document.body.classList.add('sidebar-open'); $('#sidebar').inert = false;
      $('#sidebar').setAttribute('role','dialog'); $('#sidebar').setAttribute('aria-modal','true');
      $('.shell').inert = true; $('.mobile-nav').inert = true; $('.drawer-close').focus(); break;
    case 'close-drawer':
      ui.drawer = false; document.body.classList.remove('sidebar-open');
      $('#sidebar').removeAttribute('role'); $('#sidebar').removeAttribute('aria-modal');
      $('#sidebar').inert = matchMedia('(max-width: 760px)').matches;
      $('.shell').inert = false; $('.mobile-nav').inert = false; $('.mobile-menu')?.focus(); break;
    case 'go-files': closeDialog(); navigate('files'); break;
    case 'go-preview': closeDialog(); navigate('preview'); break;
    case 'go-library': closeDialog(); navigate('library'); break;
    case 'project': inputDialog('A name for your next chapter.', 'Local project name', state.projectName, 'project'); break;
    case 'import': if (ensureNotRunning()) importDialog(); break;
    case 'import-files': $('#file-input').click(); break;
    case 'import-folder': $('#folder-input').click(); break;
    case 'confirm-import': {
      if (!ensureNotRunning() || !ui.pendingImport) break;
      let next = { ...state.files };
      for (const path of ui.pendingImport.imported) next = putFile(next, path, ui.pendingImport.files[path]);
      commitFiles(next); state.selectedFile = ui.pendingImport.imported[0]; state.projectName = ui.pendingImport.name || state.projectName;
      ui.pendingImport = null; ui.selected = []; persist(); closeDialog(); navigate('files'); toast('Project imported locally. No context has been shared.'); break;
    }
    case 'backup': download('code-studio-backup.json', JSON.stringify(persistedState(state), null, 2), 'application/json'); break;
    case 'restore': if (ensureNotRunning()) $('#restore-input').click(); break;
    case 'confirm-restore':
      if (!ensureNotRunning() || !ui.pendingRestore) break;
      state = ui.pendingRestore; ui.pendingRestore = null; ui.proposals = []; ui.undo = []; ui.selected = []; persist(); closeDialog(); navigate('home'); toast('Backup restored. Your API key was not imported.'); break;
    case 'clear-data': if (ensureNotRunning()) confirmDialog('Start with a clean slate?', 'This deletes this app’s saved files, sessions, and prompts in this browser. Export a backup first. Your API connection will be cleared too.', 'confirm-clear'); break;
    case 'confirm-clear':
      if (!ensureNotRunning()) break;
      localStorage.removeItem(STORAGE_KEY); state = freshState(); credentials.key = ''; credentials.origin = ANTHROPIC_ORIGIN; ui.demo = true; ui.selected = []; ui.proposals = []; ui.undo = []; ui.draft = ''; persist(); closeDialog(); navigate('home'); toast('Local data reset to the included starter.'); break;
    case 'disconnect':
      if (!ensureNotRunning()) break;
      credentials.key = ''; credentials.origin = ANTHROPIC_ORIGIN; ui.demo = true; ui.models = []; closeDialog(); render(); toast('Disconnected. The key has been removed from memory.'); break;
    case 'refresh-models': {
      button.disabled = true;
      const controller = new AbortController(); ui.dialogAbort = controller;
      try {
        const models = await listModels({ ...credentials, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        if (controller.signal.aborted || !button.isConnected || !modal.open) return;
        ui.dialogAbort = null; ui.models = models; modelsDialog(); toast(`${ui.models.length} available models loaded.`);
      } catch (error) { if (!controller.signal.aborted && button.isConnected) { formError(error.message.split(credentials.key || '\0').join('[redacted]')); button.disabled = false; } }
      finally { if (ui.dialogAbort === controller) ui.dialogAbort = null; }
      break;
    }
    case 'select-all-context': $$('input[name="context"]', modal).forEach(e => e.checked = true); break;
    case 'clear-context': $$('input[name="context"]', modal).forEach(e => e.checked = false); break;
    case 'filter-session': ui.sessionFilter = id; render(); break;
    case 'filter-prompt': ui.promptFilter = id; render(); break;
    case 'use-prompt': {
      const prompt = [...PROMPTS, ...state.prompts].find(p => p.id === id); if (!prompt || activeRun) break;
      ui.draft = prompt.text; ui.mode = id === 'plan' ? 'plan' : ['bug','accessible'].includes(id) ? 'review' : id === 'explore' ? 'explain' : 'build';
      navigate('home'); setTimeout(() => { $('#prompt')?.focus(); $('#prompt')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60); break;
    }
    case 'copy-prompt': { const p = [...PROMPTS, ...state.prompts].find(p => p.id === id); if (p) await copy(p.text); break; }
    case 'new-prompt':
      openDialog('A prompt worth keeping.', '<form id="new-prompt-form"><label class="field"><span>Prompt title</span><input id="prompt-title" maxlength="80" required placeholder="For example: Review an API"></label><label class="field"><span>Prompt text</span><textarea id="prompt-text" maxlength="6000" rows="6" required placeholder="Describe what you want your coding partner to do…"></textarea></label><div class="dialog-foot"><button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">Save prompt</button></div></form>'); break;
    case 'delete-prompt': confirmDialog('Remove this prompt?', 'The saved prompt will be removed from your library.', 'confirm-delete-prompt', id); break;
    case 'confirm-delete-prompt': state.prompts = state.prompts.filter(p => p.id !== id); persist(); closeDialog(); render(); break;
    case 'pin': { const s = sessionById(id); if (s) { s.pinned = !s.pinned; persist(); render(); } break; }
    case 'archive': { const s = sessionById(id); if (s && activeRun?.sessionId !== id) { s.archived = !s.archived; persist(); render(); } break; }
    case 'rename': { const s = sessionById(id); if (s) inputDialog('Give this idea a name.', 'Session title', s.title, 'rename', id); break; }
    case 'delete-session': if (activeRun?.sessionId !== id) confirmDialog('Delete this conversation?', 'This removes the saved conversation from this browser. Project files are kept. Export the session first to keep a copy.', 'confirm-delete-session', id); break;
    case 'confirm-delete-session':
      if (activeRun?.sessionId === id) break;
      state.sessions = state.sessions.filter(s => s.id !== id); persist(); closeDialog(); if (currentRoute.id === id) navigate('sessions'); else render(); break;
    case 'export-session': {
      const s = sessionById(); if (s) download('session.md', `# ${s.title}\n\nExported from independent Claude Code Design.\n\n${s.messages.map(m => `## ${m.role === 'user' ? 'You' : 'Assistant'}${m.demo ? ' (scripted demo)' : ''}\n\n${m.text}`).join('\n\n---\n\n')}`); break;
    }
    case 'copy-message': { const m = sessionById()?.messages.find(m => m.id === id); if (m) await copy(m.text); break; }
    case 'copy-code': await copy(button.closest('.code-block').querySelector('pre code').textContent); break;
    case 'select-file': state.selectedFile = id; ui.editorView = 'code'; persist(); render(); break;
    case 'new-file': inputDialog('A fresh file. A new possibility.', 'Relative file path', 'untitled.js', 'new-file'); break;
    case 'rename-file': if (state.selectedFile) inputDialog('Rename your file.', 'Relative file path', state.selectedFile, 'rename-file', state.selectedFile); break;
    case 'delete-file': if (state.selectedFile) confirmDialog('Remove this file?', `Remove ${state.selectedFile} from this local workspace? This does not affect any remote repository.`, 'confirm-delete-file', state.selectedFile); break;
    case 'confirm-delete-file':
      if (!Object.hasOwn(state.files, id)) break;
      { const next = { ...state.files }; delete next[id]; commitFiles(next); } state.selectedFile = Object.keys(state.files)[0] ?? ''; ui.selected = ui.selected.filter(p => p !== id); persist(); closeDialog(); render(); break;
    case 'download-file': if (state.selectedFile) download(state.selectedFile.split('/').at(-1), state.files[state.selectedFile]); break;
    case 'export-project': download(`${state.projectName.replace(/[^\w-]/g, '-') || 'project'}.zip`, zipFiles(state.files)); toast('Source ZIP exported. No API key is included.'); break;
    case 'editor-code': ui.editorView = 'code'; render(); break;
    case 'editor-preview': ui.editorView = 'preview'; render(); break;
    case 'preview-size': ui.previewSize = id; render(); break;
    case 'refresh-preview': mountPreview(); break;
    case 'undo-file':
      if (!ui.undo.length) { toast('No approved or file operation to undo. Use Ctrl/Cmd+Z for typing.'); break; }
      { const changes = ui.undo.at(-1);
        if (changes.some(c => (state.files[c.path] ?? null) !== c.after)) { toast('A changed file has newer edits. Undo was blocked to protect your work.'); break; }
        const next = { ...state.files };
        for (const c of changes) { if (c.before === null) delete next[c.path]; else next[c.path] = c.before; }
        if (totalBytes(next) > 3_000_000) { toast('Undo would exceed the workspace size limit.'); break; }
        state.files = next; ui.undo.pop();
      } if (!Object.hasOwn(state.files, state.selectedFile)) state.selectedFile = Object.keys(state.files)[0] ?? ''; ui.selected = ui.selected.filter(p => Object.hasOwn(state.files, p)); persist(); render(); toast('Last file operation undone.'); break;
    case 'apply-change': {
      const p = ui.proposals.find(p => p.id === id); if (!p) break;
      const next = applyChange(state.files, p); commitFiles(next); state.selectedFile = p.path; ui.proposals = ui.proposals.filter(p => p.id !== id); persist(); render(); toast(`${p.path} approved and applied locally.`); break;
    }
    case 'reject-change': ui.proposals = ui.proposals.filter(p => p.id !== id); render(); toast('Proposal rejected. The file was not changed.'); break;
    default: break;
  }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action], [data-route]');
  if (!button || button.disabled) return;
  if (button.dataset.route) { if (modal.open) closeDialog(); navigate(button.dataset.route, button.dataset.id); return; }
  try { await handleAction(button.dataset.action, button); } catch (error) { if (modal.open) formError(error.message); else toast(error.message); }
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'prompt') { ui.draft = target.value; const send = $('#compose-form button[type="submit"]'); if (send) send.disabled = !ui.draft.trim() || Boolean(activeRun); }
  if (target.id === 'session-search') { ui.sessionSearch = target.value; $('#session-results').innerHTML = sessionResults(); }
  if (target.id === 'file-search') { ui.fileSearch = target.value; $('#tree-files').innerHTML = treeFiles(); }
  if (target.id === 'command-search') { $$('.command').forEach(b => { b.hidden = !b.dataset.command.includes(target.value.toLowerCase()); }); }
  if (target.id === 'editor') {
    try { state.files = putFile(state.files, state.selectedFile, target.value); $('#save-status').textContent = 'Saving locally…'; clearTimeout(ui.editorPaint); ui.editorPaint = setTimeout(() => { syncEditor(); const saved = persist(); const status = $('#save-status'); if (status) status.textContent = saved ? 'Saved in this browser' : 'Not saved — export a backup'; }, 150); }
    catch (error) { target.value = state.files[state.selectedFile]; toast(error.message); }
  }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'mode') { ui.mode = target.value; const s = sessionById(); if (s && currentRoute.page === 'session') { s.mode = ui.mode; persist(); } }
  if (target.id === 'endpoint-type') $('#proxy-field').hidden = target.value !== 'proxy';
  if (target.id === 'preview-entry') { ui.previewEntry = target.value; mountPreview(); }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === 'compose-form') { await sendMessage(); return; }
    if (form.id === 'connect-form') {
      if (!ensureNotRunning()) return;
      const key = $('#api-key').value.trim(), origin = endpointOrigin($('#endpoint-type').value === 'proxy' ? $('#proxy-origin').value : ANTHROPIC_ORIGIN);
      if (!$('#key-consent').checked) throw new Error('Review and accept the browser key disclosure first.');
      if (!key) throw new Error('Enter an API key.');
      const button = $('#connect-submit'); button.disabled = true; button.textContent = 'Testing connection…';
      const controller = new AbortController(); ui.dialogAbort = controller;
      try {
        const models = await listModels({ key, origin, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        if (controller.signal.aborted || !form.isConnected || !modal.open) return;
        ui.dialogAbort = null;
        credentials.key = key; credentials.origin = origin; ui.models = models; ui.demo = false;
        if (models.length && !models.some(m => m.id === state.settings.model)) state.settings.model = models[0].id;
        persist(); closeDialog(); render(); toast('Connected. Your key is held only in memory.');
      } catch (error) { if (controller.signal.aborted || !form.isConnected) return; if (button.isConnected) { button.disabled = false; button.textContent = 'Connect & test'; } throw new Error(error.message.split(key).join('[redacted]')); }
      finally { if (ui.dialogAbort === controller) ui.dialogAbort = null; }
    }
    if (form.id === 'models-form') {
      if (!ensureNotRunning()) return;
      const demo = $('#demo-mode').checked;
      if (!demo && !credentials.key) throw new Error('Connect an API key before turning off the local demo.');
      state.settings.model = $('#model-id').value.trim(); state.settings.maxTokens = Number($('#max-tokens').value); ui.demo = demo;
      if (!state.settings.model || !Number.isInteger(state.settings.maxTokens) || state.settings.maxTokens < 256 || state.settings.maxTokens > 8192) throw new Error('Use a model ID and a token limit from 256 to 8192.');
      persist(); closeDialog(); render();
    }
    if (form.id === 'settings-form') { state.theme = $('#theme-select').value; state.settings.system = $('#system-instructions').value.trim(); persist(); closeDialog(); render(); toast('Preferences saved.'); }
    if (form.id === 'context-form') { const selected = $$('input[name="context"]:checked', modal).map(e => e.value); contextFor(state.files, selected); ui.selected = selected; closeDialog(); render(); toast(`${selected.length} ${selected.length === 1 ? 'file' : 'files'} selected for your next request.`); }
    if (form.id === 'input-form') {
      const value = $('#dialog-input').value.trim(), operation = form.dataset.operation, id = form.dataset.id;
      if (!value) throw new Error('Enter a value.');
      if (operation === 'project') state.projectName = value.slice(0,70);
      if (operation === 'rename') { const s = sessionById(id); if (s) s.title = value.slice(0,100); }
      if (operation === 'new-file' || operation === 'rename-file') {
        const path = safePath(value);
        if (Object.hasOwn(state.files, path) && path !== id) throw new Error('A file with that path already exists.');
        const next = putFile(state.files, path, operation === 'new-file' ? '' : state.files[id]);
        if (operation === 'rename-file' && id !== path) delete next[id];
        commitFiles(next); state.selectedFile = path; ui.selected = ui.selected.filter(p => p !== id); ui.editorView = 'code';
      }
      persist(); closeDialog(); if (operation.includes('file')) navigate('files'); else render();
    }
    if (form.id === 'new-prompt-form') {
      if (state.prompts.length >= 50) throw new Error('Remove an old prompt before adding another (50 maximum).');
      const title = $('#prompt-title').value.trim(), text = $('#prompt-text').value.trim(); if (!title || !text) throw new Error('Enter a title and prompt text.');
      state.prompts.push({ id: uid(), title, text, category: 'Your prompts', icon: 'spark' }); persist(); closeDialog(); ui.promptFilter = 'Your prompts'; navigate('library');
    }
    if (form.id === 'github-form') {
      if (!ensureNotRunning()) return;
      const value = $('#github-url').value, button = $('#github-submit'); button.disabled = true; button.textContent = 'Importing…';
      const controller = new AbortController(); ui.importAbort = controller;
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try { const result = await importPublicRepository(value, { signal: controller.signal, onProgress: path => { if ($('#dialog-error')) $('#dialog-error').textContent = `Reading ${path}…`; } }); clearTimeout(timeout); ui.importAbort = null; await acceptImport(result, result.name); }
      catch (error) { clearTimeout(timeout); ui.importAbort = null; if (button.isConnected) { button.disabled = false; button.textContent = 'Import repository'; } throw error; }
    }
  } catch (error) { formError(error.name === 'AbortError' || error.name === 'TimeoutError' ? 'The request was cancelled or timed out. Nothing was automatically retried.' : error.message); }
});
for (const id of ['file-input','folder-input']) {
  $('#' + id).addEventListener('change', async event => {
    const list = event.target.files; if (!list?.length || !ensureNotRunning()) return;
    const name = list[0].webkitRelativePath?.split('/')[0];
    try { await acceptImport(await importLocalFiles(list, {}), name); } catch (error) { toast(error.message); }
    event.target.value = '';
  });
}
$('#restore-input').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file || !ensureNotRunning()) return;
  try {
    if (file.size > 12_000_000) throw new Error('Backup is too large (12 MB maximum).');
    const input = JSON.parse(await file.text());
    if (!input || input.version !== 1 || !input.files || typeof input.files !== 'object' || Array.isArray(input.files)) throw new Error('Choose a version 1 Claude Code Design workspace backup.');
    ui.pendingRestore = hydrate(input);
    confirmDialog('Restore this workspace?', `Replace this browser’s project, sessions, and prompts with ${ui.pendingRestore.projectName}? Invalid or unsafe backup records are excluded. Export your current workspace first. API credentials are never restored.`, 'confirm-restore');
  } catch (error) { toast(error.message); }
  finally { event.target.value = ''; }
});
document.addEventListener('keydown', event => {
  const editing = event.target.matches('input, textarea, [contenteditable="true"]');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); commandDialog(); return; }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); if (modal.open) closeDialog(); newSession(); return; }
  if (event.key === 'Escape' && ui.drawer && !modal.open) { event.preventDefault(); handleAction('close-drawer'); return; }
  if (event.key === 'Tab' && ui.drawer && !modal.open) {
    const items = $$('button:not(:disabled), a[href], input, select, textarea', $('#sidebar')).filter(el => el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (event.key === 'Enter' && event.target.id === 'prompt' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); }
  if (event.key === '?' && !editing && !modal.open) { event.preventDefault(); helpDialog(); }
});
window.addEventListener('hashchange', () => {
  currentRoute = routeFromHash(); ui.drawer = false; render();
  $('#main')?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' });
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.theme === 'system') applyTheme(); });
matchMedia('(max-width: 760px)').addEventListener('change', () => { ui.drawer = false; render(); });
for (const name of ['online', 'offline']) window.addEventListener(name, () => {
  const label = $('.sidebar-bottom > span:nth-child(2)');
  if (label) label.textContent = navigator.onLine ? 'Local-first, by design' : 'Offline · local tools ready';
  $('.sidebar-bottom .status-dot')?.classList.toggle('offline', !navigator.onLine);
  toast(navigator.onLine ? 'Back online. Nothing was sent automatically.' : 'You are offline. Local editing and the demo still work.');
});
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) toast('This workspace changed in another tab. Export a backup before reloading; changes are not automatically merged.'); });
window.addEventListener('pagehide', () => { persist(); activeRun?.controller.abort(); renderer?.destroy(); });
window.addEventListener('pageshow', event => { if (event.persisted) render(); });
applyTheme(); render();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* Online operation does not require offline caching. */ });
