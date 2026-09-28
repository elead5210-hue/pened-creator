# QA checklist: Question inbox stays separate from the curriculum tree, and the per-node "Add children" flow works as scoped

## Background

Regression this guards against: the header's "Import" button used to open
`ImportDialog` (the exam question inbox) instead of a dedicated curriculum
flow, because no separate curriculum-JSON import UI existed and the button
was wired to whatever dialog happened to be named "Import". That was fixed
by renaming that component to `QuestionInboxDialog.tsx` to match what it
actually does, and giving it its own dedicated entry points (the
"Questions" tab and clicking a question-derived tree node) rather than a
shared header button.

The whole-tree JSON importer (`CurriculumImportDialog.tsx`, which used to
parse pasted JSON and call `replaceNodes()` to overwrite the entire table)
has since been removed from the header altogether, because replacing the
whole tree in one shot was breaking existing parent/child associations.
`src/routes/index.tsx` no longer renders an "Import" button or references
`CurriculumImportDialog` anywhere; the header now only exposes "Export" and
"Clear" for the curriculum tree itself.

In its place, each tree row now has its own "Add children" action (see
`TreeView.tsx`'s `onAddChildren`) that opens `AddChildNodesDialog.tsx`
scoped to that row's node. Pasted JSON is validated with
`parseChildNodes()` against `ALLOWED_CHILD_TYPES` (`schema.ts`) - the type
hierarchy for that specific parent, not the whole tree - and, once valid,
persisted node-by-node via `addNodeSubtree()` (`db.ts`), which only ever
calls the single-node `addNode()` under the hood and never `replaceNodes()`.
Scenarios C-F below cover this new flow; it's a distinct code path from the
question inbox, but shares the checklist's overall goal of catching
tree-mutation regressions before they ship.

This checklist now exists to catch:
- the question inbox drifting from its own dedicated entry points (e.g.
  the "Questions" tab or a question-derived tree node accidentally opening
  the wrong dialog, or its open state leaking into unrelated header/view
  state) - Scenario A.
- a Phase 1 → Phase 2 navigation regression, since it shares the same tree
  click-handling code path Scenario A depends on - Scenario B. See
  `docs/qa/route-tree-regression-checklist.md` for the deeper version of
  that check covering every entry point.
- the per-node "Add children" flow silently regressing - wrong visibility,
  validation that's too strict/loose, a preview that doesn't match what's
  actually saved, or a save that doesn't refresh/expand/notify correctly -
  Scenarios C-F.

Run this checklist:
- After any change to `src/routes/index.tsx`, `QuestionInboxDialog.tsx`,
  `TreeView.tsx`, `AddChildNodesDialog.tsx`, `src/lib/curriculum/schema.ts`
  (in particular `ALLOWED_CHILD_TYPES`/`parseChildNodes`),
  `src/lib/curriculum/db.ts` (`addNodeSubtree`), or `src/routeTree.gen.ts`.
- Before shipping a release.

## Setup

Use a fresh browser profile or clear site data (DevTools → Application →
Storage → "Clear site data") so IndexedDB starts empty, unless a scenario
says otherwise. Since there's no bulk JSON importer anymore, populate the
tree for these scenarios via the app's normal node-by-node flows (e.g.
filing a confirmed exam question, or the "Add children" action covered
below) rather than pasting a full tree.

## Scenario A: Questions tab / question nodes open the question inbox

1. Load the app root URL with a populated curriculum tree. Click
   "Questions" on the header toggle.
   - [ ] `QuestionInboxDialog` opens - title "Exam question inbox".
   - [ ] The dialog shows an "Add question" control and any existing
         question cards.
   - [ ] The toggle shows "Questions" as active.
2. Close the dialog. Add a question, paste a valid AI categorization
   response for it, and confirm its placement in the tree so it becomes a
   question-derived node (amber "From question" badge).
3. Switch to "Curriculum" and click that question-derived node.
   - [ ] `QuestionInboxDialog` opens again.
   - [ ] The toggle switches to "Questions".
   - [ ] The originating question card is scrolled into view and
         highlighted.
4. Close the dialog and confirm:
   - [ ] The rest of the curriculum tree is still intact aside from the
         newly filed question node - the question flow never replaced or
         cleared the tree.

## Scenario B: Curriculum tree → lesson detail view → back, without cross-wiring

