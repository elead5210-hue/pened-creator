# `lib/curriculum/phase2-content/` — Phase 2 lib modules

This folder holds the library-level logic that only Phase 2
(`components/curriculum/phase2-content/`) needs: prompt builders, tool
registries and their dummy data, content validators, and small
helpers for downloads, image prompts, and YouTube search/keywords.
Nothing outside Phase 2 imports from here. See
`lib/curriculum/README.md` for why this is split out from `shared/`,
and `docs/dependency-map.md` for the source audit this was derived
from.

## Files in this folder

- `promptBuilder.ts` — builds the Phase 2 lesson-content generation
  prompt (`buildLessonPrompt`, `LessonPromptRecord`,
  `LessonPromptResult`). Depends on `@/lib/tools/toolsClient`
  (`getTools`, `Tool`) to fetch the live TOOL REGISTRY — the same call
  the Tool Registry page uses — rather than a static in-repo registry
  or a separate implementation. Its instructions also ask the AI to
  return a `"slide"` object of slide-authoring hints
  (duration/transition/background) on every content block, so slide
  data is available on already-generated content rather than needing
  a separate generation pass later.
- `phase3PromptBuilder.ts` — builds the Phase 3 (Interactive Tools)
  generation prompt (`buildPhase3Prompt`, `Phase3PromptRecord`,
  `Phase3PromptResult`). Depends on `./interactiveTools`
  (`serializeInteractiveToolsForPrompt`).
- `interactiveTools.ts` — the Phase 3 "Interactive Tools" registry
  (`INTERACTIVE_TOOLS`, `listInteractiveTools`,
  `getInteractiveToolById`, `serializeInteractiveToolsForPrompt`,
  `ToolDefinition`/`ToolInputSchema` types). No internal
  dependencies.
- `interactiveToolsDummyData.ts` — sample data for each interactive
  tool (`INTERACTIVE_TOOLS_DUMMY_DATA`, `getInteractiveToolDummyData`),
  used by `routes/tools.interactive.tsx`'s dummy-data preview. No
  internal dependencies.
- `contentValidator.ts` — validates a parsed AI response against the
  live tool list passed in by the caller (`validateGeneratedContent`,
  `formatContentErrors`, `ContentError`). Depends on
  `@/lib/tools/toolsClient` (`Tool` type) and `../shared/apiClient`
  (`ToolInputSchema` type) — the caller resolves the current tools via
  `getTools()` (the same way `promptBuilder.ts` does) and passes them
  in for each block to be validated against. Also validates each
  block's `"slide"` object (duration/transition/background) against
  the fixed `SLIDE_SCHEMA` defined in this file, matching
  `promptBuilder.ts`'s request contract.
- `interactiveContentValidator.ts` — the Phase 3 counterpart:
  validates a parsed AI response against the Interactive Tools
  registry (`validateInteractiveContent`,
  `formatInteractiveContentErrors`, `ContentError`). Depends on
  `./interactiveTools` (`getInteractiveToolById`).
- `download.ts` — shared copy/download/print helpers
  (`downloadTextFile`, `copyTextToClipboard`, `triggerPrint`,
  `buildPromptFilename`, `buildPhase3PromptFilename`,
  `buildImagePromptFilename`, `buildSlideshowPromptFilename`). No
  internal dependencies.
- `imagePromptBuilder.ts` — builds the image-prompt generation
  request from a lesson's generated content
  (`buildImagePromptRequest`, `GeneratedContentJson`). No internal
  dependencies. Its instructions also ask the AI to return a
  `"placement"` object per image (position, size, zOrder) alongside
  the existing description/style/altText fields, deciding each
  image's slide placement once at planning time.
- `slideshowPromptBuilder.ts` — builds the "Generate Slideshow Data"
  AI prompt (`buildSlideshowPromptRequest`) by embedding the fixed
  lesson-to-deck conversion instructions and Deck JSON schema and
  injecting the lesson's saved `generatedContent`, plus
  `imagePrompts`/`images`/`imagesNoBg` context describing what visuals
  already exist, into the LESSON CONTENT placeholder. The embedded
  instructions and schema are kept in sync with pened-tools' current
  `src/tools/slideshow/docs/lesson-import-prompt.md` and with
  `slideshowDeckValidator.ts`, because pened-tools loads the saved deck
  by lesson id and rejects one that fails its structural checks. So the
  prompt requires `slides` to be a non-empty array, every slide to have
  an `elements` array (`[]` for a slide with no elements; it is no
  longer optional), every element `type` to be `text`, `image`, `shape`
  or `video`, and `id`, `title` and `background` to be well-typed when
  present. When the pened-tools doc changes, update this prompt and the
  validator together. No internal dependencies.
