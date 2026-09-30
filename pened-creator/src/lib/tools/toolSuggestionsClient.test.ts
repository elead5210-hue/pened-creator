import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOOL_SUGGESTION_MAX_LENGTH,
  TOOL_SUGGESTION_MIN_LENGTH,
  ToolSuggestionsApiError,
  isUsingMockToolSuggestions,
  mockToolSuggestionsAdapter,
  realToolSuggestionsAdapter,
  setToolSuggestionsAdapter,
  submitToolSuggestion,
  validateToolSuggestionDescription,
} from "./toolSuggestionsClient";

const VALID_DESCRIPTION = "A tool that turns a lesson into a printable worksheet with answer key.";

/** Stand-in for the deployed API origin; differs from the frontend's own origin. */
const API_BASE_URL = "https://pened-server.fly.dev";

async function captureError(promise: Promise<unknown>): Promise<ToolSuggestionsApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ToolSuggestionsApiError);
    return err as ToolSuggestionsApiError;
  }
  throw new Error("Expected the promise to reject, but it resolved.");
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("validateToolSuggestionDescription", () => {
  it("rejects blank input", () => {
    expect(validateToolSuggestionDescription("")).toBe("Description is required.");
    expect(validateToolSuggestionDescription("     ")).toBe("Description is required.");
  });

  it("rejects input shorter than the minimum after trimming", () => {
    const short = "x".repeat(TOOL_SUGGESTION_MIN_LENGTH - 1);
    expect(validateToolSuggestionDescription(`  ${short}  `)).toBe(
      `Description must be at least ${TOOL_SUGGESTION_MIN_LENGTH} characters.`,
    );
  });

  it("rejects input longer than the maximum", () => {
    const long = "x".repeat(TOOL_SUGGESTION_MAX_LENGTH + 1);
    expect(validateToolSuggestionDescription(long)).toBe(
      `Description must be ${TOOL_SUGGESTION_MAX_LENGTH} characters or fewer.`,
    );
  });

  it("accepts input at the boundaries", () => {
    expect(validateToolSuggestionDescription("x".repeat(TOOL_SUGGESTION_MIN_LENGTH))).toBeNull();
    expect(validateToolSuggestionDescription("x".repeat(TOOL_SUGGESTION_MAX_LENGTH))).toBeNull();
  });
});

describe("mock adapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setToolSuggestionsAdapter(mockToolSuggestionsAdapter);
  });

  afterEach(() => {
    vi.useRealTimers();
    setToolSuggestionsAdapter(realToolSuggestionsAdapter);
  });

  it("is reported as active once set", () => {
    expect(isUsingMockToolSuggestions()).toBe(true);
  });

  it("returns a new suggestion echoing the trimmed description on success", async () => {
    const promise = submitToolSuggestion({ description: `  ${VALID_DESCRIPTION}  ` });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result.suggestion.description).toBe(VALID_DESCRIPTION);
    expect(result.suggestion.status).toBe("new");
    expect(result.suggestion.id).toEqual(expect.any(String));
    expect(result.suggestion.reviewedBy).toBeNull();
    expect(result.suggestion.reviewedAt).toBeNull();
    expect(result.suggestion.adminNote).toBeNull();
    expect(result.suggestion.submittedBy.email).toBeUndefined();
    expect(Number.isNaN(Date.parse(result.suggestion.createdAt))).toBe(false);
  });

  it("generates a fresh id for each submission", async () => {
    const first = submitToolSuggestion({ description: VALID_DESCRIPTION });
    const second = submitToolSuggestion({ description: VALID_DESCRIPTION });
    await vi.advanceTimersByTimeAsync(500);
    const [a, b] = await Promise.all([first, second]);

    expect(a.suggestion.id).not.toBe(b.suggestion.id);
  });

  it("simulates latency so loading states are visible", async () => {
    let settled = false;
    const promise = submitToolSuggestion({ description: VALID_DESCRIPTION }).then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(400);
    await promise;
    expect(settled).toBe(true);
  });

  it("rejects a too-short description with a validation error and field message", async () => {
    const promise = captureError(submitToolSuggestion({ description: "too short" }));
    await vi.advanceTimersByTimeAsync(500);
    const error = await promise;

    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.fields?.description).toBe(
      `Description must be at least ${TOOL_SUGGESTION_MIN_LENGTH} characters.`,
    );
  });

  it("rejects a blank description with a validation error", async () => {
    const promise = captureError(submitToolSuggestion({ description: "   " }));
    await vi.advanceTimersByTimeAsync(500);
    const error = await promise;

    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.fields?.description).toBe("Description is required.");
  });

  it("simulates a server error for the documented trigger text", async () => {
    const promise = captureError(submitToolSuggestion({ description: "simulate-error" }));
    // "simulate-error" is 14 chars, so it passes validation and hits the trigger.
    await vi.advanceTimersByTimeAsync(500);
    const error = await promise;

    expect(error.status).toBe(500);
    expect(error.code).toBe("INTERNAL_ERROR");
  });

  it("simulates rate limiting with a retry-after value", async () => {
    const promise = captureError(submitToolSuggestion({ description: "simulate-rate-limit" }));
    await vi.advanceTimersByTimeAsync(500);
    const error = await promise;

    expect(error.status).toBe(429);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(1800);
  });
});

