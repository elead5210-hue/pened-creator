# `lib/curriculum/shared/` — cross-phase contract module

This folder is the explicit, narrowly-scoped shared surface between
Phase 1 (`components/curriculum/phase1-tree/`) and Phase 2
(`components/curriculum/phase2-content/`). It exists so those two
folders' READMEs can point at one clearly-scoped shared dependency
instead of an ad hoc mix of files across a flat `lib/curriculum/`.

If a task needs both phases to see the same curriculum-tree or lesson
data shape, it belongs here. If it's only ever consumed by Phase 2
(prompt builders, tool registries, content validators, the YouTube/
image-prompt helpers), it belongs in the sibling `phase2-content/`
folder instead — see that folder's own README.

## Files in this folder

- `schema.ts` — curriculum-tree and lesson-breakdown data shapes,
  `PROJECT_ID`, and validation functions (`expand`,
  `validateLessonBreakdownDocument`, etc.). The base of this folder's
  internal dependency graph — has no dependency on any other file
  here.
- `apiClient.ts` — the shared HTTP client (`apiGet`, `apiPost`,
  `apiPut`, `apiDelete`, `ApiError`). Also the base of the graph; no
  internal dependencies.
- `db.ts` — the penedv1-server-API-backed lesson/curriculum store
  (CRUD + `subscribe`). Depends on `./schema`, `./apiClient`, the
  sibling `../phase2-content/slideshowInteractiveContent` (pure helpers
  for reading and replacing a lesson's slideshow entry), and (for
  lesson-record shaping
  helpers: `createLessonRecord`, `updateLessonRecord`,
  `setLessonStatus`, `setLessonGeneratedContent`,
  `setLessonImagePrompts`, `setLessonImage`, `setLessonImageNoBg`,
  `setLessonSlideshowDeck`, `buildLessonId`) the sibling
  `../phase2-content/lessonRecord`.

  **Slideshow decks are stored on the server**, as the
  `{ tool: "slideshow", data: <deck> }` entry of the lesson's
  `interactiveContent`. This is the same entry pened-tools loads by
  lesson id (`/tool/slideshow/<encoded lessonId>`, where the lesson id
  is `<project_id>:<lesson_node_id>`), so a saved deck is visible to
  pened-tools and from any browser. Endpoints used:
  - **Read:** `getLesson` takes `interactiveContent` from the lesson
    record when the server includes it, and otherwise calls
    `GET /api/lessons/:id/interactive-content` (response
    `{ id, interactiveContent: entries | null }`, validated by
    `lessonInteractiveContentResponseSchema` in `schema.ts`; a 404 or
    `null` means nothing is saved). It then derives the record's
    `slideshowDeck` from the first `tool === "slideshow"` entry,
    mirroring pened-tools.
  - **Write:** `saveSlideshowDeck` reads the lesson's entries fresh,
    then saves the merged array with `PUT /api/lessons/:id`. The
    derived `slideshowDeck` field is not sent, so a large deck is
    only in the request body once.
  - **Verify:** after the `PUT`, it reads the entries back from the
    interactive-content endpoint and only resolves once a slideshow
    deck is actually there, so a server that silently drops the field
    doesn't look like a success.

  **Replace on regenerate:** saving replaces the existing slideshow
  entry in place (via `upsertSlideshowEntry`) instead of appending a
  second one, and drops any duplicate slideshow entries. Entries for
  other tools are passed through untouched.

  **Errors:** a failed save throws `SlideshowSaveError`, whose `reason`
  is one of `not_found`, `unauthorized`, `too_large`, `server`,
  `network`, `not_persisted`, `invalid_response` or `unknown`, with a
  message that is safe to show to the user. No pened-tools credential is
  involved: these requests use this app's own session via `apiClient.ts`.

  **Legacy migration:** decks used to be kept in a browser-local
  IndexedDB database (`pened-slideshow-decks`, the former
  `slideshowDeckLocalStore.ts`, now removed) because the server didn't
  store them. When `getLesson` finds no server-side deck, it checks that
  database directly (once per lesson per page load), pushes any
  leftover deck to the server, and clears the local copy on success. If
  the push fails, the local copy is kept and retried on a later load.
  `deleteLesson` clears any leftover local deck for the deleted lesson
  id so it can't be migrated into a later lesson with the same id.
- `lessonPipelineStatus.ts` — computes a lesson's pipeline stage
  (`PipelineStage`, `computeLessonPipelineStage`,
  `StepUnlockStatus`). Depends on `./db` (`LessonRecord`).

## List-endpoint response shapes (don't guess these)

Two bulk endpoints back the curriculum tree's per-lesson progress badges
(see `routes/index.tsx`). Their response shapes are easy to get subtly
wrong, and a wrong field name fails silently (every lesson just looks
unstarted), so they are pinned down here. The server's own tests are the
source of truth for both.

