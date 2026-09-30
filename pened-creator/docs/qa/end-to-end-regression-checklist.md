# QA checklist: full curriculum → content end-to-end regression

## Why this exists

Before the merge, this pipeline lived in two separate apps with two
separate manual checklists: TreeBuilder's `docs/qa/` suite covered the
curriculum tree, the exam-question inbox, and lesson-breakdown
generation, while GEDClient had its own
`docs/curriculum-import-regression-checklist.md` covering the
paste-breakdown → generate-prompt → paste-content → view-content half.
Now that both halves live in this one app (see
`docs/merge-architecture.md`), a break at the seam between them — the
breakdown hand-off from the tree into a lesson record, in particular —
would previously have fallen between two checklists and been missed by
both. This checklist walks the **whole path in one pass**, start to
finish, so a regression anywhere along it gets caught by a single run.

Automated checks (typecheck, lint, Vitest, build) run through
`npm run verify` and don't cover this whole path, so this remains a manual
walkthrough. Run it:

- Before shipping a release.
- After any change to `src/routes/index.tsx`, `src/routes/lessons.$lessonId.tsx`,
  `AddChildNodesDialog.tsx`, `QuestionInboxDialog.tsx`,
  `LessonBreakdownPanel.tsx`, `NewLessonForm.tsx`, `PromptViewer.tsx`,
  `PasteResponseForm.tsx`, `LessonContentView.tsx`, `TreeView.tsx`, or
  `src/lib/curriculum/{db,schema,promptBuilder}.ts`.

Three narrower checklists still exist alongside this one and are worth
running on their own if you're only touching the area they cover:

- `docs/qa/import-flows-separation-checklist.md` — curriculum import
  vs. the exam-question inbox staying two independent flows.
- `docs/qa/toggle-visibility-checklist.md` — the header
  Curriculum/Questions toggle rendering immediately on load, including
  SSR/hydration.
- `docs/qa/route-tree-regression-checklist.md` — every Phase 1 → Phase 2
  navigation/link entry point (`LessonBreakdownPanel`'s link to
  `/lessons/$lessonId`, `GlobalToolbar`'s lesson-id extraction and
  cross-links, and the `/tools` route) resolving correctly against a
  freshly regenerated `src/routeTree.gen.ts`.

A fourth checklist covers the slideshow step that comes after content
generation:

- `docs/qa/slideshow-lesson-id-links-checklist.md` — saving a slideshow
  deck on the lesson through pened-server, the lesson-id
  "Open in pened-tools" link, regenerating a deck (the slideshow entry
  is replaced and other interactive content is untouched), each failure
  message in pened-tools, old encoded links, and the secrets checks.

This checklist doesn't repeat every assertion from those four; it
exercises the same flows just enough to confirm the seam between them
and the rest of the pipeline still holds, and links out to them for the
deeper scenarios.

Each step's **expected result** is the assertion; if the actual
behavior differs, treat it as a regression.

## Setup

0. Run `npm run verify` first, especially if components, hooks, lib
   modules or routes were moved, renamed or created since the last pass.
   It must exit successfully, which confirms there are no unresolved
   imports (typecheck and build fail on them). Fix any failure before
   starting the walkthrough.
1. Start the app (`npm run dev`) with a clean/empty IndexedDB — use a
   fresh browser profile or clear site data for the app's origin
   (DevTools → Application → Storage → "Clear site data") — or run the
   same walkthrough against a production build
   (`npm run build && npm run preview`).
2. Have a valid curriculum JSON tree sample ready to paste, matching the
   "Expected schema" section on the page (a `ROOT` node with nested
   `children` down to at least one `LESSON` leaf node).
3. Have a sample exam question and a way to produce (or hand-write) a
   plausible AI categorization reply, a lesson-breakdown reply, and a
   generated-content reply — each matching the JSON shapes shown in the
   relevant panel/form on the page (the prompt views and placeholders
   describe the exact shape expected).

## Walkthrough: the full pipeline, start to finish

### 1. Populate the curriculum tree

- [ ] Load the app root URL. The Curriculum/Questions toggle is visible
      in the header immediately, with "Curriculum" active, even before
      the tree section finishes loading.
- [ ] On an existing row in the tree, click its **Add children** action.
      `AddChildNodesDialog` opens, scoped to that row — not the exam
      question inbox.
- [ ] Paste the sample curriculum JSON (matching the allowed child types
      for that row) and confirm the save.
- [ ] **Expected:** a success toast appears, the dialog closes, and the
      new nodes render under that row in the Curriculum view.