describe("real adapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // The API lives on a different host from this app, so the client must build
    // absolute URLs from VITE_API_URL (see apiUrl() in apiClient.ts).
    vi.stubEnv("VITE_API_URL", API_BASE_URL);
    setToolSuggestionsAdapter(realToolSuggestionsAdapter);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is not reported as mock", () => {
    expect(isUsingMockToolSuggestions()).toBe(false);
  });

  it("POSTs the trimmed description with credentials and returns the suggestion", async () => {
    const suggestion = {
      id: "6f1c1f0e-2f3e-4a52-9d55-6b1a2f7d8c11",
      description: VALID_DESCRIPTION,
      status: "new",
      submittedBy: { id: "b7a0f1d2-3c44-4e6b-8f21-0d9e5c7a1234", displayName: "Sam Teacher" },
      createdAt: "2026-09-29T08:15:30.000Z",
      updatedAt: "2026-09-29T08:15:30.000Z",
      reviewedBy: null,
      reviewedAt: null,
      adminNote: null,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { suggestion }));

    const result = await submitToolSuggestion({ description: `  ${VALID_DESCRIPTION}\n` });

    expect(result.suggestion).toEqual(suggestion);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/api/tool-suggestions`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ description: VALID_DESCRIPTION });
  });

  it("never sends the request to a relative path (which would hit the frontend origin)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { suggestion: { id: "x" } }));

    await submitToolSuggestion({ description: VALID_DESCRIPTION });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("/")).toBe(false);
    expect(new URL(url).origin).toBe(API_BASE_URL);
    expect(new URL(url).pathname).toBe("/api/tool-suggestions");
  });

  it("ignores a trailing slash on VITE_API_URL", async () => {
    vi.stubEnv("VITE_API_URL", `${API_BASE_URL}/`);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { suggestion: { id: "x" } }));

    await submitToolSuggestion({ description: VALID_DESCRIPTION });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/api/tool-suggestions`);
  });

  it("reports a missing VITE_API_URL clearly without sending any request", async () => {
    vi.stubEnv("VITE_API_URL", "");

    const error = await captureError(submitToolSuggestion({ description: VALID_DESCRIPTION }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toContain("VITE_API_URL");
  });

  it("maps a 400 response to a validation error with field messages", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Description must be at least 10 characters.",
          fields: { description: "Description must be at least 10 characters." },
        },
      }),
    );

    const error = await captureError(submitToolSuggestion({ description: VALID_DESCRIPTION }));

    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Description must be at least 10 characters.");
    expect(error.fields).toEqual({ description: "Description must be at least 10 characters." });
  });

  it("maps a 401 response to an unauthenticated error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } }),
    );

    const error = await captureError(submitToolSuggestion({ description: VALID_DESCRIPTION }));

    expect(error.status).toBe(401);
    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it("reads the Retry-After header on a 429 response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        429,
        { error: { code: "RATE_LIMITED", message: "Too many suggestions. Please try again later." } },
        { "Retry-After": "1800" },
      ),
    );

    const error = await captureError(submitToolSuggestion({ description: VALID_DESCRIPTION }));

    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(1800);
  });

  it("falls back to a status-derived code and generic message when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 500 }));

    const error = await captureError(submitToolSuggestion({ description: VALID_DESCRIPTION }));

    expect(error.status).toBe(500);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).toBe("Something went wrong. Please try again.");
  });

  it("uses UNKNOWN_ERROR for unrecognized status codes", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 418 }));

    const error = await captureError(submitToolSuggestion({ description: VALID_DESCRIPTION }));

    expect(error.status).toBe(418);
    expect(error.code).toBe("UNKNOWN_ERROR");
  });

  it("maps a fetch rejection to a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const error = await captureError(submitToolSuggestion({ description: VALID_DESCRIPTION }));

    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toBe("Couldn't reach the server. Check your connection and try again.");
  });

  it("treats a 2xx response with an unexpected body as an error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { unexpected: true }));

    const error = await captureError(submitToolSuggestion({ description: VALID_DESCRIPTION }));

    expect(error.code).toBe("UNKNOWN_ERROR");
    expect(error.message).toBe("The server returned an unexpected response.");
  });

  it("treats a 2xx response with invalid JSON as an error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 201 }));

    const error = await captureError(submitToolSuggestion({ description: VALID_DESCRIPTION }));

    expect(error.code).toBe("UNKNOWN_ERROR");
  });
});