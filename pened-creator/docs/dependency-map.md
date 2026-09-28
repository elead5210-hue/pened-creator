# Cross-folder dependency map

This document is an audit of every import that crosses a folder boundary
inside `src/`. It exists so later work — splitting the project into
blackboxed folders that can each be handed to a separate agent, plus the
per-folder README manifests that go with them — has a factual basis instead
of guesswork.

**Scope.** "Folder" here means the units we intend to blackbox:

- `components/curriculum/phase1-tree/`
- `components/curriculum/phase2-content/` (including its `toolRenderers/` subfolder)
- `components/curriculum/phase3-games/`
- `components/shell/`
- `components/ui/`
- `hooks/`
- `lib/auth/`
- `lib/curriculum/shared/`
- `lib/curriculum/phase2-content/`
- `routes/`

For each folder below, **"Imports from outside"** lists every external
module/file it pulls in (excluding npm packages like `react`,
`@tanstack/react-router`, `lucide-react`, `sonner`, `zod`, which are
irrelevant to folder blackboxing). **"Imported by outside"** lists every
file outside the folder that imports something from it. Internal
(same-folder) imports are omitted.

---

## `components/ui/`

The shadcn/ui primitives (`button.tsx`, `card.tsx`, `badge.tsx`, `input.tsx`,
`textarea.tsx`, `tabs.tsx`, `popover.tsx`, `label.tsx`, `separator.tsx`,
`alert.tsx`, `skeleton.tsx`, etc.).

- **Imports from outside:** almost none. `components/ui/` has no imports
  of `@/lib/*` (aside from `@/lib/utils` for `cn`), `@/components/curriculum/*`,
  or `@/components/shell/*` — with one exception: `sidebar.tsx` imports
  `useIsMobile` from `@/hooks/use-mobile`. It is close to a true leaf
  dependency, but not quite one.
- **Imported by outside:** everything. `phase1-tree/`, `phase2-content/`
  (including `toolRenderers/`), `shell/`, and `routes/` all import from it
  (e.g. `Button`, `Card`/`CardContent`/`CardHeader`/`CardTitle`, `Textarea`,
  `Badge`, `Input`, `Label`, `Tabs`/`TabsList`/`TabsTrigger`,
  `Popover`/`PopoverContent`/`PopoverTrigger`, `Alert`/`AlertDescription`/
  `AlertTitle`, `Skeleton`, `Checkbox`).

This makes `components/ui/` the one folder every other blackboxed folder
depends on. It should be treated as a shared/base dependency in every other
folder's README rather than a "parent dependency" to negotiate per-folder.

## `hooks/`

- **`use-mobile.tsx`**
  - Imports from outside: none.
  - Imported by outside: `components/ui/sidebar.tsx` (`useIsMobile`).
- **`use-tree-expanded-state.ts`**
  - Imports from outside: `PROJECT_ID` from `@/lib/curriculum/shared/schema`.
  - Imported by outside: `routes/index.tsx` (`useTreeExpandedState`).

## `lib/curriculum/shared/`

`lib/curriculum/` is now split into two subfolders: `shared/` (this
section) and `phase2-content/` (the next section). `shared/` is the
explicit, narrowly-scoped cross-phase contract — `schema.ts`,
`apiClient.ts`, `db.ts`, `lessonPipelineStatus.ts` — that both
`phase1-tree/` and `phase2-content/` depend on. Internal (file-to-file
within `shared/`) imports are noted separately at the end of this
section.

- **Imports from outside:** none of `shared/`'s own files import
  anything from `components/*` or `hooks/`. It only imports from `lib/auth/`
  indirectly is *not* the case — see `lib/auth/authClient.ts` below, which
  is the one place the dependency direction runs the other way
  (`lib/auth` → `lib/curriculum/shared`, not the reverse).
