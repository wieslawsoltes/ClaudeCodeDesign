# Architecture

The app is a static module graph with no server dependency for editing, demo use, or previews. Live model calls go directly to an explicitly trusted API origin. HTML carries document semantics and native controls; WebGPU is a progressive visual enhancement, never a requirement for text input or navigation.

```text
index.html
  src/app.js                 routes, views, native dialogs, editor, orchestration
    src/core.js              validation, state, diffs, Markdown, ZIP
    src/api.js               Anthropic HTTP/SSE client and bounded tool loop
    src/preview.js           local/public imports and preview document assembly
    src/gpu.js               WebGPU particle rendering and Canvas fallback
    src/icons.js             original inline SVG controls
  src/style.css              layered theme/layout/components/responsive CSS
preview.html
  src/preview-frame.js       one-way message receiver in an opaque-origin frame
sw.js                        allowlisted static-shell cache only
```

## State and boundaries

`core.js` is dependency-free and testable in Node. The persisted schema is explicitly allowlisted: version, theme, project files/name, selected editor file, sanitized conversations, custom prompts, and model/preferences. Hydration validates paths, byte limits, message roles, and values. API credentials and endpoint choice are held only in the module's in-memory `credentials` object. Proposals, usage display, selected sharing context, and undo history are transient.

Editor changes update the in-memory workspace and debounce local persistence. File operations and approvals record per-file before/after values for guarded undo. An undo refuses to replace a file subsequently edited by the user. Proposal approval compares the current file with the proposal's base; a stale proposal cannot overwrite a newer edit. Text editing itself uses the browser textarea undo stack, not a fabricated terminal or background worker.

The hash router uses subpath-relative assets. Route changes recreate the relevant view, dispose the GPU renderer, and preserve application data separately from DOM nodes. Message chunks update the visible answer at animation-frame cadence instead of rebuilding the shell per token. Large editor inputs fall back from highlighting to escaped text. This is a bounded local workspace, not a virtualized million-line editor.

## API flow

1. The user explicitly consents to a key and endpoint. Model discovery tests the connection without generating text.
2. The request captures a snapshot of selected files. Other workspace files are not in the system context and cannot be read by tools.
3. The client sends an Anthropic Messages streaming request. It parses UTF-8 incrementally and reconstructs SSE frames across arbitrary chunk and CRLF boundaries.
4. Text deltas render as safe Markdown. Structured tool arguments are reconstructed from input-JSON deltas. Unknown events are ignored rather than treated as output.
5. List/read/search tools are pure and selection-scoped. `propose_file` validates and stages a full text file, returning `applied: false`.
6. Tool results are sent in the next API round. There are at most six requests per user turn, with no automatic retries. The user can abort at any point; partial text is retained and labeled.
7. Provider-reported token usage is accumulated. The app does not guess prices, invent execution evidence, or show fake terminals.

The request system explicitly tells the model that no terminal, filesystem OS access, git runtime, or deployment tools exist. These instructions are helpful but are not the authorization boundary: tool implementations enforce selected-file access and staged-only writes.

## Preview isolation

The host builds an HTML document with local CSS/script references inlined. It strips embedding elements and existing HTTP-equivalent metadata, inserts a restrictive CSP, and passes only that document to a dedicated iframe. The frame has `sandbox="allow-scripts"` without `allow-same-origin`, giving it an opaque origin. The frame cannot read the parent's storage or key. Its receive handler accepts only the parent window and removes itself before rendering the document.

The generated CSP denies fetch/XHR connections, external images/fonts/scripts, subframes, object embeds, forms, and base URL changes. The host also restricts frame source origins. This is a browser sandbox with documented limits, not a substitute for a server-side hostile-code isolation service.

## Rendering

`AmbientRenderer` requests a low-power WebGPU adapter, creates a WGSL vertex/fragment pipeline, and draws 6,720 instanced particle quads per frame. A 32-byte uniform buffer carries time, dimensions, theme, and pointer state. The render loop is capped around 30 FPS, device pixel ratio is capped at 1.75, hidden-tab animation pauses, and reduced-motion preference uses a static frame.

Unavailable adapters, initialization failure, and device loss switch to a Canvas2D ornament. Because a canvas cannot change context type, the fallback uses an overlaid canvas. Every renderer releases observers, listeners, animation frames, and its device when the view is disposed.

## Packaging

`npm run build` copies only public runtime assets to `dist/`. No transpilation, bundler, secret replacement, or dynamic environment configuration occurs. `core.js`, `api.js`, `preview.js`, and `gpu.js` can be imported independently; `app.js` is the opinionated application shell. Publishing versioned npm libraries is outside this repository's current scope.
