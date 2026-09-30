import { getToolRendererBaseUrl } from "@/lib/toolRenderer/config";

/**
 * Slideshow links for pened-tools.
 *
 * A slideshow link carries only the lesson id
 * (`<project_id>:<lesson_node_id>`), never the deck. pened-tools' own
 * server fetches the deck from pened-server by that id, so the URL stays
 * short no matter how large the deck is. The deck must already be saved on
 * the lesson (as its `slideshow` interactiveContent entry, see
 * ../shared/db.ts's `saveSlideshowDeck`) for the link to show anything.
 *
 * Every slideshow link in this app must be built with
 * `buildSlideshowUrl` (the path) or `resolveSlideshowLink` (the full,
 * clickable link with error reporting). Don't encode a deck into a
 * slideshow URL anywhere: old encoded links keep working in pened-tools,
 * but nothing new should produce them.
 */

/**
 * The shape pened-tools accepts for a lesson id: a non-empty project id
 * with no colon, whitespace or slash, a colon, then a non-empty node id
 * with no whitespace or slash (the node id may itself contain colons).
 */
const LESSON_ID_PATTERN = /^[^:\s/]+:[^\s/]+$/;

/**
 * Builds the pened-tools slideshow path for a lesson id:
 * `/tool/slideshow/<encodeURIComponent(lessonId)>` (so the colon is sent as
 * `%3A`). Returns `null` for anything that isn't a valid lesson id. The id
 * is deliberately not trimmed or repaired, so a bad id is reported rather
 * than turned into a link to a different lesson. Callers must treat `null`
 * as an error.
 */
export function buildSlideshowUrl(lessonId: string | null | undefined): string | null {
  return typeof lessonId === "string" && LESSON_ID_PATTERN.test(lessonId)
    ? `/tool/slideshow/${encodeURIComponent(lessonId)}`
    : null;
}

/** Why a full slideshow link couldn't be built. */
export type SlideshowLinkErrorReason = "invalid-lesson-id" | "not-configured" | "misconfigured";

/**
 * Result of resolveSlideshowLink: either the full link, or a reason it
 * couldn't be built with a message that is safe to show to the user.
 */
export type SlideshowLinkResult =
  { ok: true; url: string } | { ok: false; reason: SlideshowLinkErrorReason; message: string };

/**
 * Builds the full, clickable slideshow link for a lesson id: the pened-tools
 * origin from `VITE_TOOL_RENDERER_BASE_URL` (via `getToolRendererBaseUrl`)
 * plus `buildSlideshowUrl(lessonId)`. Never throws; failures are returned
 * as distinct, displayable reasons:
 *  - `invalid-lesson-id`: the id isn't `<project_id>:<lesson_node_id>`
 *  - `not-configured`: `VITE_TOOL_RENDERER_BASE_URL` is unset or blank
 *  - `misconfigured`: `VITE_TOOL_RENDERER_BASE_URL` is set but invalid
 */
export function resolveSlideshowLink(lessonId: string | null | undefined): SlideshowLinkResult {
  const path = buildSlideshowUrl(lessonId);
  if (path === null) {
    return {
      ok: false,
      reason: "invalid-lesson-id",
      message:
        "This lesson's id isn't in the expected project:lesson format, so a slideshow link can't be built.",
    };
  }

  let baseUrl: string | undefined;
  try {
    baseUrl = getToolRendererBaseUrl();
  } catch (err) {
    return {
      ok: false,
      reason: "misconfigured",
      message: err instanceof Error ? err.message : "VITE_TOOL_RENDERER_BASE_URL is invalid.",
    };
  }

  if (!baseUrl) {
    return {
      ok: false,
      reason: "not-configured",
      message: "Set VITE_TOOL_RENDERER_BASE_URL to enable opening this slideshow in pened-tools.",
    };
  }

  return { ok: true, url: `${baseUrl}${path}` };
}