This scenario doesn't test question-inbox separation directly, but it
shares the same tree click-handling code path (`TreeView.tsx`'s node click
dispatch) that Scenario A depends on, so a regression here is easy to miss
if this checklist only covers the dialog above.

1. Using a populated tree, select a `LESSON` leaf node that has **no**
   saved breakdown yet by clicking it.
   - [ ] The right-hand lesson prompt panel opens - **not**
         `QuestionInboxDialog`.
2. Copy the generated prompt, obtain (or hand-write) a matching AI
   breakdown reply, paste it into the panel's "Paste AI response" textarea,
   and save.
   - [ ] The breakdown saves without error and the panel indicates a
         breakdown now exists for this node.
3. Click the same `LESSON` node again (it should now show as having a
   saved breakdown).
   - [ ] The URL navigates to `/lessons/$lessonId` for this node.
   - [ ] The lesson detail view renders inline from the `lessons.$lessonId`
         route's own `LessonDetail` component (not the orphaned/unused
         `LessonDetailPanel`) - not a 404 page, blank screen, or router
         error overlay, and `QuestionInboxDialog` doesn't open instead.
   - [ ] No router error ("No routes matched location", etc.) is logged to
         the console. If one appears, `src/routeTree.gen.ts` is likely
         stale or missing this route - see
         `docs/qa/route-tree-regression-checklist.md`.
4. From the lesson detail view, navigate back to the curriculum tree
   ("Back to curriculum").
   - [ ] The tree renders correctly, with the lesson node still marked as
         having a saved breakdown.
   - [ ] The Curriculum/Questions toggle still shows "Curriculum" as
         active, and the question inbox isn't open.
   - [ ] "Questions" still opens `QuestionInboxDialog` - confirming the
         round trip through Phase 2 didn't disturb its wiring.

## Scenario C: "Add children" button visibility

1. Using a populated tree with at least one node of each type (`ROOT`,
   `CURRICULUM`, `GRADE`, `SUBJECT`, `TOPIC`, `LESSON`, and a
   question-derived `QUESTION` node), hover each row in turn.
   - [ ] `CURRICULUM`, `GRADE`, `SUBJECT`, and `TOPIC` rows show a "+"
         ("Add children") icon on hover.
   - [ ] `LESSON` and `QUESTION` rows never show the icon, even on hover -
         per `ALLOWED_CHILD_TYPES`, neither type has any allowed child
         type.
2. Tab through the tree with the keyboard (no mouse).
   - [ ] The "+" icon becomes visible via keyboard focus on rows that have
         it, matching the hover behavior - it isn't mouse-only.
3. Click the "+" icon on a `TOPIC` row.
   - [ ] `AddChildNodesDialog` opens with that `TOPIC` node's label/type
         shown as the target parent.
   - [ ] The schema hint inside the dialog lists `LESSON, QUESTION` as the
         allowed `"type"` values for this parent (not the types allowed
         under a different parent, e.g. `GRADE`'s `SUBJECT, QUESTION`).

## Scenario D: Paste validation is scoped to the target parent

Using the dialog opened against a `TOPIC` node from Scenario C (allowed
child types: `LESSON`, `QUESTION`):

1. Paste text that isn't valid JSON at all (e.g. a stray `{` or plain
   prose).
   - [ ] An inline error appears describing a JSON parse failure.
   - [ ] Save stays disabled.
