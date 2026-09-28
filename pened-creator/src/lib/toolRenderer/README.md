
# `lib/toolRenderer/` — Tool Renderer configuration

This folder owns configuration for embedding the pened Tool Renderer
app — a separate deployed app that renders TOOL REGISTRY content
blocks (e.g. multiple-choice cards) — as iframes inside lesson content
views. It does not fetch or render anything itself; it only resolves
and validates the renderer's base URL from env config.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.

## Files in this folder

- `config.ts`
- `toolViewerUrl.ts`

## Exports

### `config.ts`
- `getToolRendererBaseUrl()` — returns the configured Tool Renderer
  base URL (trimmed, trailing slash removed), or `undefined` if
  `VITE_TOOL_RENDERER_BASE_URL` is unset or blank. Throws if the value
  is set but isn't a valid absolute `http(s)` URL.

### `toolViewerUrl.ts`
- `encodeToolViewerUrl(toolId, data)` — builds the full Tool Renderer
  iframe URL for a single content block
  (`${getToolRendererBaseUrl()}/tool/<toolId>/<encoded>`, where
  `<encoded>` is the url-safe-base64-encoded `{ toolId, data }`
  envelope — matching pened-tools' actual production decode path in
  `src/newToolBuilder/toolUrl.js`'s `decodeToolUrlData`/
  `encodeToolUrlData`, which is what `ToolPage.js` really uses; a
  same-shaped `src/tools/urlData.js` exists in that repo too but isn't
  wired into the page and should not be treated as the real contract).
  Returns `undefined` (not a throw) when `getToolRendererBaseUrl()` is
  `undefined`, so callers can degrade the same way `config.ts` does.
- `decodeToolViewerUrl(urlOrEncoded)` — parses a URL built by
  `encodeToolViewerUrl` (or just its trailing encoded segment) back
  into its `{ toolId, data }` envelope. Throws on invalid base64,
  invalid JSON, a missing/non-string `toolId`, or a `toolId` path
  segment that doesn't match the decoded payload.
- `ToolViewerEnvelope` (type) — the `{ toolId, data }` shape shared by
  both functions above.

`encodeToolViewerUrl` is for other tools' embedded content only (the
`ToolContentFrame.tsx` iframe previews). It must **not** be used for
slideshows: a slideshow link carries only the lesson id, not the deck
(see `slideshowToolUrl.ts` under "Imported by" below), so nothing that
builds a slideshow URL may put a deck in it, base64url or otherwise.

## Parent dependencies

- `import.meta.env.VITE_TOOL_RENDERER_BASE_URL` — declared (optional)
  in `src/vite-env.d.ts`, documented in the repo's `.env.example`. Read
  only here; no other file should read this env var directly.

## Imported by (outside this folder)

- `src/components/tools/ToolContentFrame.tsx` — imports
  `encodeToolViewerUrl()` to build the `src` of the iframe it embeds a
  content block's Tool Renderer preview in, and treats a return of
  `undefined` (i.e. `getToolRendererBaseUrl()` returning `undefined`)
  as the signal to show its "Tool Renderer not configured" inline
  message instead of an iframe. It does not call `getToolRendererBaseUrl()`
  directly or read `decodeToolViewerUrl()`.
- `src/lib/curriculum/phase2-content/slideshowToolUrl.ts` — imports
  `getToolRendererBaseUrl()` (and not `encodeToolViewerUrl()`) to build
  the link (not an iframe `src`) that opens a lesson's saved slideshow in
  pened-tools. The link is lesson-id based:
  `${getToolRendererBaseUrl()}/tool/slideshow/<encodeURIComponent(lessonId)>`,
  where the lesson id is `<project_id>:<lesson_node_id>` (colon sent as
  `%3A`). It carries no deck data: pened-tools' server fetches the deck
  from pened-server by lesson id, so the deck must already be saved on the
  lesson. `buildSlideshowUrl(lessonId)` builds the path (or returns
  `null` for an invalid id), and `resolveSlideshowLink(lessonId)` builds
  the full link, reporting an invalid id, an unset base URL, and an
  invalid base URL as distinct errors. Older slideshow links that encoded
  the whole deck in the URL still open in pened-tools, but nothing in this
  app creates them any more.
- Not yet imported anywhere else. `decodeToolViewerUrl()` and
  `getToolRendererBaseUrl()` (used directly rather than through
  `ToolContentFrame`) are being added ahead of `ContentDispatcher.tsx`'s
  live-registry fallback rendering, which is expected to call them when
  handling incoming Tool Renderer URLs and when deciding whether to
  render a `ToolContentFrame` at all.

## Notes for an agent working only in this folder

- Unlike `VITE_API_URL` in `lib/curriculum/shared/apiClient.ts`, this
  variable is optional — `getToolRendererBaseUrl()` returns
  `undefined` rather than throwing when it's unset, so the app can
  degrade to a clear inline message instead of crashing. Only throw
  for a value that's present but malformed (not a valid `http(s)`
  URL), matching `apiClient.ts`'s validation style for the shape of
  error, not the required/optional behavior.
- `VITE_*` values are baked into the bundle at build time — a change
  to `VITE_TOOL_RENDERER_BASE_URL` requires restarting the dev server
  or rebuilding and redeploying, not just editing `.env`.
- Don't hardcode the renderer host or re-read
  `import.meta.env.VITE_TOOL_RENDERER_BASE_URL` elsewhere in the app —
  route every consumer through `getToolRendererBaseUrl()` here so
  validation and the no-trailing-slash normalization stay in one
  place.
- `toolViewerUrl.ts`'s `encodeToolViewerUrl`/`decodeToolViewerUrl` are
  the only functions that should build or parse a `/tool/<toolId>/
  <encoded>` URL or call `btoa`/`atob` — route every consumer through
  them rather than hand-rolling the encoding elsewhere. This applies
  to embedded tool content only; slideshow links are the exception and
  never encode a deck (see `slideshowToolUrl.ts` above). In the
  pened-tools repo, the real encode/decode logic lives in
  `src/newToolBuilder/toolUrl.js` (imported by `ToolPage.js`), not in
  the similarly-named `src/tools/urlData.js` — when re-verifying this
  contract against that repo in future, check what `ToolPage.js`
  actually imports rather than pattern-matching on filename.
- If you add a new import from outside this folder, add it to the
  "Imported by" section above so the contract stays accurate.