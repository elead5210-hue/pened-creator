# API Hand-off: Tool Suggestions

**Audience:** API Agent (backend implementation)
**Consumer:** `pened-creator` frontend
**Status:** Proposed contract. None of these endpoints exist yet.
**Related frontend work:** Context Menu in the Global Nav, Tool Suggestion modal, Admin suggestions view.

---

## 1. Purpose

Signed-in users can submit a free-text description of a new tool they would like to see. Submissions are persisted and become viewable to admin users, who can review them and update their status.

This document defines everything the API side needs to build: data model, endpoints, validation, auth rules, error format, and stub responses the frontend can develop against in parallel.

---

## 2. Conventions

These follow the patterns already used by the existing API clients in `src/lib/curriculum/shared/apiClient.ts`, `src/lib/tools/toolsClient.ts` and `src/lib/auth/authClient.ts`. If the API's existing conventions differ (base URL, auth mechanism, envelope shape), the existing conventions win. Please tell the frontend team what changed and update this document.

| Topic | Convention |
| --- | --- |
| Base path | `/api/tool-suggestions` (relative to the existing API base URL) |
| Format | JSON request and response bodies, `Content-Type: application/json; charset=utf-8` |
| Auth | Same session/token mechanism the app already uses for authenticated calls |
| IDs | UUID v4 strings |
| Timestamps | ISO 8601 UTC strings, e.g. `2026-09-29T08:15:30.000Z` |
| Field casing | `camelCase` in JSON |
| Unknown request fields | Ignored (not an error) |

---

## 3. Data Model

### 3.1 `ToolSuggestion`

| Field | Type | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | no | Server generated |
| `description` | string | no | Trimmed, 10 to 2000 characters |
| `status` | enum | no | `new` (default), `reviewed`, `accepted`, `rejected` |
| `submittedBy` | object | no | See 3.2 |
| `createdAt` | string (ISO 8601) | no | Server set on insert |
| `updatedAt` | string (ISO 8601) | no | Server set on insert and on every update |
| `reviewedBy` | object or null | yes | Admin who last changed the status. See 3.2 |
| `reviewedAt` | string (ISO 8601) or null | yes | Set when status first leaves `new`, updated on later status changes |
| `adminNote` | string or null | yes | Optional admin note, max 1000 characters |

### 3.2 `UserRef`

| Field | Type | Nullable | Notes |
| --- | --- | --- | --- |
| `id` | string (UUID) | no | User id |
| `displayName` | string | yes | Falls back to email local part if the user has no display name |
| `email` | string | yes | Only returned to admin endpoints. Never returned from the submit response |

### 3.3 Suggested table (reference only, implement as fits your stack)

```sql
CREATE TABLE tool_suggestions (
  id            UUID PRIMARY KEY,
  description   TEXT        NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  status        TEXT        NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'reviewed', 'accepted', 'rejected')),
  submitted_by  UUID        NOT NULL REFERENCES users(id),
  reviewed_by   UUID        NULL REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ NULL,
  admin_note    TEXT        NULL CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tool_suggestions_status_created_idx
  ON tool_suggestions (status, created_at DESC);
CREATE INDEX tool_suggestions_submitted_by_idx
  ON tool_suggestions (submitted_by);
```

---

## 4. Auth and Roles

| Endpoint | Requires |
| --- | --- |
| `POST /api/tool-suggestions` | Any authenticated user |
| `GET /api/tool-suggestions` | Authenticated user with the **admin** role |
| `GET /api/tool-suggestions/:id` | Authenticated user with the **admin** role |
| `PATCH /api/tool-suggestions/:id` | Authenticated user with the **admin** role |

Rules:

- Unauthenticated requests return `401`.
- Authenticated non-admin requests to admin endpoints return `403`. The API must not leak whether a suggestion id exists to non-admins (always `403` before any lookup).
- The submitter is always taken from the authenticated session. The client never sends a user id.
- The frontend hides admin UI for non-admins, but this is a convenience only. The API is the source of truth for authorization.