- `slideshowDeckValidator.ts` — parses and validates the pasted AI
  response for the "Generate Slideshow Data" step against the same
  Deck schema `slideshowPromptBuilder.ts` sends out (`parseDeckJson`,
  `validateDeck`, `formatDeckErrors`, `DeckError`). It enforces the
  structural rules pened-tools applies to a deck it loads by lesson id,
  so a deck can't pass here and then fail there: `slides` is a non-empty
  array; every slide has an `elements` array (an empty array is fine, but
  omitting it is an error); every element `type` is `text`, `image`,
  `shape` or `video`; and `id`, `title` and `background` are strings when
  present on the deck, its metadata, its slides and its elements. A
  `background` may also be a background object such as
  `{ "kind": "gradient", "css": "..." }`, because the prompt schema
  defines a slide background that way. Tighten this if pened-tools turns
  out to accept only strings. A few rules are stricter than pened-tools
  (literal `version: "v1"`, `metadata.title`, per-element
  `position`/`size`, a text element's `content`, an image/video
  element's `src`) and are kept because the Deck schema in the outgoing
  prompt requires them. `../shared/db.ts`'s `saveSlideshowDeck` runs
  `validateDeck` again before making any request, so no path (pasted,
  generated or migrated) can save a deck pened-tools would reject. No
  internal dependencies.
- `slideshowInteractiveContent.ts` — pure helpers for reading and
  writing a lesson's slideshow deck as an `interactiveContent` entry
  (`SLIDESHOW_TOOL_ID`, `InteractiveContentEntry`, `InteractiveContent`,
  `getSlideshowDeck`, `upsertSlideshowEntry`). A lesson's
  `interactiveContent` is an array of `{ tool, data }` entries (or
  `null` when nothing is saved), and pened-tools loads a slideshow by
  lesson id using the `data` of the **first** entry whose `tool` is
  `"slideshow"`. `getSlideshowDeck` reads the deck the same way
  (`null` for a null/non-array input, no slideshow entry, or a null
  `data`). `upsertSlideshowEntry` returns a new array with the
  slideshow entry set to the given deck: it replaces the first existing
  slideshow entry in place (keeping its position and any extra fields),
  drops any further duplicate slideshow entries, appends a new entry if
  there was none, passes every other tool's entry through untouched and
  in order, and never mutates its input. It does no I/O and no deck
  validation (see `slideshowDeckValidator.ts`); persistence is in
  `../shared/db.ts`, which stores the deck through pened-server as this
  entry, so the deck lives on the lesson and pened-tools can load it by
  lesson id. No dependencies.
- `slideshowToolUrl.ts` — builds the link that opens a lesson's saved
  slideshow in pened-tools (`buildSlideshowUrl`, `resolveSlideshowLink`,
  `SlideshowLinkResult`, `SlideshowLinkErrorReason`). The link is
  lesson-id based and carries no deck: pened-tools' own server fetches
  the deck from pened-server by lesson id, so the deck must already be
  saved on the lesson (see `slideshowInteractiveContent.ts` and
  `../shared/db.ts`'s `saveSlideshowDeck`).
  `buildSlideshowUrl(lessonId)` validates the id against
  `^[^:\s/]+:[^\s/]+$` (`<project_id>:<lesson_node_id>`) and returns
  `/tool/slideshow/<encodeURIComponent(lessonId)>` (the colon is sent as
  `%3A`), or `null` for anything else — the id is never trimmed or
  repaired, and callers must treat `null` as an error.
  `resolveSlideshowLink(lessonId)` joins that path to the pened-tools
  origin from `@/lib/toolRenderer/config`'s `getToolRendererBaseUrl()`
  (`VITE_TOOL_RENDERER_BASE_URL`) and returns either `{ ok: true, url }`
  or `{ ok: false, reason, message }`, where `reason` is
  `invalid-lesson-id`, `not-configured` (env var unset) or
  `misconfigured` (env var set but not a valid URL) so callers can show
  a specific inline error instead of a broken link. Use these two
  functions for every slideshow link; don't encode a deck into a
  slideshow URL (the old `encodeSlideshowToolUrl` was removed). Older
  encoded links still open in pened-tools, but nothing here creates
  them. No internal dependencies.
- `youtubeClient.ts` — calls the server's YouTube search endpoint
  (`searchYoutubeVideos`, `YoutubeSearchResultItem`,
  `YoutubeSearchResponse`), and also exposes thin helpers for the
  per-lesson stored YouTube keyword response (the raw pasted LLM text
  plus extracted keywords): `loadStoredYoutubeKeywordResponse`,
  `saveStoredYoutubeKeywordResponse` (an upsert, so repeating a save is
  safe) and `clearStoredYoutubeKeywordResponse` (a missing response is
  a no-op). These wrap `getYoutubeKeywordResponse`,
  `saveYoutubeKeywordResponse` and `deleteYoutubeKeywordResponse` from
  `../shared/db`, which call `GET`/`PUT`/`DELETE`
  `/api/lessons/:lessonId/youtube-keyword-response`; validation and
  `ApiError` handling come from `../shared/db` and
  `../shared/apiClient`. Search behavior
  (`POST /api/youtube/search`) is unchanged. Depends on
  `../shared/apiClient` (`apiPost`), `../shared/db` and
  `../shared/schema` (types).
- `youtubeKeywordPromptBuilder.ts` — builds the YouTube
  keyword-request prompt from a lesson's generated content
  (`buildYoutubeKeywordPromptRequest`, `GeneratedContentJson`). No
  internal dependencies.
- `phase3GenerationApi.ts` — calls the server to generate Phase 3
  content for a lesson (`requestPhase3Generation`,
  `Phase3ContentBlock`). Depends on `../shared/db` (`LessonRecord`
  type).
- `lessonRecord.ts` — lesson-record shape helpers and status
  constants (`LessonStatus`, `LessonRecordShape`, `buildLessonId`,
  `createLessonRecord`, `updateLessonRecord`, `setLessonStatus`,
  `setLessonGeneratedContent`, `setLessonImagePrompts`,
  `setLessonImage`, `setLessonImageNoBg`, `setLessonSlideshowDeck`,
  `isValidLessonBreakdown`). `LessonRecordShape` now also carries a
  `slideshowDeck: unknown | null` field, set via
  `setLessonSlideshowDeck`, and an optional
  `interactiveContent` field (the lesson's `{ tool, data }` entries as
  stored by pened-server). `setLessonSlideshowDeck` sets both: the
  `slideshowDeck` field is the derived in-memory view, while the
  `slideshow` entry in `interactiveContent` (replaced, not appended, via
  `upsertSlideshowEntry`, with other tools' entries left untouched) is
  what actually gets persisted. Depends on `../shared/schema`
  (`validateLessonBreakdownDocument`) and `./slideshowInteractiveContent`. Also imported directly by
  `../shared/db.ts`, which uses these shaping helpers to implement its
  own lesson CRUD functions — see "Imported by" below.
- `slideshowDeckBuilder.ts` — assembles a complete slideshow Deck JSON
  (`buildSlideshowDeck`, `SlideshowDeck`, `ContentBlock`,
  `ImagePromptItem` types) from a lesson's already-saved
  `generatedContent` (using each block's `"slide"` hints from
  `promptBuilder.ts`/`contentValidator.ts`) and `imagePrompts` (using
  each item's `"placement"` hints from `imagePromptBuilder.ts`),
  resolving image filenames from `images`/`imagesNoBg`. Pure and
  deterministic — makes no AI call. No internal dependencies. No
  longer called by `../shared/db.ts`'s `saveSlideshowDeck`, which now
  persists a caller-supplied deck (validated via
  `slideshowDeckValidator.ts`) instead of assembling one itself — kept
  here in case a future deterministic-assembly path needs it again.

## Parent dependencies

- `@/lib/curriculum/shared/apiClient` (`apiPost`) — used by
  `youtubeClient.ts`; also (`ToolInputSchema` type) used by
  `contentValidator.ts`.
- `@/lib/curriculum/shared/db` (`LessonRecord` type) — used by
  `phase3GenerationApi.ts`; (`getYoutubeKeywordResponse`,
  `saveYoutubeKeywordResponse`, `deleteYoutubeKeywordResponse`) — used
  by `youtubeClient.ts`.
- `@/lib/curriculum/shared/schema` (`validateLessonBreakdownDocument`)
  — used by `lessonRecord.ts`; (`YoutubeKeywordSavedResponse`,
  `YoutubeKeywordSaveInput` types) — used by `youtubeClient.ts`.
- `@/lib/tools/toolsClient` (`getTools`, `Tool` type) — used by
  `promptBuilder.ts` and (`Tool` type only) `contentValidator.ts`.
- `@/lib/toolRenderer/config` (`getToolRendererBaseUrl`) — used by
  `slideshowToolUrl.ts` to get the pened-tools origin for the slideshow
  link. (`@/lib/toolRenderer/toolViewerUrl`'s `encodeToolViewerUrl` is
  for other tools' embedded content only and is no longer used here.)

Nothing in this folder imports from `components/*`, `hooks/`, or
`lib/auth/`. Besides its sibling `shared/`, this folder also depends on
`lib/tools/` (`promptBuilder.ts`, `contentValidator.ts`) for the live
tool registry and `lib/toolRenderer/` (`slideshowToolUrl.ts`) for the
pened-tools base URL config that `ToolContentFrame.tsx` also uses — see
the one reverse edge noted under "Imported by" below
(`shared/db.ts` → `lessonRecord.ts`).

## Imported by (outside this folder)

- **`components/curriculum/phase2-content/`** (including
  `toolRenderers/`) — the largest consumer: `download.ts` (copy/
  download/print helpers, e.g. `ImagePromptCard.tsx`,
  `ImagePromptGenerator.tsx`, `PromptViewer.tsx`,
  `YoutubeKeywordGenerator.tsx`), `imagePromptBuilder.ts`
  (`ImagePromptGenerator.tsx`), `youtubeClient.ts`
  (`YoutubeKeywordGenerator.tsx`, `YoutubeSearchResults.tsx`),
  `youtubeKeywordPromptBuilder.ts` (`YoutubeKeywordGenerator.tsx`),
  `contentValidator.ts` (`PasteResponseForm.tsx`), `slideshowToolUrl.ts`
  (`resolveSlideshowLink` — `SlideshowDeckGenerator.tsx`, to build its
  saved-deck summary's lesson-id "Open in pened-tools" link, shown only
  once a deck is saved on the server, with a visible error when the
  lesson id is invalid or `VITE_TOOL_RENDERER_BASE_URL` is missing or
  invalid).
- **`routes/`** — `lessons.$lessonId.tsx` (`promptBuilder.ts`,
  `lessonRecord.ts`).
- **`lib/curriculum/shared/`** — `db.ts` imports `lessonRecord.ts`
  (`createLessonRecord`, `updateLessonRecord`, `setLessonStatus`,
  `setLessonGeneratedContent`, `setLessonImagePrompts`,
  `setLessonImage`, `setLessonImageNoBg`, `setLessonSlideshowDeck`,
  `buildLessonId`) to implement its own lesson CRUD functions,
  including `saveSlideshowDeck`, which now takes the deck to persist
  as a parameter (callers validate it via `slideshowDeckValidator.ts`
  for field-level feedback, and `db.ts` imports `validateDeck` and
  `formatDeckErrors` to re-validate it before saving, throwing a
  `SlideshowSaveError` with reason `invalid_deck` if it fails) rather than importing
  `slideshowDeckBuilder.ts` to assemble one itself. `db.ts` also imports
  `slideshowInteractiveContent.ts` (`getSlideshowDeck`,
  `upsertSlideshowEntry`) to read the deck from, and replace it in, the
  lesson's `interactiveContent` when loading and saving through
  pened-server. This is the one
  place a `shared/` file depends on this folder rather than the
  reverse — most outside code that wants lesson-record shaping still
  reaches it indirectly through `shared/db.ts`'s own exported
  functions rather than importing `lessonRecord.ts` directly.

## Notes for an agent working only in this folder

- Nearly every dependency runs one way (this folder depends on
  `shared/`, not the reverse), with one deliberate exception:
  `shared/db.ts` imports `lessonRecord.ts` directly for its lesson-
  shaping helpers. Nothing in this folder is imported by
  `phase1-tree/`, so that part of the codebase is still safe to
  change without worrying about Phase 1 — just keep `lessonRecord.ts`'s
  exported shapes in sync with what `shared/db.ts` expects from them.
- `lessonRecord.ts` is unusual: it's imported directly by
  `../shared/db.ts` (an exception to this folder normally only
  depending on, never being depended on by, `shared/`), and most
  outside code reaches its functionality via `shared/db`'s own
  exported lesson functions (`saveSlideshowDeck`, etc.) rather than
  importing it directly. Keep its exported shapes in sync with how
  `shared/db.ts` calls them. `slideshowDeckBuilder.ts` used to be
  imported the same way, but `shared/db.ts`'s `saveSlideshowDeck` no
  longer calls it — don't assume it still is without checking.
- If you add a new import from outside this folder, or a new outside
  consumer, update this README and `docs/dependency-map.md` to match.