- **Imported by outside:** every other folder imports from it:
  - `phase1-tree/`: `TreeView.tsx` (`CurriculumNode`, `getAllowedChildTypes`,
    `LESSON_NODE_TYPE` from `schema`; `PipelineStage` from
    `lessonPipelineStatus`), `LessonBreakdownPanel.tsx` (`db.ts` functions,
    `ApiError` from `apiClient`), `AddChildNodesDialog.tsx`
    (`ChildNodesValidationError`, `CurriculumNode`, `getAllowedChildTypes`,
    `parseChildNodes` from `schema`), `NodePicker.tsx` (`CurriculumNode`
    from `schema`), `QuestionInboxDialog.tsx` (`ApiError` from `apiClient`).
  - `phase2-content/`: `db.ts` (`LessonRecord` type; lesson save
    functions), `apiClient.ts` (`ApiError`), `schema.ts` (image-prompt
    and YouTube-keyword validation/types), `lessonPipelineStatus.ts`
    (`StepUnlockStatus`). Used across `ImagePromptCard.tsx`,
    `ImagePromptCardGrid.tsx`, `ImagePromptGenerator.tsx`,
    `InteractiveContentView.tsx`, `LessonContentView.tsx`,
    `LessonDetailPanel.tsx`, `NewLessonForm.tsx`,
    `PasteImagePromptResponseForm.tsx`, `PasteInteractiveResponseForm.tsx`,
    `PasteResponseForm.tsx`, `PasteYoutubeKeywordResponseForm.tsx`,
    `StepSidebar.tsx`, `YoutubeKeywordGenerator.tsx`.
  - `lib/curriculum/phase2-content/`: several modules there import from
    `shared/` rather than from each other: `lessonRecord.ts` → `./schema`
    (`validateLessonBreakdownDocument`), `phase3GenerationApi.ts` →
    `./db` (`LessonRecord`), `youtubeClient.ts` → `./apiClient`
    (`apiPost`).
  - `shell/`: `GlobalToolbar.tsx` imports `getLesson`, `getLessonBreakdown`,
    `subscribe`, `LessonRecord` from `db.ts`; `PROJECT_ID` from `schema.ts`;
    `computeLessonPipelineStage`, `PipelineStage` from
    `lessonPipelineStatus.ts`.
  - `hooks/`: `use-tree-expanded-state.ts` imports `PROJECT_ID` from
    `schema.ts`.
  - `lib/auth/`: `authClient.ts` imports `apiGet`, `apiPost`, `ApiError`
    from `../curriculum/shared/apiClient`.
  - `routes/`: nearly every route file imports from `lib/curriculum/shared/`
    — `index.tsx` (`apiClient`, `schema`, `lessonPipelineStatus`),
    `lessons.$lessonId.tsx` and `lessons.$lessonId.interactive-tools.tsx`
    (`apiClient`, `schema`), `login.tsx` and `register.tsx` (`apiClient`
    for `ApiError`).

- **Internal cross-file imports within `lib/curriculum/shared/`:**
  - `db.ts` → `schema.ts` (`CurriculumNode`, `ExamQuestion`,
    `LessonBreakdown`, `FlatNode`, `buildCategorizationPrompt`, `expand`,
    `validateLessonBreakdownDocument`, `PROJECT_ID`), `apiClient.ts`
    (`apiGet`/`apiPost`/`apiPut`/`apiDelete`/`ApiError`).
  - `lessonPipelineStatus.ts` → `db.ts` (`LessonRecord`).
  - `schema.ts` and `apiClient.ts` themselves have no internal
    dependencies within this folder — they're the base of the internal
    graph.
  - **Cross-subfolder exception:** `db.ts` also imports its lesson-record
    shaping helpers (`createLessonRecord`, `updateLessonRecord`,
    `setLessonStatus`, `setLessonGeneratedContent`,
    `setLessonImagePrompts`, `setLessonImage`, `setLessonImageNoBg`,
    `setLessonSlideshowDeck`, `buildLessonId`) directly from the sibling
    `../phase2-content/lessonRecord.ts`, and the slideshow
    `interactiveContent` helpers (`getSlideshowDeck`,
    `upsertSlideshowEntry`) from the sibling
    `../phase2-content/slideshowInteractiveContent.ts` — the one place a
    `shared/` file depends on `phase2-content/` rather than the reverse.
    See the matching note in the `lib/curriculum/phase2-content/` section
    below.

## `lib/curriculum/phase2-content/`

The Phase-2-only lib modules: prompt builders, tool registries and
their dummy data, content validators, and the `download.ts`,
`imagePromptBuilder.ts`, `youtubeClient.ts`,
`youtubeKeywordPromptBuilder.ts`, `phase3GenerationApi.ts`, and
`lessonRecord.ts` helpers. Nothing outside `phase2-content/` (either
the components folder or this lib folder) imports from here.

