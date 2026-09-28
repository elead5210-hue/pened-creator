# Merge architecture: curricullumbuilder as the single host app

> **Note on paths:** this document was originally written when this app
> lived at `client/curricullumbuilder/`, with `contentBuilder/` as its
> sibling. That nested `curricullumbuilder/` directory has since been
> flattened directly into `client/` — everything described below
> (`src/routes/`, `src/lib/curriculum/`, `src/components/curriculum/`,
> etc.) now lives at `client/src/...` rather than
> `client/curricullumbuilder/src/...`. `contentBuilder/` did not move
> when that flatten happened, but as noted below it has since been
> deleted outright.

This project (`curricullumbuilder`, package name `penedmerge`) is the
surviving shell for the merge of two previously separate apps:

- **curricullumbuilder** ("TreeBuilder") — TanStack Start + React 19 +
  TypeScript + Tailwind v4 + shadcn/ui. Builds and stores a curriculum
  tree, files exam questions into it via AI categorization, and generates
  per-lesson breakdowns (`{version, project_id, lesson_node_id,
  breakdown}`).
- **contentBuilder** ("GEDClient") — a vanilla-JS + Vite app with
  hand-rolled CSS. Took a lesson breakdown in that same JSON shape,
  saved it to IndexedDB, assembled an AI prompt from it plus a registry
  of content-rendering tools, and rendered the AI's generated content
  back for the lesson. Now fully ported and removed — see the porting
  table and Status section below.

## Why curricullumbuilder was chosen as the host

1. **Framework and styling already match the target.** It's the only one
   of the two already on React/TypeScript/Tailwind/shadcn — the styling
   system this merge standardizes on. contentBuilder is vanilla JS with
   bespoke per-component CSS; there is no host direction that avoids a
   rewrite of contentBuilder's UI, so it made sense to rewrite it into
   the stack that's already in place rather than the other way around.
2. **It already owns the upstream half of the pipeline.** The curriculum
   tree, exam-question filing, and lesson breakdown generation all
   originate here. contentBuilder only ever consumes a breakdown as
   input, so folding contentBuilder's logic into this app keeps the
   whole tree → breakdown → content pipeline in one place instead of
   requiring a copy/paste hand-off between two separate apps.
3. **Its schema is already the shared contract.** `PROJECT_ID` and the
   `LessonBreakdownResponse` shape in `src/lib/curriculum/schema.ts`
   are what contentBuilder's `lessonSchema.js` independently re-derived.
   Treating this file as canonical avoids maintaining two parallel
   copies of the same validation logic.
4. **Its routing and IndexedDB layer are the more extensible base.**
   TanStack Start's file-based routing and the existing
   `src/lib/curriculum/db.ts` flat-node store give a straightforward
   place to extend with a `lessons` store and a fuller
   `/lessons/$lessonId` route, versus retrofitting a router and a
   component framework onto contentBuilder's plain `src/app.js` shell.

## Phase 1 / Phase 2 boundary

The merged pipeline is split into two explicitly named phases, both in
the folder structure and in the routed UI:

- **Phase 1: Curriculum** — building the curriculum tree, filing exam
  questions into it, and producing/editing a lesson's breakdown. This is
  the `curricullumbuilder` half of the original merge.
- **Phase 2: Content Generation** — turning a saved breakdown into an AI
  prompt, capturing the pasted AI response, and rendering the generated
  lesson content. This is the ported `contentBuilder` half.

### Component folder split

`src/components/curriculum/` is divided into one directory per phase,
plus the shared `db.ts`/`schema.ts`/`toolRegistry.ts` modules in
`src/lib/curriculum/` that both phases depend on:

