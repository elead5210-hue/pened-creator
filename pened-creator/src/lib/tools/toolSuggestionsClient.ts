/**
 * Client for the tool suggestions API.
 *
 * Implements the contract documented in docs/api-handoff/tool-suggestions.md.
 *
 * Two adapters are provided behind one interface:
 * - a real adapter that calls `<VITE_API_URL>/api/tool-suggestions` with fetch
 *   (never a relative path: in production the frontend and the API are on
 *   different hosts, so a relative URL would hit the frontend and get a 404)
 * - a mock adapter that returns the documented stub shapes, so the UI can be
 *   built and tested before the backend endpoints exist
 *
 * The mock is enabled with `VITE_USE_MOCK_TOOL_SUGGESTIONS=true`, or by calling
 * `setToolSuggestionsAdapter()` (useful in tests).
 */

import { apiUrl } from "../curriculum/shared/apiClient";

// ---------------------------------------------------------------------------
// Types (mirror section 3 of the hand-off doc)
// ---------------------------------------------------------------------------

export type ToolSuggestionStatus = "new" | "reviewed" | "accepted" | "rejected";

export const TOOL_SUGGESTION_STATUSES: readonly ToolSuggestionStatus[] = [
  "new",
  "reviewed",
  "accepted",
  "rejected",
];

export interface ToolSuggestionUserRef {
  id: string;
  displayName: string | null;
  /** Only present on admin endpoints. */
  email?: string | null;
}

export interface ToolSuggestion {
  id: string;
  description: string;
  status: ToolSuggestionStatus;
  submittedBy: ToolSuggestionUserRef;
  createdAt: string;
  updatedAt: string;
  reviewedBy: ToolSuggestionUserRef | null;
  reviewedAt: string | null;
  adminNote: string | null;
}

export interface SubmitToolSuggestionInput {
  description: string;
}

export interface SubmitToolSuggestionResult {
  suggestion: ToolSuggestion;
}

/**
 * A suggestion as returned by `GET /api/tool-suggestions/mine`. The server
 * leaves out the internal review fields (`adminNote`, `reviewedBy`) and every
 * email, so a submitter only sees the status and when it was reviewed.
 */
export type MyToolSuggestion = Omit<ToolSuggestion, "adminNote" | "reviewedBy">;

export interface ListMyToolSuggestionsResult {
  items: MyToolSuggestion[];
}

export type ToolSuggestionErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

/**
 * Error thrown by every client call. `fields` carries per-field messages for
 * validation errors, and `retryAfterSeconds` is set for rate limiting.
 */
export class ToolSuggestionsApiError extends Error {
  readonly status: number;
  readonly code: ToolSuggestionErrorCode;
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    status: number;
    code: ToolSuggestionErrorCode;
    message: string;
    fields?: Record<string, string>;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = "ToolSuggestionsApiError";
    this.status = params.status;
    this.code = params.code;
    this.fields = params.fields;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }
}

// ---------------------------------------------------------------------------
// Validation (same limits the API enforces; see section 6 of the hand-off doc)
// ---------------------------------------------------------------------------

export const TOOL_SUGGESTION_MIN_LENGTH = 10;
export const TOOL_SUGGESTION_MAX_LENGTH = 2000;

/**
 * Client-side validation. Returns an error message, or `null` when valid.
 * The API always re-validates, this is only for fast feedback.
 */
