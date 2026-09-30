# QA Checklist: Tool Suggestions on the Deployed App

**Applies to:** `pened-creator` (frontend, `https://pened-creator.fly.dev`) talking to `pened-server` (API, `https://pened-server.fly.dev`)
**When to run:** after any change to `src/lib/tools/toolSuggestionsClient.ts`, `src/lib/curriculum/shared/apiClient.ts`, `src/lib/auth/*`, the API-call guard, or the CORS / `VITE_API_URL` configuration, and before signing off a deploy that touches tool suggestions.
**Contract:** `docs/api-handoff/tool-suggestions.md`

## Why this checklist exists

The tool suggestions client once shipped calling a relative `/api/tool-suggestions` path. In production that resolves against the frontend host (`pened-creator.fly.dev`), which has no such route, so the POST answered `404` and never reached the API. The mock adapter and a unit test that asserted the relative URL both hid it. The steps below check the real deployed behaviour end to end, which no unit test can.

Record the date, the commit deployed and who ran the checklist at the bottom.

---

## 1. Before deploying (local)

Run these from the `pened-creator` folder on the commit you are about to deploy.

- [ ] `npm run build` completes with no errors. Its `prebuild` step runs `routes:check`, `boundaries:check`, `secrets:check` and `apicalls:check`, so a pass here covers all four guards.
- [ ] `npm run lint` passes (ESLint plus the same four guards).
- [ ] `npm test` (vitest) passes. This includes `src/lib/tools/toolSuggestionsClient.test.ts` and `scripts/check-api-calls.test.js`.
- [ ] `npm run apicalls:check` on its own prints `check-api-calls: OK` and exits 0.
- [ ] `git status` shows no uncommitted change to `src/routeTree.gen.ts` after the build (`routes:check` fails if it is stale).
- [ ] `VITE_API_URL` for the deploy points at the API host (`https://pened-server.fly.dev`), with no trailing path, and `VITE_USE_MOCK_TOOL_SUGGESTIONS` is **not** `true` in the production build settings. Check `fly.toml`, the Dockerfile build args and any Fly secrets or build environment used for the frontend.

## 2. Server configuration (pened-server)

- [ ] `CORS_ORIGIN` on `pened-server` includes `https://pened-creator.fly.dev` (exact origin: scheme and host, no trailing slash, no path). If it lists several origins, the frontend origin is one of them.
- [ ] CORS allows credentials, because the client sends `credentials: "include"` for the session cookie.
- [ ] The deployed server is the version that has `GET /api/tool-suggestions/mine`. A quick check: an unauthenticated `GET https://pened-server.fly.dev/api/tool-suggestions/mine` answers `401` with a JSON body `{ "error": { "code": "UNAUTHENTICATED", ... } }`, not `404` or an HTML page.
- [ ] Unsupported methods return the structured error. For example, an unauthenticated `DELETE https://pened-server.fly.dev/api/tool-suggestions` answers `405` with `error.code` `METHOD_NOT_ALLOWED` (or `401` first if the server checks auth before method; either is fine as long as the body is the structured JSON error and never HTML).

## 3. Deploy

- [ ] Redeploy the frontend (`fly deploy` for `pened-creator`) and wait for the release to report healthy.
- [ ] Open `https://pened-creator.fly.dev` in a fresh private window and hard-refresh, so no cached bundle from the previous release is used.

## 4. Submit a suggestion as a signed-in non-admin

Use a normal (non-admin) account. Open the browser dev tools **Network** tab before you start, and tick "Preserve log".

- [ ] Sign in. The `GET /api/auth/me` request goes to `pened-server.fly.dev` (not `pened-creator.fly.dev`) and returns `200`.
- [ ] In the response body of `/api/auth/me` (and of the login response), `isAdmin` is `false` for this account.
- [ ] Open the Tool Suggestion modal from the global nav context menu and submit a description of 10 to 2000 characters.
- [ ] The request `POST /api/tool-suggestions` has the **request URL on `pened-server.fly.dev`**, not `pened-creator.fly.dev`.
- [ ] The response status is **`201 Created`** and the body has `suggestion.status` `"new"`.
- [ ] There is no CORS error in the console, and the preflight `OPTIONS` request (if shown) answers `2xx`.
- [ ] The request carried the session cookie (the `Cookie` header is present on the request, or the server recognised the user, which the `201` already proves).
- [ ] The modal shows its success state and no error message.
- [ ] Submitting a too-short description (under 10 characters) is rejected in the modal before any request is sent, or, if it is sent, comes back as `400 VALIDATION_ERROR` with the field message shown.

