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
  `validateDeck`, `parseAndValidateDeck`, `formatDeckErrors`,
  `DeckError`, plus the slide data model types `SlideshowDeck`,
  `SlideData`, `SlideElementData`, `SlidePosition`, `SlideSize`,
  `ElementType` and `ParseDeckResult`). It enforces the
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

  **Slide data model.** A `SlideshowDeck` is `{ version: "v1", id,
  title?, background?, metadata: { title, id? }, slides: SlideData[] }`.
  A `SlideData` is `{ id, title?, background?, elements:
  SlideElementData[] }`, and a `SlideElementData` is `{ id, type, position:
  { x, y }, size: { width, height }, content?, src? }` where `type` is
  one of `text`, `image`, `shape` or `video`, and `width`/`height` may
  also be the literal `"auto"`. Unknown optional fields are typed via an
  index signature and passed through untouched. These types describe
  data that has passed validation; they do not replace it, so always
  obtain a typed deck through `parseAndValidateDeck` rather than casting.

  **`parseAndValidateDeck(input)`** accepts raw pasted text (run through
  `parseDeckJson`, so fences and stray prose are stripped) or an
  already-parsed value, and returns a discriminated `ParseDeckResult`:
  `{ ok: true, deck, errors: [] }` or `{ ok: false, deck: null, errors }`.
  It never throws. Text that can't be parsed as a JSON object produces a
  single error with path `"$"`; otherwise `errors` lists every per-field
  problem with a dotted path such as `slides[0].elements[1].src`.
  `PasteSlideshowDeckResponseForm.tsx` uses it to show a summary message
  for unparseable text and a field list for schema failures before
  anything is saved.
- `slideshowDeckSlides.ts` — safely extracts a normalized, ordered slide
  list from a saved deck record for the per-slide data view
  (`extractSlides`, `normalizeDeckSlides`, `clampSlideIndex`,
  `NormalizedSlide`, `ExtractSlidesResult`). `extractSlides(savedDeck)`
  accepts raw text, a JSON string, a parsed deck, or `null`/`undefined`,
  never throws, and returns a discriminated result by `status`: `"ok"`
  (with `slides`, `deckTitle`, `totalSlides` and `isSingleSlide`),
  `"empty"` (nothing saved yet: null, undefined or a blank string) or
  `"invalid"` (unparseable or failing validation, with `errors`). A deck
  with an empty `slides` array is `"invalid"`, not `"empty"`, matching
  `validateDeck`. Each `NormalizedSlide` has a zero-based `index`, a
  one-based `number`, the slide `id`, a `title` (falling back to
  `"Slide N"` when missing or blank) and the original slide object in
  `data`, in deck order. `clampSlideIndex(index, totalSlides)` keeps a
  current-slide index in range (returning 0 for an empty deck or a
  non-finite index), so the view stays valid when the user returns to it
  after the deck changes. Validation is delegated to
  `slideshowDeckValidator.ts`'s `parseAndValidateDeck`, so a slide that
  shows up here has passed the same checks as a saved deck. Tests are in
  `slideshowDeckSlides.test.ts`. Depends on `./slideshowDeckValidator`.