| Directory | Phase | Contents |
| --- | --- | --- |
| `src/components/curriculum/phase1-tree/` | Phase 1: Curriculum | `TreeView.tsx`, `NodePicker.tsx`, `LessonBreakdownPanel.tsx`, `CurriculumImportDialog.tsx`, `QuestionInboxDialog.tsx` |
| `src/components/curriculum/phase2-content/` | Phase 2: Content Generation | `NewLessonForm.tsx`, `LessonDetailPanel.tsx`, `LessonPromptPanel.tsx`, `PromptViewer.tsx`, `PasteResponseForm.tsx`, `LessonContentView.tsx`, and `phase2-content/toolRenderers/` (`ContentDispatcher.tsx` plus the individual `*Renderer.tsx` components: Introduction, Objectives, Vocabulary, Activity, Assessment, Checklist, Prerequisites) |

There is no longer a bare `src/components/curriculum/*.tsx` or
`src/components/curriculum/toolRenderers/` — every component that used
to live directly under `components/curriculum/` has been relocated into
whichever of the two phase directories owns it, with relative imports
(`schema.ts`, `db.ts`, `download.ts`, and sibling components) adjusted
for the added nesting level.

### Phase-labeled routing and breadcrumbs

- `src/routes/index.tsx` — the Phase 1 route (`/`). Imports `TreeView`,
  `QuestionInboxDialog`, and `CurriculumImportDialog` from their
  `phase1-tree/` paths.
- `src/routes/lessons.$lessonId.tsx` — the Phase 2 route
  (`/lessons/$lessonId`). Imports `NewLessonForm`, `PromptViewer`,
  `PasteResponseForm`, and `LessonContentView` from their
  `phase2-content/` paths, and its own header renders an explicit
  "Phase 2: Content Generation" label alongside the per-lesson
  Breakdown/Generate Prompt/Paste/View Content tabs.
- `src/routes/__root.tsx` — hosts a route-independent `PhaseBanner`
  component. `getPhaseLabel(pathname)` maps any path starting with
  `/lessons` to `"Phase 2: Content Generation"` and everything else
  (including `/`) to `"Phase 1: Curriculum"`, defaulting to Phase 1 for
  unrecognized paths so the banner never renders blank. `PhaseBanner` is
  rendered above `<Outlet />` in `RootComponent`, so the active phase
  stays visible across every screen regardless of which in-page tab is
  selected — this is what makes the phase a screen belongs to obvious
  from the UI itself, not just implied by which tab you're on.

## Where each piece of contentBuilder went

| contentBuilder source | Ported into | Roadmap goal |
| --- | --- | --- |
| `src/models/lessonSchema.js`, `src/models/lesson.js` (validation, `PROJECT_ID` duplication) | `src/lib/curriculum/schema.ts` | Unify the shared PROJECT_ID and schema module |
| `src/db/schema.js`, `src/db/lessonRepository.js` (lessons IndexedDB store) | `src/lib/curriculum/db.ts` | Merge the two IndexedDB layers into one db module |
| Manual "paste breakdown JSON into contentBuilder" step | Direct call from the breakdown save path into lesson-record creation | Wire the breakdown hand-off directly into lesson creation |
| `src/tools/toolRegistry.js`, `src/prompt/promptBuilder.js`, `src/tools/contentValidator.js` | New `src/lib/curriculum/` (or `src/lib/content/`) modules, converted to TypeScript | Port the tool registry and prompt builder into treebuilder's lib |
| `src/components/newLessonForm/`, `lessonDetail/`, `promptViewer/`, `pasteResponseForm/`, `lessonContentView/`, `toolRenderers/` (JS + hand-rolled CSS) | `src/components/curriculum/phase2-content/` `.tsx` components built on the existing shadcn/ui primitives and `styles.css` theme tokens | Rebuild gedclient's UI as Tailwind/shadcn components |
| The paste/generate/view lesson-content flow as a whole | Extended `src/routes/lessons.$lessonId.tsx` into a tabbed detail route, labeled "Phase 2: Content Generation" | Extend routing for the full lesson lifecycle |
| Lesson lifecycle status (`draft` / `prompt-generated` / `content-generated`) | Status indicator alongside the existing `hasBreakdown` flag in `phase1-tree/TreeView.tsx` | Surface lesson content status in the tree view |
| `package.json` (Vite-only deps), `vite.config.js`, `index.html` | Folded into / replaced by this project's `package.json` and `vite.config.ts`; `contentBuilder/` has been deleted — done | Consolidate build tooling and package manifests |
| `docs/curriculum-import-regression-checklist.md` | Merged into `docs/qa/` alongside the existing checklists here | Merge QA docs into one end-to-end regression checklist |