## 5. Read back your own suggestions

- [ ] `GET /api/tool-suggestions/mine` (request URL on `pened-server.fly.dev`) returns **`200`** for the signed-in non-admin user.
- [ ] The body is `{ "items": [ ... ] }` and includes the suggestion just submitted.
- [ ] Each item has `id`, `description`, `status`, `submittedBy` (no `email`), `createdAt`, `updatedAt` and `reviewedAt`, and has **no** `adminNote` or `reviewedBy`.
- [ ] Signed out (or in a window with no session), the same request returns `401`, and the UI treats it as "sign in needed" rather than a crash.
- [ ] A second non-admin account sees only its own suggestions, never the first account's.

## 6. Admin-only endpoints stay off-limits to non-admins

While signed in as the non-admin account, with the Network tab open, use the app normally (open the nav menu, the modal, the Tools page and a lesson).

- [ ] No request to `GET /api/tool-suggestions` (the admin list), `GET /api/tool-suggestions/:id` or `PATCH /api/tool-suggestions/:id` appears in the Network tab.
- [ ] No `403 FORBIDDEN` responses from `/api/tool-suggestions*` appear in the Network tab or the console.
- [ ] Admin-only UI, if present in this build, is hidden for this account.

If an admin account is available:

- [ ] Signed in as an admin, `/api/auth/me` returns `isAdmin: true`.
- [ ] Admin-only endpoints answer `200` for the admin (list, get one, PATCH a status), and a non-admin calling the same URL directly (for example from the browser address bar or curl with their cookie) gets `403`.

## 7. Error handling on the deployed app

- [ ] Signed out, submitting a suggestion (if the entry point is reachable) shows a sign-in message and the request answers `401`.
- [ ] Sending more than the rate limit (recommended 10 per hour per user) returns `429` with a `Retry-After` header and the modal shows a "try again later" message. Skip this step if it would trip a shared limit on a real account.
- [ ] Every non-2xx response from `/api/tool-suggestions*` seen during testing has a JSON body of the shape `{ "error": { "code", "message" } }`, never an HTML page or an empty body.

## 8. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `POST` goes to `pened-creator.fly.dev` and returns `404` | The client is calling a relative path. Check that the request is built with `apiUrl()` and run `npm run apicalls:check`. Also make sure the browser is not serving a cached old bundle. |
| Console error mentioning `VITE_API_URL`, or "Couldn't reach the server" with no request in the Network tab | `VITE_API_URL` is missing or invalid at build time. It is baked in during `vite build`, so set it in the build environment and redeploy. |
| Request goes to the API host but the browser blocks it with a CORS error | `CORS_ORIGIN` on `pened-server` does not include `https://pened-creator.fly.dev`, or credentials are not allowed. Fix the server setting and redeploy `pened-server`. |
| `POST` returns `401` although you are signed in | The session cookie is not being sent or accepted cross-site. Check cookie `SameSite` / `Secure` settings and that CORS allows credentials. |
| `GET /mine` returns `404` or `405` with a JSON body | The deployed `pened-server` is an older build without `/mine`. Deploy the server version that includes it. |
| Suggestions appear instantly with fake data and no request is sent | The mock adapter is on. Check `VITE_USE_MOCK_TOOL_SUGGESTIONS` in the production build. |
| `403` appears for a non-admin on `/api/tool-suggestions` | The UI is calling an admin-only endpoint. It must only do so when `useAuth().isAdmin` is `true`. |

## Sign-off

| Field | Value |
| --- | --- |
| Date | |
| Commit / release deployed | |
| Frontend release (Fly version) | |
| Server release (Fly version) | |
| Tested by | |
| Result (pass / fail) | |
| Notes and links to any issues | |