/**
 * Configuration for the pened Tool Renderer app, used to embed live
 * TOOL REGISTRY content blocks (e.g. multiple-choice cards) as iframes
 * inside lesson content views.
 *
 * Configuration is read from a Vite env var (see ../../vite-env.d.ts and
 * the repo's .env.example):
 *  - VITE_TOOL_RENDERER_BASE_URL (optional): base URL of the Tool
 *    Renderer app, no trailing slash.
 *
 * Unlike VITE_API_URL, this variable is optional — the renderer
 * integration must degrade gracefully (a clear inline message, not a
 * crash) when it's unset. getToolRendererBaseUrl() is the single place
 * that reads and validates this env var; the rest of the app should call
 * it rather than reading import.meta.env.VITE_TOOL_RENDERER_BASE_URL or
 * hardcoding the renderer host itself.
 *
 * Note that VITE_* values are baked into the bundle at build time, so
 * changing the renderer URL for a deployed app means rebuilding it (see
 * .env.example).
 */

/**
 * Returns the configured Tool Renderer base URL (trimmed, with any
 * trailing slash removed), or `undefined` if VITE_TOOL_RENDERER_BASE_URL
 * is not set or is blank.
 *
 * Throws if the value is set but isn't a valid absolute http(s) URL, so a
 * typo'd config fails fast and loudly rather than silently disabling the
 * feature.
 */
export function getToolRendererBaseUrl(): string | undefined {
  const raw = import.meta.env.VITE_TOOL_RENDERER_BASE_URL;
  if (raw === undefined) return undefined;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `VITE_TOOL_RENDERER_BASE_URL ("${trimmed}") is not a valid URL. Use a full URL including ` +
        'the protocol, e.g. "http://192.168.1.66:4500", with no trailing slash.',
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `VITE_TOOL_RENDERER_BASE_URL ("${trimmed}") must start with http:// or https://, but uses ` +
        `"${parsed.protocol}".`,
    );
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
