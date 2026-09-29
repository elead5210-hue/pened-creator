
# `lib/tools/` — Tools registry data layer (read-only)

This folder owns the data shape and fetch functions for browsing the
Tools registry. Unlike pened-admin's `lib/tools/`, this creator app has
no ability to register, edit, or delete tools — `toolsClient.ts` only
lists and fetches what's already been registered elsewhere (in the
admin app), talking to the same penedv1-server `/api/tools` endpoints.
`slideshowSchemaPlaceholder.ts` is unrelated to that registry: it's a
hardcoded, not-yet-fetched placeholder JSON schema for the slideshow
app's slide-rendering data, standing in until the real schema is added.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.

## Files in this folder

- `toolsClient.ts`
- `toolSuggestionsClient.ts`
- `slideshowSchemaPlaceholder.ts`

## Exports

### `toolsClient.ts`
- `ToolMode` — the two modes a registered tool's content can be used
  for: `"presentation" | "evaluation"`.
- `Tool` — a tool as stored and returned by the server: `id`, `name`,
  `description`, `mode`, `inputSchema` (`Record<string, unknown>`), and
  `createdAt`.
- `getTools(mode?: ToolMode)` — lists every registered tool, optionally
  filtered to one mode.
- `getTool(id: string)` — fetches a single tool, or `undefined` if none
  exists with that id (a 404 is treated as "not found", not an error).

There is no `createTool`, `updateTool`, or `deleteTool` here — this app
can only read the registry, never write to it.

### `toolSuggestionsClient.ts`
- `ToolSuggestion` — a suggested tool match returned for a given piece
  of curriculum content: at minimum a `toolId`, the matching `Tool`'s
  `name`, and a `confidence`/`reason` describing why it was suggested.
- `getToolSuggestions(input)` — given the content to be matched (e.g. a
  learning objective or generated content payload), returns a list of
  `ToolSuggestion`s ranked by relevance.

This client is currently backed by a **mock adapter**: the real
suggestion endpoint does not exist on penedv1-server yet, so
`getToolSuggestions` resolves its result locally (deterministically,
from the already-fetched `Tool` list) instead of calling `apiGet`. The
function signature and return shape are written to match what the real
endpoint is expected to return, so that swapping the mock body for a
real `apiGet("/api/tools/suggestions", ...)` call later should not
require any caller-facing changes. Callers should treat it exactly
like any other async data-fetching function (e.g. wrap it in a React
Query `useQuery`) rather than special-casing it as synchronous or mock
only, so that the eventual swap to a live endpoint is invisible to
them.

### `slideshowSchemaPlaceholder.ts`
- `SLIDESHOW_SCHEMA_PLACEHOLDER` — a hardcoded placeholder JSON Schema
  object describing the slideshow app's slide-rendering data shape.
- `SLIDESHOW_SCHEMA_PLACEHOLDER_NOTE` — short string noting this is a
  placeholder, shown alongside the schema wherever it's rendered.

Unlike `toolsClient.ts`, this module makes no API calls — both exports
are static constants. Replace them once the real slideshow schema is
finalized; no other file should need to change as a result.

## Parent dependencies

- `@/lib/curriculum/shared/apiClient` — `toolsClient.ts` imports
  `apiGet` and the `ApiError` class to call the `/api/tools` endpoints
  and translate a 404 into "not found" for `getTool`. `toolSuggestionsClient.ts`
  does not currently import from here, since it is mock-backed; this
  will become a real dependency once it switches to a live `apiGet`
  call.

## Imported by (outside this folder)

- `src/routes/tools.tsx` — imports `getTools`/`Tool` (from
  `toolsClient.ts`) to load the registry via a React Query `useQuery`
  and render each tool read-only via `ToolRegistryCard`.
- `src/lib/curriculum/phase2-content/promptBuilder.ts` — imports
  `getTools`/`Tool` to fetch the live TOOL REGISTRY section of the
  Generate Content prompt.
- `src/components/curriculum/phase2-content/PasteResponseForm.tsx` —
  imports `getTools` to fetch the tool list it passes to
  `contentValidator.ts`'s `validateGeneratedContent` for validating a
  pasted AI response.
- `src/components/tools/SlideshowSchemaViewer.tsx` — imports
  `SLIDESHOW_SCHEMA_PLACEHOLDER` and `SLIDESHOW_SCHEMA_PLACEHOLDER_NOTE`
  (from `slideshowSchemaPlaceholder.ts`) to render on the Tools Registry
  page's "Slideshow Schema" tab.

## Notes for an agent working only in this folder

- This module is deliberately read-only. If a future request asks for
  create/edit/delete here, that's a signal the creator account's
  permissions have changed — don't add write functions speculatively.
- `toolsClient.ts` is now the single path to `GET /api/tools` in this
  app — the AI prompt builder and the Paste AI Response validator both
  fetch through `getTools()` here rather than a separate
  implementation, so don't reintroduce a parallel tool-fetching
  function elsewhere for a narrower shape; add an optional param to
  `getTools`/`Tool` here instead if a caller ever needs something this
  shape doesn't already provide.
- `toolsClient.ts` has no `subscribe`/`notify` mechanism like
  `lib/curriculum/shared/db.ts` does — callers are expected to use
  `@tanstack/react-query` (already used elsewhere in this app) for
  fetching/caching/invalidation rather than a bespoke pub-sub layer.
- `toolSuggestionsClient.ts`'s mock adapter is an implementation
  detail, not a feature to design around — don't add mock-only params
  or shortcuts to its exported functions that wouldn't also make sense
  against a real HTTP endpoint. When the real endpoint ships, update
  the function body in place rather than adding a parallel real client.
- `slideshowSchemaPlaceholder.ts` is deliberately hardcoded and has no
  parent dependencies of its own — don't wire it up to a live fetch
  speculatively; when the real schema is ready, update its constants
  in place instead.
- If you add a new import from outside this folder, add it to the
  "Parent dependencies" section above so the contract stays accurate.