- `slideImagesPromptBuilder.ts` — builds the per-slide "add images"
  prompt shown by the Slide Data step's "Add images" modal
  (`buildSlideImagesPrompt`, `getUploadedImageDescriptions`,
  `SlideImagesLessonInput`, `UploadedImageDescription`,
  `SlideImagesPromptResult`). It is pure and deterministic: it makes no
  AI call, does no I/O, and never mutates its input. Tests are in
  `slideImagesPromptBuilder.test.ts`. No internal dependencies: the
  lesson input is typed structurally (`imagePrompts` and `images`), so
  it accepts a `LessonRecord` or any object with those two fields.

  **Inputs.** `buildSlideImagesPrompt(slide, lesson)` takes one slide's
  data object exactly as saved in the deck (typed `unknown`, and
  malformed slides are tolerated) and the lesson. It returns
  `{ prompt, images, hasImages }`: the full prompt text, the uploaded
  images that were listed in it, and whether there were any.

  **Which images are listed.** `getUploadedImageDescriptions(lesson)`
  joins the lesson's `imagePrompts` with its `images` map by id and
  returns one `{ id, description, altText, src, sourceTool }` per image
  prompt that has a non-empty uploaded filename in `images`, in the
  order of `imagePrompts`. An image prompt that has no uploaded image
  is left out, because a slide can't reference an image that hasn't
  been uploaded. Values are trimmed, and entries without an id, and
  non-array or malformed input, are skipped rather than throwing.

  **What the prompt contains.** The prompt tells the AI to add image
  elements to the slide's `elements` array using only the uploaded
  images, setting each element's `src` to the image's exact `src` from
  the list, and to change nothing else on the slide. It restates the
  image-element rules that `slideshowDeckValidator.ts` enforces, so a
  slide the AI returns stays compatible with it: `type` is exactly
  `"image"`, `id` is a non-empty string unique among the slide's
  elements, `src` is a non-empty string copied from the list, `position`
  is `{ x, y }` and `size` is `{ width, height }` (each a number, or
  `"auto"` for a size), `alt` is optional, and the slide keeps its `id`
  and an `elements` array. It also includes an example image element,
  the UPLOADED IMAGES list (id, src, description, and altText and
  sourceTool when present), and the slide JSON.

  **Response format.** The prompt asks for JSON only: the complete
  updated slide as a single JSON object, with no prose, comments,
  markdown fences or wrapper object.

  **Edge cases.** With no uploaded images (`hasImages` is `false`) the
  prompt says so and tells the AI to return the slide unchanged and
  not to invent any image elements or `src` values; the modal shows a
  no-images message and disables copy and download in that case. When
  the slide already contains image elements, the prompt says how many,
  and tells the AI to keep every existing element exactly as it is, not
  to add a second copy of an image the slide already shows, and to
  place new images so they don't overlap.

  **Response handling.** Nothing in this module parses or saves the
  AI's response: it only produces the prompt text. Parsing and checking
  the response is done by `slideImagesResponse.ts` (below), which
  validates through `slideshowDeckValidator.ts` rather than adding a
  second set of rules. Keep the rules this prompt gives the AI in sync
  with the checks in `slideImagesResponse.ts` and with that validator.
