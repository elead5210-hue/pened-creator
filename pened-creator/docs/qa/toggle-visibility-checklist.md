# QA checklist: Curriculum/Questions toggle visibility on load

## Background

Regression this guards against: the header's Curriculum/Questions `Tabs`
toggle (in `src/routes/index.tsx`) failed to appear when the app first
loaded, because the toggle's view state either didn't exist or was gated
behind the same `ready`/`tree` conditional as the tree/loading/empty-state
section. The toggle must always render immediately, independent of whether
IndexedDB has finished loading or whether any curriculum data exists.

Run this checklist:
- After any change to `src/routes/index.tsx`, `QuestionInboxDialog.tsx`, or
  `db.ts`'s startup/subscription behavior.
- Before shipping a release.

## Setup

For each scenario below, use a fresh browser profile or clear site data
(DevTools → Application → Storage → "Clear site data") so IndexedDB starts
empty, then follow the scenario-specific data step.

## Scenario A: Empty IndexedDB (no curriculum imported yet)

1. Clear site data so IndexedDB has no `nodes` rows.
2. Load the app root URL.
3. **Immediately** (before clicking anything) confirm:
   - [ ] The "Curriculum" / "Questions" toggle is visible in the header.
   - [ ] The toggle is visible even while the tree section still shows
         "Loading…".
   - [ ] The toggle is visible once loading finishes and the empty-tree
         message ("No curriculum yet — import JSON to populate the tree.")
         is shown.
   - [ ] "Curriculum" is the active/selected tab by default.
4. Click "Questions" on the toggle.
   - [ ] The question inbox dialog opens.
   - [ ] The toggle now shows "Questions" as active.
5. Close the dialog (Escape key, overlay click, or the dialog's close
   control).
   - [ ] The toggle returns to "Curriculum" as active.
   - [ ] No dialog remains open.
6. Reload the page.
   - [ ] Toggle is visible immediately again, defaulting to "Curriculum".

## Scenario B: Populated IndexedDB (curriculum already imported)

1. Populate the tree with at least one node via an existing row's "Add
   children" action (`AddChildNodesDialog`) so IndexedDB has `nodes` rows,
   or reuse a browser profile from a prior session that already has data.
2. Reload the app root URL.
3. **Immediately** (before clicking anything) confirm:
   - [ ] The toggle is visible in the header while the tree section still
         shows "Loading…".
   - [ ] The toggle remains visible once the populated tree renders.
   - [ ] "Curriculum" is the active/selected tab by default, and the tree is
         shown underneath it.
4. Click a question-derived node in the tree (a node with the amber
   "From question" badge), if one exists; otherwise file a question first
   via the Questions tab → add a question → paste an AI response → confirm
   placement.
   - [ ] Clicking the node opens the question inbox dialog.
   - [ ] The toggle switches to show "Questions" as active.
   - [ ] The originating question card is scrolled into view and
         highlighted.
5. Click "Curriculum" on the toggle while the dialog is open.
   - [ ] The dialog closes.
   - [ ] The toggle shows "Curriculum" as active and the tree is visible
         again.
6. Click a tree row's "Add children" action (not the toggle) to open
   `AddChildNodesDialog`, then close it and click the header **Export** and
   **Clear** buttons.
   - [ ] `AddChildNodesDialog` opens for the clicked row, not the question
         inbox.
   - [ ] The Curriculum/Questions toggle is unaffected throughout and still
         shows "Curriculum" as active (the two dialogs are independent -
         see `docs/qa/import-flows-separation-checklist.md`).

## Hydration check (SSR)

1. With browser DevTools open to the Network tab, hard-reload the app root
   URL (disable cache) so the initial HTML is server-rendered.
2. View the page source / initial HTML response (before JS executes) if
   possible, or use "View rendered source" immediately on load.
   - [ ] The toggle markup ("Curriculum" / "Questions" labels) is present in
         the very first paint, not added a moment later.
   - [ ] No visible flash where the header briefly renders without the
         toggle before it "pops in".
3. Check the browser console.
   - [ ] No React hydration-mismatch warnings are logged.

## Sign-off

- [ ] Scenario A passed
- [ ] Scenario B passed
- [ ] Hydration check passed
- Tested by: ______________________  Date: ______________________