**Open question for the API Agent:** the frontend needs a way to know whether the current user is an admin so it can show or hide the admin entry. Please confirm whether the existing session/user payload already exposes a role. If it does not, add `role` (or `isAdmin`) to the current-user response and report the exact field name back so `AuthContext` can consume it.

---

## 5. Endpoints

### 5.1 Submit a suggestion

`POST /api/tool-suggestions`

**Request body**

```json
{
  "description": "A tool that turns a lesson into a printable worksheet with answer key."
}
```

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `description` | string | yes | After trimming leading and trailing whitespace: 10 to 2000 characters. Internal newlines are preserved. |

**Success: `201 Created`**

```json
{
  "suggestion": {
    "id": "6f1c1f0e-2f3e-4a52-9d55-6b1a2f7d8c11",
    "description": "A tool that turns a lesson into a printable worksheet with answer key.",
    "status": "new",
    "submittedBy": {
      "id": "b7a0f1d2-3c44-4e6b-8f21-0d9e5c7a1234",
      "displayName": "Sam Teacher"
    },
    "createdAt": "2026-09-29T08:15:30.000Z",
    "updatedAt": "2026-09-29T08:15:30.000Z",
    "reviewedBy": null,
    "reviewedAt": null,
    "adminNote": null
  }
}
```

Note that `email` is intentionally absent from `submittedBy` in this response.

**Errors:** `400` (validation), `401`, `429` (rate limited), `500`. See section 6.

**Rate limiting (recommended):** max 10 submissions per user per hour. Return `429` with a `Retry-After` header (seconds) when exceeded.

---

### 5.2 List suggestions (admin)

`GET /api/tool-suggestions`

**Query parameters**

| Param | Type | Default | Rules |
| --- | --- | --- | --- |
| `status` | enum | none (all) | One of `new`, `reviewed`, `accepted`, `rejected`. May be repeated or comma separated to filter on several. |
| `page` | integer | `1` | Min 1 |
| `pageSize` | integer | `25` | Min 1, max 100 |
| `sort` | enum | `createdAt:desc` | `createdAt:desc` or `createdAt:asc` |

**Success: `200 OK`**

```json
{
  "items": [
    {
      "id": "6f1c1f0e-2f3e-4a52-9d55-6b1a2f7d8c11",
      "description": "A tool that turns a lesson into a printable worksheet with answer key.",
      "status": "new",
      "submittedBy": {
        "id": "b7a0f1d2-3c44-4e6b-8f21-0d9e5c7a1234",
        "displayName": "Sam Teacher",
        "email": "sam@example.com"
      },
      "createdAt": "2026-09-29T08:15:30.000Z",
      "updatedAt": "2026-09-29T08:15:30.000Z",
      "reviewedBy": null,
      "reviewedAt": null,
      "adminNote": null
    }
  ],
  "page": 1,
  "pageSize": 25,
  "totalItems": 1,
  "totalPages": 1,
  "counts": {
    "new": 1,
    "reviewed": 0,
    "accepted": 0,
    "rejected": 0
  }
}
```

`counts` is the total per status across all suggestions, ignoring the `status` filter and pagination. The admin UI uses it for tab badges.

Empty result: `items` is `[]`, `totalItems` is `0`, `totalPages` is `0`.

**Errors:** `400` (bad query param), `401`, `403`, `500`.

---

### 5.3 Get one suggestion (admin)

`GET /api/tool-suggestions/:id`

**Success: `200 OK`**

