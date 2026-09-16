# Security model and explicit limitations

## API keys

This is an independent bring-your-own-key app. It is not an Anthropic login screen; never enter a Claude account password. The key and chosen origin stay in JavaScript memory, are cleared on disconnect, and are not intentionally persisted or exported. Every persistence write uses an explicit field allowlist. API requests omit cookies and referrers, reject redirects, and go only to the origin selected in the connection dialog.

The browser-access header is sent only to `https://api.anthropic.com`, not arbitrary proxies. A proxy must be explicitly selected, must use HTTPS (except loopback development), and receives the key and selected context. Model-list validation requires a working `/v1/models` endpoint; a gateway that only implements `/v1/messages` is not sufficient.

Memory-only does not mean theft-proof. Browser extensions, developer tools, compromised hosting, or malicious same-origin scripts can inspect browser-held credentials. GitHub Pages project sites under one account share an origin. Use a dedicated trusted origin for sensitive use and an authenticated server-side gateway for multi-user/production deployment. Do not embed a shared key in this static app. Rate/cost limits must also be set at the provider.

## Workspace data and sharing

Files, conversations, and prompts are stored unencrypted in this browser. They are not cloud backups. Private/incognito sessions, storage eviction, quota failures, and clearing browser data can lose them. Export backups regularly. A second tab produces a conflict warning, not a CRDT merge; concurrent multi-tab editing is not qualified.

Only explicitly checked files and the conversation/preferences are sent with a live request. Importing a file or opening it in the editor does not attach it. Common secret filenames and key extensions are rejected, but this is not content-based secret scanning: a password inside `config.js` remains the user's responsibility. Pasting a key into a prompt or source file would save that text like any other content. Do not do so.

## Model output

Output is untrusted. The Markdown renderer escapes raw HTML, does not create external images, and does not turn model URLs into executable links. Tools expose no network, terminal, native filesystem, or GitHub-write capability. Existing files must be attached before replacement proposals can be staged. Proposed writes require explicit approval and a matching base version. Undo refuses to overwrite subsequent manual edits.

Context is capped at 180,000 characters; model limits can still be smaller. Files are capped at 500,000 UTF-8 bytes and the workspace at 3,000,000 bytes. API turns are capped at six requests. There is no automatic retry or paid background work. Cancelling a request does not necessarily reverse provider-side billing already incurred.

## Preview

The preview receives source code only, never the API key or privileged app objects. It is isolated by a native sandbox with an opaque origin and a restrictive CSP. Fetch/XHR, external script/resource loading, forms, embeds, and nested frames are denied. Parent storage and DOM access are not permitted. Plain relative CSS and classic JavaScript references are inlined; arbitrary package/module resolution is not implemented.

Do not treat this as a complete hostile-code execution environment. Resource exhaustion, browser implementation bugs, self-navigation semantics, and side channels are not eliminated by an iframe sandbox. There is no CPU-time or memory governor. Never put credentials in previewed source, and review generated code before opening Preview. For running truly hostile programs, use separately hosted, resource-limited isolated compute.

## Offline caching

The service worker intercepts only an exact allowlist of static application-shell GET URLs in its own scope. It does not cache API calls, keys, user files, repository imports, or model conversations. App data is managed separately by local storage. Network-first shell updates fall back to the existing cache when offline.

## Supply chain and identity

Runtime assets are local and dependency-free. No analytics, remote font, external frontend script, or tracking image is included. Development/browser-test tools run only in the development or CI environment. The visible independent-redesign disclosure and connection warning are intentional; do not remove them in a hosted fork that retains product references.

## Sources and maintenance references

- Anthropic streaming protocol: https://platform.claude.com/docs/en/build-with-claude/streaming
- Anthropic SDK browser-access warning: https://github.com/anthropics/anthropic-sdk-typescript#requirements
- Browser sandbox semantics: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox
- GitHub Pages deployment configuration: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

Report a security concern privately to the repository maintainer where a private channel is available. Do not post credentials or private source files in a public issue.