- **Imports from outside:** from `../shared/` — `youtubeClient.ts`
  → `../shared/apiClient` (`apiPost`); `contentValidator.ts` →
  `../shared/apiClient` (`ToolInputSchema`); `phase3GenerationApi.ts` →
  `../shared/db` (`LessonRecord`); `lessonRecord.ts` → `../shared/schema`
  (`validateLessonBreakdownDocument`); and from `lib/tools/` —
  `promptBuilder.ts` → `../../tools/toolsClient` (`getTools`, `Tool`) to
  fetch the live tool registry, `contentValidator.ts` →
  `../../tools/toolsClient` (`Tool` type) to type-check the caller-
  supplied tool list. `slideshowToolUrl.ts` →
  `../../toolRenderer/config` (`getToolRendererBaseUrl`), for the
  pened-tools base URL (`VITE_TOOL_RENDERER_BASE_URL`) its lesson-id
  slideshow link is built on. Nothing here imports from `components/*`,
  `hooks/`, or `lib/auth/`.
- **Imported by outside:**
  - `components/curriculum/phase2-content/`: `download.ts`
    (`copyTextToClipboard`, `downloadTextFile`, filename builders,
    `triggerPrint`), `imagePromptBuilder.ts`,
    `interactiveContentValidator.ts`, `contentValidator.ts`,
    `youtubeKeywordPromptBuilder.ts`, `youtubeClient.ts`,
    `slideshowToolUrl.ts` (`resolveSlideshowLink`). Used across
    `ImagePromptCard.tsx`, `ImagePromptGenerator.tsx`,
    `PasteImagePromptResponseForm.tsx`, `PasteInteractiveResponseForm.tsx`,
    `PasteResponseForm.tsx`, `PromptViewer.tsx`,
    `YoutubeKeywordGenerator.tsx`, `YoutubeSearchResults.tsx`,
    `toolRenderers/WorksheetRenderer.tsx`, `SlideshowDeckGenerator.tsx`
    (`slideshowToolUrl.ts`, to build its saved-deck summary's lesson-id
    "Open in pened-tools" link, shown only once the deck is saved on the
    server).
  - `routes/`: `lessons.$lessonId.tsx` (`promptBuilder`, `lessonRecord`),
    `lessons.$lessonId.interactive-tools.tsx` (`phase3PromptBuilder`,
    `phase3GenerationApi`, `download`), `tools.interactive.tsx`
    (`interactiveTools`, `interactiveToolsDummyData`).
  - `lib/curriculum/shared/`: `db.ts` imports `lessonRecord.ts` directly
    for its lesson-shaping helpers (see the matching note in the
    `lib/curriculum/shared/` section above) — the one place this folder
    is depended on by `shared/` rather than the other way around.

- **Internal cross-file imports within `lib/curriculum/phase2-content/`:**
  - `interactiveContentValidator.ts` → `interactiveTools.ts`
    (`getInteractiveToolById`, `ToolInputSchema`).
  - `phase3PromptBuilder.ts` → `interactiveTools.ts`
    (`serializeInteractiveToolsForPrompt`, `SerializedToolDefinition`).
  - `lessonRecord.ts` → `slideshowInteractiveContent.ts`
    (`upsertSlideshowEntry`, `InteractiveContentEntry`).
  - `slideshowInteractiveContent.ts` has no dependencies: it holds the
    pure helpers (`getSlideshowDeck`, `upsertSlideshowEntry`) for a
    lesson's slideshow `interactiveContent` entry.
  - `slideshowToolUrl.ts` has no internal dependencies within this
    folder. It builds a lesson-id slideshow link
    (`/tool/slideshow/<encoded lesson id>`, via `buildSlideshowUrl` and
    `resolveSlideshowLink`) on the origin from
    `lib/toolRenderer/config`'s `getToolRendererBaseUrl()`, which reads
    `VITE_TOOL_RENDERER_BASE_URL`. It never encodes a deck into the URL.

## `lib/auth/`

- **Imports from outside:**
  - `authClient.ts` → `../curriculum/shared/apiClient` (`apiGet`,
    `apiPost`, `ApiError`). This is the only import out of
    `lib/curriculum` that originates from `lib/auth` rather than the
    reverse.
  - `AuthContext.tsx`, `routeGuard.ts` → only import from `./authClient`
    (internal to `lib/auth/`), plus `@tanstack/react-router`.
