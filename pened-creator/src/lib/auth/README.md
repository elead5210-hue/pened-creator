# `lib/auth/` — authentication

This folder owns authentication: the auth API client, the
`AuthContext`/`useAuth` provider, and the route guard used to require
a logged-in user on protected routes.

It is intended to be blackboxable: an agent working only inside this
folder, plus the parent dependencies listed below, should be able to
make changes here without needing visibility into the rest of the
project. This README is that contract — keep it in sync with the code.
The source audit this was derived from lives in
`docs/dependency-map.md`.

## Files in this folder

- `authClient.ts`
- `AuthContext.tsx`
- `routeGuard.ts`

## Parent dependencies

Everything this folder imports from outside itself. Nothing outside
this list may be assumed to exist — if a change here needs something
not on this list, that's a signal the dependency map and this README
need updating first.

### `@/lib/curriculum/shared/apiClient` (imported as `../curriculum/shared/apiClient`)
- `apiGet`, `apiPost`, `ApiError` — used in `authClient.ts`.
- `registerUnauthorizedHandler` — used in `AuthContext.tsx`.

This is the only parent dependency for this entire folder, and it's
notable: it's the one place in the codebase where the dependency
direction runs `lib/auth` → `lib/curriculum` rather than the reverse.
`routeGuard.ts` has no outside dependencies at all beyond this
folder's own `authClient.ts` and npm packages
(`@tanstack/react-router`).

## Imported by (outside this folder)

Files outside `lib/auth/` that import from it. Renaming or removing an
exported symbol below is a breaking change for the listed file.

### `useAuth` (from `AuthContext.tsx`)
- `src/components/shell/GlobalToolbar.tsx`
- `src/routes/__root.tsx` — `AuthGate` reads `isInitialized`.
- `src/routes/login.tsx` — reads `user`, `loading`, and `refresh`.

### `AuthProvider` (from `AuthContext.tsx`)
- `src/routes/__root.tsx` — mounted app-wide, wrapping the app shell.

### `loginUser` / `registerUser` (from `authClient.ts`)
- `src/routes/login.tsx`
- `src/routes/register.tsx`

### `restoreSession` (from `authClient.ts`)
- `routeGuard.ts` (within this folder).

### `requireAuth` (from `routeGuard.ts`)
- `src/routes/index.tsx`
- `src/routes/lessons.$lessonId.tsx`
- `src/routes/lessons.$lessonId.interactive-tools.tsx`
- `src/routes/tools.tsx`
- `src/routes/tools.interactive.tsx`

## Session persistence & rehydration

Sessions are cookie-based (established server-side on login/register,
cleared on logout), so the session itself already survives a page
refresh — there is no client-side token to persist. What needs to
rehydrate on refresh is React's in-memory auth *state*, since that's
reset on every reload:

- `AuthProvider` (`AuthContext.tsx`) starts with `user: null` and
  `loading: true` (exposed inversely as `isInitialized: false`), then
  resolves the session (`GET /api/auth/me`) in a mount-time
  `useEffect` to rehydrate `user` from the existing session cookie
  before flipping `loading` to `false` / `isInitialized` to `true`. A
  transient failure (network blip, cold start, 5xx) is retried once
  before the session is treated as unknown/logged-out.
  Consumers of `useAuth()` should wait for `isInitialized` and avoid
  branching on `user` until then, to avoid a false "logged out" flash
  on refresh.
- `routes/__root.tsx` wraps the app shell and `<Outlet />` in an
  `AuthGate` that renders a placeholder until `isInitialized` is true,
  so protected routes and their data requests don't run while `user`
  is still null.
- `restoreSession()` (`authClient.ts`) wraps `getCurrentUser()` with a
  single retry for transient failures. A 401 resolves to `null`
  immediately (no valid session, retrying can't help); if the retry
  also fails the error is rethrown so callers can tell "unknown" from
  "logged out".
- `requireAuth` (`routeGuard.ts`) does its own independent
  `restoreSession()` call rather than reading from `AuthContext`, so
  route-level guards are correct even before/without `AuthProvider`
  having rehydrated — there's no race between the two. It only
  redirects to `/login` once restoration definitively resolves with no
  session; if the session state is unknown (API unreachable after the
  retry) the error propagates to the router's error boundary instead
  of bouncing a possibly-signed-in user to `/login`.
- A data request that returns 401 (`apiClient.ts`) is first confirmed
  with a direct `GET /api/auth/me` probe. If the session is still
  valid the request is retried once; only a confirmed-invalid session
  invokes the unauthorized handler (which clears `user` and redirects
  to `/login`). An inconclusive probe never logs the user out. The
  handler in `AuthContext` also ignores 401s that arrive while the
  initial restoration is still in flight.
- `/login` (`routes/login.tsx`) skips the form when a session already
  exists and navigates to the `redirect` search param (or `/`); after a
  successful login it calls `refresh()` so `AuthContext` picks up the
  new session before navigating.

## Notes for an agent working only in this folder

- `requireAuth` is used as a route-level guard across nearly every
  route in the app. Changing its signature or behavior is effectively
  a breaking change to every file listed above — treat it as fixed
  unless the task explicitly asks you to change route-guard behavior.
- `AuthProvider` and `useAuth` form a pair: `AuthProvider` is mounted
  once at the root (`routes/__root.tsx`) and `useAuth` is consumed
  wherever auth state is needed (currently
  `components/shell/GlobalToolbar.tsx`, `routes/__root.tsx`, and
  `routes/login.tsx`). Don't rename or restructure the context value
  shape (`user`, `loading`, `isInitialized`, `logout`, `refresh`)
  without checking those call sites.
- `lib/curriculum/shared/apiClient.ts`'s `apiGet`/`apiPost`/`ApiError`
  are the shared contract this folder relies on for making requests
  and recognizing API errors. Treat their signatures as fixed unless the
  task explicitly asks you to change them (a change there also affects
  `lib/curriculum/` internals and most of `routes/` — outside this
  folder's blackbox).
- If you add a new import from outside this folder, add it to the
  "Parent dependencies" section above so the contract stays accurate.