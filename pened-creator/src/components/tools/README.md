
# `components/tools/` — Tools registry UI (read-only)

This folder owns the UI for browsing the /api/tools registry. Unlike
pened-admin's `components/tools/`, there is no register/edit/delete
dialog here - the creator account can only view what's already been
registered elsewhere. `ToolRegistryCard.tsx` renders a single tool's
id, name, mode badge, description, and pretty-printed `inputSchema`,
reachable from the Tools Registry page (`routes/tools.tsx`).
`ToolContentFrame.tsx` embeds a single TOOL REGISTRY content block as a
sandboxed iframe pointed at the Tool Renderer app, for previewing what
a generated content block actually looks like. `SlideshowSchemaViewer.tsx`
renders the hardcoded placeholder slideshow JSON schema from
`@/lib/tools/slideshowSchemaPlaceholder`, for the "Slideshow Schema" side
tab on the Tools Registry page.
`ToolSuggestionModal.tsx` is the dialog for submitting a new tool
suggestion; it is opened from the global toolbar
(`components/shell/GlobalToolbar.tsx`), not from a page in this folder.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.

## Files in this folder

- `ToolRegistryCard.tsx`
- `ToolContentFrame.tsx`
- `SlideshowSchemaViewer.tsx`
- `ToolSuggestionModal.tsx`
- `ToolSuggestionModal.test.tsx` (Vitest + Testing Library tests for the
  modal)

## Exports

### `SlideshowSchemaViewer.tsx`
- `SlideshowSchemaViewer` — no props. Renders the hardcoded
  `SLIDESHOW_SCHEMA_PLACEHOLDER` constant (and its accompanying
  `SLIDESHOW_SCHEMA_PLACEHOLDER_NOTE`) from
  `@/lib/tools/slideshowSchemaPlaceholder` as pretty-printed JSON inside
  a `Card`, mirroring `ToolRegistryCard.tsx`'s bordered card styling.
  Unlike `ToolRegistryCard.tsx`, this reads no live data - there's no
  API call behind it yet.

### `ToolContentFrame.tsx`
- `ToolContentFrame` — props `{ toolId, data, title?, height?,
  className? }`. Renders a sandboxed iframe of the Tool Renderer app's
  preview for a single content block inside a `rounded-md border
  border-border p-4` wrapper with an uppercase eyebrow label (the
  block's `title`, defaulting to `toolId`) above the frame — the same
  bordered/padded/eyebrow-label pattern the other read-only block
  renderers in `toolRenderers/` use — so it reads as one consistent
  block list alongside them. Shows a loading skeleton until `onLoad`
  fires, an `onError` fallback (message + "open in new tab" link), an
  always-present "open in new tab" link under the iframe, and a clear
  inline message instead of a blank frame when
  `VITE_TOOL_RENDERER_BASE_URL` is unset (i.e. when
  `encodeToolViewerUrl` returns `undefined`).

### `ToolSuggestionModal.tsx`
- `ToolSuggestionModal` (named and default export) — props `{ open,
  onOpenChange, onSubmitted? }`, exported as `ToolSuggestionModalProps`.
  Renders a Dialog with a single "Tool description" textarea. It
  validates the text (10 to 2000 characters after trimming) with
  `validateToolSuggestionDescription`, submits it with
  `submitToolSuggestion`, and shows a loading state, inline field and form
  errors, and a success state that closes automatically after a short
  delay. The dialog cannot be dismissed while a request is in flight, and
  the form resets each time it closes. `onSubmitted` is called after a
  successful save. The parent owns the `open` state.

## Parent dependencies

Everything this folder imports from outside itself. Nothing outside
this list may be assumed to exist — if a change here needs something
not on this list, that's a signal this README needs updating first.

### `@/components/ui/card`
- `Card`, `CardContent`, `CardHeader` — used in `ToolRegistryCard.tsx`;
  `Card`, `CardContent`, `CardHeader`, `CardTitle` — used in
  `SlideshowSchemaViewer.tsx`.

### `@/components/ui/badge`
- `Badge` — used in `ToolRegistryCard.tsx` to show a tool's `mode`.

### `@/lib/tools/`
- `Tool` (type, from `toolsClient.ts`) — used in `ToolRegistryCard.tsx`
  to type its `tool` prop.
- `SLIDESHOW_SCHEMA_PLACEHOLDER`, `SLIDESHOW_SCHEMA_PLACEHOLDER_NOTE`
  (from `slideshowSchemaPlaceholder.ts`) — used in
  `SlideshowSchemaViewer.tsx` as the hardcoded schema/description it
  renders.

### `@/lib/toolRenderer/toolViewerUrl`
- `encodeToolViewerUrl(toolId, data)` — used in `ToolContentFrame.tsx`
  to build the iframe's `src`; a return of `undefined` (renderer base
  URL unconfigured) drives the inline "not configured" message instead
  of the iframe.