- `slideImagesResponse.ts` — parses, validates and applies the AI's
  response to the "add images" prompt
  (`parseSlideImagesResponse`, `getAllowedImageSrcs`,
  `replaceSlideInDeck`, `SlideImagesResponseResult`). It is pure and
  deterministic: no I/O, no AI call, no saving, and it never mutates its
  inputs. Tests are in `slideImagesResponse.test.ts`. It is used by the
  Slide Data step's "Add images" flow: `SlideImagesPromptModal.tsx` calls
  `getAllowedImageSrcs` and `parseSlideImagesResponse` when the user
  applies a pasted response, and `SlideDataViewer.tsx` calls
  `replaceSlideInDeck` to build the deck that is then saved (see "How an
  updated slide is saved" below). Depends on `./slideshowDeckValidator`
  and `./slideImagesPromptBuilder` (`getUploadedImageDescriptions`, used
  by `getAllowedImageSrcs`).

  **`parseSlideImagesResponse(raw, originalSlide, allowedSrcs)`** takes
  the text pasted from the AI, the slide exactly as it is currently
  saved, and the exact `src` values of the lesson's uploaded images (any
  iterable of strings). It never throws and returns a discriminated
  `SlideImagesResponseResult`: `{ ok: true, slide, addedElements, errors:
  [] }` (the validated updated slide and the new image elements) or `{
  ok: false, slide: null, addedElements: [], errors }`. Each error is a
  `DeckError` (`{ path, message }`, so `formatDeckErrors` works on it),
  with paths relative to the slide, such as `slide.elements[2].src`. An
  error with path `"$"` means the problem is with the response as a
  whole (no JSON object found, invalid JSON, or no uploaded images).

  **Parsing and structure.** The text goes through `parseDeckJson`, so
  code fences and stray prose around the object are tolerated. A wrapper
  object is also unwrapped: `{ "slide": { ... } }`, or a deck
  `{ "slides": [ ... ] }` (the slide with the original id, or the only
  slide). The slide is then checked with `validateDeck` by placing it in
  a minimal valid deck, and the paths are rewritten from `slides[0]` to
  `slide`, so the structural rules (an `elements` array, element
  `id`/`type`/`position`/`size`, an image element's `src`, and so on) are
  exactly the deck validator's and are not duplicated here. If the slide
  fails structurally, only those errors are returned.

  **Checks against the original slide.** Once the slide is structurally
  valid, every one of these is checked and all problems are reported
  together: the slide `id` is unchanged; every other slide-level field
  (`title`, `background`, anything else) is unchanged, neither added,
  removed nor edited; every original element is still present, deeply
  equal to the original (key order is ignored), and in its original
  relative order; every new element has `type` `"image"`; every new
  image's `src` is exactly (case-sensitively) one of `allowedSrcs`, so an
  invented file or an external URL is rejected; new element ids are
  unique among all of the slide's elements, including the existing ones;
  and at least one image was added. When `allowedSrcs` is empty the
  response is rejected straight away with a single `"$"` error, before
  the text is read, because there is nothing to add.

  **`getAllowedImageSrcs(lesson)`** returns the `src` of each uploaded
  image in image-prompt order (using `getUploadedImageDescriptions`), so
  the allowed list always matches the list shown in the prompt.

  **`replaceSlideInDeck(deck, index, slide)`** returns a new deck with the
  slide at `index` replaced. Every other slide, every other deck field and
  the metadata are carried over untouched, and neither the deck nor the
  slide is mutated. It throws a `RangeError` for an index that is not an
  integer inside the deck. Pass it a deck from `parseAndValidateDeck`, and
  the saved result must still go through `../shared/db.ts`'s
  `saveSlideshowDeck`, which validates the whole deck again before
  anything is stored.

  **How an updated slide is saved.** The flow, from the pasted text to
  the server, is:

  1. `SlideImagesPromptModal.tsx` runs `parseSlideImagesResponse` on the
     pasted text, with the slide currently shown and
     `getAllowedImageSrcs(lesson)`. If it fails, the modal shows the
     errors and nothing is saved.
  2. On success the modal calls its `onApplySlide(slide)` prop, which
     `SlideDataViewer.tsx` provides. The viewer parses the saved deck
     with `parseAndValidateDeck`, builds the new deck with
     `replaceSlideInDeck(deck, currentIndex, slide)` and passes it to its
     `onSlideUpdated(deck)` prop.
  3. `routes/lessons.$lessonId.tsx` implements `onSlideUpdated` with
     `../shared/db.ts`'s `saveSlideshowDeck(lessonRecord.id, deck)`. That
     function validates the whole deck again with `validateDeck` (a
     failure is a `SlideshowSaveError` with reason `invalid_deck`), then
     writes it with `upsertSlideshowEntry`, so the lesson ends up with
     exactly one `"slideshow"` entry, any duplicates are dropped and
     other tools' entries are left untouched. The route then stores the
     lesson record the server returned. A deck saved this way is
     therefore held to the same rules as one saved from the Generate
     Slideshow Data step, and pened-tools can still load it by lesson id.
  4. A failed save rejects back through the viewer to the modal, which
     shows it as its own message, separate from the validation errors,
     keeps the pasted text and stays open.

  This module and `slideshowInteractiveContent.ts` stay pure: the only
  I/O in this flow is `saveSlideshowDeck`.
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
  lesson id. Both saving a whole deck and saving a single updated slide
  (see "How an updated slide is saved" above) go through it, so a lesson
  always keeps exactly one slideshow entry. Tests are in
  `slideshowInteractiveContent.test.ts`, including that a deck produced
  by `replaceSlideInDeck` and written with `upsertSlideshowEntry` leaves
  one slideshow entry and leaves other tools' entries untouched. No
  dependencies.
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
  invalid), `slideImagesPromptBuilder.ts` (`SlideImagesPromptModal.tsx`,
  to build the per-slide "add images" prompt it displays),
  `slideImagesResponse.ts` (`SlideImagesPromptModal.tsx` —
  `getAllowedImageSrcs`, `parseSlideImagesResponse`, to check a pasted
  response; `SlideDataViewer.tsx` — `replaceSlideInDeck`, to build the
  deck with the updated slide), and `slideshowDeckValidator.ts` types
  and `parseAndValidateDeck` (`SlideDataViewer.tsx`). The tests for this
  flow live next to the components that use it:
  `SlideImagesPromptModal.test.tsx`, `SlideDataViewer.test.tsx` and
  `SlideDataViewer.slideUpdate.test.tsx`.
- **`routes/`** — `lessons.$lessonId.tsx` (`promptBuilder.ts`,
  `lessonRecord.ts`, and the `SlideshowDeck` type from
  `slideshowDeckValidator.ts` for its slide-update handler, which saves
  through `../shared/db.ts`'s `saveSlideshowDeck`).
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