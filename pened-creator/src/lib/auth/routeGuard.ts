import { redirect } from "@tanstack/react-router";

import { restoreSession, type RegisteredUser } from "./authClient";

/**
 * Minimal shape `requireAuth` needs from a route's `beforeLoad` context —
 * just enough to build the post-login redirect target, without pulling in
 * TanStack Router's full location type.
 */
type RequireAuthLocation = {
  href: string;
};

/**
 * Guard for protected routes: call this from a route's `beforeLoad` as
 * `beforeLoad: ({ location }) => requireAuth(location)`.
 *
 * Resolves the current session via restoreSession() (which retries once
 * on transient failures, so a network blip or API cold start on page
 * refresh isn't mistaken for "logged out") and returns the user (so it
 * can be attached to route context if needed). The redirect only happens
 * once restoration has definitively resolved with no session: a 401 (or
 * a failed retry) is never turned into a login bounce for a user whose
 * session may still be valid. If there's no session, throws a TanStack
 * Router redirect() to /login, passing
 * the current location's href as the `redirect` search param so /login
 * can send the user back where they were headed once they sign in.
 *
 * Throwing (rather than returning) the redirect is deliberate — that's
 * how TanStack Router expects beforeLoad to short-circuit the route
 * match, matching redirect()'s own documented usage.
 */
export async function requireAuth(location: RequireAuthLocation): Promise<RegisteredUser> {
  let user: RegisteredUser | null;
  try {
    user = await restoreSession();
  } catch (err) {
    // The session state is unknown (API unreachable / 5xx after a
    // retry). Don't redirect to /login on a refresh in that case;
    // surface the failure so the router's error boundary handles it
    // instead of logging out a user who may well still be signed in.
    throw err;
  }
  if (!user) {
    throw redirect({
      to: "/login",
      search: { redirect: location.href },
    });
  }
  return user;
}