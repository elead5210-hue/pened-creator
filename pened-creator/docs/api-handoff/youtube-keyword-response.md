# API handoff: store the YouTube keyword LLM response

**Audience:** the API agent working on `penedv1-server`.
**Frontend status:** implemented in `pened-creator` (see "Frontend files that define this contract" at the end).
**Goal:** persist, per lesson, the raw response the user pasted from the LLM in Phase 2 step 3 ("Paste the LLM's response" on the YouTube Videos step), together with the keywords extracted from it, so the work survives a refresh and is reloaded when the user returns to the step.

The frontend is already calling these endpoints. Until they exist, the step's load call will fail and its save call will fail with an error message. Everything below is derived from what the frontend actually sends and validates, so please match it exactly. Where something is a recommendation rather than a frontend requirement, it is marked **(recommended)**.

> The `server/` source is not part of the frontend repo, so the notes on existing conventions (auth middleware, `lib/validation.js`, lessons table) are based on how the frontend consumes the API. Adapt to whatever the server actually does, but keep the wire contract identical.

---

## 1. Summary of what to build

| Method | Path | Purpose | Success |
|---|---|---|---|
| `GET` | `/api/lessons/:lessonId/youtube-keyword-response` | Fetch the saved response for a lesson | `200` + saved record, or `404` if none saved |
| `PUT` | `/api/lessons/:lessonId/youtube-keyword-response` | Create or fully replace the saved response (idempotent upsert) | `200` + saved record |
| `DELETE` | `/api/lessons/:lessonId/youtube-keyword-response` | Remove the saved response | `204`, no body |

There is **at most one saved response per lesson**. Saving again replaces it. There is no separate create endpoint and no `POST`.

No changes are needed to `POST /api/youtube/search`. The keyword strings from the saved response are sent to it unchanged by the frontend, exactly as before.

---

## 2. Data model

The frontend associates the response with a **lesson**, not with a project/phase/step tuple. The lesson id is already the identity of a Phase 2 pipeline, and this step is the only YouTube-keyword step in it, so no phase or step columns are needed. Do not add them to the wire contract.

