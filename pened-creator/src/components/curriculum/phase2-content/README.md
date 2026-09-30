# `phase2-content/` — Phase 2: Content Generation

This folder owns Phase 2 of the curriculum pipeline: turning a saved
lesson breakdown into an AI prompt, capturing the pasted AI response,
and rendering the generated lesson content (including image prompts
and YouTube keyword prompts). See
`docs/merge-architecture.md` for the full Phase 1 / Phase 2 background.

It includes the `toolRenderers/` subfolder, which dispatches generated
content to the right renderer component.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.
The source audit this was derived from lives in
`docs/dependency-map.md`.

## Files in this folder

- `NewLessonForm.tsx`
- `PromptViewer.tsx`
- `PasteResponseForm.tsx`
- `LessonContentView.tsx`
- `LessonDetailPanel.tsx`
- `StepSidebar.tsx`
- `ImagePromptGenerator.tsx`, `ImagePromptCard.tsx`,
  `ImagePromptCardGrid.tsx`, `PasteImagePromptResponseForm.tsx`
- `YoutubeKeywordGenerator.tsx`, `YoutubeSearchResults.tsx`,
  `PasteYoutubeKeywordResponseForm.tsx` — the step-3 "Paste the LLM's
  response" form now persists the raw pasted response and the extracted
  keywords to the API on submit (via `saveYoutubeKeywordResponse`), with
  saving/success/error states and duplicate-save prevention.
  `YoutubeKeywordGenerator.tsx` loads any previously saved response via
  `getYoutubeKeywordResponse` when the step mounts and passes `lessonId`
  and `initialRawResponse` to the form, so the pasted response and
  keywords are restored when the user returns to the step.
