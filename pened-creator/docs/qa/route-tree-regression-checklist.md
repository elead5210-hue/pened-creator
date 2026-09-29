# QA checklist: Phase 1 → Phase 2 route resolution

## Background

Regression this guards against: `src/routeTree.gen.ts` (the TanStack Router
codegen output) was committed stale, missing the `LessonsLessonIdRoute`
(`/lessons/$lessonId`) and `ToolsRoute` (`/tools`) entries. Because several
Phase 1 surfaces navigate or link into Phase 2 by path string rather than by
importing the route module directly, none of them failed to *compile* — they
only failed at runtime, either 404ing or throwing a router "no route matched"
error. This checklist re-exercises every one of those entry points against
the regenerated route tree to confirm they resolve to the correct component.

See `src/routeTree.gen.ts`'s own header comment, and `AGENTS.md`'s "Route
tree" section, for why this file must never be hand-edited or committed
stale, and `npm run routes:check` / `.github/workflows/verify-routes.yml`
for the automated guard against this regression recurring.

Run this checklist:
- After any change to `src/routes/`, `src/routeTree.gen.ts`, `vite.config.ts`,
  `LessonBreakdownPanel.tsx`, or `GlobalToolbar.tsx`.
- Before shipping a release.
- Any time `npm run routes:check` has failed and been re-run to regenerate
  the route tree.

## Setup

Use a fresh browser profile or clear site data (DevTools → Application →
Storage → "Clear site data") so IndexedDB starts empty, then use an
existing row's "Add children" action to open `AddChildNodesDialog` and
paste in curriculum JSON, repeating as needed, so at least one `LESSON`
leaf node exists to navigate to. Keep DevTools open to the Console tab
throughout, watching for router errors ("No routes matched location",
"Encountered an unknown route", etc.) and uncaught exceptions.

## Scenario A: `LessonBreakdownPanel` → `/lessons/$lessonId`

`LessonBreakdownPanel.tsx` renders a `Link to="/lessons/$lessonId"` once a
lesson node has a saved breakdown.

1. From the Curriculum tab, select a `LESSON` leaf node that has **no**
   saved breakdown yet.
   - [ ] The right-hand prompt panel opens (not a route change).
2. Copy the generated prompt, run it through the AI elsewhere, and paste the
   JSON response back into the panel's paste-response textarea, then save.
   - [ ] The breakdown saves without error.
   - [ ] The panel now shows the "View lesson" / breakdown-saved link.
3. Click that link.
   - [ ] The URL changes to `/lessons/<the node's id>`.
   - [ ] The page renders inline from the `lessons.$lessonId` route's own
         `LessonDetail` component (not the orphaned/unused
         `LessonDetailPanel`) — showing objectives, outcomes, etc. — not a
         404 page, blank screen, or router error overlay.
   - [ ] No router error is logged to the console.
4. Click the node in the tree again (it should now show the
   "Breakdown saved" badge).
   - [ ] Clicking navigates directly to `/lessons/$lessonId` (per
         `de1f7960...` wiring) rather than reopening the prompt panel.

## Scenario B: `GlobalToolbar` lesson-id extraction and cross-links

`GlobalToolbar.tsx`'s `getLessonNodeIdFromPathname` parses the lesson id out
of the current pathname, and its toolbar links depend on the route
resolving correctly for `activeView` to be computed.

1. While on a `/lessons/$lessonId` page (from Scenario A step 3), inspect
   the toolbar.
   - [ ] The toolbar highlights the "content"/lesson view as active (not
         falling back to the curriculum or tools view).
   - [ ] No console error from `getLessonNodeIdFromPathname` or
         `getActiveView`.
2. Note the lesson id shown/used by the toolbar (e.g. in a badge, label, or
   any lesson-scoped link) and confirm it matches the `$lessonId` segment
   actually in the URL bar.
   - [ ] Ids match exactly (no truncation, no stale id from a previous
         lesson).
3. From the toolbar, use any lesson-scoped link that targets "the current
   lesson's own URL" (see the comment above `ToolbarLink` in
   `GlobalToolbar.tsx` around line 141).
   - [ ] The link's `to` prop resolves and clicking it stays on the same
         lesson detail page without erroring.
4. Manually edit the URL to `/lessons/` followed by a node id that does
   **not** exist, and load it.
   - [ ] This is handled gracefully (an in-app "lesson not found" state or
         similar) rather than an unhandled router crash.
   - [ ] The toolbar still renders without throwing.

## Scenario C: `/tools` route

1. From anywhere in the app, use the toolbar's "Tools" entry (or navigate
   directly to `/tools`).
   - [ ] The URL changes to `/tools`.
   - [ ] The page renders the Tool Registry (`ToolsPage` — a list of every
         entry in `src/lib/curriculum/phase2-content/presentationTools.ts`,
         each with its renderer fed dummy data from
         `presentationToolsDummyData.ts`) — not a 404 page or router error
         overlay.
   - [ ] No router error is logged to the console.
2. On the `/tools` page, confirm the toolbar correctly marks "Tools" as the
   active view (via `getActiveView`).
   - [ ] "Tools" is highlighted; "Curriculum"/"Lessons" are not.
3. From `/tools`, navigate back to the Curriculum root (`/`) via the
   toolbar.
   - [ ] Navigation succeeds and the curriculum tree renders normally.
4. Reload the page directly at `/tools` (hard refresh, not client-side
   navigation).
   - [ ] The route still resolves correctly on a fresh SSR load, confirming
         the fix isn't dependent on client-side route registration alone.

## Regression guard sanity check

1. Run `npm run routes:check` locally against a clean working tree.
   - [ ] It exits successfully (no diff reported) — confirming the
         regenerated `src/routeTree.gen.ts` committed for this fix is
         actually in sync with `src/routes/`.
2. Verify imports after moving or creating components or routes. Run
   `npm run verify` (typecheck, lint, test, build) after any component,
   hook, lib module or route file has been moved, renamed or created.
   - [ ] It exits successfully, so there are no unresolved imports (stale
         relative paths, mistyped `@/` aliases, missing named exports).
   - [ ] The `.github/workflows/verify.yml` check is green on the pull
         request.
3. Confirm `.github/workflows/verify-routes.yml` is present and configured
   to run on changes under `src/routes/` and `src/routeTree.gen.ts`.
   - [ ] Workflow file exists and its `paths` filters cover both.

## Sign-off

- [ ] Scenario A passed
- [ ] Scenario B passed
- [ ] Scenario C passed
- [ ] Regression guard sanity check passed (including `npm run verify`)
- Tested by: ______________________  Date: ______________________