Suggested table `youtube_keyword_responses` (adapt names to the server's conventions):

| Column | Type | Notes |
|---|---|---|
| `lesson_id` | same type as `lessons.id`, **primary key** (or unique) | FK to lessons, `ON DELETE CASCADE`. One row per lesson. |
| `user_id` | same type as users id | Denormalised owner for ownership checks (or derive through `lessons.user_id`, whichever the server already does for lessons). |
| `raw_response` | text, not null | The exact text the user pasted, stored **verbatim**. No trimming, no normalisation, no fence stripping. It is re-shown in the textarea and re-parsed client-side. |
| `keywords` | JSON/JSONB, not null | Array of keyword items, see 2.1. |
| `created_at` | timestamptz, not null | Set on first insert only. **Must not change on overwrite.** |
| `updated_at` | timestamptz, not null | Set on every successful `PUT`. |

If the server stores lessons as JSON documents rather than relational rows, an equivalent is a `youtubeKeywordResponse` sub-object on the lesson, **but keep it out of the `LessonRecord` payload returned by `GET/PUT /api/lessons/:id`**. The frontend's existing `PUT /api/lessons/:id` sends a whole `LessonRecord` back, and a separate resource keeps the two from clobbering each other. A separate table is the recommended approach.

### 2.1 Keyword item

Every item has exactly three required, non-empty strings:

```json
{
  "keyword": "photosynthesis for kids explained",
  "sourceTool": "introduction",
  "reason": "Gives students a short visual overview before the lesson starts."
}
```

- `keyword`: the exact YouTube search phrase. This is what the frontend later sends to `POST /api/youtube/search`.
- `sourceTool`: which section/topic the keyword supports (e.g. `"introduction"`, `"vocabulary:morph"`).
- `reason`: one plain-language sentence.

Preserve the array **order** and store items as given.

---

## 3. Auth and ownership

- **Auth:** same session-cookie mechanism as the other `/api/lessons/*` routes. The frontend sends every request with `credentials: "include"`. No token header. Reuse the existing auth middleware; all three routes are authenticated.
- **Unauthenticated:** `401` with the standard error body (section 6). The frontend's API client reacts to a data-route `401` by probing `GET /api/auth/me`; if the session is confirmed invalid it logs the user out, and if it's still valid it retries the request once. So a `401` must mean "no valid session" and nothing else. Do not return `401` for ownership problems.
- **Ownership:** a user may only read/write/delete the response of a lesson they own. Apply exactly the same ownership rule the existing lesson routes use. If the lesson does not exist **or belongs to someone else**, return `404` (not `403`), so lesson ids aren't leaked. Note the consequence for `GET`, described in section 4.1.

---

## 4. Endpoints

`:lessonId` is the same id used in `/api/lessons/:id`. The frontend URL-encodes it with `encodeURIComponent`.

### 4.1 `GET /api/lessons/:lessonId/youtube-keyword-response`

Returns the saved response for the lesson.

**Success: `200 OK`**

```json
{
  "lessonId": "lesson_8f3a12",
  "rawResponse": "```json\n[\n  {\"keyword\": \"photosynthesis for kids explained\", \"sourceTool\": \"introduction\", \"reason\": \"Gives students a short visual overview.\"}\n]\n```",
  "keywords": [
    {
      "keyword": "photosynthesis for kids explained",
      "sourceTool": "introduction",
      "reason": "Gives students a short visual overview."
    }
  ],
  "createdAt": "2026-09-23T18:04:11.532Z",
  "updatedAt": "2026-09-23T18:04:11.532Z"
}
```

**Nothing saved yet: `404 Not Found`** with the standard error body, e.g. `{ "error": "No saved YouTube keyword response for this lesson" }`.

The frontend treats a `404` on this `GET` as "not saved yet" and shows the empty step. Consequently:

- Do **not** return `200` with `null`, `{}`, or an empty array for "nothing saved". The frontend validates every `200` body against the schema in section 5 and will throw if it doesn't match.
- Lesson-not-found and lesson-not-owned also return `404`. The frontend can't and doesn't need to tell these apart on this call.

**Other errors:** `401` (no session), `500`.

### 4.2 `PUT /api/lessons/:lessonId/youtube-keyword-response`

Creates the saved response if none exists, otherwise **replaces it entirely**. This is a full replace, not a merge or patch.

**Request headers:** `Content-Type: application/json` (cookie auth as above).

**Request body:**

```json
{
  "rawResponse": "[\n  {\"keyword\": \"photosynthesis for kids explained\", \"sourceTool\": \"introduction\", \"reason\": \"Gives students a short visual overview.\"}\n]",
  "keywords": [
    {
      "keyword": "photosynthesis for kids explained",
      "sourceTool": "introduction",
      "reason": "Gives students a short visual overview."
    }
  ]
}
```

- `lessonId` is **only** in the URL. The frontend does not send it in the body, and does not send `createdAt`/`updatedAt`/`userId`. If a body contains any of these, ignore them (do not error, do not trust them).
- `rawResponse` is the user's pasted text exactly as typed (it may include markdown code fences, surrounding prose, or whitespace). Store it verbatim.
- `keywords` are the items the frontend extracted from `rawResponse` and already validated.

**Success: `200 OK`** (use `200` for both the create and the replace case; the frontend does not distinguish, and does not accept an empty body here) with the full saved record, same shape as the `GET` response:

```json
{
  "lessonId": "lesson_8f3a12",
  "rawResponse": "[\n  {\"keyword\": ...}\n]",
  "keywords": [ { "keyword": "...", "sourceTool": "...", "reason": "..." } ],
  "createdAt": "2026-09-23T18:04:11.532Z",
  "updatedAt": "2026-09-23T18:09:47.120Z"
}
```

The frontend parses this response with the same schema as `GET` and uses it to confirm the save, so it must be the record **as stored**, including server-set timestamps.

**Timestamp rules:**

- First save: `createdAt = updatedAt = now`.
- Overwrite: `createdAt` unchanged, `updatedAt = now`.
- Format: ISO 8601 UTC string (e.g. `toISOString()`), non-empty. The frontend only checks they're non-empty strings but treats them as ISO timestamps.

**Errors:** `400` (validation, see section 5), `401`, `404` (lesson missing or not owned), `413` if the body exceeds the limit (see 5.2), `500`.

### 4.3 `DELETE /api/lessons/:lessonId/youtube-keyword-response`

Removes the saved response.

**Success: `204 No Content`, empty body.** The frontend's client resolves `undefined` for `204` and does not parse a body.

Behaviour:

- If nothing is saved for a lesson that the user owns, return `204` as well (idempotent), **or** `404`. The frontend treats both as success. `204` is preferred **(recommended)**.
- Lesson missing or not owned: `404`.
- Other errors: `401`, `500`.

The frontend currently has a helper for this but does not expose a delete button in the UI, so this endpoint is low traffic. It's required for a complete contract and for cleanup.

### 4.4 Cascade behaviour

When a lesson is deleted (`DELETE /api/lessons/:id`), its saved YouTube keyword response must be deleted too (FK `ON DELETE CASCADE`, or explicit cleanup). Otherwise orphaned rows remain and a re-created lesson with a reused id could inherit stale data.

---

## 5. Validation

Validate the `PUT` body server-side. Do not rely on the frontend having validated it. The rules below mirror the frontend's zod schema (`youtubeKeywordSaveInputSchema`) so anything the frontend considers valid is accepted.

### 5.1 Rules

- Body must be a JSON object.
- `rawResponse`: string, **length ≥ 1**. (Do not trim before checking length? A whitespace-only string can't reach here because the frontend rejects it earlier, so either behaviour is fine. Store the original, untrimmed value.)
- `keywords`: array with **at least 1** item.
- Each item: object with `keyword`, `sourceTool`, `reason`, each a string of **length ≥ 1**.
- Extra unknown properties on the body or on items: ignore/strip (do not error, do not store).
- Do **not** require that `keywords` is derivable from `rawResponse`. The frontend does that extraction; the server stores both as given.
- Do not reject duplicate `keyword` strings; the frontend doesn't dedupe at this layer.

### 5.2 Size limits **(recommended)**

The frontend imposes no limit, so keep these generous so real responses never fail:

- `rawResponse`: up to ~200,000 characters.
- `keywords`: up to ~200 items; each string field up to ~2,000 characters.
- Request body limit high enough for the above (make sure the JSON body parser's limit is raised if it's lower). Over the limit: `413` (or `400`) with the standard error body and a clear message, since the frontend shows `error.message` to the user.

### 5.3 Validation error response

Use the server's existing validation error shape (`lib/validation.js`'s `formatZodError`, which the frontend's `ApiError.details` is typed against):

**`400 Bad Request`**

```json
{
  "error": "Invalid request body",
  "details": [
    { "path": "keywords.0.reason", "message": "reason is required" },
    { "path": "rawResponse", "message": "rawResponse is required" }
  ]
}
```

- `path`: dot-notation path into the body (array indexes as numbers, e.g. `keywords.2.keyword`).
- The message strings above match the frontend's; wording doesn't need to be identical, but `error` must be a non-empty string because that's what the user sees (the frontend displays `error` as "Could not save the response: <error>").

---

## 6. Standard error body

All non-2xx responses (except `204`) should be JSON:

```json
{ "error": "human-readable message", "details": [ { "path": "…", "message": "…" } ] }
```

- `error`: required string. Shown to end users, so keep it plain-language and free of internals/stack traces.
- `details`: optional, only for validation failures.

If a response isn't JSON, the frontend falls back to `Request failed with status <code>`. It still works, but the message is less helpful.

### Error matrix

| Situation | GET | PUT | DELETE |
|---|---|---|---|
| Success | 200 + record | 200 + record | 204 |
| No saved response (lesson owned) | **404** | n/a (creates) | 204 (preferred) or 404 |
| Lesson missing or not owned | 404 | 404 | 404 |
| Not logged in / session expired | 401 | 401 | 401 |
| Body fails validation | n/a | 400 + details | n/a |
| Malformed JSON body | n/a | 400 | n/a |
| Body too large | n/a | 413 (or 400) | n/a |
| Unexpected server error | 500 | 500 | 500 |

Frontend behaviour on errors, for reference:

- `GET` `404` → treated as "nothing saved", no error shown. Any other failure → toast "Couldn't load your saved response: <error>", and the user can still paste a fresh response.
- `PUT` failure → inline error "Could not save the response: <error>" and the form stays editable so the user can retry. Their pasted text is not lost.
- Network failure (no response) is handled client-side as status `0`; nothing for the server to do.

---

## 7. Idempotency and concurrency

- **`PUT` is an idempotent full replace.** Sending the same body twice results in the same stored `rawResponse` and `keywords`; only `updatedAt` advances. `createdAt` never changes after first insert.
- The frontend already blocks double-submits while a save is in flight (a ref guard plus a disabled button), so duplicate concurrent saves from one tab are not expected. Retries after a failed save are expected and must be safe, which the upsert semantics guarantee.
- Implement the upsert atomically (e.g. `INSERT … ON CONFLICT (lesson_id) DO UPDATE …`, keeping the original `created_at`), so two concurrent first saves can't create duplicates or return a `500` on a unique violation.
- Last write wins. There is no `If-Match`/ETag/versioning in this contract and the frontend doesn't send any.
- `DELETE` is idempotent (see 4.3).

---

## 8. Example exchanges

**First save**

```
PUT /api/lessons/lesson_8f3a12/youtube-keyword-response
Content-Type: application/json
Cookie: <session>

{
  "rawResponse": "[{\"keyword\":\"fractions on a number line\",\"sourceTool\":\"introduction\",\"reason\":\"Shows how fractions sit between whole numbers.\"}]",
  "keywords": [
    { "keyword": "fractions on a number line", "sourceTool": "introduction", "reason": "Shows how fractions sit between whole numbers." }
  ]
}

→ 200 OK
{
  "lessonId": "lesson_8f3a12",
  "rawResponse": "[{\"keyword\":\"fractions on a number line\",\"sourceTool\":\"introduction\",\"reason\":\"Shows how fractions sit between whole numbers.\"}]",
  "keywords": [ { "keyword": "fractions on a number line", "sourceTool": "introduction", "reason": "Shows how fractions sit between whole numbers." } ],
  "createdAt": "2026-09-23T18:04:11.532Z",
  "updatedAt": "2026-09-23T18:04:11.532Z"
}
```

**Return to the step later (refresh)**

```
GET /api/lessons/lesson_8f3a12/youtube-keyword-response
→ 200 OK  (same record as above)
```

**Nothing saved for a fresh lesson**

```
GET /api/lessons/lesson_new/youtube-keyword-response
→ 404 Not Found
{ "error": "No saved YouTube keyword response for this lesson" }
```

**Invalid body**

```
PUT /api/lessons/lesson_8f3a12/youtube-keyword-response
{ "rawResponse": "", "keywords": [] }

→ 400 Bad Request
{
  "error": "Invalid request body",
  "details": [
    { "path": "rawResponse", "message": "rawResponse is required" },
    { "path": "keywords", "message": "at least one keyword is required" }
  ]
}
```

**Someone else's lesson**

```
GET /api/lessons/lesson_of_another_user/youtube-keyword-response
→ 404 Not Found
{ "error": "Lesson not found" }
```

**Delete**

```
DELETE /api/lessons/lesson_8f3a12/youtube-keyword-response
→ 204 No Content
```

---

## 9. CORS and transport

- The frontend uses `credentials: "include"`. The API's CORS config must already allow the app origin with credentials; confirm that `PUT` and `DELETE` are in the allowed methods for this route (they already are for `/api/lessons/:id`, so this is normally a no-op).
- `Content-Type: application/json` is sent only on requests with a body (`PUT`). `GET` and `DELETE` have no body.

---

## 10. Acceptance checklist

- [ ] `GET` returns `200` with the exact shape in 4.1 after a save, and `404` (not `200 null`) before any save.
- [ ] `PUT` creates on first call and replaces on later calls, returning `200` and the full stored record each time.
- [ ] `createdAt` is stable across overwrites; `updatedAt` advances.
- [ ] `rawResponse` round-trips byte-for-byte (including newlines, fences, leading/trailing whitespace, unicode).
- [ ] `keywords` round-trip in the same order with the same three string fields.
- [ ] `PUT` with empty `rawResponse`, empty `keywords`, a keyword missing any of the three fields, or a non-string field returns `400` with `error` and `details[]`.
- [ ] Unauthenticated requests return `401`; another user's lesson and unknown lessons return `404`.
- [ ] `DELETE` returns `204` with an empty body, and a second `DELETE` also succeeds (204 or 404).
- [ ] Deleting a lesson removes its saved response.
- [ ] Concurrent first `PUT`s don't produce a `500` or duplicate rows.
- [ ] `POST /api/youtube/search` behaviour is unchanged.

---

## Frontend files that define this contract

Keep these in sync if the contract changes.

- `src/lib/curriculum/shared/schema.ts`: `YoutubeKeywordItem`, `YoutubeKeywordSaveInput`, `YoutubeKeywordSavedResponse` and their zod schemas (`youtubeKeywordSaveInputSchema` is what the frontend validates before sending; `youtubeKeywordSavedResponseSchema` is what it validates on every `GET`/`PUT` response).
- `src/lib/curriculum/shared/db.ts`: `getYoutubeKeywordResponse` (`404` → "not saved"), `saveYoutubeKeywordResponse` (`PUT`), `deleteYoutubeKeywordResponse` (`404` tolerated).
- `src/lib/curriculum/phase2-content/youtubeClient.ts`: thin wrappers `loadStoredYoutubeKeywordResponse`, `saveStoredYoutubeKeywordResponse`, `clearStoredYoutubeKeywordResponse`.
- `src/components/curriculum/phase2-content/PasteYoutubeKeywordResponseForm.tsx`: sends `{ rawResponse, keywords }` on submit, with saving/success/error states and duplicate-save prevention.
- `src/components/curriculum/phase2-content/YoutubeKeywordGenerator.tsx`: loads the saved response on mount and pre-fills the form with `rawResponse`; uses `keywords[].keyword` to run the YouTube search.
- `src/lib/curriculum/shared/apiClient.ts`: error shape (`{ error, details? }`), `credentials: "include"`, and the `401` probe/retry behaviour.