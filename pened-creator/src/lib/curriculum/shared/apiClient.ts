/**
 * Shared HTTP client for talking to the penedv1-server API (see
 * ../../../../server/README.md). Every data-access function in ./db.ts
 * goes through this module rather than calling `fetch` directly, so base
 * URL resolution, auth, JSON handling, and error shaping only live in one
 * place.
 *
 * Auth is now session-cookie based: every request is sent with
 * `credentials: "include"` so the browser attaches the session cookie
 * established by POST /api/auth/login (see ../auth/authClient.ts), and
 * the server resolves req.user from it. There is no client-supplied
 * shared-secret header anymore.
 *
 * Configuration is read from Vite env vars (see ../../vite-env.d.ts and
 * the repo's .env.example):
 *  - VITE_API_URL (required): base URL of the API, no trailing slash.
 *
 * Note that VITE_* values are baked into the bundle at build time, so
 * changing the API URL for a deployed app means rebuilding it (see
 * .env.example).
 */

/**
 * Field-level detail entry the server includes on some 400 responses
 * (validation failures), matching formatZodError's shape in the server's
 * lib/validation.js.
 */
export type ApiErrorDetail = {
  path: string;
  message: string;
};

/**
 * Thrown for any request that doesn't succeed — a non-2xx HTTP response
 * from the server, or a failure to reach it at all. `status` is 0 for the
 * latter (no HTTP response was ever received), so callers can distinguish
 * "the server rejected this" from "the server was unreachable" if needed.
 */
export class ApiError extends Error {
  status: number;
  details?: ApiErrorDetail[];

  constructor(status: number, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/** Query-string parameters for a request. `undefined` values are omitted
 * entirely (rather than serialized as the literal string "undefined"),
 * so callers can pass an optional filter straight through without an
 * extra existence check. */
export type QueryParams = Record<string, string | undefined>;

/** Hostnames treated as "local", where plain http:// is acceptable even in a production build. */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Callback invoked whenever a non-auth request comes back with a 401,
 * meaning the session has expired or was never valid. Registered via
 * registerUnauthorizedHandler() below; typically wired up by AuthContext
 * to clear its in-memory user and redirect to /login.
 */
let unauthorizedHandler: (() => void) | null = null;

/**
 * Registers a callback to be invoked when a data request (i.e. not one of
 * the /api/auth/* endpoints) receives a 401. Only one handler can be
 * registered at a time; a later call replaces the previous one. Pass
 * `null` to clear it.
 *
 * /api/auth/* requests are deliberately excluded from triggering this
 * handler (see the check in request() below) — a 401 from, say,
 * /api/auth/me or /api/auth/login is an expected "logged out" or
 * "bad credentials" result, not a session that unexpectedly expired
 * mid-use, so it shouldn't bounce the user through the same handler.
 */
export function registerUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/**
 * Resolves the configured API base URL, with no trailing slash. Throws
 * eagerly (rather than producing a confusing fetch failure later) if
 * VITE_API_URL hasn't been set, isn't a parseable http(s) URL, or — in a
 * production build — uses plain http:// for anything other than localhost
 * (session cookies and credentials must not travel over an unencrypted
 * connection). See .env.example.
 *
 * VITE_API_URL is baked into the bundle at build time, so fixing a bad
 * value means correcting the env var and rebuilding, not just restarting.
 */
function getBaseUrl(): string {
  const url = import.meta.env.VITE_API_URL;
  if (!url) {
    throw new Error(
      "VITE_API_URL is not configured. Copy .env.example to .env and set VITE_API_URL to your " +
        "penedv1-server instance (see server/README.md). Note it is read at build time, so " +
        "rebuild after changing it.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `VITE_API_URL ("${url}") is not a valid URL. Use a full URL including the protocol, ` +
        'e.g. "https://pened-server.fly.dev", with no trailing slash.',
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `VITE_API_URL ("${url}") must start with http:// or https://, but uses "${parsed.protocol}".`,
    );
  }

  if (import.meta.env.PROD && parsed.protocol === "http:" && !LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `VITE_API_URL ("${url}") uses plain http:// in a production build. Use https:// so session ` +
        "cookies and credentials are not sent unencrypted, then rebuild.",
    );
  }

  return url.replace(/\/+$/, "");
}

/** Joins the base URL, path, and query params into a single request URL. */
function buildUrl(path: string, query?: QueryParams): string {
  const base = getBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  const searchParams = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) searchParams.set(key, value);
    }
  }
  const queryString = searchParams.toString();

  return `${base}${normalizedPath}${queryString ? `?${queryString}` : ""}`;
}

/**
 * Attempts to parse a Response body as JSON, tolerating an empty body
 * (e.g. a 204, or a non-JSON error page from something in front of the
 * server) by returning undefined instead of throwing a SyntaxError.
 */