## Status

This document reflects the target end-state agreed at the "Adopt
treebuilder as the single host app" step, including the subsequent
"Draw an explicit Phase 1 / Phase 2 boundary in the codebase and
routing" goal, whose folder split (`phase1-tree/` / `phase2-content/`)
and phase-labeled routing/breadcrumbs are now in place. The
"Consolidate build tooling and package manifests" goal has now also
landed: `contentBuilder/`'s `package.json`, `vite.config.js`, and
`index.html` were confirmed redundant (their logic already lived in
this project's own `package.json`/`vite.config.ts`), and the entire
`client/contentBuilder/` directory has been deleted. Every row in the
porting table above is complete. Remaining work under the Phase 1 /
Phase 2 boundary goal — the global toolbar/shell, the Tool Registry
view, consolidating the breakdown edit/regenerate path into Phase 1,
and consistent phase/pipeline status across the new nav — is still
tracked separately in the roadmap and not yet reflected here.

Separately, the app's own root directory has been renamed/flattened:
this project previously lived at `client/curricullumbuilder/` (a nested
subdirectory alongside `client/contentBuilder/`) and now lives directly
at `client/` — the `curricullumbuilder/` path segment has been removed
and all of `src/`, `docs/`, `package.json`, etc. moved up one level.
This was a location change only; none of the architecture, phase
boundary, or porting-status rows described above changed as a result of
it.

## Decision record: image storage strategy (Image Generation step)

The Image Generation step (Phase 2) lets a user upload an image against
each AI-returned image prompt. Two options were considered for storing
those uploads:

1. **Base64 data URLs inside the existing JSON-based lesson record** —
   simplest to implement end-to-end (no new route, no object storage
   provider to configure), but bloats the `lessons` row/payload size
   since every uploaded image is stored inline as text.
2. **A dedicated file-upload endpoint / object storage**, with the
   lesson record holding only a URL reference — keeps lesson payloads
   small and avoids re-sending image bytes on every lesson read/write,
   but requires a new upload route, a storage backend (disk, S3-compatible
   bucket, etc.), and additional handling for cleanup/orphaned files.

**Decision: option 1 (base64 data URLs), accepting the payload-bloat
tradeoff.** This matches the scale of the app (single-user/small-team
lesson authoring, not high-volume production imagery) and keeps the
Image Generation step consistent with how `generatedContent` and
`interactiveContent` are already persisted — as plain JSON on the
lesson record via the existing generic `PUT /api/lessons/:id`, with no
new endpoint required.

This is implemented end-to-end as follows:

- **Client upload UI** — `ImagePromptCard.tsx` reads the picked file via
  `FileReader.readAsDataURL` and calls `onUpload(promptId, dataUrl)`.
- **Client persistence** — `ImagePromptCardGrid.tsx` forwards that data
  URL to `saveGeneratedImage(lessonId, promptId, dataUrl)` in
  `src/lib/curriculum/db.ts`, which merges it into the lesson record's
  `images` map (keyed by image-prompt id) and PUTs the whole record.
- **Server persistence** — the server stores `images` (and the parsed
  `imagePrompts` array) as JSONB columns on the `lessons` table,
  alongside `generated_content`/`interactive_content`. No separate
  upload route or object-storage bucket was added.
- **Server body-size limit** — because uploaded images now travel as
  base64 text inside the same JSON body as the rest of the lesson
  record, the server's `express.json()` body-size limit was raised
  (from its ~100kb default) so image-bearing `PUT /api/lessons/:id`
  requests aren't rejected with a 413.

If usage later grows to the point where inline base64 storage becomes a
real cost or performance problem, the natural follow-up is to revisit
option 2 above — swap the `images` map's values from data URLs to
hosted URLs behind a small upload endpoint — without needing to change
the shape of `imagePrompts` or the rest of the Image Generation flow.