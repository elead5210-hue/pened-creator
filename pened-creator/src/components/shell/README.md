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
- `GlobalNavContextMenu.tsx`

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

### `@/components/ui/dropdown-menu`
- `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`,
  `DropdownMenuItem` — used in `GlobalNavContextMenu.tsx` for the
  menu's open/close, keyboard, focus and click-outside behavior.

### `@/components/tools/ToolSuggestionModal`
- `ToolSuggestionModal` — used in `GlobalToolbar.tsx`. The file lives at
  `src/components/tools/ToolSuggestionModal.tsx`, not in this folder;
  `GlobalToolbar.tsx` imports it from `@/components/tools/ToolSuggestionModal`.

Nothing in this folder imports from `phase1-tree/` or
`phase2-content/`.

## `GlobalNavContextMenu`

A right-click/overflow context menu rendered as part of the global
nav chrome (mounted alongside `GlobalToolbar`). It presents a small,
fixed list of app-wide actions — it is not a per-page or per-lesson
menu, and it does not know about `phase1-tree/` or `phase2-content/`
internals.

### Item structure

Each menu item is a plain object with the shape:

```ts
type GlobalNavMenuItem = {
  id: string;          // stable identifier, used as React key
  label: string;        // visible text
  icon?: ReactNode;      // optional leading icon
  onSelect: () => void;  // click handler
  disabled?: boolean;    // optional, greys out and blocks onSelect
};
```

Items are declared as a local array inside `GlobalNavContextMenu.tsx`
and rendered in order. There is no external registry — the menu's
contents are owned entirely by this component.

### Adding a new menu option

1. Add a new `GlobalNavMenuItem` entry to the items array in
   `GlobalNavContextMenu.tsx`, giving it a unique `id` and `label`.
2. Implement the `onSelect` handler inline, or import a handler from
   an existing parent dependency (see the list above). If the new
   option needs something not already imported, add that import to
   the "Parent dependencies" section first.
3. Do not add phase-specific logic directly to a menu item — if an
   option needs to affect `phase1-tree/` or `phase2-content/`, route
   it through a shared dependency (e.g. `lib/curriculum/shared/`)
   rather than importing from those folders directly.
4. Keep item order stable/intentional; new items are typically
   appended unless there's a clear grouping reason to place them
   elsewhere.

## `ToolSuggestionModal`

`ToolSuggestionModal` lives in `src/components/tools/ToolSuggestionModal.tsx`,
not in this folder — see that folder's README for its contract.
`GlobalToolbar.tsx` imports it from `@/components/tools/ToolSuggestionModal`
(an import of `@/components/shell/ToolSuggestionModal` will fail to resolve
and break the build). It is mounted alongside `GlobalToolbar` and used by
this folder's chrome, as described below.

### Wiring

- `GlobalToolbar.tsx` owns the open/closed state for the modal (as
  local `useState`) and renders `<ToolSuggestionModal />` alongside
  its other chrome, passing `open` and `onOpenChange`. The optional
  `onSubmitted` callback is not used by the toolbar.
- A nav/menu action (e.g. a button in `GlobalToolbar` or an entry in
  `GlobalNavContextMenu.tsx`) sets the open state to `true` to launch
  the modal. There is no separate route or deep link for it — it is
  purely client-side dialog state.

### Submission flow

- The modal holds its own local form state (the suggestion text) and
  validates it (10 to 2000 characters after trimming) before allowing
  submit.
- On submit, the modal itself calls `submitToolSuggestion` from
  `@/lib/tools/toolSuggestionsClient`, shows a success toast, and
  closes itself after a short delay. On failure it stays open and shows
  the error inline. `GlobalToolbar.tsx` supplies no submit handler, so
  it needs no persistence or notification logic of its own.

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