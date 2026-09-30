/**
 * Builds the structured instruction prompt that asks an AI to propose a set
 * of simple, single-subject slideshow images for a lesson, given the
 * lesson's saved generated content JSON.
 *
 * Ported from the standalone prototype's buildPrompt() function.
 */

/** Loosely-typed shape of a lesson's saved generated content. */
export type GeneratedContentJson =
  | Record<string, unknown>
  | Record<string, unknown>[];

const MIN_ALLOWED_IMAGES = 1;
const MAX_ALLOWED_IMAGES = 30;

function clampImageCount(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_ALLOWED_IMAGES, Math.max(MIN_ALLOWED_IMAGES, Math.trunc(value)));
}

/**
 * Builds the full instruction prompt to hand to an AI, asking it to review
 * the lesson JSON and propose a set of simple, single-subject images for a
 * slideshow.
 *
 * @param lessonJson - the lesson's saved generatedContent JSON.
 * @param minImages - minimum number of images the AI should return.
 * @param maxImages - maximum number of images the AI should return.
 * @param noOnImageText - when true, instructs the AI that images must
 *   contain no text/labels/captions at all; when false, allows minimal
 *   essential labels.
 */
export function buildImagePromptRequest(
  lessonJson: GeneratedContentJson,
  minImages: number,
  maxImages: number,
  noOnImageText: boolean,
): string {
  let min = clampImageCount(minImages, 5);
  let max = clampImageCount(maxImages, 12);
  if (min > max) {
    [min, max] = [max, min];
  }

  const noTextRule = noOnImageText
    ? '- The image itself must contain no text, letters, numbers, labels, captions, or diagram annotations. If a concept needs a label, describe that in "description" or "altText" instead, never inside "imagePrompt".'
    : "- Avoid dense on-image text; if labels are essential, keep them minimal.";

  return `You are helping prepare visuals for a slideshow that will accompany the lesson content below.

TASK
Review the lesson JSON in full — every section, activity, vocabulary term, and assessment — and suggest a set of images that could be used across the slideshow to support this lesson visually.

RULES FOR EACH IMAGE
- Each image must depict exactly ONE simple, clear subject: a single object, animal, person, scene, or concept.
- Do not describe busy compositions, collages, multi-panel layouts, infographics, or scenes packed with many unrelated elements. Simplicity is the priority over completeness.
${noTextRule}
- Keep each image prompt self-contained: it should make sense to an image-generation AI with no other context.
- Only suggest an image where a visual genuinely helps a learner or teacher; do not force one onto every single item in the lesson.
- Spread images across the different sections of the lesson (e.g. introduction, vocabulary, activities, assessments) rather than clustering them in one place.
- For vocabulary terms, prefer one clean, representative image per term you choose to illustrate rather than a composite of multiple terms.
- Keep content appropriate for a classroom / educational setting.

LESSON JSON
\`\`\`json
${JSON.stringify(lessonJson, null, 2)}
\`\`\`

RESPONSE FORMAT
Respond with ONLY a valid JSON array — no markdown code fences, no commentary before or after — matching exactly this schema:

[
  {
    "id": "string — short unique id, e.g. img-01",
    "sourceTool": "string — which section/tool this image supports, e.g. 'introduction' or 'vocabulary:morph'",
    "description": "string — one plain-language sentence describing what the image depicts",
    "imagePrompt": "string — a single self-contained prompt for an AI image generator describing exactly one simple subject, its setting, and a visual style",
    "style": "string — visual style, e.g. 'flat vector illustration', 'realistic photo', 'watercolor illustration', 'simple diagram'",
    "aspectRatio": "string — one of '16:9', '4:3', '1:1'",
    "altText": "string — accessible alt text describing the image for screen readers",
    "tags": "array of strings — a few short, lowercase, descriptive keywords for this image (e.g. subject, topic, style); not consumed by the app yet, but always include it",
    "placement": {
      "position": "string — one of 'left', 'right', 'center', 'full-bleed' — where this image should sit on its slide",
      "size": "string — one of 'small', 'medium', 'large' — how much of the slide it should occupy",
      "zOrder": "string — one of 'foreground', 'background' — whether this image sits in front of slide text/content or behind it"
    }
  }
]

PLACEMENT GUIDANCE
- Decide placement once, here, rather than leaving it to be figured out later: choose "zOrder": "background" only for simple, low-detail images that text can legibly sit on top of; everything else should be "foreground".
- Vary "position" and "size" sensibly across the set rather than defaulting every image to the same values.

Return between ${min} and ${max} images in total. Do not include any explanation before or after the JSON array.`;
}