export function validateToolSuggestionDescription(description: string): string | null {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return "Description is required.";
  }
  if (trimmed.length < TOOL_SUGGESTION_MIN_LENGTH) {
    return `Description must be at least ${TOOL_SUGGESTION_MIN_LENGTH} characters.`;
  }
  if (trimmed.length > TOOL_SUGGESTION_MAX_LENGTH) {
    return `Description must be ${TOOL_SUGGESTION_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface ToolSuggestionsAdapter {
  submit(input: SubmitToolSuggestionInput): Promise<SubmitToolSuggestionResult>;
  /** The signed-in user's own suggestions, newest first. Open to every role. */
  listMy(): Promise<ListMyToolSuggestionsResult>;
}

// ---------------------------------------------------------------------------
// Real adapter
// ---------------------------------------------------------------------------

const TOOL_SUGGESTIONS_PATH = "/api/tool-suggestions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function codeFromStatus(status: number): ToolSuggestionErrorCode {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 429:
      return "RATE_LIMITED";
    case 500:
      return "INTERNAL_ERROR";
    default:
      return "UNKNOWN_ERROR";
  }
}

function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function toApiError(response: Response): Promise<ToolSuggestionsApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  const errorBody = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const knownCodes: ToolSuggestionErrorCode[] = [
    "VALIDATION_ERROR",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "METHOD_NOT_ALLOWED",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
  ];
  const rawCode = errorBody && typeof errorBody.code === "string" ? errorBody.code : undefined;
  const code = knownCodes.includes(rawCode as ToolSuggestionErrorCode)
    ? (rawCode as ToolSuggestionErrorCode)
    : codeFromStatus(response.status);

  const message =
    errorBody && typeof errorBody.message === "string" && errorBody.message.length > 0
      ? errorBody.message
      : "Something went wrong. Please try again.";

  let fields: Record<string, string> | undefined;
  if (errorBody && isRecord(errorBody.fields)) {
    fields = {};
    for (const [key, value] of Object.entries(errorBody.fields)) {
      if (typeof value === "string") fields[key] = value;
    }
  }

  return new ToolSuggestionsApiError({
    status: response.status,
    code,
    message,
    fields,
    retryAfterSeconds: parseRetryAfter(response),
  });
}

export const realToolSuggestionsAdapter: ToolSuggestionsAdapter = {
  async submit(input) {
    // Resolve the absolute API URL first. apiUrl() throws a descriptive error
    // when VITE_API_URL is missing or invalid; surface that message instead of
    // reporting it as a generic connection problem.
    try {
      apiUrl(TOOL_SUGGESTIONS_PATH);
    } catch (err) {
      throw new ToolSuggestionsApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "The API URL is not configured correctly.",
      });
    }

    let response: Response;
    try {
      response = await fetch(apiUrl(TOOL_SUGGESTIONS_PATH), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: input.description.trim() }),
      });
    } catch {
      throw new ToolSuggestionsApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "Couldn't reach the server. Check your connection and try again.",
      });
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ToolSuggestionsApiError({
        status: response.status,
        code: "UNKNOWN_ERROR",
        message: "The server returned an unexpected response.",
      });
    }

    if (!isRecord(body) || !isRecord(body.suggestion)) {
      throw new ToolSuggestionsApiError({
        status: response.status,
        code: "UNKNOWN_ERROR",
        message: "The server returned an unexpected response.",
      });
    }

    return { suggestion: body.suggestion as unknown as ToolSuggestion };
  },

  async listMy() {
    const path = `${TOOL_SUGGESTIONS_PATH}/mine`;

    // Surface a missing or invalid VITE_API_URL with its descriptive message
    // rather than as a generic connection problem.
    try {
      apiUrl(path);
    } catch (err) {
      throw new ToolSuggestionsApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "The API URL is not configured correctly.",
      });
    }

    let response: Response;
    try {
      response = await fetch(apiUrl(path), {
        method: "GET",
        credentials: "include",
      });
    } catch {
      throw new ToolSuggestionsApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "Couldn't reach the server. Check your connection and try again.",
      });
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ToolSuggestionsApiError({
        status: response.status,
        code: "UNKNOWN_ERROR",
        message: "The server returned an unexpected response.",
      });
    }

    if (!isRecord(body) || !Array.isArray(body.items)) {
      throw new ToolSuggestionsApiError({
        status: response.status,
        code: "UNKNOWN_ERROR",
        message: "The server returned an unexpected response.",
      });
    }

    return { items: body.items as MyToolSuggestion[] };
  },
};

// ---------------------------------------------------------------------------
// Mock adapter (section 9 of the hand-off doc)
// ---------------------------------------------------------------------------

const MOCK_LATENCY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0").slice(-12);
}

export const mockToolSuggestionsAdapter: ToolSuggestionsAdapter = {
  async submit(input) {
    await delay(MOCK_LATENCY_MS);

    const description = input.description.trim();

    const validationMessage = validateToolSuggestionDescription(description);
    if (validationMessage) {
      throw new ToolSuggestionsApiError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: validationMessage,
        fields: { description: validationMessage },
      });
    }

    if (description === "simulate-error") {
      throw new ToolSuggestionsApiError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
      });
    }

    if (description === "simulate-rate-limit") {
      throw new ToolSuggestionsApiError({
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many suggestions. Please try again later.",
        retryAfterSeconds: 1800,
      });
    }

    const now = new Date().toISOString();
    return {
      suggestion: {
        id: mockId(),
        description,
        status: "new",
        submittedBy: { id: "b7a0f1d2-3c44-4e6b-8f21-0d9e5c7a1234", displayName: "Sam Teacher" },
        createdAt: now,
        updatedAt: now,
        reviewedBy: null,
        reviewedAt: null,
        adminNote: null,
      },
    };
  },

  async listMy() {
    await delay(MOCK_LATENCY_MS);

    return {
      items: [
        {
          id: "6f1c1f0e-2f3e-4a52-9d55-6b1a2f7d8c11",
          description: "A tool that turns a lesson into a printable worksheet with answer key.",
          status: "reviewed",
          submittedBy: { id: "b7a0f1d2-3c44-4e6b-8f21-0d9e5c7a1234", displayName: "Sam Teacher" },
          createdAt: "2026-09-29T08:15:30.000Z",
          updatedAt: "2026-09-30T09:00:00.000Z",
          reviewedAt: "2026-09-30T09:00:00.000Z",
        },
        {
          id: "0b9d3a5e-7c1f-4d2a-8e6b-3f4a5c6d7e8f",
          description: "A tool that quizzes students on vocabulary from their lessons.",
          status: "new",
          submittedBy: { id: "b7a0f1d2-3c44-4e6b-8f21-0d9e5c7a1234", displayName: "Sam Teacher" },
          createdAt: "2026-09-28T14:02:10.000Z",
          updatedAt: "2026-09-28T14:02:10.000Z",
          reviewedAt: null,
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Adapter selection and public API
// ---------------------------------------------------------------------------

function shouldUseMockByDefault(): boolean {
  try {
    return import.meta.env.VITE_USE_MOCK_TOOL_SUGGESTIONS === "true";
  } catch {
    return false;
  }
}

let activeAdapter: ToolSuggestionsAdapter = shouldUseMockByDefault()
  ? mockToolSuggestionsAdapter
  : realToolSuggestionsAdapter;

/** Swap the adapter at runtime. Intended for tests and local development. */
export function setToolSuggestionsAdapter(adapter: ToolSuggestionsAdapter): void {
  activeAdapter = adapter;
}

/** Whether the mock adapter is currently active. */
export function isUsingMockToolSuggestions(): boolean {
  return activeAdapter === mockToolSuggestionsAdapter;
}

/**
 * Submit a new tool suggestion for the signed-in user.
 * Throws `ToolSuggestionsApiError` on any failure.
 */
export function submitToolSuggestion(
  input: SubmitToolSuggestionInput,
): Promise<SubmitToolSuggestionResult> {
  return activeAdapter.submit(input);
}

/**
 * List the signed-in user's own suggestions, newest first
 * (`GET /api/tool-suggestions/mine`). Open to every role, so this is the call
 * a non-admin UI should use. The admin-only review list
 * (`GET /api/tool-suggestions`) returns 403 for everyone else and must only be
 * called when `useAuth().isAdmin` is true.
 * Throws `ToolSuggestionsApiError` on any failure.
 */
export function listMyToolSuggestions(): Promise<ListMyToolSuggestionsResult> {
  return activeAdapter.listMy();
}
