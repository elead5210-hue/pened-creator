
import { validateLessonBreakdownDocument } from "../shared/schema";
import { upsertSlideshowEntry, type InteractiveContentEntry } from "./slideshowInteractiveContent";

/**
 * Lesson model: shape definition, status enum, and factory helpers
 * for records stored via the `/api/lessons` endpoints (see this app's
 * ../shared/db.ts for the underlying persistence/CRUD layer).
 *
 * Detailed structural validation lives in the shared schema module
 * (validateLessonBreakdownDocument, in ../shared/schema.ts); this module
 * consumes it to guard record creation rather than duplicating
 * validation logic locally.
 *
 * Phase 2 adds `generatedContent`: the parsed array of { tool, data }
 * content blocks produced by pasting an AI response (validated against
 * the Presentation Tools registry elsewhere, see ./contentValidator.ts).
 *
 * Phase 2 also adds `imagePrompts`/`images`: the Image Generation step's
 * saved output. `imagePrompts` is the parsed array of AI-returned prompt
 * objects ({ id, sourceTool, description, imagePrompt, style, aspectRatio,
 * altText }) built from a lesson's already-generated content. `images` is
 * a map of prompt id -> uploaded image data (a data URL or a hosted URL,
 * depending on the storage strategy the Image Generation step ends up
 * using), so an uploaded image can be matched back to the prompt card it
 * was generated for. Both are null until the user has actually run the
 * Image Generation step.
 *
 * Phase 2 also adds `imagesNoBg`: the background-removed counterpart to
 * `images`, keyed the same way (prompt id -> image data). Populated either
 * automatically (the server's POST /api/lessons/:id/images/:promptId/
 * remove-background endpoint runs background removal against an already-
 * uploaded `images` entry and persists the result here) or manually via
 * setLessonImageNoBg below (used to replace an automatic result that
 * didn't process correctly). Null until a background-removed image exists
 * for at least one prompt.
 *
 * TS port of contentBuilder's src/models/lesson.js, now the canonical
 * home for this record-shaping logic (see docs/merge-architecture.md);
 * db.ts and routes/lessons.$lessonId.tsx import from here instead of
 * reaching across into contentBuilder.
 */

/**
 * Possible lifecycle states for a lesson record.
 * - draft: JSON pasted and saved, nothing generated yet.
 * - prompt-generated: an AI prompt has been assembled for this lesson.
 * - content-generated: AI-generated content has been pasted back and saved.
 * - images-generated: image prompts have been generated (and, typically,
 *   at least one image uploaded) for this lesson's content. Builds on
 *   content-generated - a lesson can't reach this status without content
 *   to base image prompts on - but doesn't replace it as the terminal
 *   Phase 2 state, since generating images is optional.
 */
export const LessonStatus = Object.freeze({
  DRAFT: "draft",
  PROMPT_GENERATED: "prompt-generated",
  CONTENT_GENERATED: "content-generated",
  IMAGES_GENERATED: "images-generated",
} as const);

export type LessonStatusValue = (typeof LessonStatus)[keyof typeof LessonStatus];

export const LESSON_STATUS_VALUES: LessonStatusValue[] = Object.values(LessonStatus) as LessonStatusValue[];

/**
 * A lesson record as created/shaped by this module (createLessonRecord /
 * updateLessonRecord / setLessonStatus / setLessonGeneratedContent /
 * setLessonImagePrompts / setLessonImage / setLessonImageNoBg).
 * Kept structurally loose (rather than importing db.ts's LessonRecord
 * type) to avoid a circular import between this module and db.ts, which
 * imports these helpers.
 */
