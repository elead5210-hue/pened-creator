# QA checklist: deployment / API configuration and login

## Why this exists

Once the client talks to a separately deployed API (see the
"Deployment / API configuration" section in the root `README.md`),
there's a whole class of failure that has nothing to do with any one
route or component: a stale `VITE_API_URL`, a `CORS_ORIGIN` that
doesn't match the deployed client's origin, a cookie that's silently
dropped because of `SameSite`/third-party-cookie rules, and so on.
None of those show up by reading a diff — they only show up by
actually loading the deployed app in a browser and trying to log in.
This checklist is that manual walkthrough.

This project has no automated test framework configured (see
`package.json` — lint/format plus Vite dev/build/preview scripts
only), so this remains a manual walkthrough. Run it:

- After deploying a new build of the client.
- After changing `VITE_API_URL`, the API's `CORS_ORIGIN`,
  `COOKIE_SAMESITE`, or `COOKIE_DOMAIN`.
- After any change to `src/lib/auth/*`, `src/lib/curriculum/shared/apiClient.ts`,
  `src/routes/login.tsx`, or `src/routes/register.tsx`.

## Prerequisites

- The API is deployed and reachable at the URL the client was built
  with (`VITE_API_URL`).
- You have a browser with dev tools open to the Network and
  Application/Storage tabs, so you can confirm requests are going to
  the right origin and that a session cookie actually gets set.

## Steps

1. **Register a new account.**
   - Go to `/register`, submit a new email/password.
   - Confirm the request in the Network tab goes to the configured API
     origin (not `localhost`, unless that's genuinely what you're
     testing) and returns success.
   - Confirm you land on the app's main authenticated area afterward.

2. **Log in.**
   - Log out if the register step left you logged in, then go to
     `/login` and sign in with the account from step 1.
   - Confirm a session cookie is set for the API's domain in the
     Application/Storage tab.
   - Confirm you land back on the main authenticated area (or wherever
     `redirect` pointed, if you arrived via a protected-route bounce).

3. **Refresh keeps the session.**
   - With the app in a logged-in state, hard-refresh the page.
   - Confirm you're still logged in — you should not be bounced to
     `/login`. If you are, the cookie likely isn't being sent
     cross-site (check `CORS_ORIGIN`, `COOKIE_SAMESITE`, and whether
     the client/API share a parent domain — see the README's
     Deployment / API configuration section).

   - Repeat the refresh while on a protected route other than `/`
     (e.g. a lesson page or `/tools`). You should briefly see the
     "Restoring your session…" placeholder and then the same page,
     with no flash of `/login` and no redirect.

   **3a. Direct deep-link while logged in.**
   - In a new tab, paste the full URL of a protected route (e.g. a
     specific `/lessons/<id>` page) and load it.
   - Confirm the page loads directly and you are not sent to `/login`.

   **3b. Deep-link while logged out.**
   - Log out, then load a protected route's URL directly.
   - Confirm you're redirected to `/login` with a `redirect` search
     param pointing at the original URL, and that after signing in you
     land on that page rather than `/`.

   **3c. Visiting `/login` with an existing session.**
   - While logged in, navigate to `/login` (optionally with a
     `?redirect=` param).
   - Confirm the form is skipped and you're sent to the `redirect`
     target (or `/`).

   **3d. Expired or invalidated session.**
   - While logged in, delete the session cookie (or invalidate the
     session server-side), then trigger a data request (e.g. navigate
     within the app or refresh).
   - Confirm you're redirected to `/login` with the current location
     preserved in `redirect`, and that you can sign in and return.
   - Confirm that in the Network tab a 401 on a data request is
     followed by a `GET /api/auth/me` check, and that a request is
     only retried when that check succeeds.

   **3e. Transient API failure on refresh.**
   - In dev tools, throttle to offline or block the API briefly, then
     refresh a protected route and restore the connection.
   - Confirm you are not logged out just because the first session
     check failed: the app retries once, and if the API is still
     unreachable it shows the error page ("Try again") rather than
     redirecting to `/login`.

4. **Load the curriculum tree.**
   - Navigate to the curriculum tree view and confirm it loads data
     from the API without errors.

5. **Run Phase 3 (content) generation.**
   - From a lesson with a saved breakdown, generate a prompt, and walk
     through the Phase 3 content-generation flow.
   - Confirm the request(s) succeed against the deployed API and the
     generated content view renders.

6. **Log out.**
   - Use the app's logout action.
   - Confirm the session cookie is cleared (or invalidated) and that
     navigating to a protected route now redirects to `/login`.

## If something fails

- **Requests fail with a network/CORS error:** check that
  `VITE_API_URL` in the deployed build matches the API's actual URL,
  and that the API's `CORS_ORIGIN` secret matches the client's exact
  deployed origin (no trailing slash).
- **Login "succeeds" but a refresh logs you out:** first confirm the
  `/api/auth/me` request on load is being sent with the session
  cookie and what status it returns (a 401 there means the cookie
  isn't reaching the API; a 5xx or network error means the session
  state is unknown and the app should show the error page, not
  `/login`). Otherwise, the cookie is
  probably not being persisted or sent. Check `COOKIE_SAMESITE` (needs
  `none` for cross-site) and consider whether the client and API
  should be moved under a shared parent domain with `COOKIE_DOMAIN`
  set, per the README.
- **Everything else:** see the broader
  [`end-to-end-regression-checklist.md`](./end-to-end-regression-checklist.md)
  for the full curriculum → content walkthrough once auth itself is
  confirmed working.