- `GET /api/lesson-breakdowns?projectId=` returns
  `[{ node_id: string, breakdown: LessonBreakdown }]`. The lesson node id
  is `node_id` (there is **no** `lesson_node_id` field on these rows) and
  the breakdown is nested under `breakdown`, not merged into the row.
  `listLessonBreakdowns()` in `db.ts` reads `node_id` and returns the ids
  as a `string[]`. The per-node `GET /api/lesson-breakdowns/:nodeId` is
  different: it returns the bare breakdown, because the id is already in
  the URL.
- `GET /api/lessons?projectId=` returns lightweight **summaries**, not
  full lesson records: `id`, `project_id`, `lesson_node_id`, `breakdown`,
  `status`, `generatedPrompt`, `imagePrompts`, `createdAt`, `updatedAt`.
  It deliberately omits `generatedContent`,
  `images` and `imagesNoBg` (and `interactiveContent`, where the
  slideshow deck is stored, along with the derived `slideshowDeck`).
  `listLessons()` is typed as `LessonRecord[]` for
  convenience, so don't read those omitted fields off list results; they
  will be `undefined`. That is fine for `computeLessonPipelineStage`,
  which also looks at `status`, `generatedPrompt` and `imagePrompts`. Use
  `getLesson(id)` (`GET /api/lessons/:id`) when you need the full record.

If either server response shape changes, update `db.ts`, this section,
and the server's README together.

## Parent dependencies

No file in this folder imports from `components/*`, `hooks/`, or
`lib/auth/`. There is one exception to "depends on nothing": `db.ts`
imports its lesson-record shaping helpers from the sibling
`@/lib/curriculum/phase2-content/lessonRecord`, since those helpers
(validating/defaulting a lesson record, status transitions) are
implemented there rather than duplicated here. This folder, along with
`components/ui/`, is otherwise one of the two true shared/base
dependencies in the project — every other blackboxed folder that
touches curriculum or lesson data depends on it, not the reverse.

## Imported by (outside this folder)

- **`components/curriculum/phase1-tree/`** — `schema.ts`
  (`CurriculumNode`, `LESSON_NODE_TYPE`),
  `lessonPipelineStatus.ts` (`PipelineStage`), `db.ts`
  (`ensureLessonFromBreakdown`, `getLesson`, `getLessonBreakdown`,
  `saveLessonBreakdown`, `subscribe`), `apiClient.ts` (`ApiError`).
- **`components/curriculum/phase2-content/`** (including
  `toolRenderers/`) — `db.ts` (`LessonRecord` type; lesson save
  functions), `apiClient.ts` (`ApiError`), `schema.ts` (image-prompt
  and YouTube-keyword validation/types),
  `lessonPipelineStatus.ts` (`StepUnlockStatus`).
- **`lib/curriculum/phase2-content/`** — several modules there import
  from here rather than from each other: `lessonRecord.ts` →
  `./schema` (`validateLessonBreakdownDocument`),
  `youtubeClient.ts` → `./apiClient` (`apiPost`). The reverse edge
  also exists: this folder's own `db.ts` imports lesson-record shaping
  helpers from `phase2-content/lessonRecord.ts` (see "Parent
  dependencies" above) — the one place this folder depends on its
  sibling rather than the other way around.
- **`components/shell/`** — `db.ts` (`getLesson`,
  `getLessonBreakdown`, `subscribe`, `LessonRecord`), `schema.ts`
  (`PROJECT_ID`), `lessonPipelineStatus.ts`
  (`computeLessonPipelineStage`, `PipelineStage`).
- **`hooks/`** — `use-tree-expanded-state.ts` imports `PROJECT_ID`
  from `schema.ts`.
- **`lib/auth/`** — `authClient.ts` imports `apiGet`, `apiPost`,
  `ApiError` from `apiClient.ts`. This is the one place the
  dependency direction runs `lib/auth` → this folder rather than the
  reverse.
- **`routes/`** — nearly every route file imports from here:
  `index.tsx` (`apiClient`, `schema`, `lessonPipelineStatus`),
  `lessons.$lessonId.tsx` (`apiClient`, `schema`),
  `login.tsx`/`register.tsx` (`apiClient` for `ApiError`).

## Notes for an agent working only in this folder

- This is a high-blast-radius folder: a breaking change to `schema.ts`
  or `db.ts` in particular affects both curriculum phases, the shell,
  hooks, `lib/auth/`, most of `routes/`, and several modules in the
  sibling `phase2-content/` lib folder. Prefer additive changes (new
  optional fields, new functions) over renaming or removing existing
  exports.
- `schema.ts` and `apiClient.ts` have no dependents within this folder
  that they depend on back — they're safe to reason about in
  isolation from `db.ts` and `lessonPipelineStatus.ts`.
- If you add a new import from outside this folder (there currently
  are none), or a new outside consumer, update this README and
  `docs/dependency-map.md` to match.