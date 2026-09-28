/**
 * Deterministically assembles a complete slideshow Deck JSON object from a
 * lesson's already-saved generatedContent (each block carrying slide-
 * authoring hints — see ./promptBuilder.ts / ./contentValidator.ts) and
 * imagePrompts (each item carrying placement hints — see
 * ./imagePromptBuilder.ts), pairing each content block with any image(s)
 * whose sourceTool matches that block's tool id and resolving those images
 * to their already-uploaded filenames via the lesson's images/imagesNoBg
 * maps.
 *
 * No AI call is involved — everything this function needs was already
 * decided when the content and image prompts were first generated, so
 * assembling the deck is a pure, deterministic transform over data that's
 * already saved on the lesson record. This keeps "Generate slideshow data"
 * a single synchronous action rather than another prompt/paste round trip.
 */

export const SLIDESHOW_DECK_VERSION = "v1";

/** Slide-authoring hints attached to a generated content block (see ./contentValidator.ts's SLIDE_SCHEMA). */
export interface SlideAuthoringHints {
  durationSeconds: number;
  transition: "fade" | "slide" | "cut";
  background: "light" | "dark" | "image";
}

/** A single generated content block, as saved in LessonRecord.generatedContent. */
export interface ContentBlock {
  tool: string;
  data: Record<string, unknown>;
  slide: SlideAuthoringHints;
  [key: string]: unknown;
}

/** Placement hints attached to an image prompt (see ./imagePromptBuilder.ts). */
export interface ImagePlacementHints {
  position: "left" | "right" | "center" | "full-bleed";
  size: "small" | "medium" | "large";
  zOrder: "foreground" | "background";
}

/** A single image-prompt item, as saved in LessonRecord.imagePrompts. */
export interface ImagePromptItem {
  id: string;
  sourceTool: string;
  description: string;
  imagePrompt: string;
  style: string;
  aspectRatio: string;
  altText: string;
  placement: ImagePlacementHints;
  [key: string]: unknown;
}

/** A single image reference resolved onto a slide. */
export interface SlideImageRef {
  promptId: string;
  altText: string;
  /** Filename of the plain uploaded image (LessonRecord.images[promptId]), or null if none is uploaded. */
  plainFilename: string | null;
  /** Filename of the background-removed image (LessonRecord.imagesNoBg[promptId]), or null if none exists. */
  cutoutFilename: string | null;
  placement: ImagePlacementHints;
}

export interface DeckSlide {
  id: string;
  tool: string;
  data: Record<string, unknown>;
  durationSeconds: number;
  transition: SlideAuthoringHints["transition"];
  background: SlideAuthoringHints["background"];
  images: SlideImageRef[];
}

export interface DeckCanvas {
  width: number;
  height: number;
}

export interface DeckPlayback {
  autoAdvance: boolean;
  loop: boolean;
}

export interface DeckMetadata {
  lessonId: string;
  generatedAt: string;
}

export interface SlideshowDeck {
  version: string;
  id: string;
  metadata: DeckMetadata;
  canvas: DeckCanvas;
  playback: DeckPlayback;
  slides: DeckSlide[];
}

const DEFAULT_CANVAS: DeckCanvas = { width: 1920, height: 1080 };
const DEFAULT_PLAYBACK: DeckPlayback = { autoAdvance: true, loop: false };

/**
 * Extracts the last path segment of a stored image URL/data URL (its
 * filename), mirroring the convention used when a cutout's filename is
 * derived from its plain counterpart's (see ../shared/db.ts's
 * deriveCutoutFilename). Returns null if no image is stored for this key.
 */
function extractFilename(imageUrl: string | undefined): string | null {
  if (!imageUrl) return null;
  const lastSegment = imageUrl.split("/").pop() ?? imageUrl;
  return lastSegment.split("?")[0] || null;
}

/**
 * Returns true if an image prompt's sourceTool applies to a given content
 * block's tool id — either an exact match ("introduction" ->
 * "introduction"), or a namespaced match where the sourceTool is prefixed
 * by the block's tool followed by ":" (e.g. sourceTool
 * "vocabulary:morph" applies to a block with tool "vocabulary").
 */
function sourceToolMatchesBlock(sourceTool: string, blockTool: string): boolean {
  return sourceTool === blockTool || sourceTool.startsWith(`${blockTool}:`);
}

