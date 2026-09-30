/**
 * Builds the structured instruction prompt that asks an AI to propose a set
 * of YouTube search keywords/phrases relevant to a lesson, given the
 * lesson's saved generated content JSON.
 *
 * Mirrors imagePromptBuilder.ts's buildImagePromptRequest - same overall
 * shape (clamp a count, embed the lesson JSON, spell out an exact response
 * schema) but asking for search keywords instead of image prompts. The
 * resulting keyword list feeds the YouTube Videos step's
 * POST /api/youtube/search call (see ../../server's YouTube search
 * endpoint), so each keyword should be usable as a search query on its
 * own - specific enough to surface relevant videos, not just the lesson's
 * title restated.
 */

/** Loosely-typed shape of a lesson's saved generated content, matching
 * imagePromptBuilder.ts's GeneratedContentJson. */
export type GeneratedContentJson =
  | Record<string, unknown>
  | Record<string, unknown>[];

const MIN_ALLOWED_KEYWORDS = 1;
const MAX_ALLOWED_KEYWORDS = 20;

function clampKeywordCount(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_ALLOWED_KEYWORDS, Math.max(MIN_ALLOWED_KEYWORDS, Math.trunc(value)));
}

/**
 * Builds the full instruction prompt to hand to an AI, asking it to review
 * the lesson JSON and propose a set of YouTube search keywords/phrases a
 * teacher or student could use to find videos supporting this lesson.
 *
 * @param lessonJson - the lesson's saved generatedContent JSON.
 * @param minKeywords - minimum number of keywords the AI should return.
 * @param maxKeywords - maximum number of keywords the AI should return.
 */
export function buildYoutubeKeywordPromptRequest(
  lessonJson: GeneratedContentJson,
  minKeywords: number = 5,
  maxKeywords: number = 10,
): string {
  let min = clampKeywordCount(minKeywords, 5);
  let max = clampKeywordCount(maxKeywords, 10);
  if (min > max) {
    [min, max] = [max, min];
  }

  return `You are helping find supplementary YouTube videos for the lesson content below.

TASK
Review the lesson JSON in full — every section, activity, vocabulary term, and assessment — and propose a set of YouTube search keywords/phrases that would surface videos genuinely useful for teaching or reviewing this lesson.

RULES FOR EACH KEYWORD
- Each "keyword" must be a search query you would actually type into YouTube - specific enough to return relevant results, not just the lesson's title restated (e.g. prefer "long division step by step for kids" over "math lesson").
- Keep each keyword self-contained: it should make sense as a standalone search with no other context.
- Favor phrases likely to surface real educational videos (tutorials, explainers, demonstrations) over generic or overly broad terms.
- Spread keywords across the different sections of the lesson (e.g. introduction, vocabulary, activities, assessments) rather than clustering them around one topic.
- Do not propose near-duplicate keywords - each one should target a distinct topic, term, or angle from the lesson.
- Keep content appropriate for a classroom / educational setting.

LESSON JSON
\`\`\`json
${JSON.stringify(lessonJson, null, 2)}
\`\`\`

RESPONSE FORMAT
Respond with ONLY a valid JSON array — no markdown code fences, no commentary before or after — matching exactly this schema:

[
  {
    "keyword": "string — the exact search phrase to use on YouTube",
    "sourceTool": "string — which section/topic this keyword supports, e.g. 'introduction' or 'vocabulary:morph'",
    "reason": "string — one plain-language sentence explaining why this search is useful for this lesson"
  }
]

Return between ${min} and ${max} keywords in total. Do not include any explanation before or after the JSON array.`;
}