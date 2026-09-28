
/**
 * Parses and structurally validates a pasted AI response for the
 * "Generate Slideshow Data" step against the Deck schema described in
 * PenEdSlideshow's docs/lesson-import-prompt.md (see
 * ./slideshowPromptBuilder.ts, which embeds that same schema into the
 * outgoing prompt).
 *
 * Like contentValidator.ts, this is not a
 * general-purpose JSON Schema implementation — it only checks the fields
 * this app actually depends on (required top-level fields, per-slide
 * `id` and `elements`, and per-element `id`/`type`/`position`/`size` plus
 * each element type's own required field), and otherwise passes optional
 * fields through untouched so the app's defaults can apply to them at
 * render time.
 *
 * Alignment with pened-tools: a saved deck is loaded by pened-tools by
 * lesson id, and pened-tools rejects a deck that fails its structural
 * checks, so a deck must never pass here and then fail there. Those
 * checks are: `slides` is a non-empty array; every slide has an
 * `elements` array (an empty array is fine); every element `type` is
 * `text`, `image`, `shape` or `video`; and `title`, `id` and `background`
 * are strings when present. Every one of them is enforced below. The
 * remaining rules here (literal `version`, `metadata.title`, per-element
 * `position`/`size`, and a text element's `content` and an
 * image/video element's `src`) are stricter than pened-tools, but they
 * are required by the Deck schema in the outgoing prompt (see
 * ./slideshowPromptBuilder.ts), so they are kept.
 *
 * `background` is accepted as a string or as a background object such as
 * `{ "kind": "gradient", "css": "..." }`. The prompt schema defines a
 * slide background as an object, so requiring a string would reject the
 * prompt's own example. Anything else (number, array, boolean, null) is
 * rejected. If pened-tools' validator turns out to accept only strings
 * for `background`, tighten this in validateOptionalStringFields.
 */

export interface DeckError {
  path: string;
  message: string;
}

const ELEMENT_TYPES = ["text", "image", "shape", "video"] as const;
type ElementType = (typeof ELEMENT_TYPES)[number];

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type OptionalStringField = "id" | "title" | "background";

/**
 * Checks that each listed field, when present (not `undefined`), has the
 * type pened-tools expects: `id` and `title` must be strings, and
 * `background` must be a string or a plain background object. Absent
 * fields are fine. Callers pass only the fields that aren't already
 * covered by a stricter "required" check on the same object, so an error
 * is never reported twice.
 *
 * @param path - dotted path of `value` in the deck ("" for the deck itself)
 */
function validateOptionalStringFields(
  value: Record<string, unknown>,
  path: string,
  errors: DeckError[],
  fields: OptionalStringField[],
): void {
  for (const field of fields) {
    const fieldValue = value[field];
    if (fieldValue === undefined) continue;

    const fieldPath = path ? `${path}.${field}` : field;

    if (field === "background") {
      if (typeof fieldValue !== "string" && !isPlainObject(fieldValue)) {
        errors.push({
          path: fieldPath,
          message: `"${fieldPath}" must be a string (or a background object) when present, got ${typeOf(fieldValue)}.`,
        });
      }
    } else if (typeof fieldValue !== "string") {
      errors.push({
        path: fieldPath,
        message: `"${fieldPath}" must be a string when present, got ${typeOf(fieldValue)}.`,
      });
    }
  }
}

/**
 * Strips markdown code fences (```json ... ``` or ``` ... ```) from pasted
 * text and extracts the JSON object between the first "{" and the last
 * "}", so a reply with stray prose or fences around the object still
 * parses — the single-object counterpart to
 * PasteImagePromptResponseForm.tsx's extractJsonArray.
 *
 * @throws Error if no object is found or the extracted text isn't valid JSON.
 */
export function parseDeckJson(raw: string): unknown {
  const stripped = String(raw ?? "").trim().replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in the pasted text.");
  }

  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Validates a Position ({ x, y }) or Size ({ width, height }) pair, where
 * each field may be a plain number and — for size only — either field may
 * also be the literal string "auto".
 */
function validatePoint(
  value: unknown,
  path: string,
  errors: DeckError[],
  fieldNames: [string, string],
  allowAutoSize: boolean,
): void {
  if (!isPlainObject(value)) {
    errors.push({ path, message: `"${path}" is required and must be an object with ${fieldNames[0]}/${fieldNames[1]}.` });
    return;
  }

  for (const field of fieldNames) {
    const fieldPath = `${path}.${field}`;
    const fieldValue = value[field];
    const isValidNumber = typeof fieldValue === "number" && Number.isFinite(fieldValue);
    const isValidAuto = allowAutoSize && fieldValue === "auto";

    if (!isValidNumber && !isValidAuto) {
      errors.push({
        path: fieldPath,
        message: allowAutoSize
          ? `"${fieldPath}" must be a number or "auto".`
          : `"${fieldPath}" must be a number.`,
      });
    }
  }
}

/**
 * Validates a single slide element against its base fields
 * (id/position/size) plus the required fields specific to its `type`
 * (TextElement.content, ImageElement.src, VideoElement.src). ShapeElement
 * has no additional required fields beyond the base ones.
 */
