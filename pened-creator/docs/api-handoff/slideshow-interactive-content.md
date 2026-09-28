# Handoff: pened-server support for id-based slideshow loading

**Audience:** whoever works on the `pened-server` repo (penedv1-server).
**Written from:** the `pened-creator` repo. Nothing here has been checked
against pened-server's code, since it lives elsewhere. Every "verify" below
is a real open question, and the answer has to be found in that repo. Where
this document and pened-server disagree, fix pened-server unless this
document says otherwise. Do not change pened-tools to match.

## Why this exists

pened-tools no longer takes a slideshow deck in the URL. A slideshow link now
carries only a lesson id, and the pened-tools Node server fetches the deck
from pened-server on each request. Decks can be very large, which is what
broke the old encoded links. pened-creator now saves the deck on the lesson
and links by lesson id. So the contract below must hold exactly, because
pened-tools maps each response to a message its visitors see.

## Terms

- **Lesson id:** `<project_id>:<lesson_node_id>`, for example
  `cc606ab5-61ee-4829-90ca-7c224016deac:n_lesson_1`.
  - `project_id` has no colon, whitespace or slash.
  - `lesson_node_id` has no whitespace or slash, and **may contain more
    colons**.
  - Both are non-empty. Shape check used by pened-tools and pened-creator:
    `^[^:\s/]+:[^\s/]+$`.
- **`interactiveContent`:** an array of `{ "tool": string, "data": any }`
  entries stored on the lesson, or `null` when nothing is saved. Each tool
  owns its entry (for example `"slideshow"`).
- **Slideshow entry:** the entry with `tool === "slideshow"`. Its `data` is
  the Deck JSON.

## 1. The read endpoint (pened-tools calls this)

```
GET {PENED_SERVER_URL}/api/lessons/<encodeURIComponent(lessonId)>/interactive-content
Headers: x-api-key: <key>, Accept: application/json
```

What pened-tools does:

- The request is **server-to-server only**, never from a browser.
- It **does not follow redirects**. Any 3xx is treated as an invalid
  response.
- Timeout is 8s by default. It sends no cache headers and always reads fresh
  (`cache: 'no-store'`).
- The colon is percent-encoded, so the path contains `%3A`. Extra colons in
  the node id are encoded the same way.

### Required responses

| Situation | Status | Body |
| --- | --- | --- |
| Lesson exists and has a slideshow entry | `200` | `{ "id": "<lessonId>", "interactiveContent": [ ... ] }` |
| Lesson exists, nothing saved | `200` | `{ "id": "<lessonId>", "interactiveContent": null }` |
| Lesson exists, entries but none with `tool: "slideshow"` | `200` | `{ "id": "<lessonId>", "interactiveContent": [ ...other tools... ] }` |
| Unknown lesson | `404` | JSON error body (no secrets, see section 3) |
| Missing or wrong `x-api-key` | `401` or `403` | JSON error body |
| Server trouble | `5xx` | JSON error body |

- `id` in the body is the **decoded** lesson id, exactly as stored.
- `200` with `null` and `404` are different on purpose. "No slideshow saved
  yet" and "lesson not found" show visitors different messages.
- A lesson with **no** slideshow entry is not an error. It is `200`.

How pened-tools maps results to what visitors see:

| pened-server returns | Visitor sees |
| --- | --- |
| 200 with a deck | The slideshow (deck validated by pened-tools) |
| 404 | "Lesson not found" |
| 200 with `null` or no slideshow entry | "No slideshow saved" |
| 401 or 403 | "Server access misconfigured" |
| 502, 503, 504, network error | "Lesson server unavailable" |
| Timeout | "Lesson server unavailable" (took too long) |
| Other errors (400, 429, 500), non-JSON body, redirects | Generic invalid-response message |

Note: pened-tools uses the `data` of the **first** `tool === "slideshow"`
entry. Section 4 makes sure there is never more than one.

## 2. Verify these against pened-server

Please check each and fix what differs:

1. **Path and shape.** The route exists at exactly
   `/api/lessons/:lessonId/interactive-content` and returns the bodies above.
   `404` for an unknown lesson, and `200` with `interactiveContent: null` for
   a lesson with nothing saved (not `404`, not `[]`, not omitted).
2. **Colon ids.** The route matches lesson ids whose colon arrives as `%3A`,
   and node ids with extra colons (for example
   `<project>:n_a:b:c`). Confirm the framework decodes the parameter once and
   only once, and that a router configured for `:` in path patterns doesn't
   break on it.
3. **No redirects on this route.** Neither a trailing slash
   (`.../interactive-content/`) nor http-to-https may answer with a 3xx.
   Either serve the request directly or return `404`, never a redirect. Also
   confirm that the public URL given to pened-tools as `PENED_SERVER_URL`
   (the https origin, no trailing slash) returns `200` directly, with no
   proxy hop or www redirect in front of it.
4. **Freshness.** Edits must show up immediately. No server-side cache, and
   no CDN or proxy cache, on this route. Send
   `Cache-Control: no-store` on every response from it, including errors.