/**
 * Resolves every image prompt whose sourceTool matches a block's tool id
 * into SlideImageRef entries, pulling each one's plain/cutout filenames
 * from the lesson's images/imagesNoBg maps. Image prompts with no
 * uploaded image yet (no entry in `images`) are skipped, since a slide
 * can't reference an image that doesn't exist.
 */
function resolveImagesForBlock(
  blockTool: string,
  imagePrompts: ImagePromptItem[],
  images: Record<string, string>,
  imagesNoBg: Record<string, string>,
): SlideImageRef[] {
  return imagePrompts
    .filter((prompt) => sourceToolMatchesBlock(prompt.sourceTool, blockTool))
    .filter((prompt) => Boolean(images[prompt.id]))
    .map((prompt) => ({
      promptId: prompt.id,
      altText: prompt.altText,
      plainFilename: extractFilename(images[prompt.id]),
      cutoutFilename: extractFilename(imagesNoBg[prompt.id]),
      placement: prompt.placement,
    }));
}

/**
 * Assembles a complete Deck JSON object for a lesson from its already-
 * saved generatedContent, imagePrompts, images, and imagesNoBg. Pure and
 * deterministic aside from the metadata.generatedAt timestamp: calling
 * this again with the same inputs produces the same slides, so it's safe
 * to re-run as a "Regenerate" action whenever the underlying content or
 * image prompts change.
 *
 * @param lessonId - the lesson record's id, used as both the deck's id
 *   and metadata.lessonId.
 * @param generatedContent - LessonRecord.generatedContent; each block must
 *   already carry a "slide" object (see ./contentValidator.ts's
 *   SLIDE_SCHEMA) — throws if this precondition isn't met, since a slide
 *   can't be built without its authoring hints.
 * @param imagePrompts - LessonRecord.imagePrompts; each item is expected to
 *   carry a "placement" object (see ./imagePromptBuilder.ts). May be
 *   null/empty if the Image Generation step hasn't been run yet, in which
 *   case every slide is built with no images.
 * @param images - LessonRecord.images, mapping image-prompt id -> plain
 *   uploaded image URL. May be null.
 * @param imagesNoBg - LessonRecord.imagesNoBg, mapping image-prompt id ->
 *   background-removed ("-cutout") image URL. May be null.
 */
export function buildSlideshowDeck(
  lessonId: string,
  generatedContent: ContentBlock[] | null | undefined,
  imagePrompts: ImagePromptItem[] | null | undefined,
  images: Record<string, string> | null | undefined,
  imagesNoBg: Record<string, string> | null | undefined,
): SlideshowDeck {
  if (!lessonId) {
    throw new Error("buildSlideshowDeck requires a lessonId.");
  }

  if (!Array.isArray(generatedContent) || generatedContent.length === 0) {
    throw new Error(
      "buildSlideshowDeck requires a non-empty generatedContent array. Generate and save lesson content before generating slideshow data.",
    );
  }

  generatedContent.forEach((block, index) => {
    if (!block || typeof block !== "object" || !block.slide) {
      throw new Error(
        `Content block ${index} ("${block?.tool ?? "unknown"}") is missing its "slide" authoring hints. ` +
          "Slideshow data can only be assembled from content generated after slide hints were added to the content-generation prompt.",
      );
    }
  });

  const resolvedImagePrompts = Array.isArray(imagePrompts) ? imagePrompts : [];
  const resolvedImages = images ?? {};
  const resolvedImagesNoBg = imagesNoBg ?? {};

  const slides: DeckSlide[] = generatedContent.map((block, index) => ({
    id: `slide-${String(index + 1).padStart(2, "0")}`,
    tool: block.tool,
    data: block.data,
    durationSeconds: block.slide.durationSeconds,
    transition: block.slide.transition,
    background: block.slide.background,
    images: resolveImagesForBlock(block.tool, resolvedImagePrompts, resolvedImages, resolvedImagesNoBg),
  }));

  return {
    version: SLIDESHOW_DECK_VERSION,
    id: lessonId,
    metadata: {
      lessonId,
      generatedAt: new Date().toISOString(),
    },
    canvas: DEFAULT_CANVAS,
    playback: DEFAULT_PLAYBACK,
    slides,
  };
}