2. Paste valid JSON that's missing a required field, e.g. `{ "type":
   "LESSON" }` (no `label`).
   - [ ] An inline error appears naming the missing field (`label`).
   - [ ] Save stays disabled.
3. Paste a single valid node whose `type` is **not** legal under this
   parent, e.g. `{ "label": "Bad", "type": "SUBJECT" }`.
   - [ ] An inline error explains `"SUBJECT"` isn't a valid child of
         `"TOPIC"` and lists the allowed types (`LESSON`, `QUESTION`).
   - [ ] Save stays disabled.
4. Paste an array mixing one valid and one invalid node, e.g.
   `[{ "label": "Good Lesson", "type": "LESSON" }, { "label": "Bad",
   "type": "GRADE" }]`.
   - [ ] Both problems are surfaced (not just the first) if there is more
         than one - check that fixing only the reported issue for index
         `[1]` still leaves `[0]` untouched/valid.
   - [ ] Save stays disabled until every entry is fixed.
5. Paste a node with a nested child whose type is illegal for *its own*
   parent (not the top-level target), e.g. a valid top-level `LESSON`
   node that itself has a `children: [{ "label": "X", "type": "TOPIC" }]`
   - [ ] The error path identifies the nested node specifically (e.g.
         `[0].children[0].type`), not just the top-level node, and states
         that `TOPIC` isn't a valid child of `LESSON` (a leaf).
6. Fix the paste down to a single valid node, e.g. `{ "label": "New
   Lesson", "type": "LESSON" }`.
   - [ ] All inline errors clear.
   - [ ] Save becomes enabled.
7. Open the dialog again from a node type with **no** allowed children
   (e.g. a `LESSON` row, if you can reach one some other way, or verify via
   Scenario C's visibility check that this case simply can't be reached
   from the tree UI).
   - [ ] Confirmed this state is unreachable through normal use, since the
         "+" icon never renders for such rows.

## Scenario E: Preview matches what's actually saved

1. With the dialog still open on the `TOPIC` node from Scenario D, paste a
   valid array containing a node with nested children, e.g.:
   ```json
   [
     { "label": "Fractions", "type": "LESSON" },
     {
       "label": "Follow-up question",
       "type": "QUESTION",
       "children": []
     }
   ]
   ```
   - [ ] A read-only preview appears showing both top-level nodes with
         their labels and type badges, nested one level under the target
         parent's own label/type.
   - [ ] The preview's node count matches the number of top-level pasted
         nodes (2 here).
2. Edit the pasted text to change `"Fractions"` to `"Fractions (renamed)"`.
   - [ ] The preview updates to reflect the new label without needing to
         close/reopen the dialog.
3. Click Save, then re-open the same `TOPIC` node's tree row (expand it if
   needed).
   - [ ] Every label/type shown in the preview immediately before saving
         now appears in the live tree in the same nesting - the preview
         didn't show anything that wasn't actually persisted, and nothing
         extra was added.

## Scenario F: Post-save tree refresh, auto-expand, and toast

1. Pick a `TOPIC` node that is currently **collapsed** (no children shown,
   chevron pointing right) and has no children yet. Use its "+" icon to
   paste and save one valid `LESSON` node under it.
   - [ ] A success toast appears summarizing how many nodes were added
         (e.g. "Added 1 node" with a description naming the parent).
   - [ ] The dialog closes.
   - [ ] The tree reflects the new node without a manual page refresh -
         confirms the reload-after-save (`load()`) path ran.
2. Repeat, but paste a node with two nested children (3 nodes total: 1
   top-level + 2 nested).
   - [ ] The toast's count reflects all 3 nodes, not just the 1 top-level
         pasted node.
3. Using a parent node that was already **expanded** before adding
   children, add another child.
   - [ ] The node stays expanded (adding children never unexpectedly
         collapses an already-open row).
4. Force a save failure (e.g. disconnect the network, or use browser
   devtools to block the `POST /api/nodes` request) and attempt to save a
   valid paste.
   - [ ] An error toast appears describing the failure (not a silent
         no-op, and not an unhandled console exception).
   - [ ] The tree is reloaded/re-rendered afterward rather than left
         showing a stale state, even though the save didn't fully
         succeed.

## Cross-check: no shared open state

1. Open the question inbox via the "Questions" tab.
2. While it's open, click outside/press Escape to close it.
   - [ ] Only `QuestionInboxDialog` closes; no unrelated dialog opens in
         its place.
   - [ ] The toggle returns to "Curriculum".
3. Confirm the header no longer renders an "Import" button or any other
   trigger for a whole-tree JSON import.
   - [ ] `CurriculumImportDialog` is not present anywhere in the app
         (grep the codebase if unsure) and no header action replaces the
         entire tree from pasted JSON.
4. Open `AddChildNodesDialog` via a tree row's "+" icon, then switch to the
   "Questions" tab without closing it first.
   - [ ] `AddChildNodesDialog` and `QuestionInboxDialog` never appear
         open at the same time - opening one doesn't leave the other's
         state dangling.

## Sign-off

- [ ] Scenario A passed
- [ ] Scenario B passed
- [ ] Scenario C passed
- [ ] Scenario D passed
- [ ] Scenario E passed
- [ ] Scenario F passed
- [ ] Cross-check passed
- Tested by: ______________________  Date: ______________________