- **Imported by outside:**
  - `shell/GlobalToolbar.tsx` → `useAuth` from `@/lib/auth/AuthContext`.
  - `routes/login.tsx`, `routes/register.tsx` → `loginUser`/`registerUser`
    from `@/lib/auth/authClient`.
  - `routes/index.tsx`, `routes/lessons.$lessonId.tsx`,
    `routes/lessons.$lessonId.interactive-tools.tsx`,
    `routes/tools.tsx`, `routes/tools.interactive.tsx` → `requireAuth` from
    `@/lib/auth/routeGuard`.
  - `routes/__root.tsx` → `AuthProvider` from `../lib/auth/AuthContext`.

## `components/shell/`

- **Imports from outside:**
  - `GlobalToolbar.tsx` → `cn` (`@/lib/utils`); `getLesson`,
    `getLessonBreakdown`, `subscribe`, `LessonRecord`
    (`@/lib/curriculum/shared/db`); `PROJECT_ID`
    (`@/lib/curriculum/shared/schema`); `computeLessonPipelineStage`,
    `PipelineStage` (`@/lib/curriculum/shared/lessonPipelineStatus`);
    `useAuth` (`@/lib/auth/AuthContext`); `Button`
    (`@/components/ui/button`).
  - `LessonPipelineBadge.tsx` → `cn` (`@/lib/utils`); pipeline-stage types
    from `@/lib/curriculum/shared/lessonPipelineStatus`.
- **Imported by outside:**
  - `phase1-tree/TreeView.tsx` → `LessonPipelineBadge`.
  - `routes/__root.tsx` → `GlobalToolbar` (mounted app-wide, above
    `<Outlet />`).
  - `routes/lessons.$lessonId.tsx`,
    `routes/lessons.$lessonId.interactive-tools.tsx` → `LessonPipelineBadge`.

`components/shell/` therefore sits between the two phases: it's a
dependency of `phase1-tree/` (via `LessonPipelineBadge`) and is mounted
globally by `routes/__root.tsx`, while itself depending on
`lib/curriculum/`, `lib/auth/`, and `components/ui/`.

## `components/curriculum/phase1-tree/`

- **Imports from outside:**
  - `@/lib/curriculum/shared/schema` (`CurriculumNode`,
    `LESSON_NODE_TYPE`) — `TreeView.tsx`, `NodePicker.tsx`.
  - `@/lib/curriculum/shared/lessonPipelineStatus` (`PipelineStage`) —
    `TreeView.tsx`.
  - `@/lib/curriculum/shared/db` (`ensureLessonFromBreakdown`, `getLesson`,
    `getLessonBreakdown`, `saveLessonBreakdown`, `subscribe`) —
    `LessonBreakdownPanel.tsx`.
  - `@/lib/curriculum/shared/apiClient` (`ApiError`) —
    `LessonBreakdownPanel.tsx`, `QuestionInboxDialog.tsx`.
  - `@/lib/utils` (`cn`) — `TreeView.tsx`, `NodePicker.tsx`,
    `QuestionInboxDialog.tsx`.
  - `@/components/shell/LessonPipelineBadge` — `TreeView.tsx`.
  - `@/components/ui/*` (`Button`, `Textarea`, `Card`/`CardContent`/
    `CardHeader`/`CardTitle`, `Popover`/`PopoverContent`/`PopoverTrigger`,
    `Badge`) — all five files.
- **Imported by outside:**
  - `routes/index.tsx` → `TreeView`, `QuestionInboxDialog`,
    `AddChildNodesDialog`, `LessonBreakdownPanel`.
  - Nothing in `phase2-content/` imports from `phase1-tree/` — the
    dependency only runs from routing into this folder, not from the other
    phase.

## `components/curriculum/phase2-content/` (including `toolRenderers/`)

