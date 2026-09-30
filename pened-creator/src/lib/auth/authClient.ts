/**
 * Auth-related data access — registration, login, session lookup, and
 * logout. Goes through the shared ../curriculum/shared/apiClient HTTP client
 * (same penedv1-server base URL / error handling as every other
 * data-access module) rather than calling fetch/apiPost/apiGet directly,
 * so callers (routes, AuthContext) only ever deal with typed
 * inputs/outputs and ApiError.
 */

import { apiGet, apiPost, ApiError } from "../curriculum/shared/apiClient";

/** Payload accepted by POST /api/auth/register. There is deliberately no
 * `type`/role field here — the server always creates the account as
 * 'creator', and the client has no way to request anything else. */
export type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

/** Payload accepted by POST /api/auth/login. */
export type LoginInput = {
  email: string;
  password: string;
};

/** The user record returned by registration, login, and the current-user
 * check. Never includes the password/password hash. */
export type RegisteredUser = {
  id: string;
  name: string;
  email: string;
  type: string;
  createdAt: string;
};

/**
 * Registers a new account. Always created server-side as type 'creator'
 * — this call never sends and the server never accepts a client-supplied
 * role. Rejects with an ApiError (see ../curriculum/shared/apiClient) on
 * duplicate email, validation failure, or any other non-2xx response.
 * (see ../curriculum/shared/apiClient for ApiError.)
 */
export function registerUser(input: RegisterInput): Promise<RegisteredUser> {
  return apiPost<RegisteredUser>("/api/auth/register", input);
}

/**
 * Logs in with an existing account's credentials. On success the server
 * establishes a session (cookie-based) and this resolves with the
 * authenticated user. Rejects with an ApiError on invalid credentials or
 * any other non-2xx response.
 */
export function loginUser(input: LoginInput): Promise<RegisteredUser> {
  return apiPost<RegisteredUser>("/api/auth/login", input);
}

/**
 * Resolves the current session's user from the server (GET /api/auth/me),
 * or null if there's no valid session — a 401 here just means "not
 * logged in", not a failure, so it's translated into null rather than
 * left to throw. Any other error (network unreachable, 5xx) still
 * rejects with an ApiError, since those genuinely are failures the
 * caller should be able to distinguish from "logged out".
 */
export async function getCurrentUser(): Promise<RegisteredUser | null> {
  try {
    return await apiGet<RegisteredUser>("/api/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return null;
    }
    throw err;
  }
}

/**
 * Restores the session on app load (e.g. after a page refresh). Wraps
 * getCurrentUser() with a single retry for transient failures (network
 * blip, API cold start, 5xx) so a momentary hiccup isn't mistaken for
 * "logged out". A 401 still resolves to null immediately (there is no
 * valid session, so retrying can't help); if the retry also fails, the
 * error is rethrown so the caller can tell "unknown" apart from
 * "logged out".
 */
export async function restoreSession(retryDelayMs = 500): Promise<RegisteredUser | null> {
  try {
    return await getCurrentUser();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return await getCurrentUser();
  }
}

/**
 * Logs out the current session: asks the server to destroy it and clear
 * the session cookie. Resolves once that's done regardless of prior
 * session state.
 */
export function logout(): Promise<void> {
  return apiPost<void>("/api/auth/logout");
}