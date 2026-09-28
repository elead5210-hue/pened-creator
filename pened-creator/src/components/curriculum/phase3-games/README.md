# `phase3-games/` — Phase 3: Games (placeholder)

This folder will eventually own Phase 3 of the curriculum pipeline:
letting a user pick and embed a prebuilt game for a lesson. Right now
it holds only a placeholder panel — there is no game list, selection
state, or embedding logic yet. This README documents the current
(minimal) contract; it should grow alongside the feature.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.

## Files in this folder

- `GamesPlaceholder.tsx` — renders a static empty-state message (icon
  + "Games are coming soon" copy) inside a dashed-border panel. No
  props, no internal state, no data fetching.

## Parent dependencies

Everything this folder imports from outside itself. Nothing outside
this list may be assumed to exist — if a change here needs something
not on this list, that's a signal this README needs updating first.

### `lucide-react`
- `Gamepad2` — used in `GamesPlaceholder.tsx` as the placeholder's
  icon.

Nothing in this folder imports from `phase1-tree/`, `phase2-content/`,
`components/shell/`, `components/tools/`, `lib/auth/`, or
`lib/curriculum/`.

## Imported by (outside this folder)

- `src/routes/lessons.$lessonId.tsx` — imports `GamesPlaceholder` to
  render the "Games" tab's content.

## Notes for an agent working only in this folder

- `GamesPlaceholder.tsx` is deliberately inert: it takes no props,
  holds no state, and makes no requests. Don't wire it up to real game
  data, a game picker, or an iframe/embed speculatively — that's a
  separate, larger task that should come with its own plan (likely
  including new `lib/curriculum/` schema and API surface, mirroring
  how `phase2-content/` is structured).
- If a future task does build out real game functionality here, split
  this README's "Files in this folder" and "Parent dependencies"
  sections to reflect the new modules rather than continuing to treat
  `GamesPlaceholder.tsx` as the whole folder.
- If you add a new import from outside this folder, add it to the
  "Parent dependencies" section above so the contract stays accurate.