- **Imports from outside:**
  - `@/components/ui/*` — used throughout (`Badge`, `Button`, `Card` family,
    `Checkbox`, `Input`, `Label`, `Textarea`, `Separator`, `Alert` family,
    `Skeleton`).
  - `@/lib/utils` (`cn`) — `StepSidebar.tsx`,
    `toolRenderers/MCQFlashcardsRenderer.tsx`.
  - `@/lib/curriculum/shared/db` (`LessonRecord` type; `createLesson`,
    `updateLessonBreakdown`, `saveImagePrompts`, `saveInteractiveContent`,
    `saveGeneratedContent`) — `NewLessonForm.tsx`,
    `PasteImagePromptResponseForm.tsx`,
    `PasteInteractiveResponseForm.tsx`, `PasteResponseForm.tsx`,
    `InteractiveContentView.tsx`, `LessonContentView.tsx`,
    `LessonDetailPanel.tsx`, `YoutubeKeywordGenerator.tsx`.
  - `@/lib/curriculum/shared/apiClient` (`ApiError`) — `NewLessonForm.tsx`,
    `PasteImagePromptResponseForm.tsx`,
    `PasteInteractiveResponseForm.tsx`, `PasteResponseForm.tsx`,
    `YoutubeKeywordGenerator.tsx`.
  - `@/lib/tools/toolsClient` (`getTools`) — `PasteResponseForm.tsx`, to
    fetch the live tool list (the same call `routes/tools.tsx` uses)
    passed to `contentValidator.ts`'s `validateGeneratedContent`.
  - `@/lib/curriculum/shared/schema` (`ImagePromptItem`,
    `imagePromptItemSchema`, `validateImagePromptResponse`,
    `ImagePromptValidationError`, `validateYoutubeKeywordResponse`,
    `YoutubeKeywordItem`, `YoutubeKeywordValidationError`) —
    `ImagePromptCard.tsx`, `ImagePromptCardGrid.tsx`,
    `PasteImagePromptResponseForm.tsx`,
    `PasteYoutubeKeywordResponseForm.tsx`.
  - `@/lib/curriculum/phase2-content/download` (`copyTextToClipboard`,
    `downloadTextFile`, `buildImagePromptFilename`, `buildPromptFilename`,
    `triggerPrint`) — `ImagePromptCard.tsx`, `ImagePromptGenerator.tsx`,
    `PromptViewer.tsx`, `YoutubeKeywordGenerator.tsx`,
    `toolRenderers/WorksheetRenderer.tsx`.
  - `@/lib/curriculum/phase2-content/imagePromptBuilder`
    (`buildImagePromptRequest`) — `ImagePromptGenerator.tsx`.
  - `@/lib/curriculum/phase2-content/interactiveContentValidator`
    (`validateInteractiveContent`, `ContentError`) —
    `PasteInteractiveResponseForm.tsx`.
  - `@/lib/curriculum/phase2-content/contentValidator`
    (`validateGeneratedContent`) — `PasteResponseForm.tsx`.
  - `@/lib/curriculum/phase2-content/youtubeKeywordPromptBuilder`
    (`buildYoutubeKeywordPromptRequest`) — `YoutubeKeywordGenerator.tsx`.
  - `@/lib/curriculum/phase2-content/youtubeClient`
    (`searchYoutubeVideos`, `YoutubeSearchResultItem`) —
    `YoutubeKeywordGenerator.tsx`, `YoutubeSearchResults.tsx`.
  - `@/lib/curriculum/shared/lessonPipelineStatus` (`StepUnlockStatus`) —
    `StepSidebar.tsx`.
  - `@/components/curriculum/phase2-content/toolRenderers/ContentDispatcher`
    — `InteractiveContentView.tsx`, `LessonContentView.tsx` (these are
    intra-folder since `toolRenderers/` is a subfolder of
    `phase2-content/`, listed here only because the import path is
    absolute rather than relative).
  - Nothing in `phase2-content/` imports from `phase1-tree/`.
- **Imported by outside:**
  - `routes/lessons.$lessonId.tsx` → `PromptViewer`, `PasteResponseForm`,
    `LessonContentView`, `ImagePromptGenerator`, `YoutubeKeywordGenerator`,
    `StepSidebar`.
  - `routes/lessons.$lessonId.interactive-tools.tsx` → `PromptViewer`,
    `PasteInteractiveResponseForm`, `InteractiveContentView`.
  - `routes/tools.tsx`, `routes/tools.interactive.tsx` →
    `toolRenderers/ContentDispatcher` directly (bypassing the rest of
    `phase2-content/` — these two dummy-data preview routes only need the
    renderer dispatch, not the lesson-pipeline forms).

## `components/curriculum/phase3-games/`

A new, currently minimal folder holding a single placeholder component
for the not-yet-built Phase 3 games feature.