```json
{
  "suggestion": {
    "id": "6f1c1f0e-2f3e-4a52-9d55-6b1a2f7d8c11",
    "description": "A tool that turns a lesson into a printable worksheet with answer key.",
    "status": "reviewed",
    "submittedBy": {
      "id": "b7a0f1d2-3c44-4e6b-8f21-0d9e5c7a1234",
      "displayName": "Sam Teacher",
      "email": "sam@example.com"
    },
    "createdAt": "2026-09-29T08:15:30.000Z",
    "updatedAt": "2026-09-30T10:02:11.000Z",
    "reviewedBy": {
      "id": "0a3d9c55-71be-4c0a-9a6e-5f2b8c4d7e90",
      "displayName": "Alex Admin",
      "email": "alex@example.com"
    },
    "reviewedAt": "2026-09-30T10:02:11.000Z",
    "adminNote": "Overlaps with the planned worksheet generator. Keep for roadmap."
  }
}
```

**Errors:** `400` (id is not a UUID), `401`, `403`, `404`, `500`.

---

### 5.4 Update status and note (admin)

`PATCH /api/tool-suggestions/:id`

**Request body** (at least one field required)

```json
{
  "status": "reviewed",
  "adminNote": "Overlaps with the planned worksheet generator. Keep for roadmap."
}
```

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `status` | enum | no | `new`, `reviewed`, `accepted`, `rejected` |
| `adminNote` | string or null | no | Max 1000 characters after trimming. `null` or empty string clears the note. |

Behavior:

- Any status may move to any other status (no forced workflow). Admins can correct mistakes.
- When `status` changes, set `reviewedBy` to the acting admin and update `reviewedAt` to now. Moving back to `new` clears `reviewedBy` and `reviewedAt`.
- Changing only `adminNote` also updates `updatedAt`, and sets `reviewedBy` if it is currently null.
- `description`, `submittedBy` and `createdAt` are immutable. If sent, they are ignored.
- The operation must be idempotent: repeating the same PATCH produces the same stored state.

**Success: `200 OK`** returns the same shape as 5.3 (`{ "suggestion": { ... } }`).

**Errors:** `400` (validation or empty body), `401`, `403`, `404`, `500`.

---

## 6. Error Format

All non-2xx responses use this body:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Description must be at least 10 characters.",
    "fields": {
      "description": "Description must be at least 10 characters."
    }
  }
}
```

| Field | Notes |
| --- | --- |
| `error.code` | Stable machine-readable string (table below) |
| `error.message` | Human-readable, safe to display in the UI |
| `error.fields` | Optional. Map of field name to message, present for `VALIDATION_ERROR` |

| HTTP | `error.code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing, too short, too long or wrongly typed fields; invalid query params; empty PATCH body; malformed id |
| 401 | `UNAUTHENTICATED` | No valid session |
| 403 | `FORBIDDEN` | Authenticated but not an admin |
| 404 | `NOT_FOUND` | Suggestion id does not exist (admin endpoints only) |
| 429 | `RATE_LIMITED` | Too many submissions |
| 500 | `INTERNAL_ERROR` | Unexpected failure. Do not leak internals in `message` |

**Validation messages the frontend expects** (exact wording is flexible, codes and field keys are not):

| Field | Condition | Suggested message |
| --- | --- | --- |
| `description` | missing or blank | `Description is required.` |
| `description` | under 10 chars | `Description must be at least 10 characters.` |
| `description` | over 2000 chars | `Description must be 2000 characters or fewer.` |
| `status` | not in enum | `Status must be one of: new, reviewed, accepted, rejected.` |
| `adminNote` | over 1000 chars | `Note must be 1000 characters or fewer.` |

The frontend applies the same limits client-side, but the API must always enforce them.

---

## 7. Security and Data Handling

- Treat `description` and `adminNote` as untrusted text. Store as-is, never as HTML. The frontend renders as plain text. Escape on output anywhere else it is rendered (emails, exports).
- Use parameterized queries only.
- Do not return `email` from the submit endpoint or to non-admins.
- Do not log full descriptions at info level. Log ids only.
- Suggestions are retained until an admin-driven deletion process exists (out of scope for v1).

---

## 8. Out of Scope for v1

- Deleting suggestions
- Editing a suggestion after submission
- Submitter-facing "my suggestions" list
- Email or in-app notifications on submit or status change
- Voting, comments, duplicate detection, attachments

