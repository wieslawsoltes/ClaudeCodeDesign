# Verification

## Reproducible gates

- `npm run check`: JavaScript syntax, preview bootstrap consistency, and entry metadata.
- `npm test`: 63 dependency-free Node tests, including UTF-8 and storage bounds, traversal/secret filenames, prototype safety, selected-only context, stale proposals, bounded diffs, safe Markdown, sanitized backups, independent ZIP CRC conventions, imports, origin/header handling, paginated model discovery, byte-split Unicode SSE, stalled-stream abort, protocol failures, tool authorization, and the six-request cap.
- `npm run build`: static `dist/` with no build-time credential or external runtime package.
- `python tests/browser.py --url URL --output qa-results`: real HTTP browser acceptance and screenshots. The CI server mounts the build at `/ClaudeCodeDesign/` to exercise repository-relative paths.
- `python tests/browser.py --url PAGES_URL --smoke --output qa-results/live`: public-site smoke after deployment.

## Browser evidence

The suite checks desktop and 320/390/768-pixel touch layouts, visible renderer pixels, page navigation, dark mode, keyboard commands, mobile drawer focus isolation, file editing/reload, downloadable ZIP content using Python's independent ZIP reader, demo proposal approval/undo, custom prompts, a mocked Anthropic model-list and streamed tool roundtrip, explicit context selection, no credential persistence, backup/restore, cancellation preventing late credential writes, interactive preview, and sandbox parent/storage/network rejection.

Mocked provider tests prevent service-worker registration in their top-level test document only. They do not relax production CSP or preview sandboxing. Service-worker behavior is tested separately by `tests/offline.py`: start a dedicated origin serving the actual production build at the project subpath, allow the real worker to install, stop that child server, prove an uncached request fails, then reload the application and persist an edit across another offline reload. No public server is stopped. This tests a real origin outage rather than relying on browser network emulation.

Every scenario writes its outcome into `browser-results.json`. Screenshots are uploaded with the report. A failure is not silently converted into a skip. Published-site smoke is a smaller subset and does not repeat full editor or origin-outage tests. Renderer mode is recorded; a successful Canvas fallback is not represented as WebGPU qualification. The visible-pixel check prevents a successfully initialized but blank graphics surface from passing.

## Rendering qualification

Chromium CI uses SwiftShader software WebGPU with Vulkan presentation enabled. A dedicated diagnostic run confirmed that the actual WGSL shader compiles without messages or validation errors and produces nontransparent pixels on GPU readback. Its composited screenshot and animation also produced visible colored pixels. The `--disable-vulkan-surface` flag must not be added: it produced an invisible composited canvas in this headless runner despite correct GPU readback. The permanent acceptance suite verifies visible output. WebKit can exercise the explicitly labeled Canvas fallback.

## Evidence boundaries

The local managed browser does not permit HTTP navigation; local in-memory visual inspection alone does not verify origin-dependent features. The normal browser suite runs on GitHub Actions against actual HTTP and never removes production CSP. Its results are the source of truth for those gates and deployment.

No real paid Anthropic completion is executed: no production API key was supplied. Account/model permissions, provider-side CORS, billing, and custom proxy production behavior require the user's own endpoint. Touch emulation is not physical device testing. Software WebGPU is not physical-GPU qualification. No physical-device, screen-reader, exhaustive accessibility, penetration, or production-load certification is claimed. Imported code is untrusted; review it before opening a preview.

## Publication

Only a successful Pages deployment followed by a passing public-URL smoke test establishes publication. An uploaded source ZIP, build artifact, or branch name alone does not. Read the latest **Verify and publish** run and its artifacts, rather than assuming a previous run still describes the current branch.