function validateElement(value: unknown, path: string, errors: DeckError[]): void {
  if (!isPlainObject(value)) {
    errors.push({ path, message: `"${path}" must be an element object.` });
    return;
  }

  if (typeof value.id !== "string" || !value.id) {
    errors.push({ path: `${path}.id`, message: `"${path}.id" is required and must be a non-empty string.` });
  }

  validateOptionalStringFields(value, path, errors, ["title", "background"]);

  const elementType = value.type;
  if (typeof elementType !== "string" || !ELEMENT_TYPES.includes(elementType as ElementType)) {
    errors.push({
      path: `${path}.type`,
      message: `"${path}.type" must be one of: ${ELEMENT_TYPES.join(", ")}.`,
    });
  }

  validatePoint(value.position, `${path}.position`, errors, ["x", "y"], false);
  validatePoint(value.size, `${path}.size`, errors, ["width", "height"], true);

  if (elementType === "text" && typeof value.content !== "string") {
    errors.push({ path: `${path}.content`, message: `"${path}.content" is required for a text element.` });
  }

  if ((elementType === "image" || elementType === "video") && (typeof value.src !== "string" || !value.src)) {
    errors.push({
      path: `${path}.src`,
      message: `"${path}.src" is required for a ${elementType} element and must be a real URL/path — omit the element instead of fabricating one.`,
    });
  }
}

/**
 * Validates a single slide against its base fields: a non-empty string
 * `id`, an `elements` array (required by pened-tools; an empty array is
 * fine), and `title`/`background` when present. Every element in
 * `elements` is validated in turn via validateElement.
 */
function validateSlide(value: unknown, path: string, errors: DeckError[]): void {
  if (!isPlainObject(value)) {
    errors.push({ path, message: `"${path}" must be a slide object.` });
    return;
  }

  if (typeof value.id !== "string" || !value.id) {
    errors.push({ path: `${path}.id`, message: `"${path}.id" is required and must be a non-empty string.` });
  }

  validateOptionalStringFields(value, path, errors, ["title", "background"]);

  if (!Array.isArray(value.elements)) {
    errors.push({
      path: `${path}.elements`,
      message: `"${path}.elements" is required and must be an array (use an empty array for a slide with no elements), got ${typeOf(value.elements)}.`,
    });
  } else {
    value.elements.forEach((element, index) => {
      validateElement(element, `${path}.elements[${index}]`, errors);
    });
  }
}

/**
 * Validates a lesson's pasted Deck JSON against the required subset of
 * the Deck schema: a literal "v1" version, a non-empty id, a
 * metadata.title, and a non-empty slides array whose entries each have
 * an `elements` array and whose elements satisfy
 * validateSlide/validateElement above. It also applies pened-tools'
 * "string when present" checks for `title`, `id` and `background` on the
 * deck, its metadata, its slides and their elements, so a deck that
 * passes here also passes pened-tools' structural validation.
 *
 * @param parsedResponse - the result of parseDeckJson (or JSON.parse) on
 *   the pasted AI response
 */
export function validateDeck(parsedResponse: unknown): { valid: boolean; errors: DeckError[] } {
  const errors: DeckError[] = [];

  if (!isPlainObject(parsedResponse)) {
    return {
      valid: false,
      errors: [{ path: "$", message: "The AI response must be a single JSON object representing a Deck." }],
    };
  }

  if (parsedResponse.version !== "v1") {
    errors.push({
      path: "version",
      message: `"version" must be the literal string "v1", got ${JSON.stringify(parsedResponse.version)}.`,
    });
  }

  if (typeof parsedResponse.id !== "string" || !parsedResponse.id) {
    errors.push({ path: "id", message: '"id" is required and must be a non-empty string.' });
  }

  validateOptionalStringFields(parsedResponse, "", errors, ["title", "background"]);

  if (!isPlainObject(parsedResponse.metadata)) {
    errors.push({ path: "metadata", message: '"metadata" is required and must be an object.' });
  } else {
    if (typeof parsedResponse.metadata.title !== "string" || !parsedResponse.metadata.title) {
      errors.push({ path: "metadata.title", message: '"metadata.title" is required and must be a non-empty string.' });
    }
    validateOptionalStringFields(parsedResponse.metadata, "metadata", errors, ["id"]);
  }

  if (!Array.isArray(parsedResponse.slides)) {
    errors.push({ path: "slides", message: `"slides" must be an array, got ${typeOf(parsedResponse.slides)}.` });
  } else if (parsedResponse.slides.length === 0) {
    errors.push({ path: "slides", message: '"slides" must contain at least one slide.' });
  } else {
    parsedResponse.slides.forEach((slide, index) => {
      validateSlide(slide, `slides[${index}]`, errors);
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Formats a list of deck errors into a single human-readable string,
 * mirroring formatContentErrors.
 */
export function formatDeckErrors(errors: DeckError[]): string {
  return errors.map((error) => (error.path !== "$" ? `${error.path}: ${error.message}` : error.message)).join("\n");
}