- `SlideshowDeckGenerator.tsx`, `PasteSlideshowDeckResponseForm.tsx` —
  the step-7 "Generate Slideshow Data" panel, now following the same
  prompt/paste round trip as the other generator components above:
  Step 1 builds the lesson-to-deck conversion prompt (via
  `slideshowPromptBuilder`'s `buildSlideshowPromptRequest`) with
  copy/download actions, and Step 2
  (`PasteSlideshowDeckResponseForm.tsx`) validates and saves the AI's
  pasted Deck JSON via `saveSlideshowDeck`, showing a saved-deck
  summary with a "Paste a different response" action once one is
  saved. The deck is stored on the server as the lesson's slideshow
  `interactiveContent` entry: the form disables its save button while a
  save is in flight, and shows a failed save (for example an expired
  session, an oversized deck or a network error) separately from deck
  validation errors, keeping the pasted text so the user can retry. The
  deck only counts as saved once the server has confirmed it.
  That saved-deck summary (in `SlideshowDeckGenerator.tsx`) also shows
  an "Open in pened-tools" link, built via `slideshowToolUrl`'s
  `resolveSlideshowLink(lesson.id)`. The link is
  `<pened-tools origin>/tool/slideshow/<encoded lesson id>` and carries
  only the lesson id, not the deck (pened-tools loads the deck from the
  server), so it appears only after the deck has been saved. If the
  lesson id is invalid or `VITE_TOOL_RENDERER_BASE_URL` is unset or
  invalid, a visible inline error is shown instead of a link.
- `SlideDataViewer.tsx`, `SlideDataCard.tsx`,
  `SlideDataBreadcrumbNav.tsx` — the "Slide Data" step, shown after the
  "Generate Slideshow Data" step once a deck has been saved.
  `SlideDataViewer.tsx` takes the lesson's saved deck (`slideshowDeck`:
  a parsed object, JSON/raw text, or null/undefined) and an optional
  `initialIndex`, extracts the slides via `extractSlides`, and shows one
  slide per card. It tracks the current index, moves focus
  to the card region after the user navigates (by button or arrow key)
  but never on initial mount or when the deck is replaced, and renders
  an empty state (nothing saved) or an error alert listing validation
  problems (invalid deck) instead of the card. It compares the deck by
  content: a background refresh that supplies an identical deck keeps
  the user's current slide, while any change in deck content (for
  example a re-saved deck, including one with fewer slides) resets the
  view to the first slide. `clampSlideIndex` is only a safeguard that
  keeps an out-of-range index (such as a too-large or negative
  `initialIndex`) within the deck; it is not what handles a changed or
  shrunken deck. The card region
  has `role="region"` and an accessible name of the form "Title, slide N
  of M". `SlideDataCard.tsx` renders one slide's data
  object: id, title, background, each element (type, position, size,
  `content`/`src`, other fields) and any other slide-level fields.
  `SlideDataBreadcrumbNav.tsx` is the breadcrumb-style navigation: a
  Previous button, a "Slide N of M" trail with the slide title, and a
  Next button, with Previous disabled on the first slide and Next
  disabled on the last (both disabled for a single-slide deck). Left and
  right arrow keys also navigate (while focus is inside the navigation),
  and the position is announced through a polite live region. Tests are
  in `SlideDataViewer.test.tsx`.

  `StepSidebar.tsx` gives each step button an accessible name that
  includes its position and state (for example "Step 8 of 9: Slide Data,
  locked, complete the earlier steps to unlock"); the visual indicators
  are hidden from assistive technology.

  The "slide-data" step's unlock status comes from the shared
  `getPhase2StepStatuses` lookup in `lessonPipelineStatus.ts` like every
  other step (locked until a deck is saved on the lesson, otherwise
  "available"; it never reports "complete"), not from a local override in
  the route. Once a deck is saved, the "slideshow-data" step in
  `lessons.$lessonId.tsx` shows a "Next: Slide Data" call-to-action
  above `SlideshowDeckGenerator`. The route also keys `SlideDataViewer`
  on the lesson id and a reset counter that is bumped when the lesson
  changes or the deck is re-saved, so the viewer never carries a stale
  slide position over.
- `toolRenderers/` — `ContentDispatcher.tsx`, which now routes every
  content block through `ToolContentFrame` (no local renderer
  components remain in this subfolder).

## Parent dependencies

Everything this folder (including `toolRenderers/`) imports from
outside itself. Nothing outside this list may be assumed to exist — if
a change here needs something not on this list, that's a signal the
dependency map and this README need updating first.

### `@/lib/curriculum/shared/` — cross-phase contract
See that folder's own README for the full contract. This folder
consumes:
- `db` — `LessonRecord` (type); `createLesson`, `updateLessonBreakdown`,
  `saveImagePrompts`, `saveGeneratedContent`
  — used across `NewLessonForm.tsx`, `PasteImagePromptResponseForm.tsx`,
  `PasteResponseForm.tsx`,
  `LessonContentView.tsx`,
  `LessonDetailPanel.tsx`, `YoutubeKeywordGenerator.tsx`; `saveSlideshowDeck`,
  `SlideshowSaveError` — used in `PasteSlideshowDeckResponseForm.tsx`;
  `getYoutubeKeywordResponse` — used in `YoutubeKeywordGenerator.tsx` to
  reload the saved YouTube keyword response; `saveYoutubeKeywordResponse`
  — used in `PasteYoutubeKeywordResponseForm.tsx` to persist it
  (GET/PUT `/api/lessons/:lessonId/youtube-keyword-response`).
- `apiClient` — `ApiError` — used in `NewLessonForm.tsx`,
  `PasteImagePromptResponseForm.tsx`,
  `PasteResponseForm.tsx`,
  `YoutubeKeywordGenerator.tsx`, `PasteSlideshowDeckResponseForm.tsx`.
- `schema` — `ImagePromptItem` (type), `imagePromptItemSchema`,
  `validateImagePromptResponse`, `ImagePromptValidationError` (type) —
  used in `ImagePromptCard.tsx`, `ImagePromptCardGrid.tsx`,
  `PasteImagePromptResponseForm.tsx`; `validateYoutubeKeywordResponse`,
  `YoutubeKeywordItem` (type), `YoutubeKeywordValidationError` (type) —
  used in `PasteYoutubeKeywordResponseForm.tsx`.
- `lessonPipelineStatus` — `StepUnlockStatus` (type) — used in
  `StepSidebar.tsx`; the route reads `getPhase2StepStatuses` (which now
  includes `"slide-data"`) from it.
- `schema` and `db` are not imported by the Slide Data components; they
  receive the saved deck as a prop from the lesson route.

### `@/lib/tools/`
- `toolsClient` — `getTools` — used in `PasteResponseForm.tsx` to
  fetch the live tool list (the same call the Tool Registry page uses)
  to validate the pasted response against.

### `@/lib/curriculum/phase2-content/` — phase2-owned lib modules
These live alongside this folder's own README's sibling lib folder,
under `src/lib/curriculum/phase2-content/` (see that folder's README
for its own parent dependencies, which point back into
`lib/curriculum/shared/`):
- `download` — `copyTextToClipboard`, `downloadTextFile`,
  `buildImagePromptFilename`, `buildPromptFilename`,
  `buildSlideshowPromptFilename`, `triggerPrint` — used in
  `ImagePromptCard.tsx`, `ImagePromptGenerator.tsx`,
  `PromptViewer.tsx`, `YoutubeKeywordGenerator.tsx`,
  `toolRenderers/WorksheetRenderer.tsx`, `SlideshowDeckGenerator.tsx`
  (`copyTextToClipboard`, `downloadTextFile`,
  `buildSlideshowPromptFilename`).
- `imagePromptBuilder` — `buildImagePromptRequest` — used in
  `ImagePromptGenerator.tsx`.
- `slideshowPromptBuilder` — `buildSlideshowPromptRequest` — used in
  `SlideshowDeckGenerator.tsx`.
- `slideshowDeckValidator` — `parseAndValidateDeck`, `validateDeck`,
  `DeckError`, `SlideshowDeck` (types) — used in
  `PasteSlideshowDeckResponseForm.tsx`; `formatDeckErrors` — used in
  `SlideDataViewer.tsx`; `SlideData`, `SlideElementData` (types) — used
  in `SlideDataCard.tsx`.
- `slideshowDeckSlides` — `extractSlides`, `clampSlideIndex` — used in
  `SlideDataViewer.tsx` to turn the saved deck into a normalized,
  ordered slide list.
- `slideshowToolUrl` — `resolveSlideshowLink` — used in
  `SlideshowDeckGenerator.tsx` to build its saved-deck summary's "Open
  in pened-tools" link from the lesson id (not from the deck).
- `contentValidator` — `validateGeneratedContent` — used in
  `PasteResponseForm.tsx`, which now passes it the live tool list
  fetched via `@/lib/tools/toolsClient`'s `getTools` instead of a
  separate implementation or a static registry.
- `youtubeKeywordPromptBuilder` — `buildYoutubeKeywordPromptRequest` —
  used in `YoutubeKeywordGenerator.tsx`.
- `youtubeClient` — `searchYoutubeVideos`, `YoutubeSearchResultItem`
  (type) — used in `YoutubeKeywordGenerator.tsx` and
  `YoutubeSearchResults.tsx`.

### `@/components/tools/`
- `ToolContentFrame` — used in `toolRenderers/ContentDispatcher.tsx` as
  the renderer for every content block with a well-formed `tool` id
  (i.e. a live TOOL REGISTRY id such as `multiple-choice-card`),
  embedding it via the Tool Renderer app instead of showing the
  "Unrecognized content block" placeholder. Blocks with a missing or
  non-string `tool` id still render the local `UnknownBlock`
  placeholder instead.

### `@/lib/utils`
- `cn` — used in `StepSidebar.tsx` and `SlideDataBreadcrumbNav.tsx`.

### `@/components/ui/*`
Standard shadcn/ui primitives, treated as a standing shared baseline
(see that folder's own README — it has no parent dependencies of its
own). Each item below names the underlying module (in parentheses)
alongside the exports this folder uses from it:
- `Badge` (`badge`)
- `Breadcrumb`/`BreadcrumbItem`/`BreadcrumbList`/`BreadcrumbPage`/
  `BreadcrumbSeparator` (`breadcrumb`) — used in
  `SlideDataBreadcrumbNav.tsx`
- `Button` (`button`)
- `Card`/`CardContent`/`CardHeader`/`CardTitle`/`CardDescription`/
  `CardFooter` (`card`)
- `Checkbox` (`checkbox`)
- `Input` (`input`)
- `Label` (`label`)
- `Textarea` (`textarea`)
- `Separator` (`separator`)
- `Alert`/`AlertDescription`/`AlertTitle` (`alert`)
- `Skeleton` (`skeleton`)

Nothing in this folder imports from `phase1-tree/`, `components/shell/`,
or `lib/auth/`.

## Imported by (outside this folder)

Files outside `phase2-content/` that import from it. Renaming or
removing an exported symbol below is a breaking change for the listed
file.

- `src/routes/lessons.$lessonId.tsx` — imports `PromptViewer`,
  `PasteResponseForm`, `LessonContentView`, `ImagePromptGenerator`,
  `YoutubeKeywordGenerator`, `StepSidebar`, `SlideshowDeckGenerator`
  (which in turn imports `PasteSlideshowDeckResponseForm` from within
  this folder), and `SlideDataViewer` (which in turn imports
  `SlideDataCard` and `SlideDataBreadcrumbNav`). The route adds a
  `"slide-data"` step after `"slideshow-data"`; it stays locked until a
  slideshow deck is saved on the lesson.
- `src/routes/tools.tsx` and `src/routes/tools.interactive.tsx` —
  import `toolRenderers/ContentDispatcher` directly. These two
  dummy-data preview routes bypass the rest of this folder and only
  need the renderer dispatch, not the lesson-pipeline forms.

## Notes for an agent working only in this folder

- Phase 1 (`phase1-tree/`) and Phase 2 never import from each other
  directly — the only coupling runs through `lib/curriculum/` and
  `components/ui/`. You should not need to touch `phase1-tree/` to
  work here.
- `toolRenderers/ContentDispatcher.tsx` is imported by two different
  kinds of outside consumers: real lesson routes
  (`LessonContentView.tsx`, inside
  this folder) and standalone preview routes
  (`routes/tools.tsx`, `routes/tools.interactive.tsx`, outside this
  folder). Don't assume it's only reachable through this folder's own
  lesson-pipeline flow.
- `toolRenderers/ContentDispatcher.tsx` routes every block with a
  well-formed `tool` id through `ToolContentFrame` as a live TOOL
  REGISTRY id (e.g. `multiple-choice-card`); only a block with a
  missing/non-string `tool` id still renders the local `UnknownBlock`
  placeholder.
- `lib/curriculum/schema.ts` and `lib/curriculum/db.ts` are the shared
  contract for curriculum-tree/lesson data shapes. Treat their
  exported types and function signatures as fixed unless the task
  explicitly asks you to change them (a change there also affects
  `phase1-tree/`, `shell/`, `hooks/`, and most of `routes/` — outside
  this folder's blackbox).
- If you add a new import from outside this folder, add it to the
  "Parent dependencies" section above so the contract stays accurate.