### 2. File an exam question into the tree

- [ ] Click **Questions** on the header toggle. `QuestionInboxDialog`
      opens ("Exam question inbox") and the toggle switches to
      "Questions".
- [ ] Add the sample exam question, paste its AI categorization reply,
      and confirm its placement under a node in the tree.
- [ ] **Expected:** the dialog reflects the question as filed, and after
      closing it and switching back to "Curriculum", the corresponding
      node in the tree now shows the amber "From question" badge. The
      rest of the tree imported in step 1 is unchanged.

### 3. Generate a lesson breakdown for a LESSON leaf node

- [ ] Click a `LESSON` leaf node in the tree that has no saved breakdown
      yet.
- [ ] **Expected:** `LessonBreakdownPanel` opens beside the tree, titled
      "Prompt: <node label>", showing a generated breakdown prompt with
      a **Copy prompt** action.
- [ ] Click **Copy prompt** and confirm a "Prompt copied" toast appears.
- [ ] Paste the sample lesson-breakdown JSON reply (matching this
      node's `project_id`/`lesson_node_id`) into the "Paste AI response"
      textarea and click **Save breakdown**.
- [ ] **Expected:** a "Lesson breakdown saved" toast appears naming the
      lesson, and the tree marks this node as having a saved breakdown
      (subsequent clicks on it navigate straight to its detail route
      instead of reopening this panel).
- [ ] Re-click the same node.
- [ ] **Expected:** navigates to `/lessons/$lessonId` for this node
      instead of reopening `LessonBreakdownPanel`. If this link 404s or
      throws a router error instead, see
      `docs/qa/route-tree-regression-checklist.md` — it's likely a
      stale `src/routeTree.gen.ts`.

### 4. Confirm the lesson record was created automatically

- [ ] On the lesson detail page — rendered inline by the
      `lessons.$lessonId` route's own `LessonDetail` component, not a
      separate `LessonDetailPanel` — the **Breakdown** tab is active by
      default and shows the saved objectives/outcomes/vocabulary/etc.
      from the breakdown.
- [ ] **Expected:** saving the breakdown in step 3 already created (or
      updated) this lesson's record automatically via
      `ensureLessonFromBreakdown` — no separate import/creation step is
      needed, and the **Generate Prompt** / **Paste AI Response** tabs are
      enabled immediately.

### 5. Generate a content prompt from the lesson

- [ ] Click the **Generate Prompt** tab, then click **Generate Prompt**.
- [ ] **Expected:** `PromptViewer` renders the generated content prompt
      (built from the breakdown plus the tool registry) with **Copy to
      Clipboard** and **Download as Text** actions, the button relabels
      to "Regenerate Prompt", and the lesson's status badge updates to
      "Prompt generated".
- [ ] Reload the page and return to this lesson's **Generate Prompt**
      tab.
- [ ] **Expected:** the previously generated prompt is still shown
      (persisted on the lesson record), without needing to regenerate.

### 6. Paste the AI's content response back

- [ ] Click the **Paste AI Response** tab.
- [ ] Paste the sample generated-content JSON (an array of content
      blocks, including at least one Assessment block) and click
      **Save Response**.
- [ ] **Expected:** an "AI response saved" toast appears, the view
      automatically switches to the **View Content** tab, and the
      lesson's status badge updates to "Content generated". The
      **View Content** tab is now enabled (it stays disabled until
      content exists).

### 7. View the finished content

- [ ] On the **View Content** tab, `LessonContentView` renders each
      saved content block via the tool renderers (Introduction,
      Objectives, Vocabulary, Activity, Assessment, Checklist,
      Prerequisites as applicable), headed "Generated Lesson Content",
      with explainer text noting this is a read-only AI-generated
      preview distinct from the curriculum JSON.
- [ ] If the pasted content included an Assessment block, its question
      renders here.
- [ ] Click **View Details** (or the **Breakdown** tab).
- [ ] **Expected:** returns to the breakdown view for the same lesson;
      no content/question is shown outside this explicit tab.
- [ ] Navigate back to the curriculum tree (**Back to curriculum**).
- [ ] **Expected:** the tree still renders correctly, the lesson node
      from step 3 still shows as having a saved breakdown, and clicking
      it still navigates straight to `/lessons/$lessonId` rather than
      reopening the prompt panel.
- [ ] While on this lesson's detail page, spot-check the global
      toolbar: it correctly shows the lesson view as active, and
      **Tools** (`/tools`) is reachable and renders the Tool Registry
      without a 404 or router error. For the full pass on these entry
      points, run `docs/qa/route-tree-regression-checklist.md`.

### 8. Check lesson progress on the tree against the real API

This step exists because the tree's progress badges depend on two bulk
list endpoints (`GET /api/lesson-breakdowns?projectId=` and
`GET /api/lessons?projectId=`, shapes documented in
`src/lib/curriculum/shared/README.md`). If either response is misread, the
tree still renders but every lesson silently looks unstarted, so this
needs a run against a server that already has lessons at different stages.

- [ ] Load the tree while signed in, with `DevTools → Network` open
      (filter by `lesson`). Reload the page.
- [ ] **Expected:** both `GET /api/lesson-breakdowns?projectId=…` and
      `GET /api/lessons?projectId=…` return `200`. The
      breakdowns response is an array of `{ node_id, breakdown }`
      objects (no `lesson_node_id` field), and the lessons response
      contains summaries without `generatedContent`, `interactiveContent`,
      `images` or `imagesNoBg`.
- [ ] Compare lessons that are at different stages: breakdown saved,
      prompt generated, content generated, and images generated.
- [ ] **Expected:** each lesson shows the badge for its own stage, not a
      "No breakdown" badge and not the same badge for all of them.
- [ ] Click a lesson that has progress (any stage past "No breakdown").
- [ ] **Expected:** navigates to that lesson's `/lessons/$lessonId`
      page; the Phase 1 breakdown panel does not open.
- [ ] Click a lesson node that truly has no saved breakdown.
- [ ] **Expected:** the Phase 1 `LessonBreakdownPanel` opens beside the
      tree.
- [ ] In DevTools, block or fail the `/api/lessons` request (right-click →
      Block request URL) and reload.
- [ ] **Expected:** a "Couldn't load lesson progress" toast appears with a
      **Try again** action, the tree itself still renders, lesson nodes
      show a neutral icon rather than a "No breakdown" badge, and clicking
      one shows the "progress isn't available yet" toast instead of
      opening the Phase 1 panel. Unblock the request and click **Try
      again**; the correct badges appear.

### 9. Slideshow data and the lesson-id link

This step follows the lesson from step 6 (it needs saved generated
content) and is a short smoke test. The full scenarios, including the
failure messages, secrets checks and rollout order, are in
`docs/qa/slideshow-lesson-id-links-checklist.md`: **run that checklist in
full on every full regression pass** (its sections 3 to 7 at least).

- [ ] On the lesson from step 6, open the slideshow step ("Generate
      Slideshow Data"), generate the prompt, paste a valid Deck JSON reply
      and save.
- [ ] **Expected:** the button shows "Saving...", then the saved-deck
      summary appears with the slide count. A deck that fails validation
      (for example a slide with no `elements`) is rejected in the form with a
      list of problems and is not saved.
- [ ] **Expected:** the "Open in pened-tools" link appears only after the
      deck is saved, and its URL is
      `<pened-tools origin>/tool/slideshow/<project id>%3A<node id>`, with no
      deck data in it. Opening it plays the deck.
- [ ] Reload the lesson page.
- [ ] **Expected:** the saved-deck summary is still shown (the deck is
      loaded from the server, not from this browser).
- [ ] Paste a different response with an edited deck and save, then reload
      the pened-tools tab.
- [ ] **Expected:** the edit shows immediately, and the lesson has exactly
      one slideshow entry in its interactive content.

### 10. Slide Data step (per-slide data view)

This step follows the deck saved in step 9. It is a read-only view of the
saved deck, one slide per card.

**Step order, numbering and locked state**

- [ ] On a lesson with no saved deck, look at the step list on the right.
- [ ] **Expected:** "Slide Data" appears directly after "Generate Slideshow
      Data" and before "Games", the step numbers run in order with no
      gaps or duplicates, and "Slide Data" shows the lock icon and cannot
      be opened by click or keyboard.
- [ ] With a screen reader (or by inspecting the accessible name), check
      the step buttons.
- [ ] **Expected:** each step is announced with its position and state,
      for example "Step 8 of 9: Slide Data, locked", and the current step
      is announced as the current step.
- [ ] Save a deck in the "Generate Slideshow Data" step.
- [ ] **Expected:** "Slide Data" unlocks (it never shows a completed
      check, since it only displays data), and a "Next: Slide Data"
      call-to-action appears above the slideshow step's content.
- [ ] Click **Next: Slide Data**.
- [ ] **Expected:** the Slide Data step opens on the first slide.

**Navigation**

- [ ] On a deck with three or more slides, check the first slide.
- [ ] **Expected:** a card shows the slide's id, title, background and
      each element (type, position, size, and its content or source). The
      breadcrumb shows "Slide 1 of N" with the slide title, and Previous
      is disabled.
- [ ] Click **Next** repeatedly until the last slide.
- [ ] **Expected:** each click shows the next slide's data in deck order,
      the position label updates, and Next is disabled on the last slide.
- [ ] Click **Previous** back to the first slide.
- [ ] **Expected:** slides are shown in reverse order, and Previous is
      disabled again on the first slide.

**Keyboard and screen reader**

- [ ] Tab to the navigation and press the Left and Right arrow keys.
- [ ] **Expected:** the slide changes, and the arrow keys do nothing past
      the first or last slide.
- [ ] Activate Next with the keyboard, or press an arrow key.
- [ ] **Expected:** focus moves to the slide card, which is announced as a
      region with its title and position (for example "Title, slide 2 of
      5"). The new position is also announced through the polite live
      region.
- [ ] Open the Slide Data step for the first time.
- [ ] **Expected:** focus is not moved into the card just because the
      step opened.

**Empty, invalid and single-slide decks**

- [ ] Open a lesson whose deck has one slide.
- [ ] **Expected:** the message "This deck has a single slide." is shown,
      and both Previous and Next are disabled.
- [ ] Open a slide that has no elements.
- [ ] **Expected:** the card says the slide has no elements, and nothing
      crashes.
- [ ] Open a slide with no title.
- [ ] **Expected:** the heading falls back to "Slide N".
- [ ] If a saved deck is malformed or fails validation (for example a
      hand-edited record), open Slide Data.
- [ ] **Expected:** an error alert lists the problems by path and no
      navigation is shown. It does not throw or blank the page.

**Returning after edits**

- [ ] Go to the Slide Data step, move to a later slide, switch to another
      step and come back without changing anything.
- [ ] **Expected:** the view opens without errors on a valid slide.
- [ ] Paste and save an edited deck with a different number of slides,
      then open Slide Data.
- [ ] **Expected:** the view starts on the first slide of the new deck, the
      total is correct, and no stale data from the old deck is shown.
- [ ] Open a different lesson.
- [ ] **Expected:** the Slide Data step shows that lesson's own deck (or
      stays locked), never the previous lesson's.

## Pass criteria

All expected results above must hold. In particular, across the full
pipeline:

- Curriculum import and the exam-question inbox never open each
  other's dialog (see `import-flows-separation-checklist.md` for the
  deeper version of this check).
- The Curriculum/Questions toggle is visible on every load, independent
  of tree-loading state (see `toggle-visibility-checklist.md`).
- Every Phase 1 → Phase 2 link or navigation (lesson breakdown → lesson
  detail, the global toolbar's lesson/tools links) resolves to its
  correct route rather than a 404 or router error (see
  `route-tree-regression-checklist.md`).
- Saving a lesson breakdown (from the tree's `LessonBreakdownPanel`)
  automatically creates or updates that lesson's record on the lesson
  detail page — rendered inline by the `lessons.$lessonId` route, not the
  orphaned `LessonDetailPanel` component — via `ensureLessonFromBreakdown`.
- Generated prompts and generated content persist across reloads, and
  each lifecycle tab (Breakdown / Generate Prompt / Paste AI Response /
  View Content) is only enabled once its prerequisite step is complete.
- Assessment/question content only ever renders inside the explicit
  **View Content** tab — never as a side effect of navigating to or
  reloading a lesson's detail page.
- A saved slideshow deck is stored on the lesson through pened-server,
  the "Open in pened-tools" link is a lesson-id link (never a link with the
  deck in it), and regenerating a deck replaces the slideshow entry rather
  than adding a second one (see
  `slideshow-lesson-id-links-checklist.md`).
- The Slide Data step stays locked until a deck is saved, shows one slide
  per card with working Previous/Next and arrow-key navigation (disabled
  at the first and last slide), handles empty, invalid and single-slide
  data without crashing, and resets to the first slide when the deck is
  replaced.

## Sign-off

- [ ] `npm run verify` passed (no unresolved imports)
- [ ] Full walkthrough (steps 1–10) passed
- [ ] `slideshow-lesson-id-links-checklist.md` run (sections 3 to 7)
- Tested by: ______________________  Date: ______________________