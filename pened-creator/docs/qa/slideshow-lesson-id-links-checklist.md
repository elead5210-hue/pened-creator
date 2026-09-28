# Slideshow lesson-id links: rollout runbook and QA checklist

Use this for the rollout of id-based slideshow links, and again after any
change to slideshow saving, slideshow links, or the pened-server
interactive-content route. It is also referenced from
`end-to-end-regression-checklist.md`.

## What changed

- A slideshow link now carries only the lesson id:
  `<pened-tools origin>/tool/slideshow/<encodeURIComponent(lessonId)>`
  where the lesson id is `<project_id>:<lesson_node_id>` (the colon is sent as
  `%3A`). It no longer contains the deck.
- pened-creator saves the deck on the lesson, through pened-server, as the
  `{ "tool": "slideshow", "data": <deck> }` entry of the lesson's
  `interactiveContent`. Regenerating replaces that entry and leaves other
  tools' entries alone.
- pened-tools' own Node server fetches the deck from pened-server on every
  request, using its own key. A browser never talks to pened-server for this.
- Old links that encode the whole deck still work in pened-tools. Nothing in
  pened-creator produces them any more.
- **Nothing to regenerate:** pened-creator does not store slideshow links. The
  "Open in pened-tools" link is built from `lesson.id` each time it is shown, so
  no stored link needs to be migrated. If you have old links saved somewhere
  else (a document, a chat, a bookmark), they keep working, and you can
  optionally replace them by hand with the new lesson-id link.

Contract and server requirements:
`docs/api-handoff/slideshow-interactive-content.md`.

## 1. Rollout order

Do these in order. Don't deploy a later step until the earlier one passes.

### 1.1 pened-server

- [ ] The changes from `docs/api-handoff/slideshow-interactive-content.md` are
      deployed (route contract, key check, no redirects, no caching, larger body
      limit, replace-not-append).
- [ ] pened-server's own contract tests pass.
- [ ] Run the live check against the deployed server (see the script header for
      every variable):
      ```
      PENED_SERVER_URL=https://<pened-server> \
      PENED_API_KEY=<the key pened-tools will use> \
      VERIFY_LESSON_WITH_SLIDESHOW=<lesson id> \
      VERIFY_LESSON_NULL_CONTENT=<lesson id> \
      VERIFY_LESSON_NO_SLIDESHOW=<lesson id> \
      VERIFY_LESSON_COLON_ID=<project-id>:n_a:b:c \
      npm run verify:pened-server
      ```
      It exits non-zero on any failed check. Optional write round trip
      (`VERIFY_WRITE=1`) uses a **scratch lesson** and restores it afterwards.
- [ ] `PENED_SERVER_URL` (the public https URL, no trailing slash) answers the
      read route directly, with no redirect.
- [ ] A separate **read-only** key exists for pened-tools, or it is written
      down that `API_KEY` is being used and why.

### 1.2 pened-tools (Fly app)

- [ ] Secrets are set as **secrets**, not build args:
      `fly secrets set PENED_SERVER_URL=https://<pened-server> PENED_API_KEY=<same value the server checks>`
- [ ] The pened-tools app has restarted with the new secrets
      (`fly status`, and check the release).
- [ ] The value of `PENED_API_KEY` is not written in any file, ticket, chat or
      commit. Store it only in the password manager and the two places that need
      it.

### 1.3 pened-creator

- [ ] `npm run lint` passes (includes the boundaries check).
- [ ] `npm run secrets:check` passes (no pened-tools secret, and no secret in
      a `VITE_*` variable).
- [ ] `VITE_TOOL_RENDERER_BASE_URL` is `https://pened-tools.fly.dev` (or the
      right origin) in the deployed build. It is baked into the bundle at build
      time, so a change needs a rebuild and redeploy.
- [ ] Deploy. Then run sections 2 to 6 below on the deployed app.

## 2. Secrets hygiene

- [ ] pened-creator does not use `PENED_API_KEY` or `PENED_SERVER_URL`
      (`npm run secrets:check`, or search the repo for both names: they must
      appear only in docs and comments).
- [ ] No `VITE_*` variable holds a secret. `VITE_*` values are public: they are
      read at build time and shipped to every browser. Only public URLs belong
      there.
- [ ] `.env` is not committed (`git status`, `.gitignore`), and `.env.example`
      has no real key.
- [ ] Deployed pened-creator: open the site, then DevTools > Sources/Search and
      search the built JS for the API key value and for the pened-server host.
      Neither appears. (pened-creator does talk to pened-server for its own
      data, so `VITE_API_URL` is expected. The check is that the **pened-tools**
      key is absent.)
- [ ] pened-creator's network requests to pened-server use the session cookie
      (`credentials: "include"`) and no `x-api-key` header.

## 3. Acceptance: saving, playing and editing

Use a scratch lesson that has generated content. Record its lesson id
(`<project_id>:<lesson_node_id>`).

- [ ] Generate the prompt in the "Generate Slideshow Data" step, paste a valid
      Deck JSON, and save. The button shows "Saving...", then the saved-deck
      summary appears with a slide count. (The deck only counts as saved once the
      server has stored it and it has been read back.)