async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Narrows an unknown parsed JSON body down to the server's error shape,
 * if it looks like one. */
function asErrorBody(body: unknown): { error?: unknown; details?: unknown } | null {
  if (typeof body !== "object" || body === null) return null;
  return body as { error?: unknown; details?: unknown };
}

/**
 * Probes GET /api/auth/me directly (bypassing request(), so it can't
 * recurse or trigger the unauthorized handler) to tell whether a 401 on a
 * data request means the session is genuinely gone.
 *  - "valid":   the server still recognises the session (the 401 was a
 *               transient/racy failure, e.g. right after a page refresh).
 *  - "invalid": the server confirms there is no session.
 *  - "unknown": the probe itself failed (network error, 5xx); we can't
 *               tell, so callers must not log the user out.
 */
async function probeSession(): Promise<"valid" | "invalid" | "unknown"> {
  try {
    const res = await fetch(buildUrl("/api/auth/me"), {
      method: "GET",
      credentials: "include",
    });
    if (res.ok) return "valid";
    if (res.status === 401) return "invalid";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Core request function every convenience method below delegates to.
 * Serializes `body` as JSON when present, always sends the request with
 * `credentials: "include"` so the session cookie is attached, and either
 * returns the parsed JSON response body (or undefined for a 204/empty
 * body) or throws an ApiError.
 */
async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: { query?: QueryParams; body?: unknown; retried?: boolean } = {},
): Promise<T> {
  const { query, body, retried } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const apiUrl = (() => {
      try {
        return getBaseUrl();
      } catch {
        return "(VITE_API_URL is missing or invalid)";
      }
    })();
    throw new ApiError(
      0,
      `Could not reach the API at ${apiUrl}. This usually means either the API is unreachable ` +
        `(check your network connection and that VITE_API_URL is correct), or the API's ` +
        `CORS_ORIGIN doesn't allow this app's origin. ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const parsedBody = await parseJsonBody(res);

  if (!res.ok) {
    const errorBody = asErrorBody(parsedBody);
    const message =
      errorBody && typeof errorBody.error === "string" && errorBody.error.length > 0
        ? errorBody.error
        : `Request failed with status ${res.status} ${res.statusText}`.trim();
    const details =
      errorBody && Array.isArray(errorBody.details) ? (errorBody.details as ApiErrorDetail[]) : undefined;
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      // Before treating this as an expired session, confirm with the
      // server. If the session is actually still valid, retry the
      // request once instead of logging the user out. Only a confirmed
      // "invalid" result clears the session and redirects; an
      // inconclusive probe never logs the user out.
      const sessionState = retried ? "invalid" : await probeSession();
      if (sessionState === "valid") {
        return request<T>(method, path, { query, body, retried: true });
      }
      if (sessionState === "invalid" && unauthorizedHandler) {
        unauthorizedHandler();
      }
    }
    throw new ApiError(res.status, message, details);
  }

  return parsedBody as T;
}

/** GET request, returning the parsed JSON response body. */
export function apiGet<T>(path: string, query?: QueryParams): Promise<T> {
  return request<T>("GET", path, { query });
}

/** POST request with an optional JSON body, returning the parsed JSON response body. */
export function apiPost<T>(path: string, body?: unknown, query?: QueryParams): Promise<T> {
  return request<T>("POST", path, { query, body });
}

/** PUT request with an optional JSON body, returning the parsed JSON response body. */
export function apiPut<T>(path: string, body?: unknown, query?: QueryParams): Promise<T> {
  return request<T>("PUT", path, { query, body });
}

/** DELETE request. Every delete endpoint on this API returns 204 with no
 * body on success, so this resolves to void rather than a parsed body. */
export function apiDelete(path: string, query?: QueryParams): Promise<void> {
  return request<void>("DELETE", path, { query });
}

/**
 * Uploads an image (as a base64 data URL) to the API's bucket-backed
 * POST /api/images endpoint and returns the hosted URL from the response.
 *
 * Goes through apiPost() so it inherits the same base URL resolution,
 * session-cookie auth, and error shaping as every other request. Throws
 * an ApiError if the request fails, or if the server responds
 * successfully but without a usable `url`.
 */
export async function uploadImage(dataUrl: string): Promise<string> {
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    throw new Error("uploadImage requires a non-empty image data URL.");
  }

  const response = await apiPost<{ url?: unknown } | undefined>("/api/images", { dataUrl });

  const url = response?.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new ApiError(500, "Image upload succeeded but the server response did not include a url.");
  }

  return url;
}

/** A JSON Schema fragment describing a registered tool's expected input shape. */
export interface ToolInputSchema {
  type: string;
  required?: string[];
  properties?: Record<string, unknown>;
  items?: unknown;
  minItems?: number;
  enum?: string[];
  description?: string;
  additionalProperties?: boolean;
}

