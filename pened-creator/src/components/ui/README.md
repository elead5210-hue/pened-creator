# `components/ui/` — shared UI primitives

This folder holds the shadcn/ui primitive components (button, card,
input, textarea, tabs, popover, badge, alert, skeleton, dialog, form,
etc.) that the rest of the app is built on. It is not phase-specific —
both curriculum phases, the app shell, and the routes all use it.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.
The source audit this was derived from lives in
`docs/dependency-map.md`.

## Parent dependencies

Almost none. `components/ui/` does not import anything from `@/lib/*`
(aside from `@/lib/utils` for the `cn` helper), `@/components/curriculum/*`,
or `@/components/shell/*` — with one exception:

### `@/hooks/use-mobile`
- `useIsMobile` — used in `sidebar.tsx` to collapse the sidebar on
  small viewports.

Aside from that one hook and the npm packages this folder is built on
(React, Radix UI primitives, `lucide-react`, `class-variance-authority`,
etc.), this is close to a true leaf dependency: there is almost no
external contract an agent here needs to track. The one thing to
preserve is the **public shape** of each component (its exported name
and prop signature), since that shape is exactly what every other
folder's "parent dependencies" section promises is stable.

## Imported by (outside this folder)

Every other blackboxed folder imports from here. Because the list of
individual imports is large and changes often, this README tracks it
at the folder level rather than the per-symbol level used by other
folders' READMEs — see `docs/dependency-map.md` for the full per-file
breakdown if you need it.

- `src/components/curriculum/phase1-tree/` — `Button`, `Textarea`,
  `Card`/`CardContent`/`CardHeader`/`CardTitle`, `Popover`/
  `PopoverContent`/`PopoverTrigger`, `Badge`.
- `src/components/curriculum/phase2-content/` (including
  `toolRenderers/`) — `Badge`, `Button`, `Card` family, `Checkbox`,
  `Input`, `Label`, `Textarea`, `Separator`, `Alert` family, `Skeleton`.
- `src/components/shell/` — `Button`.
- `src/routes/` — `Button`, `Input`, `Tabs`/`TabsList`/`TabsTrigger`,
  `Toaster` (from `sonner.tsx`), among others depending on the route.

## Notes for an agent working only in this folder

- Because nearly every other folder depends on this one, a breaking
  change here (renaming an export, changing a required prop, changing
  a component's DOM structure in a way other folders rely on) can
  ripple across the entire app without you being able to see those
  call sites from inside this folder alone. Prefer additive changes
  (new optional props, new variants) over breaking ones.
- If a task requires a breaking change to a component here, flag it
  rather than making it silently — the other folders' READMEs list
  this folder as a standing shared baseline, not something they
  re-check per change.
- This folder has almost no parent-dependency section to maintain
  going forward — just the one `@/hooks/use-mobile` import in
  `sidebar.tsx` documented above; the "Imported by" section is what
  needs updates if new folders start consuming components from here.