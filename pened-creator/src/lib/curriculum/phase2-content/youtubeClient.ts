import { apiPost } from "../shared/apiClient";
import {
  deleteYoutubeKeywordResponse,
  getYoutubeKeywordResponse,
  saveYoutubeKeywordResponse,
} from "../shared/db";
import type { YoutubeKeywordSavedResponse, YoutubeKeywordSaveInput } from "../shared/schema";

/**
 * ---------------------------------------------------------------------
 * Thin client for the YouTube search endpoint, POST /api/youtube/search
 * (see server/src/routes/youtube.js and server/README.md's "YouTube
 * search" section). Given a list of keywords, the server searches
 * YouTube for each one (via server/src/lib/youtube.js's searchKeyword)
 * and returns results grouped by keyword - this module just wraps that
 * call via the shared ../shared/apiClient.ts request helper, the same way
 * every other data-access function in ../shared/db.ts does.
 * ---------------------------------------------------------------------
 */

/**
 * A single video result for one keyword, matching the simplified shape
 * server/src/lib/youtube.js's itemToSearchResult maps each YouTube API
 * search.list item into.
 */
export interface YoutubeSearchResultItem {
  /** YouTube video id (the part after "v=" in a watch URL), or undefined
   * if the server couldn't determine one for this item. */
  videoId?: string;
  title?: string;
  description?: string;
  channelTitle?: string;
  /** ISO 8601 timestamp string. */
  publishedAt?: string;
  /** Thumbnail image URL. */
  thumbnail?: string;
}

/** Response body of POST /api/youtube/search: results grouped by the
 * exact keyword string that produced them. */
export interface YoutubeSearchResponse {
  results: Record<string, YoutubeSearchResultItem[]>;
}

/**
 * Searches YouTube for each keyword in `keywords`, returning results
 * grouped by keyword.
 *
 * Posts to /api/youtube/search with `{ keywords, maxResults }` via
 * apiPost (see ../shared/apiClient.ts), so failures - including a missing
 * YOUTUBE_API_KEY on the server (400), a YouTube API quota/auth failure
 * (502), an unexpected server error (500), or the API being unreachable
 * (status 0) - surface as the same ApiError every other db.ts call
 * throws, letting callers reuse the existing describeSaveError/
 * describeLoadError-style handling rather than a bespoke error path for
 * this one endpoint.
 *
 * @param keywords - non-empty array of non-empty search keyword strings.
 * @param maxResults - optional, per-keyword result cap (bounded server-side
 *   to YouTube's own 1-50 range, defaults to 5 when omitted).
 * @returns results grouped by the exact keyword string that produced them.
 */
export async function searchYoutubeVideos(
  keywords: string[],
  maxResults?: number,
): Promise<YoutubeSearchResponse> {
  return apiPost<YoutubeSearchResponse>("/api/youtube/search", {
    keywords,
    ...(maxResults !== undefined ? { maxResults } : {}),
  });
}

/**
 * ---------------------------------------------------------------------
 * Stored keyword response helpers
 *
 * Thin wrappers over the data-access functions in ../shared/db.ts for the
 * per-lesson stored YouTube keyword response, backed by
 * GET/PUT/DELETE /api/lessons/:lessonId/youtube-keyword-response. They
 * live here so the YouTube step's components can import everything
 * YouTube-related from one module; validation, auth and error handling
 * (ApiError) are all inherited from db.ts / apiClient.ts. They do not
 * touch searchYoutubeVideos or the search endpoint.
 * ---------------------------------------------------------------------
 */

/**
 * Loads the previously saved keyword response (raw pasted text plus
 * extracted keywords) for a lesson, or undefined if none has been saved.
 */
export function loadStoredYoutubeKeywordResponse(
  lessonId: string,
): Promise<YoutubeKeywordSavedResponse | undefined> {
  return getYoutubeKeywordResponse(lessonId);
}

/**
 * Saves (creates or overwrites) the keyword response for a lesson and
 * resolves with the stored record. Saving is an upsert, so repeating the
 * same call is safe.
 */
export function saveStoredYoutubeKeywordResponse(
  lessonId: string,
  input: YoutubeKeywordSaveInput,
): Promise<YoutubeKeywordSavedResponse> {
  return saveYoutubeKeywordResponse(lessonId, input);
}

/** Deletes the stored keyword response for a lesson; a missing one is a no-op. */
export function clearStoredYoutubeKeywordResponse(lessonId: string): Promise<void> {
  return deleteYoutubeKeywordResponse(lessonId);
}
