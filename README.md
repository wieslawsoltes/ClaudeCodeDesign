# Claude Code Design

**A space to think. A place to build.**

An independent Claude Code-inspired interface redesign and working, local-first coding workspace. Built with plain HTML, CSS, JavaScript modules, and a real WebGPU particle renderer. No frontend framework, CDN, build-time API key, or runtime package dependency.

**This is not the official Claude Code product. It is not affiliated with or endorsed by Anthropic.** It connects to the Anthropic Messages API with a key you provide; it does not embed the Claude Code CLI.

[Pages deployment](https://wieslawsoltes.github.io/ClaudeCodeDesign/) · [Build and browser checks](https://github.com/wieslawsoltes/ClaudeCodeDesign/actions) · [Architecture](docs/ARCHITECTURE.md) · [Security and boundaries](docs/SECURITY.md) · [Verification](docs/VERIFICATION.md)

## The experience

A warm paper-and-terracotta workspace, editorial typography, an animated generative torus, light/dark/system themes, touch-friendly mobile navigation, a desktop sidebar, keyboard commands, and reduced-motion support. The homepage is a starting point for real work, not a disconnected marketing mockup.

| Workspace | Working capabilities |
| --- | --- |
| Conversations | Live streaming Claude responses, stop/cancel, selected-file context, model discovery, manual model IDs, response limits, real API token usage, Build/Plan/Review/Explain modes |
| Coding partner | Structured list/read/search/propose tools; selected-file access only; a six-request ceiling; a visible activity log; no hidden retries |
| Changes | Per-file proposals, line diffs, explicit approve/reject, stale-base conflict checks, guarded undo |
| Editor | File creation, editing, renaming, deletion, syntax highlighting, line numbers, filtering, local persistence, individual downloads |
| Preview | Interactive plain HTML/CSS/JavaScript in an opaque-origin sandbox, local CSS/script inlining, desktop/tablet/mobile widths |
| Projects | Local files/folders, read-only public GitHub import, real source ZIP export, JSON workspace backup and restore |
| Organization | Searchable sessions, pin/archive/rename/delete, built-in prompt library, custom prompts, command palette |
| Local use | Clearly labeled scripted demo, an included interactive starter, shell-only service-worker offline caching |

## Run locally

Node.js 20 or newer is required for the development scripts. There are no npm dependencies to install.

```sh
npm start
# Open http://localhost:4173
```

Or build a clean static directory:

```sh
npm run check
npm test
npm run build
SERVE_DIR=dist npm start
```

Serve the site over HTTP on localhost or HTTPS in production. Do not open `index.html` using `file://`; module imports, storage, and WebGPU require a suitable browser origin. `dist/` can be served at a root or repository subpath without changing asset URLs.

## Connect an API key

Open **Connect API**, enter your Anthropic API key, review the endpoint and browser-key disclosure, and choose **Connect & test**. This requests `/v1/models`; it does not generate text. The app then selects a model available to your account. Model availability and billing are controlled by your provider.

Choose **Add context** to explicitly attach files, then submit a prompt. Imported files are not automatically shared. Proposed changes appear in **Changes**, where you can inspect the diff and approve or reject each one. Open **Files → Preview** to try the result, then **Export ZIP** to download the actual files.

Keys stay in page memory and are forgotten on reload or disconnect. They are not saved in browser storage, backups, a service worker, or the repository. Browser extensions and compromised same-origin scripts can still access browser-held credentials. Use a low-budget development key and a trusted browser; deploy behind an authenticated server-side gateway for shared or production use. Never put a key into a chat message, source file, repository secret intended for the frontend, or URL.

A custom **Anthropic-compatible proxy origin** is supported. It must implement `GET /v1/models`, `POST /v1/messages`, Anthropic SSE/tool semantics, and CORS. The app sends `x-api-key` to the explicitly selected origin. Only HTTPS origins and HTTP loopback origins are accepted. This is not a universal OpenAI-compatible provider adapter.

## GitHub Pages

The repository workflow verifies syntax, unit tests, and browser acceptance checks before uploading the static site and attempting deployment. No Anthropic key or secret is needed for build, tests, or publication. Tests use fake credentials and mocked provider responses.

The **Verify and publish** workflow tests the actual static build at a repository subpath and deploys only after checks pass. The deployment job then runs a smoke test against the public Pages URL. The workflow result and `published-site-qa` artifact are the publication evidence. On a newly forked repository, enable **Settings → Pages → Source → GitHub Actions** before running the workflow. Never add an API key to frontend build variables or repository files.

## Tests

```sh
npm run check
npm test
npm run build
python -m pip install playwright==1.57.0
python -m playwright install chromium
python tests/browser.py
```

Start `SERVE_DIR=dist npm start` in another terminal before running the browser suite. The suite accepts an explicit deployment URL:

```sh
python tests/browser.py --url http://localhost:4173/ --output qa-results
python tests/browser.py --url https://wieslawsoltes.github.io/ClaudeCodeDesign/ --smoke --output qa-results/live
```

The 68 dependency-free unit tests cover data-model, import, Markdown, ZIP, API streaming/tool boundaries, offline route normalization, and project-scoped cache cleanup. Browser checks cover real module loading, responsive layouts at 320/390/768/1440 pixels, touch navigation, keyboard dialogs, local editing and persistence, the demo review/undo flow, prompt creation, mocked API streaming and tool calls, selected context, credential lifecycle, workspace backups, interactive sandbox isolation, and offline reload/edit persistence with the test origin stopped. Browser reports and screenshots are written to the requested output directory. No paid provider key is used by CI. See [Verification](docs/VERIFICATION.md) for the evidence boundaries.

## Deliberate boundaries

This is a browser coding workspace, not full Claude Code CLI parity. It has no shell, npm execution, local OS agent, private GitHub authentication, git writes, background cloud agents, multiplayer collaboration, or deployment of generated projects. Public GitHub import is read-only. The site's own GitHub Pages workflow is separate from app capabilities.

Previews support plain HTML/CSS/JavaScript, not framework compilation, arbitrary ES-module dependency resolution, external resources, or a general-purpose secure compute service. Generated code can consume CPU; review it before running. File limits are 500 KB per file, 3 MB per workspace, 180,000 context characters, 120 local files per import, and 24 files per public-repository import. See the security document for details.

## License

MIT for this repository's original implementation. Product names belong to their respective owners. No Anthropic source code, proprietary font, or official identity asset is included.
