# Verification

## Reproducible gates

- `npm run check`: JavaScript syntax and entry metadata.
- `npm test`: 63 dependency-free Node tests, including UTF-8 and storage bounds, traversal/secret filenames, prototype safety, selected-only context, stale proposals, bounded diffs, safe Markdown, sanitized backups, independent ZIP CRC conventions, imports, origin/header handling, paginated model discovery, byte-split Unicode SSE, stalled-stream abort, protocol failures, tool authorization, and the six-request cap.
- `npm run build`: static `dist/` with no build-time credential or external runtime package.
- `python tests/browser.py --url URL --output qa-results`: real HTTP browser acceptance and screenshots. The CI server mounts the build at `/ClaudeCodeDesign/` to exercise repository-relative paths.
- `python tests/browser.py --url PAGES_URL --smoke --output qa-results/live`: public-site smoke after deployment.

## Browser evidence

The suite checks desktop and 320/390/768-pixel touch layouts, page navigation, dark mode, keyboard commands, mobile drawer focus isolation, file editing/reload, downloadable ZIP content using Python's independent ZIP reader, demo proposal approval/undo, custom prompts, a mocked Anthropic model-list and streamed tool roundtrip, explicit context selection, no credential persistence, backup/restore, cancellation preventing late credential writes, interactive preview, sandbox parent/storage/network rejection, and a real offline service-worker reload.

Every scenario writes its outcome into `browser-results.json`. Screenshots are uploaded with the report. A failure is not silently converted into a skip. Published-site smoke is a smaller subset and does not repeat paid API or full editor tests. The actual renderer mode is recorded: a successful Canvas fallback is not represented as physical WebGPU qualification.

## Current evidence boundaries

The recovered implementation was checked locally with the Node suite and syntax/build gates. The local managed browser does not permit HTTP navigation, so local visual inspection used an in-memory rendering harness. That visual inspection alone does not verify origin-dependent features. The repository's normal browser suite runs against actual HTTP and never removes production CSP; its GitHub Actions results are the source of truth for those gates and for deployment.

No real paid Anthropic completion is executed: no production API key was supplied. Account/model permissions, provider-side CORS, billing, and custom proxy production behavior require the user's own endpoint. Touch emulation is not physical device testing. No physical-GPU, screen-reader, exhaustive accessibility, penetration, or production-load certification is claimed. Imported code is untrusted; review it before opening a preview.

## Publication

Only a successful Pages deployment followed by a passing public-URL smoke test establishes publication. An uploaded source ZIP, build artifact, or branch name alone does not. Read the latest **Verify and publish** run and its artifacts, rather than assuming a previous run still describes the current branch.
