# `phase1-tree/` — Phase 1: Curriculum

This folder owns Phase 1 of the curriculum pipeline: building the
curriculum tree, filing exam questions into it, and producing/editing a
lesson's breakdown. See `docs/merge-architecture.md` for the full
Phase 1 / Phase 2 background.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.
The source audit this was derived from lives in
`docs/dependency-map.md`.

## Files in this folder

- `TreeView.tsx`
- `NodePicker.tsx`
- `QuestionInboxDialog.tsx`
- `LessonBreakdownPanel.tsx`

## Parent dependencies

Everything this folder imports from outside itself. Nothing outside
this list may be assumed to exist — if a change here needs something
not on this list, that's a signal the dependency map and this README
need updating first.

### `@/lib/curriculum/shared/schema`
- `CurriculumNode` (type), `LESSON_NODE_TYPE` — used in `TreeView.tsx`.
- `CurriculumNode` (type) — used in `NodePicker.tsx`.

### `@/lib/curriculum/shared/lessonPipelineStatus`
- `PipelineStage` (type) — used in `TreeView.tsx`.

### `@/lib/curriculum/shared/db`
- `ensureLessonFromBreakdown`, `getLesson`, `getLessonBreakdown`,
  `saveLessonBreakdown`, `subscribe` — used in
  `LessonBreakdownPanel.tsx`.

### `@/lib/curriculum/shared/apiClient`
- `ApiError` — used in `LessonBreakdownPanel.tsx` and
  `QuestionInboxDialog.tsx`.

### `@/lib/utils`
- `cn` — used in `TreeView.tsx`, `NodePicker.tsx`, and
  `QuestionInboxDialog.tsx`.

### `@/components/shell/LessonPipelineBadge`
- `LessonPipelineBadge` — used in `TreeView.tsx` to show pipeline
  status per node. This is the one dependency this folder has on
  another blackboxed folder rather than on `lib/` or `components/ui/`.

### `@/components/ui/*`
Standard shadcn/ui primitives, treated as a standing shared baseline
(see that folder's own README — it has no parent dependencies of its
own). Each bullet names the underlying module (in parentheses)
alongside the exports this folder uses from it:
- `Button` (`button`), `Textarea` (`textarea`) — used across this
  folder.
- `Card`, `CardContent`, `CardHeader`, `CardTitle` (`card`) — used in
  `LessonBreakdownPanel.tsx` and `QuestionInboxDialog.tsx`.
- `Popover`, `PopoverContent`, `PopoverTrigger` (`popover`) — used in
  `NodePicker.tsx`.
- `Badge` (`badge`) — used in `NodePicker.tsx` and
  `QuestionInboxDialog.tsx`.
- `Dialog`, `DialogContent`, `DialogDescription`, `DialogClose`,
  `DialogFooter`, `DialogHeader`, `DialogTitle`, `DialogTrigger`
  (`dialog`) — used in `QuestionInboxDialog.tsx`.
- `Command`, `CommandEmpty`, `CommandGroup`, `CommandInput`,
  `CommandItem`, `CommandList` (`command`) — used in `NodePicker.tsx`.

## Imported by (outside this folder)

Files outside `phase1-tree/` that import from it. Renaming or removing
an exported symbol below is a breaking change for the listed file.

- `src/routes/index.tsx` — imports `TreeView`, `QuestionInboxDialog`,
  and `LessonBreakdownPanel`. This is the only outside consumer;
  nothing in `phase2-content/` imports from this folder.

## Notes for an agent working only in this folder

- Phase 1 and Phase 2 (`phase2-content/`) never import from each other
  directly — the only coupling between them runs through
  `lib/curriculum/` and `components/ui/`. You should not need to touch
  `phase2-content/` to work here.
- `lib/curriculum/shared/schema.ts` and `lib/curriculum/shared/db.ts` are the shared
  contract for curriculum-tree/lesson data shapes. Treat their exported
  types and function signatures as fixed unless the task explicitly
  asks you to change them (a change there affects `phase2-content/`,
  `shell/`, `hooks/`, and most of `routes/` too — outside this folder's
  blackbox).
- If you add a new import from outside this folder, add it to the
  "Parent dependencies" section above so the contract stays accurate.