export type LessonRecordShape = {
  id: string;
  project_id: string;
  lesson_node_id: string;
  breakdown: unknown;
  status: LessonStatusValue;
  generatedPrompt: string | null;
  generatedContent: unknown[] | null;
  /**
   * Parsed array of image-prompt objects returned by the AI for the Image
   * Generation step ({ id, sourceTool, description, imagePrompt, style,
   * aspectRatio, altText }), or null if that step hasn't been run for this
   * lesson yet.
   */
  imagePrompts: unknown[] | null;
  /**
   * Map of image-prompt id -> uploaded image data (a data URL or hosted
   * URL) for images the user has generated and uploaded against an
   * imagePrompts entry. Null until at least one image has been uploaded.
   */
  images: Record<string, string> | null;
  /**
   * Map of image-prompt id -> background-removed image data (a data URL
   * or hosted URL), mirroring `images`. Null until a background-removed
   * image exists for at least one prompt - see setLessonImageNoBg below.
   */
  imagesNoBg: Record<string, string> | null;
  /**
   * Saved slideshow Deck JSON, assembled deterministically from
   * generatedContent, imagePrompts, images, and imagesNoBg (see
   * ./slideshowDeckBuilder.ts's buildSlideshowDeck) — no separate AI call
   * is involved in producing this. Null until "Generate slideshow data"
   * has been run for this lesson.
   */
  slideshowDeck: unknown | null;
  /**
   * The lesson's interactiveContent entries as stored by pened-server:
   * one `{ tool, data }` entry per tool, or null/absent when nothing has
   * been saved. The slideshow deck is persisted as the `tool ===
   * "slideshow"` entry here (this is what pened-tools loads by lesson
   * id); `slideshowDeck` above is only the derived in-memory view of that
   * entry. Entries for other tools must be carried through unchanged.
   */
  interactiveContent?: InteractiveContentEntry[] | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

/**
 * Builds the composite primary key used as the `id` field for lesson
 * records, matching the keyPath this app's persistence layer expects.
 */
export function buildLessonId(projectId: string, lessonNodeId: string): string {
  return `${projectId}:${lessonNodeId}`;
}

/**
 * Lightweight boolean check kept for callers that only need a yes/no
 * answer. Prefer `validateLessonBreakdownDocument` from ./schema when
 * field-level error messages are needed (e.g. for form feedback).
 */
export function isValidLessonBreakdown(data: unknown): boolean {
  return validateLessonBreakdownDocument(data).valid;
}

/**
 * Creates a new lesson record from a validated, parsed breakdown JSON.
 * Sets initial status to DRAFT and stamps createdAt/updatedAt.
 *
 * @param breakdownJson - the full parsed JSON pasted by the user
 *   (expected to include version, project_id, lesson_node_id, breakdown).
 * @returns lesson record ready to persist
 * @throws if breakdownJson fails the shared schema validation; the
 *   error message concatenates all field-level validation messages.
 */
export function createLessonRecord(breakdownJson: any): LessonRecordShape {
  const { valid, errors } = validateLessonBreakdownDocument(breakdownJson);

  if (!valid) {
    const details = errors.map((error) => error.message).join(" ");
    throw new Error(`Invalid lesson breakdown JSON: ${details}`);
  }

  const now = new Date().toISOString();
  const { project_id, lesson_node_id } = breakdownJson;

  return {
    id: buildLessonId(project_id, lesson_node_id),
    project_id,
    lesson_node_id,
    breakdown: breakdownJson,
    status: LessonStatus.DRAFT,
    generatedPrompt: null,
    generatedContent: null,
    imagePrompts: null,
    images: null,
    imagesNoBg: null,
    slideshowDeck: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Returns a new lesson record with updated fields, bumping updatedAt.
 * Does not mutate the original record.
 *
 * @param lessonRecord - existing lesson record
 * @param changes - partial fields to merge in (e.g. { status, generatedPrompt })
 * @returns new lesson record
 */
export function updateLessonRecord(
  lessonRecord: LessonRecordShape,
  changes: Record<string, unknown>,
): LessonRecordShape {
  return {
    ...lessonRecord,
    ...changes,
    updatedAt: new Date().toISOString(),
  } as LessonRecordShape;
}

/**
 * Transitions a lesson record to a new status, validating the value
 * against the known LessonStatus enum.
 */
export function setLessonStatus(lessonRecord: LessonRecordShape, status: string): LessonRecordShape {
  if (!LESSON_STATUS_VALUES.includes(status as LessonStatusValue)) {
    throw new Error(`Invalid lesson status: ${status}`);
  }
  return updateLessonRecord(lessonRecord, { status });
}

/**
 * Stores the parsed, validated AI-generated content blocks on a lesson
 * record and transitions its status to CONTENT_GENERATED.
 *
 * @param lessonRecord - existing lesson record
 * @param generatedContent - parsed array of content blocks, expected to
 *   already be validated against the Presentation Tools registry (see
 *   ./contentValidator.ts).
 * @throws if generatedContent is not an array
 */
export function setLessonGeneratedContent(
  lessonRecord: LessonRecordShape,
  generatedContent: unknown[],
): LessonRecordShape {
  if (!Array.isArray(generatedContent)) {
    throw new Error("generatedContent must be an array of content blocks.");
  }

  return updateLessonRecord(lessonRecord, {
    generatedContent,
    status: LessonStatus.CONTENT_GENERATED,
  });
}

/**
 * Stores the parsed, AI-returned image prompts on a lesson record and
 * transitions its status to IMAGES_GENERATED, mirroring
 * setLessonGeneratedContent's shape for the Image Generation step.
 *
 * Does not touch `images` - uploading a generated image against one of
 * these prompts is a separate action (see setLessonImages) that can
 * happen incrementally, one prompt at a time, after this call.
 *
 * @param lessonRecord - existing lesson record
 * @param imagePrompts - parsed array of image-prompt objects returned by
 *   the AI ({ id, sourceTool, description, imagePrompt, style,
 *   aspectRatio, altText }).
 * @throws if imagePrompts is not an array
 */
export function setLessonImagePrompts(
  lessonRecord: LessonRecordShape,
  imagePrompts: unknown[],
): LessonRecordShape {
  if (!Array.isArray(imagePrompts)) {
    throw new Error("imagePrompts must be an array of image prompt objects.");
  }

  return updateLessonRecord(lessonRecord, {
    imagePrompts,
    status: LessonStatus.IMAGES_GENERATED,
  });
}

/**
 * Records an uploaded image against a single image-prompt id, merging it
 * into the lesson's existing `images` map (creating the map if this is
 * the first upload) rather than requiring the whole map to be replaced.
 *
 * @param lessonRecord - existing lesson record
 * @param promptId - the `id` of the imagePrompts entry this image belongs to
 * @param imageData - the uploaded image, as a data URL or hosted URL
 */
export function setLessonImage(
  lessonRecord: LessonRecordShape,
  promptId: string,
  imageData: string,
): LessonRecordShape {
  const images = { ...(lessonRecord.images ?? {}), [promptId]: imageData };
  return updateLessonRecord(lessonRecord, { images });
}

/**
 * Records a background-removed image against a single image-prompt id,
 * merging it into the lesson's existing `imagesNoBg` map (creating the
 * map if this is the first entry) rather than requiring the whole map to
 * be replaced - mirrors setLessonImage's shape for the background-removed
 * counterpart of `images`.
 *
 * Used both after automatic background removal (the server's own
 * remove-background endpoint persists directly, but the client's optimistic/
 * local shaping goes through this same helper) and for a manual "Replace"
 * upload when the automatic result didn't process correctly.
 *
 * @param lessonRecord - existing lesson record
 * @param promptId - the `id` of the imagePrompts entry this image belongs to
 * @param imageData - the background-removed image, as a data URL or hosted URL
 */
export function setLessonImageNoBg(
  lessonRecord: LessonRecordShape,
  promptId: string,
  imageData: string,
): LessonRecordShape {
  const imagesNoBg = { ...(lessonRecord.imagesNoBg ?? {}), [promptId]: imageData };
  return updateLessonRecord(lessonRecord, { imagesNoBg });
}

/**
 * Stores an assembled slideshow Deck JSON (see ./slideshowDeckBuilder.ts's
 * buildSlideshowDeck) on a lesson record, replacing any previously saved
 * deck. The deck is set both as the derived `slideshowDeck` view and as
 * the record's `slideshow` interactiveContent entry (replacing the
 * existing slideshow entry rather than appending a second one, and leaving
 * other tools' entries untouched), which is what actually gets persisted.
 * Mirrors setLessonGeneratedContent/setLessonImagePrompts' shape,
 * but doesn't transition `status` - assembling slideshow data is a
 * deterministic derivation of already-saved content/image data rather
 * than a new step in the Phase 2 draft -> content -> images lifecycle.
 *
 * @param lessonRecord - existing lesson record
 * @param slideshowDeck - the deck object produced by buildSlideshowDeck
 */
export function setLessonSlideshowDeck(
  lessonRecord: LessonRecordShape,
  slideshowDeck: unknown,
): LessonRecordShape {
  if (!slideshowDeck || typeof slideshowDeck !== "object") {
    throw new Error("slideshowDeck must be a deck object.");
  }

  return updateLessonRecord(lessonRecord, {
    slideshowDeck,
    interactiveContent: upsertSlideshowEntry(lessonRecord.interactiveContent, slideshowDeck),
  });
}