import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";

import { getCurrentUser, logout as logoutRequest, type RegisteredUser } from "./authClient";
import { registerUnauthorizedHandler } from "../curriculum/shared/apiClient";

type AuthContextValue = {
  /** The current session's user, or null if not logged in. Stays null
   * (rather than stale data) whenever loading is true. */
  user: RegisteredUser | null;
  /** Derived from `user?.isAdmin === true`: false when logged out, while
   * loading, or for any non-admin account. Gate admin-only API calls (such as
   * the tool suggestion review list) on this so they are never sent for
   * users the server would reject with 403. */
  isAdmin: boolean;
  /** True only for the initial session check on mount. Login/register/
   * logout/refresh don't toggle this back on — callers that need a
   * separate "this specific action is in flight" state should track
   * that themselves (e.g. a route's own isSubmitting). */
  loading: boolean;
  /** Inverse of `loading`: true once the initial session restoration
   * has finished (successfully or not). Route guards and redirects
   * should wait for this before deciding the user is logged out, so a
   * page refresh doesn't bounce an already-authenticated user to
   * /login before their session has been restored. */
  isInitialized: boolean;
  /** Destroys the server-side session, clears the local user, then
   * resolves. If the logout request itself fails, the error is
   * rethrown to the caller and the local user is left as-is, since we
   * can't be sure the session was actually destroyed. */
  logout: () => Promise<void>;
  /** Re-checks the current session against the server and updates
   * `user` accordingly. Call this after a successful login or
   * registration (which establish a new session server-side) so the
   * rest of the app picks up the now-authenticated user. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks whether the initial session restoration is still in flight,
  // readable from the unauthorized handler without re-subscribing it.
  const initializingRef = useRef(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    const currentUser = await getCurrentUser();
    setUser(currentUser);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let currentUser: RegisteredUser | null;
        try {
          currentUser = await getCurrentUser();
        } catch {
          // A transient failure (network blip, API cold start, 5xx)
          // shouldn't be treated as "logged out" on refresh; retry once
          // before giving up on restoring the session.
          await new Promise((resolve) => setTimeout(resolve, 500));
          currentUser = await getCurrentUser();
        }
        if (!cancelled) setUser(currentUser);
      } catch (err) {
        // getCurrentUser() already translates a 401 ("not logged in")
        // into null, so anything that reaches here is a genuine failure
        // (e.g. the API being unreachable, a 5xx, etc). Treat the
        // session as unknown/logged-out rather than letting this
        // rejection go unhandled and crash the initial mount check —
        // a down or misconfigured API should degrade gracefully.
        if (!cancelled) {
          console.error("Failed to resolve current session:", err);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          initializingRef.current = false;
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Any data request (i.e. not the /api/auth/me probe above, or the
    // login/register requests themselves) that comes back 401 means the
    // session has expired or been invalidated server-side since we last
    // checked it. Clear the now-stale local user and send the user to
    // /login, preserving where they were as the `redirect` search param
    // so they land back here after signing in again - mirroring
    // requireAuth's redirect() in ./routeGuard.ts and the router's own
    // query/mutation-level handling in ../../router.tsx.
    return registerUnauthorizedHandler(() => {
      // A 401 from a data request that raced the initial session
      // restoration must not clear the user or redirect: the restore
      // is still deciding whether a valid session exists, and the
      // route guard handles the genuinely-logged-out case afterwards.
      if (initializingRef.current) return;
      setUser(null);
      router.navigate({
        to: "/login",
        search: { redirect: router.state.location.href },
      });
    });
  }, [router]);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isInitialized: !loading,
      isAdmin: user?.isAdmin === true,
      logout,
      refresh,
    }),
    [user, loading, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Reads the current user, loading state, and logout/refresh actions.
 * Must be called beneath <AuthProvider> (mounted in __root.tsx) — throws
 * otherwise, since a missing provider means every consumer would
 * silently see user as always-null/always-loading instead of a real
 * session state.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
