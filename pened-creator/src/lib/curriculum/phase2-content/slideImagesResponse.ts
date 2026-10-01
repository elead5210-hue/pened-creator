/**
 * Parses, validates and applies the AI's response to the per-slide "add
 * images" prompt (see ./slideImagesPromptBuilder.ts).
 *
 * Pure and deterministic: no I/O, no AI call, and it never mutates its
 * inputs. It is not wired into any UI or saved anywhere by this module;
 * callers decide what to do with a successful result (for example, replace
 * the slide in the deck with `replaceSlideInDeck` and save the deck).
 *
 * It does not add a second set of structural rules. The response is run
 * through ./slideshowDeckValidator.ts: `parseDeckJson` tolerates code
 * fences and stray prose, and the slide is checked by wrapping it in a
 * minimal deck and calling `validateDeck`, so a slide that passes here
 * passes the same checks as any saved deck. On top of that it checks the
 * promises the "add images" prompt makes to the AI:
 *
 * - the slide's `id` is unchanged;
 * - every original element is still present, unmodified and in order;
 * - the slide's other fields (`title`, `background`, anything else) are
 *   unchanged;
 * - the only additions are elements of type "image";
 * - each new image's `src` is exactly one of the lesson's uploaded image
 *   srcs, so the AI cannot invent files;
 * - new element ids are unique among the slide's elements;
 * - at least one image was actually added.
 *
 * Errors use the same `{ path, message }` shape as the deck validator, with
 * paths relative to the slide (for example `slide.elements[2].src`).
 */

import {
  parseDeckJson,
  validateDeck,
  type DeckError,
  type SlideData,
  type SlideElementData,
  type SlideshowDeck,
} from "./slideshowDeckValidator";
import { getUploadedImageDescriptions, type SlideImagesLessonInput } from "./slideImagesPromptBuilder";

/**
 * Discriminated result of parseSlideImagesResponse: on success `slide` is
 * the validated updated slide and `addedElements` are the new image
 * elements; on failure `errors` lists every problem found.
 */
export type SlideImagesResponseResult =
  | { ok: true; slide: SlideData; addedElements: SlideElementData[]; errors: [] }
  | { ok: false; slide: null; addedElements: []; errors: DeckError[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Structural deep equality for JSON-like values; object key order does not matter. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }

  return false;
}

/**
 * The exact `src` values of the images uploaded for a lesson, in the order
 * of the lesson's image prompts. These are the only srcs the AI is allowed
 * to use, and match the list embedded in the prompt.
 */
export function getAllowedImageSrcs(lesson: SlideImagesLessonInput | null | undefined): string[] {
  return getUploadedImageDescriptions(lesson).map((image) => image.src);
}

/**
 * Tolerates an AI that wrapped the slide instead of returning it bare:
 * `{ "slide": { ... } }`, or a deck `{ "slides": [ ... ] }` (using the slide
 * with the original id, or the only slide). Anything else is returned as is
 * and left for validation to reject.
 */
function unwrapSlide(parsed: unknown, originalId: string): unknown {
  if (!isPlainObject(parsed) || Array.isArray(parsed.elements)) return parsed;

  if (isPlainObject(parsed.slide)) return parsed.slide;

  if (Array.isArray(parsed.slides)) {
    const match = parsed.slides.find((slide) => isPlainObject(slide) && slide.id === originalId);
    if (match !== undefined) return match;
    if (parsed.slides.length === 1) return parsed.slides[0];
  }

  return parsed;
}

/**
 * Runs the deck validator's slide rules on `candidate` by placing it in a
 * minimal valid deck, then rewrites the paths so they refer to the slide
 * ("slides[0].elements[1]" becomes "slide.elements[1]").
 */
function validateSlideWithDeckRules(candidate: unknown): DeckError[] {
  const { errors } = validateDeck({
    version: "v1",
    id: "slide-check",
    metadata: { title: "slide-check" },
    slides: [candidate],
  });

  return errors.map((error) => ({
    path: error.path.replace(/^slides\[0\]/, "slide"),
    message: error.message.split("slides[0]").join("slide"),
  }));
}

/**
 * Checks the updated slide against the original and the uploaded srcs.
 * Assumes `updated` already passed structural validation.
 */