The design leaves room for these. For example, a future `GET /api/tool-suggestions/mine` route would not conflict with the routes above as long as it is registered before `/:id`.

---

## 9. Stub Responses for Frontend Development

The frontend will build against a mock adapter that returns exactly the shapes below, so the real API can replace it without frontend changes.

### 9.1 Fixtures

```json
{
  "submitSuccess": {
    "status": 201,
    "body": {
      "suggestion": {
        "id": "6f1c1f0e-2f3e-4a52-9d55-6b1a2f7d8c11",
        "description": "A tool that turns a lesson into a printable worksheet with answer key.",
        "status": "new",
        "submittedBy": { "id": "b7a0f1d2-3c44-4e6b-8f21-0d9e5c7a1234", "displayName": "Sam Teacher" },
        "createdAt": "2026-09-29T08:15:30.000Z",
        "updatedAt": "2026-09-29T08:15:30.000Z",
        "reviewedBy": null,
        "reviewedAt": null,
        "adminNote": null
      }
    }
  },
  "submitValidationError": {
    "status": 400,
    "body": {
      "error": {
        "code": "VALIDATION_ERROR",
        "message": "Description must be at least 10 characters.",
        "fields": { "description": "Description must be at least 10 characters." }
      }
    }
  },
  "unauthenticated": {
    "status": 401,
    "body": { "error": { "code": "UNAUTHENTICATED", "message": "Please sign in to continue." } }
  },
  "forbidden": {
    "status": 403,
    "body": { "error": { "code": "FORBIDDEN", "message": "You do not have permission to view this." } }
  },
  "rateLimited": {
    "status": 429,
    "headers": { "Retry-After": "1800" },
    "body": { "error": { "code": "RATE_LIMITED", "message": "Too many suggestions. Please try again later." } }
  },
  "serverError": {
    "status": 500,
    "body": { "error": { "code": "INTERNAL_ERROR", "message": "Something went wrong. Please try again." } }
  },
  "listEmpty": {
    "status": 200,
    "body": {
      "items": [],
      "page": 1,
      "pageSize": 25,
      "totalItems": 0,
      "totalPages": 0,
      "counts": { "new": 0, "reviewed": 0, "accepted": 0, "rejected": 0 }
    }
  }
}
```

### 9.2 Mock adapter behavior (frontend side)

- Submit with a trimmed description under 10 characters returns `submitValidationError`.
- Submit with the exact text `simulate-error` returns `serverError`.
- Submit with the exact text `simulate-rate-limit` returns `rateLimited`.
- All other valid submissions return `submitSuccess` with the description echoed back and a fresh id.
- Mock latency is around 400 ms so loading states are visible.

---

## 10. Acceptance Checklist for the API Agent

- [ ] Table and indexes created via migration
- [ ] `POST /api/tool-suggestions` works for any authenticated user, returns `201`
- [ ] Submitter is derived from the session, never from the body
- [ ] Description trimmed, then validated at 10 to 2000 characters
- [ ] Rate limiting in place with `Retry-After`
- [ ] `GET /api/tool-suggestions` supports `status`, `page`, `pageSize`, `sort` and returns `counts`
- [ ] `GET /api/tool-suggestions/:id` returns `404` for unknown ids (admins only)
- [ ] `PATCH /api/tool-suggestions/:id` updates status and note, maintains `reviewedBy`, `reviewedAt` and `updatedAt`
- [ ] Non-admins get `403` on all admin endpoints, unauthenticated users get `401`
- [ ] Error body matches section 6 for every non-2xx response
- [ ] Current-user payload exposes the admin role, and the field name has been reported back to the frontend team
- [ ] Automated tests cover validation, auth and role checks, pagination, filtering and status transitions
- [ ] This document updated if any behavior differs from what is described here

---

## 11. Change Log

| Date | Change |
| --- | --- |
| 2026-09-29 | Initial contract drafted by the frontend team |