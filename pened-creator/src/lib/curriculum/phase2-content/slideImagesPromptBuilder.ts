
/**
 * Builds the per-slide "add images" prompt: given one slide's data object and
 * the images already uploaded for the lesson, it produces a prompt asking an
 * AI to add image elements to that slide.
 *
 * Pure and deterministic: makes no AI call, does no I/O, and never mutates its
 * input. The AI's response is not parsed or saved by anything here (that is
 * planned for a later update); this module only produces the prompt text.
 *
 * The schema rules restated in the prompt mirror what
 * ./slideshowDeckValidator.ts enforces for slides and elements, so a slide
 * returned by the AI stays compatible with the deck validator.
 */

/**
 * The parts of a lesson record this builder reads. Kept structural (rather
 * than importing LessonRecord) so the builder has no dependencies and is easy
 * to test.
 */
export interface SlideImagesLessonInput {
  /** The lesson's image prompts (each item has at least an `id`). */
  imagePrompts?: unknown;
  /** Uploaded image filenames/paths keyed by image prompt id. */
  images?: Record<string, unknown> | null;
  /**
   * Background-removed image URLs/paths keyed by image prompt id. When an
   * image has an entry here, that exact value is used as its `src`.
   */
  imagesNoBg?: Record<string, unknown> | null;
}

/** An image that has actually been uploaded for the lesson. */
export interface UploadedImageDescription {
  /** The image prompt id, e.g. "img-01". */
  id: string;
  /** One-sentence description of what the image depicts. */
  description: string;
  /** Alt text for the image, when the image prompt has one. */
  altText: string;
  /** The uploaded filename/path, to be used as the element's `src`. */
  src: string;
  /** Which section/tool the image supports, when known. */
  sourceTool: string;
}

export interface SlideImagesPromptResult {
  /** The full prompt text. */
  prompt: string;
  /** The uploaded images that were listed in the prompt. */
  images: UploadedImageDescription[];
  /** True when the lesson has no uploaded images to place. */
  hasImages: boolean;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Joins the lesson's image prompts with its uploaded images by id. Only
 * prompts that have a non-empty uploaded filename are returned, in the order
 * of `imagePrompts`, because a slide can't reference an image that hasn't
 * been uploaded.
 */
export function getUploadedImageDescriptions(lesson: SlideImagesLessonInput | null | undefined): UploadedImageDescription[] {
  const prompts = lesson?.imagePrompts;
  if (!Array.isArray(prompts)) return [];

  const images = lesson?.images && typeof lesson.images === "object" ? lesson.images : {};
  const imagesNoBg: Record<string, unknown> =
    lesson?.imagesNoBg && typeof lesson.imagesNoBg === "object" ? lesson.imagesNoBg : {};
  const result: UploadedImageDescription[] = [];

  for (const prompt of prompts) {
    if (!prompt || typeof prompt !== "object") continue;
    const item = prompt as Record<string, unknown>;

    const id = asString(item.id);
    if (!id) continue;

    // Prefer the exact background-removed image URL; fall back to the uploaded image.
    const src = asString(imagesNoBg[id]) || asString(images[id]);
    if (!src) continue;

    result.push({
      id,
      description: asString(item.description),
      altText: asString(item.altText),
      src,
      sourceTool: asString(item.sourceTool),
    });
  }

  return result;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "null";
  }
}

/** Counts image elements already on the slide, tolerating malformed data. */
function countExistingImageElements(slide: unknown): number {
  if (!slide || typeof slide !== "object") return 0;
  const elements = (slide as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return 0;
  return elements.filter(
    (element) => element && typeof element === "object" && (element as { type?: unknown }).type === "image",
  ).length;
}

function formatImageList(images: UploadedImageDescription[]): string {
  if (images.length === 0) {
    return "(No images have been uploaded for this lesson yet.)";
  }

  return images
    .map((image, index) => {
      const lines = [
        `${index + 1}. id: ${image.id}`,
        `   src: ${image.src}`,
        `   description: ${image.description || "(none)"}`,
      ];
      if (image.altText) lines.push(`   altText: ${image.altText}`);
      if (image.sourceTool) lines.push(`   sourceTool: ${image.sourceTool}`);
      return lines.join("\n");
    })
    .join("\n");
}

const IMAGE_ELEMENT_EXAMPLE = {
  id: "slide-1-image-1",
  type: "image",
  position: { x: 60, y: 120 },
  size: { width: 480, height: 320 },
  src: "<src of an uploaded image from the list above>",
  alt: "<the image's alt text>",
};

/**
 * Builds the "add images to this slide" prompt.
 *
 * @param slide - the slide's data object exactly as saved in the deck
 * @param lesson - the lesson record (or any object with `imagePrompts` and
 *   `images`), used to list the images already uploaded for the lesson
 */
export function buildSlideImagesPrompt(
  slide: unknown,
  lesson: SlideImagesLessonInput | null | undefined,
): SlideImagesPromptResult {
  const images = getUploadedImageDescriptions(lesson);
  const hasImages = images.length > 0;
  const existingImageCount = countExistingImageElements(slide);

  const existingNote =
    existingImageCount > 0
      ? `This slide already contains ${existingImageCount} image element${existingImageCount === 1 ? "" : "s"}. Keep every existing element exactly as it is (same ids, types, positions, sizes and content), do not add a second copy of an image the slide already shows, and place any new images so they don't overlap existing elements.`
      : "This slide does not contain any image elements yet.";

  const noImagesInstruction = hasImages
    ? ""
    : `
NO IMAGES ARE AVAILABLE: no images have been uploaded for this lesson, so there is nothing to add. Return the slide unchanged, exactly as provided, and do not invent any image elements or src values.
`;

  const prompt = `You are helping to build a lesson slideshow. Below is the data for ONE slide and the list of images that have already been uploaded for this lesson. Add image elements to the slide, using only the uploaded images that suit the slide's content.

INSTRUCTIONS
1. Read the slide data and decide which of the uploaded images (if any) genuinely support what the slide says. Not every image has to be used, and a slide may get no images if none fit.
2. Add each chosen image to the slide's "elements" array as an element of type "image".
3. Use ONLY images from the UPLOADED IMAGES list. Set each element's "src" to that image's exact "src" value. Never invent, guess or modify a src, and never use a URL or file that is not in the list. If no listed image fits, add nothing.
4. Do not change, remove or reorder any existing element, and do not change the slide's "id", "title", "background" or any other field. Only add image elements.
5. ${existingNote}
6. Give each image a position and size that fits on the slide, does not overlap other elements, and keeps text readable.
${noImagesInstruction}
IMAGE ELEMENT RULES
- "type" must be exactly "image".
- "id" is required: a non-empty string that is unique among the slide's elements.
- "src" is required: a non-empty string copied exactly from the UPLOADED IMAGES list.
- "position" is required: an object { "x": number, "y": number }.
- "size" is required: an object { "width": number, "height": number }. Each value is a number (or the literal string "auto").
- Optionally include "alt" with the image's alt text.
- The slide must keep an "elements" array (an empty array is allowed) and a non-empty string "id".

Example image element:
${safeStringify(IMAGE_ELEMENT_EXAMPLE)}

UPLOADED IMAGES
${formatImageList(images)}

SLIDE DATA
${safeStringify(slide)}

RESPONSE FORMAT
Respond with ONLY the complete updated slide as a single valid JSON object: the same slide as above, with the new image elements added to its "elements" array. Do not include any prose, explanation, comments or markdown code fences, and do not wrap the slide in another object.`;

  return { prompt, images, hasImages };
}