- **Imports from outside:** none beyond `lucide-react` (`Gamepad2`),
  which is excluded from this audit's scope as an npm package.
  `GamesPlaceholder.tsx` takes no props and has no internal state, so it
  does not import from `lib/curriculum/*`, `components/ui/*`, or any
  other blackboxed folder.
- **Imported by outside:**
  - `routes/lessons.$lessonId.tsx` → `GamesPlaceholder`, rendered for the
    new "Games" tab.

## `routes/`

- **Imports from outside:** everything above flows into `routes/` — it is
  the composition root, not a leaf. See the per-folder "Imported by
  outside" entries for the full list. In addition, `routes/__root.tsx`
  imports `Toaster` from `../components/ui/sonner`, `GlobalToolbar` from
  `../components/shell/GlobalToolbar`, and `AuthProvider` from
  `../lib/auth/AuthContext`.
- **Imported by outside:** none — nothing outside `routes/` imports from
  it. `src/router.tsx` consumes the generated `routeTree.gen.ts`, which is
  produced from this folder by the TanStack Router codegen rather than by
  hand-written imports (see `AGENTS.md`).

---

## Summary graph

```
components/ui/                  <- depended on by everyone; depends on nothing
                                    except one exception, hooks/use-mobile
                                    (via sidebar.tsx)
hooks/                          <- use-tree-expanded-state.ts depends on
                                    lib/curriculum/shared/schema; use-mobile.tsx
                                    depends on nothing and is depended on by
                                    components/ui/sidebar.tsx
lib/curriculum/shared/          <- depended on by everyone; internally layered
                                    (schema.ts, apiClient.ts are the base;
                                    db.ts sits above them; lessonPipelineStatus.ts
                                    sits above that). Depended on by
                                    lib/curriculum/phase2-content/ too. db.ts
                                    also has one reverse edge, importing
                                    lessonRecord.ts from phase2-content/ for
                                    its lesson-shaping helpers.
lib/curriculum/phase2-content/  <- depends on lib/curriculum/shared/ and,
                                    for promptBuilder.ts/contentValidator.ts,
                                    lib/tools/toolsClient.ts for the live
                                    tool registry, and slideshowToolUrl.ts
                                    on lib/toolRenderer/config.ts for the
                                    pened-tools base URL; internally
                                    layered (interactiveTools.ts, download.ts,
                                    imagePromptBuilder.ts,
                                    youtubeKeywordPromptBuilder.ts,
                                    slideshowToolUrl.ts are the base;
                                    contentValidator.ts,
                                    interactiveContentValidator.ts,
                                    lessonRecord.ts, phase3GenerationApi.ts,
                                    phase3PromptBuilder.ts, promptBuilder.ts,
                                    youtubeClient.ts sit above that); depended
                                    on by components/curriculum/phase2-content/,
                                    routes/, and (lessonRecord.ts only) by
                                    lib/curriculum/shared/db.ts
lib/auth/               <- depends on lib/curriculum/shared/apiClient only
                            (the one place the auth->curriculum edge runs
                            opposite to how most other folders relate to
                            lib/curriculum)
components/shell/       <- depends on ui/, lib/curriculum/shared/, lib/auth/;
                            depended on by phase1-tree/ and routes/
components/curriculum/phase1-tree/    <- depends on ui/, lib/curriculum/shared/,
                                          shell/; depended on by routes/ only
components/curriculum/phase2-content/ <- depends on ui/, lib/curriculum/shared/,
                                          lib/curriculum/phase2-content/;
                                          depended on by routes/ only
components/curriculum/phase3-games/   <- depends on nothing blackboxed (only
                                          the npm package lucide-react);
                                          depended on by routes/ only
routes/                 <- composition root; depends on all of the above;
                            depended on by nothing (routeTree.gen.ts is
                            generated, not hand-imported)
```

Two observations that should shape the next goals:

1. **`components/ui/` and `lib/curriculum/` are the real shared surface.**
   Every blackboxed folder depends on both. Any README-based "parent
   dependency" contract needs to treat these two as a standing shared
   baseline for every folder rather than something each folder negotiates
   individually.
2. **`phase1-tree/` and `phase2-content/` never import from each other.**
   The only thing connecting them is `routes/` (which imports from both)
   and their shared dependence on `lib/curriculum/` and `components/ui/`.
   This means the two phases are already cleanly separable component-wise;
   the coupling that needs documenting/managing is entirely through the
   shared `lib/curriculum/shared/` surface, not through direct
   phase-to-phase imports.