- [ ] The "Open in pened-tools" link appears **only after** the deck is saved.
      Before saving, no link is shown.
- [ ] The link's URL is short and has the form
      `https://pened-tools.fly.dev/tool/slideshow/<projectId>%3A<nodeId>`. No JSON
      or base64 is in it.
- [ ] Opening the link plays the deck (right slide count, right text).
- [ ] The same URL typed by hand or pasted from another browser or a private
      window plays the deck too. (This is what the old local-only storage could
      not do.)
- [ ] Reload the pened-tools page: same deck.
- [ ] Back in pened-creator, use "Paste a different response" with an edited
      deck (change a heading) and save. **Reload the pened-tools tab: the change
      shows immediately**, with no cache delay and no hard refresh needed.
- [ ] Reload pened-creator: the saved-deck summary is still there, with the edited
      deck (it is loaded from the server).
- [ ] A lesson id with extra colons in the node id (for example
      `<project>:n_a:b:c`) also works end to end, if you have one.
- [ ] A very large deck (several MB) saves, reads back unchanged, and plays. If
      it fails, note the message: "too large for the server" points at the
      server's body limit.

## 4. Acceptance: each failure shows its own message

Open the pened-tools link for each case. Each must show a **different** message,
and never a slideshow or a blank page.

| Case | How to set it up | Expected pened-tools message |
| --- | --- | --- |
| Unknown lesson | Change the id in the URL to one that doesn't exist | "Lesson not found" |
| Lesson with no slideshow | Use a lesson with no deck saved (a new lesson, or one with `interactiveContent: null`, or with only other tools' entries) | "No slideshow saved" |
| Wrong key | On a **test copy** of the pened-tools app (or briefly, then restore), set `PENED_API_KEY` to a wrong value | "Server access misconfigured" |
| Stopped server | Stop pened-server (or point a test pened-tools at a closed port) | "Lesson server unavailable" |
| Slow server | (optional) make the route take longer than 8s | "Lesson server unavailable" (took too long) |
| Bad response | (optional) a server that returns 429/500 or non-JSON | The generic invalid-response message |

- [ ] All of the required rows above show their own message.
- [ ] Restore the real secret and the server afterwards, and confirm the good
      link plays again.

## 5. Acceptance: nothing secret is visible

On the pened-tools slideshow page, with a working deck:

- [ ] View source and DevTools > Elements: the API key value and the
      pened-server URL do not appear.
- [ ] DevTools > Network (reload with "Preserve log"): **no request goes to
      pened-server**, and no request or response carries an `x-api-key` header.
      Only requests to the pened-tools origin (and its assets) appear.
- [ ] Do the same on each error page from section 4. The error text doesn't
      include the key, the pened-server URL, or a stack trace.
- [ ] pened-server's error bodies for 401/403/404 don't contain the key or an
      internal URL (`npm run verify:pened-server` checks this).

## 6. Regenerating and other interactive content

- [ ] **Regenerating replaces the entry.** Save deck A, then save deck B on the
      same lesson. Read `GET /api/lessons/<encoded id>/interactive-content` (or use
      the verify script's write round trip): exactly **one** entry has
      `tool: "slideshow"`, and its data is deck B. Opening the pened-tools link
      shows deck B, not A.
- [ ] **Other tools' entries are untouched.** On a lesson that also has another
      tool's entry in `interactiveContent`, save a slideshow and read it back: the
      other entry is still there, unchanged and in the same position.
- [ ] Saving an invalid deck (for example a slide with no `elements`, or an
      element with type `"audio"`) is rejected in the form with a list of
      problems, the pasted text is kept, and **nothing is saved** (the previous
      deck still plays in pened-tools).
- [ ] A failed save (for example, stop pened-server, or use an expired
      session) shows an error and "Retry Save", keeps the pasted text, and does
      not show the deck as saved.
- [ ] Deleting a lesson does not leave a stale deck behind: recreate a lesson with
      the same id, and confirm it starts with no slideshow.
- [ ] One-time migration (only if you have a browser that still has decks in the
      old local store, IndexedDB `pened-slideshow-decks`): open such a lesson. The
      deck is moved to the server, the pened-tools link plays it, and the local
      copy is removed. If the move fails, the local copy stays and is retried on
      a later load.

## 7. Old encoded links still open

- [ ] Take a small deck and build an old-style link:
      `https://pened-tools.fly.dev/tool/slideshow/<encodeURIComponent(JSON.stringify(deck))>`
      (or use a link saved from before this change). It still opens and plays.
- [ ] No migration is needed, and pened-creator shows no old-style links.

## 8. Sign-off

| Item | Done by | Date |
| --- | --- | --- |
| Section 1 rollout in order |  |  |
| Section 2 secrets hygiene |  |  |
| Sections 3 and 4 acceptance |  |  |
| Section 5 nothing secret visible |  |  |
| Sections 6 and 7 replace, other entries, old links |  |  |

If any check fails, roll back in reverse order: pened-creator, then the
pened-tools secrets, then pened-server. The old encoded links keep working
throughout.