### `@/components/ui/skeleton`
- `Skeleton` — used in `ToolContentFrame.tsx` as the loading placeholder
  shown until the iframe's `onLoad` fires.

### `@/components/ui/alert`
- `Alert`, `AlertTitle`, `AlertDescription` — used in
  `ToolContentFrame.tsx` for the "not configured" and "failed to embed"
  states.

### `@/lib/utils`
- `cn` — used in `ToolContentFrame.tsx` to merge className props.

### `@/components/ui/dialog`, `@/components/ui/label`, `@/components/ui/textarea`, `@/components/ui/button`
- `Dialog`, `DialogContent`, `DialogDescription`, `DialogFooter`,
  `DialogHeader`, `DialogTitle`, `Label`, `Textarea`, `Button` — used in
  `ToolSuggestionModal.tsx`.

### `@/lib/tools/toolSuggestionsClient`
- `submitToolSuggestion`, `validateToolSuggestionDescription`,
  `ToolSuggestionsApiError`, `TOOL_SUGGESTION_MAX_LENGTH` — used in
  `ToolSuggestionModal.tsx`. The test file also uses
  `setToolSuggestionsAdapter`, `realToolSuggestionsAdapter` and the
  adapter/result types to stub the API.

### `sonner`
- `toast` — used in `ToolSuggestionModal.tsx` for the success toast.

### `lucide-react`
- `AlertTriangle`, `ExternalLink` — used in `ToolContentFrame.tsx`'s
  alert states and "open in new tab" links.
- `CheckCircle2`, `Loader2` — used in `ToolSuggestionModal.tsx`'s success
  and sending states.

## Imported by (outside this folder)

- `src/routes/tools.tsx` — imports `ToolRegistryCard` to render one
  card per tool returned by `getTools()` (see `@/lib/tools/toolsClient.ts`)
  in its default "Tool Registry" side tab, and `SlideshowSchemaViewer` to
  render in its "Slideshow Schema" side tab.
- `src/components/curriculum/phase2-content/toolRenderers/ContentDispatcher.tsx`
  — imports `ToolContentFrame` as the renderer for every content block
  whose `tool` id is a well-formed string, rendering
  `<ToolContentFrame toolId={tool} data={block?.data} />` for each one
  (only a block with a missing/non-string `tool` id still falls back to
  its own "Unrecognized content block" placeholder).
- `src/components/shell/GlobalToolbar.tsx` — imports `ToolSuggestionModal`
  from `@/components/tools/ToolSuggestionModal` and renders it, owning
  its `open` state. It is opened from the "Suggest a tool" item in
  `GlobalNavContextMenu`. An import from `@/components/shell/...` will
  not resolve, because the file lives here.

## Notes for an agent working only in this folder

- `ToolRegistryCard.tsx` is deliberately read-only, with no internal
  state and no mutations - it just renders the `Tool` it's given. If a
  future request asks for edit/delete affordances here, that's a
  signal the creator account's permissions have changed; don't add
  them speculatively.
- `ToolContentFrame.tsx` does have internal state (`loaded`/`errored`),
  but it's purely presentational (iframe load/error tracking) - it
  doesn't fetch or mutate anything itself, it only builds a URL via
  `encodeToolViewerUrl` and renders an `<iframe>`.
- Don't loosen `ToolContentFrame`'s iframe `sandbox` attribute without
  a specific reason - it intentionally omits e.g. `allow-top-navigation`
  so embedded tool content can't navigate the host page.
- `SlideshowSchemaViewer.tsx` is deliberately hardcoded, not fetched -
  don't wire it up to a live API call speculatively. When the real
  slideshow schema is ready, it should replace the constant in
  `@/lib/tools/slideshowSchemaPlaceholder.ts` rather than this component
  growing its own fetch logic.
- `ToolSuggestionModal.tsx` talks to the API only through
  `@/lib/tools/toolSuggestionsClient`. Don't call `fetch` from the
  component. Tests swap the adapter with `setToolSuggestionsAdapter`, so
  restore `realToolSuggestionsAdapter` afterwards. Run
  `npm run verify` after moving or renaming it, since `GlobalToolbar.tsx`
  and its test depend on the import path.
- If you add a new import from outside this folder, add it to the
  "Parent dependencies" section above so the contract stays accurate.