5. **How the deck is written.** pened-creator saves the deck with the
   existing lesson update route,
   `PUT /api/lessons/:id` (session-cookie auth, the same call it already uses
   for every other lesson change), sending the whole lesson record with an
   `interactiveContent` array in it. It then reads it back through the GET
   route above and treats the save as failed if the deck isn't there.
   Verify that `PUT /api/lessons/:id`:
   - accepts and **persists** `interactiveContent` (a server that validates
     with a strict schema or silently drops unknown fields would make the
     save fail, and pened-creator will report "the server didn't store the
     slideshow deck");
   - stores the array exactly as sent, including entries for other tools;
   - returns the saved record.
   If the write endpoint is meant to be something else, say so. pened-creator
   would then be changed to use it, and that has to be decided before rollout.
6. **Large decks.** See section 5.

## 3. Auth and information hygiene

1. **Check `x-api-key` on this route** against the server's `API_KEY`. A
   missing or wrong key returns `401` or `403`. The value must equal the
   `PENED_API_KEY` secret set on pened-tools.
2. **Prefer a separate read-only key for pened-tools** that can only `GET`
   this route (for example a second env var checked only by this route). Then
   a leaked pened-tools secret can't write or read anything else. Verify what
   the current auth allows first: if `API_KEY` is a general key that also
   authorizes writes, do not hand it to pened-tools.
3. **Compare keys in constant time** if the runtime offers it.
4. **Session-cookie users are unaffected.** pened-creator does not use the
   API key and must never be given it. Don't loosen session auth on other
   routes to make this work.
5. **No secrets or internals in bodies.** Error bodies, on every status,
   must not contain the API key, the `x-api-key` header value, internal URLs
   or hostnames, stack traces, database names or file paths.
6. **CORS: no change.** The request is server-to-server, so browser CORS does
   not apply. Do **not** add `https://pened-tools.fly.dev` to `CORS_ORIGIN`
   for this feature. Leave it as it is for other browser clients.

## 4. One slideshow entry per lesson

pened-tools uses the first `tool: "slideshow"` entry it finds. So saving must
**replace** the existing slideshow entry instead of appending a second one.

- pened-creator already does this on its side: it reads the current entries,
  replaces the first slideshow entry in place (or adds one if there was none),
  drops any further slideshow duplicates, leaves every other tool's entry
  untouched and in order, and sends the whole array.
- pened-server should not depend on that. Where it stores or merges
  `interactiveContent`, either keep it as a plain array replaced wholesale, or
  enforce the rule server-side (at most one entry per `tool`, last write wins
  for that tool). Whichever it is, write it down in pened-server's README.
- Existing data: check whether any lesson already has two slideshow entries.
  If so, decide which one wins and clean it up. The first one currently wins
  in pened-tools.

## 5. Large decks

Decks can be very large (many slides, long text, inlined data).

- Check the JSON body size limit on `PUT /api/lessons/:id`. Many frameworks
  default to about 100kb. Raise it for this route to comfortably above the
  largest deck expected (start with 10 MB and adjust), and confirm the reverse
  proxy in front of it (Fly proxy, nginx, and so on) doesn't enforce a lower
  cap.
- Check any database column or document limit for `interactiveContent`
  (for example a `varchar` length, a row size limit, or a document size cap).
- A deck must **save and read back unchanged**: JSON in, the same JSON out.
  Key order doesn't matter, but no truncation, no field loss and no number or
  string coercion.
- An oversized body should return `413`, not a hang or a generic `500`.
  pened-creator shows a specific message for `413`.
- Keep the read route fast for large decks: it has to answer within pened-tools'
  8s timeout. Avoid loading unrelated heavy fields (uploaded images, and so
  on) to serve it, and return only `id` and `interactiveContent`.

## 6. Contract tests to add

Add automated tests to pened-server (the request goes through the real route,
with the real `x-api-key` check):

| # | Test | Expect |
| --- | --- | --- |
| 1 | Success: lesson with a slideshow entry | `200`, `{ id, interactiveContent: [ {tool:"slideshow", data:<deck>} ] }`, the deck unchanged |
| 2 | Unknown lesson id | `404`, JSON body, no secrets |
| 3 | Lesson with `interactiveContent: null` | `200`, `interactiveContent: null` |
| 4 | Lesson with entries but no slideshow entry | `200`, the other entries returned as stored |
| 5 | Lesson with multiple slideshow entries (legacy data) | documented behavior; the first is what pened-tools uses. Saving through the write path leaves exactly one |
| 6 | Wrong key, and missing key | `401` or `403`, body has no key |
| 7 | Colon-containing id, requested with `%3A` | `200`, and `id` in the body is the decoded id. Include a node id with extra colons |
| 8 | Trailing slash request | no `3xx` |
| 9 | Save a large deck, then read it back | equal to what was saved |
| 10 | Save twice | the slideshow entry is replaced, other tools' entries unchanged |
| 11 | Response headers | `Cache-Control: no-store` |

## 7. Rollout order

1. **pened-server:** make the changes above and deploy. Check sections 2
   and 3, and run the contract tests. From the pened-creator repo,
   `npm run verify:pened-server` (script `scripts/verify-pened-server-slideshow.mjs`)
   runs the same checks against a live server.
2. **pened-tools (Fly app):** set the secrets, not build args:
   `fly secrets set PENED_SERVER_URL=https://<pened-server> PENED_API_KEY=<the read-only key>`.
3. **pened-creator:** deploy the build that saves decks on the lesson and
   links by lesson id. Old encoded slideshow links keep working, so nothing
   has to be migrated.

## 8. Acceptance check

- Save a deck on a lesson in pened-creator, then open
  `https://pened-tools.fly.dev/tool/slideshow/<encoded lessonId>`. The deck
  plays.
- Edit the deck and reload. The change shows immediately.
- An unknown lesson, a lesson without a slideshow, a wrong key and a stopped
  server each show their own message instead of a slideshow.
- pened-tools never shows the API key or the pened-server URL in the page or
  in browser network requests.

## Open questions for the pened-server owner

- Does `PUT /api/lessons/:id` already persist `interactiveContent`, and how
  is a separate read-only key best configured?
- What is the real body and storage limit today?
- Are there lessons that already have more than one slideshow entry?