function checkPromptPromises(
  original: SlideData,
  updated: SlideData,
  allowedSrcs: Set<string>,
): { errors: DeckError[]; addedElements: SlideElementData[] } {
  const errors: DeckError[] = [];
  const addedElements: SlideElementData[] = [];

  if (updated.id !== original.id) {
    errors.push({
      path: "slide.id",
      message: `The slide id must stay "${original.id}", but the response has ${JSON.stringify(updated.id)}.`,
    });
  }

  // Every other slide-level field must be exactly as it was.
  const otherKeys = new Set([...Object.keys(original), ...Object.keys(updated)]);
  otherKeys.delete("id");
  otherKeys.delete("elements");
  for (const key of otherKeys) {
    if (!deepEqual(original[key], updated[key])) {
      errors.push({
        path: `slide.${key}`,
        message: `"slide.${key}" must not be changed; only image elements may be added to the slide.`,
      });
    }
  }

  const responseElements = updated.elements;
  const used = new Set<number>();
  const matchedIndexes: number[] = [];

  // Every original element must still be there, unmodified.
  for (const originalElement of original.elements) {
    const index = responseElements.findIndex(
      (element, position) => !used.has(position) && element.id === originalElement.id,
    );

    if (index === -1) {
      errors.push({
        path: "slide.elements",
        message: `The existing element "${originalElement.id}" was removed; every existing element must be kept.`,
      });
      continue;
    }

    used.add(index);
    matchedIndexes.push(index);

    if (!deepEqual(originalElement, responseElements[index])) {
      errors.push({
        path: `slide.elements[${index}]`,
        message: `The existing element "${originalElement.id}" was changed; existing elements must stay exactly as they were.`,
      });
    }
  }

  // Existing elements must keep their relative order.
  const isInOrder = matchedIndexes.every((value, position) => position === 0 || value > matchedIndexes[position - 1]);
  if (!isInOrder) {
    errors.push({
      path: "slide.elements",
      message: "The existing elements were reordered; they must keep their original order.",
    });
  }

  // Everything else is an addition, and additions must be uploaded images.
  const idCounts = new Map<string, number>();
  for (const element of responseElements) {
    idCounts.set(element.id, (idCounts.get(element.id) ?? 0) + 1);
  }

  responseElements.forEach((element, index) => {
    if (used.has(index)) return;

    const path = `slide.elements[${index}]`;
    let isValidAddition = true;

    if (element.type !== "image") {
      errors.push({
        path: `${path}.type`,
        message: `"${path}.type" must be "image": only image elements may be added, got ${JSON.stringify(element.type)}.`,
      });
      isValidAddition = false;
    } else if (typeof element.src !== "string" || !allowedSrcs.has(element.src)) {
      errors.push({
        path: `${path}.src`,
        message: `"${path}.src" (${JSON.stringify(element.src)}) is not one of the uploaded images; use an exact src from the uploaded images list.`,
      });
      isValidAddition = false;
    }

    if ((idCounts.get(element.id) ?? 0) > 1) {
      errors.push({
        path: `${path}.id`,
        message: `"${path}.id" (${JSON.stringify(element.id)}) is not unique; each element id on the slide must be unique.`,
      });
      isValidAddition = false;
    }

    if (isValidAddition) addedElements.push(element);
  });

  if (responseElements.length - used.size === 0) {
    errors.push({
      path: "slide.elements",
      message: "The response doesn't add any images to the slide.",
    });
  }

  return { errors, addedElements };
}

/**
 * Parses and validates the AI's response to the "add images" prompt for one
 * slide.
 *
 * @param raw - the text pasted from the AI; code fences, stray prose and a
 *   wrapper object around the slide are tolerated
 * @param originalSlide - the slide exactly as it is currently saved
 * @param allowedSrcs - the exact srcs of the lesson's uploaded images (see
 *   `getAllowedImageSrcs`); a new image must use one of them
 */
export function parseSlideImagesResponse(
  raw: string,
  originalSlide: SlideData,
  allowedSrcs: Iterable<string>,
): SlideImagesResponseResult {
  const fail = (errors: DeckError[]): SlideImagesResponseResult => ({
    ok: false,
    slide: null,
    addedElements: [],
    errors,
  });

  const allowed = new Set(allowedSrcs);
  if (allowed.size === 0) {
    return fail([
      {
        path: "$",
        message: "This lesson has no uploaded images, so there is nothing to add to the slide.",
      },
    ]);
  }

  let parsed: unknown;
  try {
    parsed = parseDeckJson(raw);
  } catch (err) {
    return fail([{ path: "$", message: err instanceof Error ? err.message : String(err) }]);
  }

  const candidate = unwrapSlide(parsed, originalSlide.id);

  const structuralErrors = validateSlideWithDeckRules(candidate);
  if (structuralErrors.length > 0) {
    return fail(structuralErrors);
  }

  const updated = candidate as SlideData;
  const { errors, addedElements } = checkPromptPromises(originalSlide, updated, allowed);
  if (errors.length > 0) {
    return fail(errors);
  }

  return { ok: true, slide: updated, addedElements, errors: [] };
}

/**
 * Returns a new deck with the slide at `index` replaced by `slide`. Every
 * other slide, deck field and the metadata are carried over untouched, and
 * neither `deck` nor `slide` is mutated.
 *
 * @throws RangeError if `index` is not an integer within the deck's slides.
 */
export function replaceSlideInDeck(deck: SlideshowDeck, index: number, slide: SlideData): SlideshowDeck {
  if (!Number.isInteger(index) || index < 0 || index >= deck.slides.length) {
    throw new RangeError(`Slide index ${index} is out of range for a deck with ${deck.slides.length} slides.`);
  }

  return {
    ...deck,
    slides: deck.slides.map((existing, position) => (position === index ? slide : existing)),
  };
}