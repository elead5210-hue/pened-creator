# `components/shell/` — app-wide chrome

This folder owns app-wide UI chrome that isn't specific to either
curriculum phase: the global toolbar/navigation and the lesson
pipeline-status badge it (and Phase 1) use to show where a lesson is
in the pipeline.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.
The source audit this was derived from lives in
`docs/dependency-map.md`.

## Files in this folder

- `GlobalToolbar.tsx`
- `LessonPipelineBadge.tsx`

## Parent dependencies

Everything this folder imports from outside itself. Nothing outside
this list may be assumed to exist — if a change here needs something
not on this list, that's a signal the dependency map and this README
need updating first.

### `@/lib/utils`
- `cn` — used in `GlobalToolbar.tsx` and `LessonPipelineBadge.tsx`.

### `@/lib/curriculum/shared/db`
- `getLesson`, `getLessonBreakdown`, `subscribe`, `LessonRecord` (type)
  — used in `GlobalToolbar.tsx`.

### `@/lib/curriculum/shared/schema`
- `PROJECT_ID` — used in `GlobalToolbar.tsx`.

### `@/lib/curriculum/shared/lessonPipelineStatus`
- `computeLessonPipelineStage`, `PipelineStage` (type) — used in
  `GlobalToolbar.tsx`.
- Pipeline-stage types — also used in `LessonPipelineBadge.tsx`.

### `@/lib/auth/AuthContext`
- `useAuth` — used in `GlobalToolbar.tsx`.

### `@/components/ui/button`
- `Button` — used in `GlobalToolbar.tsx`.

Nothing in this folder imports from `phase1-tree/` or
`phase2-content/`.

## Imported by (outside this folder)

Files outside `components/shell/` that import from it. Renaming or
removing an exported symbol below is a breaking change for the listed
file.

- `src/components/curriculum/phase1-tree/TreeView.tsx` — imports
  `LessonPipelineBadge` to show pipeline status per tree node. This is
  the one place a phase folder depends on this one.
- `src/routes/__root.tsx` — imports `GlobalToolbar`, mounted app-wide
  above `<Outlet />` so it's visible on every screen.
- `src/routes/lessons.$lessonId.tsx` and
  `src/routes/lessons.$lessonId.interactive-tools.tsx` — import
  `LessonPipelineBadge`.

## Notes for an agent working only in this folder

- This folder sits between the two phases: `phase1-tree/` depends on
  it (via `LessonPipelineBadge`), and it's mounted globally by
  `routes/__root.tsx`. A breaking change to `LessonPipelineBadge`'s
  props affects both `phase1-tree/` and the two lesson routes above —
  all outside this folder's blackbox.
- `lib/curriculum/shared/db.ts`, `schema.ts`, and
  `lessonPipelineStatus.ts` are the shared contract for lesson/
  pipeline data shapes. Treat their
  exported types and function signatures as fixed unless the task
  explicitly asks you to change them.
- If you add a new import from outside this folder, add it to the
  "Parent dependencies" section above so the contract stays accurate.