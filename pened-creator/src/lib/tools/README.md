
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
- `ToolSuggestion` — a tool idea submitted by a signed-in user, as
  returned by penedv1-server: `id`, `description`, `status`
  (`new | reviewed | accepted | rejected`), `submittedBy`, timestamps,
  and the review fields `reviewedBy`, `reviewedAt` and `adminNote`.
- `submitToolSuggestion({ description })` — `POST`s a suggestion to
  `/api/tool-suggestions` and resolves to `{ suggestion }`. Throws
  `ToolSuggestionsApiError`, which carries `status`, a stable `code`,
  optional per-field `fields`, and `retryAfterSeconds` for rate limiting.
- `validateToolSuggestionDescription(description)` — client-side length
  check (10 to 2000 characters after trimming) for fast feedback; the API
  always re-validates.
- `setToolSuggestionsAdapter(adapter)` / `isUsingMockToolSuggestions()` —
  swap or inspect the active adapter (used by tests and local development).

The client has two adapters behind one interface: a **real adapter** that
calls the live endpoint, and a **mock adapter** that returns the stub
responses from `docs/api-handoff/tool-suggestions.md`. The mock is only
used when `VITE_USE_MOCK_TOOL_SUGGESTIONS=true` or when a test swaps it in,
and must never be enabled in a production build. The contract is in
`docs/api-handoff/tool-suggestions.md`.

## All API calls go through the shared client

Every request to penedv1-server must go through
`@/lib/curriculum/shared/apiClient`: `apiGet`, `apiPost`, `apiPut` and
`apiDelete`. If a call genuinely needs `fetch` itself (for example to read
response headers such as `Retry-After`), build its URL with `apiUrl(path)`
from the same module and keep `credentials: "include"`. That keeps the
base URL, session cookie handling and error handling in one place.

**Never call `fetch("/api/...")` with a relative path.** In production this
app (`pened-creator.fly.dev`) and the API (`pened-server.fly.dev`) are on
different hosts, and a relative URL resolves against this app's own origin,
which has no such route. The request answers `404` and never reaches the API.
The mock adapter and a test that asserts the relative URL both hide this,
which is how the tool suggestions client shipped with exactly that bug.

`npm run apicalls:check` (`scripts/check-api-calls.js`, also run by `lint`,
`prebuild` and therefore CI) fails the build on any `fetch(` call in `src/`
that is not built with `apiUrl(...)`, outside `apiClient.ts`, `authClient.ts`
and test files. It prints only the file and line of each violation.

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
  and translate a 404 into "not found" for `getTool`.
  `toolSuggestionsClient.ts` imports `apiUrl` to build the absolute URL for
  its `POST /api/tool-suggestions` request. It uses `fetch` directly, rather
  than `apiPost`, so it can read the `Retry-After` header and the
  structured `{ error: { code, message, fields } }` body.


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
  against the real HTTP endpoint. Keep both adapters behind the one
  `ToolSuggestionsAdapter` interface, and keep the real adapter's URL
  built with `apiUrl()` (see "All API calls go through the shared client"
  above).
- `slideshowSchemaPlaceholder.ts` is deliberately hardcoded and has no
  parent dependencies of its own — don't wire it up to a live fetch
  speculatively; when the real schema is ready, update its constants
  in place instead.
- If you add a new import from outside this folder, add it to the
  "Parent dependencies" section above so the contract stays accurate.