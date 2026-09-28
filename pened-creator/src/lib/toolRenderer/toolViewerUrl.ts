
/**
 * Builds and parses the iframe URLs used to embed the Tool Renderer
 * app's rendering of a single TOOL REGISTRY content block (see
 * ./config.ts's getToolRendererBaseUrl and this folder's README).
 *
 * The Tool Renderer app expects a URL of the shape:
 *
 *   `${baseUrl}/tool/<toolId>/<encoded>`
 *
 * where `<encoded>` is a URL-safe base64 encoding of the JSON envelope
 * `{ toolId, data }` — the same `toolId` that also appears in the path
 * (kept there too so the URL is human-readable and so the renderer app
 * can route without first decoding the payload). `data` is an
 * arbitrary, tool-specific JSON value (e.g. a ContentBlock's `data`,
 * see components/curriculum/phase2-content/toolRenderers/
 * ContentDispatcher.tsx) — this module does not know or care about its
 * shape.
 *
 * `encodeToolViewerUrl` is the only place that should build one of
 * these URLs; `decodeToolViewerUrl` is the only place that should parse
 * one back apart. Nothing else in the app should hand-roll the
 * `/tool/<toolId>/<encoded>` path or call btoa/atob directly.
 */

import { getToolRendererBaseUrl } from "./config";

/** The `{ toolId, data }` payload embedded in a Tool Viewer URL. */
export interface ToolViewerEnvelope {
  toolId: string;
  data: unknown;
}

/**
 * The maximum length, in characters, `encodeToolViewerUrl` will allow
 * for the URL it builds. Chosen well under common browser/proxy/server
 * URL length limits (many cap out around 8000 characters) so an
 * oversized content block fails clearly rather than producing a URL
 * that's silently truncated or rejected by the browser or the Tool
 * Renderer app's own server.
 */
export const MAX_TOOL_VIEWER_URL_LENGTH = 6000;

/**
 * Thrown by `encodeToolViewerUrl` when a content block's `toolId`/`data`
 * can't be turned into a usable Tool Viewer URL — either `data` isn't
 * JSON-serializable (e.g. it contains a circular reference or a
 * `BigInt`) or the resulting URL would exceed
 * `MAX_TOOL_VIEWER_URL_LENGTH`. Distinct from `encodeToolViewerUrl`
 * returning `undefined`, which means something different (the Tool
 * Renderer base URL simply isn't configured) — callers should treat
 * this as an error to surface, not as the "not configured" case.
 */
export class ToolViewerEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolViewerEncodingError";
  }
}

/**
 * Encodes a UTF-8 string as URL-safe base64 (`+`/`/` replaced with
 * `-`/`_`, no `=` padding), so the result can be used directly as a
 * single URL path segment with no further percent-encoding needed.
 */
function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Reverses `toBase64Url`: restores standard base64 padding/alphabet,
 * decodes it, and returns the original UTF-8 string. Throws if `value`
 * isn't valid base64 (url-safe or standard).
 */
function fromBase64Url(value: string): string {
  const restored = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (restored.length % 4)) % 4;
  const padded = restored + "=".repeat(paddingNeeded);

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Tool Viewer payload is not valid base64.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Builds the full Tool Renderer iframe URL for a single content block:
 * `${getToolRendererBaseUrl()}/tool/<toolId>/<encoded>`, where
 * `<encoded>` is the url-safe-base64-encoded JSON of `{ toolId, data }`.
 *
 * Returns `undefined` (rather than throwing) if
 * `VITE_TOOL_RENDERER_BASE_URL` isn't configured, matching
 * `getToolRendererBaseUrl()`'s own degrade-gracefully behavior — a
 * caller (e.g. `ToolContentFrame`) should treat `undefined` as "show a
 * clear inline message instead of an iframe", not as an error.
 *
 * Throws a `ToolViewerEncodingError` — distinct from returning
 * `undefined` — if `data` isn't JSON-serializable (e.g. a circular
 * reference or a `BigInt`, which make `JSON.stringify` throw) or if the
 * resulting URL would exceed `MAX_TOOL_VIEWER_URL_LENGTH`. Callers
 * should catch this and show their own "couldn't prepare this content
 * for preview" state rather than letting it propagate as an unhandled
 * render error.
 */
export function encodeToolViewerUrl(toolId: string, data: unknown): string | undefined {
  const baseUrl = getToolRendererBaseUrl();
  if (baseUrl === undefined) return undefined;

  const envelope: ToolViewerEnvelope = { toolId, data };

  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch (err) {
    throw new ToolViewerEncodingError(
      `Could not encode "${toolId}"'s content for preview: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const encoded = toBase64Url(serialized);
  const url = `${baseUrl}/tool/${encodeURIComponent(toolId)}/${encoded}`;

  if (url.length > MAX_TOOL_VIEWER_URL_LENGTH) {
    throw new ToolViewerEncodingError(
      `"${toolId}"'s content is too large to preview here (built URL is ${url.length} characters, ` +
        `over the ${MAX_TOOL_VIEWER_URL_LENGTH}-character limit).`,
    );
  }

  return url;
}

/**
 * Parses a Tool Renderer iframe URL (as built by `encodeToolViewerUrl`)
 * back into its `{ toolId, data }` envelope.
 *
 * Accepts either a full URL (absolute or relative, e.g. as produced by
 * `encodeToolViewerUrl`) or just the trailing `<encoded>` path segment
 * on its own. When a full URL is given, the `toolId` embedded in the
 * decoded payload is cross-checked against the `<toolId>` path segment
 * in the URL and an error is thrown on mismatch, so a corrupted or
 * hand-edited URL fails loudly rather than silently rendering the
 * wrong tool.
 *
 * Throws if the input isn't valid base64, doesn't decode to valid JSON,
 * or doesn't decode to an object with a string `toolId` field.
 */
export function decodeToolViewerUrl(urlOrEncoded: string): ToolViewerEnvelope {
  const trimmed = urlOrEncoded.trim();
  if (trimmed.length === 0) {
    throw new Error("Tool Viewer URL/payload must not be empty.");
  }

  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  const encoded = segments[segments.length - 1] ?? trimmed;

  // If this looks like a `/tool/<toolId>/<encoded>` URL rather than a
  // bare encoded segment, pull out the `<toolId>` segment so it can be
  // cross-checked against the decoded envelope below.
  let urlToolId: string | undefined;
  const toolSegmentIndex = segments.indexOf("tool");
  if (toolSegmentIndex !== -1 && segments.length >= toolSegmentIndex + 3) {
    urlToolId = decodeURIComponent(segments[toolSegmentIndex + 1]);
  }

  let json: string;
  try {
    json = fromBase64Url(encoded);
  } catch (err) {
    throw new Error(
      `Failed to base64-decode Tool Viewer payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `Failed to parse Tool Viewer payload as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).toolId !== "string"
  ) {
    throw new Error('Tool Viewer payload is missing a valid "toolId" field.');
  }

  const envelope = parsed as ToolViewerEnvelope;

  if (urlToolId !== undefined && urlToolId !== envelope.toolId) {
    throw new Error(
      `Tool Viewer URL's toolId ("${urlToolId}") does not match the toolId encoded in its payload ` +
        `("${envelope.toolId}").`,
    );
  }

  return envelope;
}