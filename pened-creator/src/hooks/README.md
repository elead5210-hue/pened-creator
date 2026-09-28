# `hooks/` — shared React hooks

This folder holds small, standalone React hooks used across the app.
It is not phase-specific — one hook is consumed by `components/ui/`
and the other by `routes/`.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.
The source audit this was derived from lives in
`docs/dependency-map.md`.

## Files in this folder

- `use-mobile.tsx` — `useIsMobile` tracks whether the viewport is
  below the mobile breakpoint (768px) via `matchMedia`. No internal
  or outside dependencies.
- `use-tree-expanded-state.ts` — `useTreeExpandedState` persists the
  curriculum tree's expanded/collapsed node state to `localStorage`,
  namespaced by `PROJECT_ID` so separate projects don't clobber each
  other's saved state.

## Parent dependencies

Everything this folder imports from outside itself. Nothing outside
this list may be assumed to exist — if a change here needs something
not on this list, that's a signal the dependency map and this README
need updating first.

### `@/lib/curriculum/shared/schema`
- `PROJECT_ID` — used in `use-tree-expanded-state.ts` to namespace its
  `localStorage` key.

`use-mobile.tsx` has no parent dependencies of its own — it only uses
React and the browser `matchMedia` API.

## Imported by (outside this folder)

Files outside `hooks/` that import from it. Renaming or removing an
exported symbol below is a breaking change for the listed file.

- `src/components/ui/sidebar.tsx` — imports `useIsMobile` from
  `use-mobile.tsx` to collapse the sidebar on small viewports.
- `src/routes/index.tsx` — imports `useTreeExpandedState` from
  `use-tree-expanded-state.ts`.

## Notes for an agent working only in this folder

- `use-mobile.tsx` and `use-tree-expanded-state.ts` are independent of
  each other — neither imports the other, and their outside consumers
  don't overlap (`components/ui/` vs. `routes/`).
- `use-tree-expanded-state.ts`'s only outside dependency is
  `PROJECT_ID` from `lib/curriculum/shared/schema.ts`. Treat that
  constant as fixed unless the task explicitly asks you to change it
  — a change there affects every other folder that imports from
  `lib/curriculum/shared/`.
- If you add a new import from outside this folder, or a new outside
  consumer, add it to the relevant section above so the contract
  stays accurate.