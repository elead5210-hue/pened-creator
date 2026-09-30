
/**
 * Safely extracts a normalized, ordered array of slides from a saved
 * slideshow deck record, for the per-slide data view.
 *
 * The saved deck may arrive as raw pasted text, a JSON string, an
 * already-parsed object, or null/undefined (nothing saved yet). This
 * helper never throws: it always returns a discriminated result so the
 * UI can render a slide list, an "empty" state, or an "invalid" state
 * without extra try/catch handling.
 *
 * Validation is delegated to parseAndValidateDeck in
 * ./slideshowDeckValidator.ts so a deck that renders here is exactly a
 * deck that passed the shared structural checks.
 */

import {
  parseAndValidateDeck,
  type DeckError,
  type SlideData,
  type SlideshowDeck,
} from "./slideshowDeckValidator";

/** A slide prepared for display, with its position in the deck. */
export interface NormalizedSlide {
  /** Zero-based position in the deck. */
  index: number;
  /** One-based position, for display ("Slide 3 of 10"). */
  number: number;
  /** The slide's id. */
  id: string;
  /** The slide's title, or a fallback ("Slide N") when absent/blank. */
  title: string;
  /** The original slide object, untouched, for the data card to render. */
  data: SlideData;
}

/**
 * Result of extractSlides:
 * - "ok": at least one slide is available.
 * - "empty": nothing was saved yet (null/undefined/blank input).
 * - "invalid": data exists but is unparseable or fails validation.
 */
export type ExtractSlidesResult =
  | {
      status: "ok";
      slides: NormalizedSlide[];
      deckTitle: string;
      totalSlides: number;
      isSingleSlide: boolean;
      errors: [];
    }
  | { status: "empty"; slides: []; deckTitle: ""; totalSlides: 0; isSingleSlide: false; errors: [] }
  | {
      status: "invalid";
      slides: [];
      deckTitle: "";
      totalSlides: 0;
      isSingleSlide: false;
      errors: DeckError[];
    };

const EMPTY_RESULT: ExtractSlidesResult = {
  status: "empty",
  slides: [],
  deckTitle: "",
  totalSlides: 0,
  isSingleSlide: false,
  errors: [],
};

function isBlankInput(input: unknown): boolean {
  if (input === null || input === undefined) return true;
  if (typeof input === "string") return input.trim() === "";
  return false;
}

function fallbackSlideTitle(number: number): string {
  return `Slide ${number}`;
}

function normalizeSlide(slide: SlideData, index: number): NormalizedSlide {
  const number = index + 1;
  const rawTitle = typeof slide.title === "string" ? slide.title.trim() : "";

  return {
    index,
    number,
    id: slide.id,
    title: rawTitle || fallbackSlideTitle(number),
    data: slide,
  };
}

/**
 * Builds the normalized slide list from an already-validated deck.
 * Slides keep the order they have in the deck's `slides` array.
 */
export function normalizeDeckSlides(deck: SlideshowDeck): NormalizedSlide[] {
  return deck.slides.map((slide, index) => normalizeSlide(slide, index));
}

/**
 * Extracts a normalized, ordered slide list from a saved deck record.
 *
 * @param savedDeck - raw pasted text, a JSON string, a parsed deck
 *   object, or null/undefined when nothing has been saved yet
 */
export function extractSlides(savedDeck: unknown): ExtractSlidesResult {
  if (isBlankInput(savedDeck)) {
    return EMPTY_RESULT;
  }

  let result: ReturnType<typeof parseAndValidateDeck>;
  try {
    result = parseAndValidateDeck(savedDeck);
  } catch (err) {
    // parseAndValidateDeck is not expected to throw, but a malformed
    // record must never crash the view.
    return {
      status: "invalid",
      slides: [],
      deckTitle: "",
      totalSlides: 0,
      isSingleSlide: false,
      errors: [{ path: "$", message: err instanceof Error ? err.message : String(err) }],
    };
  }

  if (!result.ok) {
    return {
      status: "invalid",
      slides: [],
      deckTitle: "",
      totalSlides: 0,
      isSingleSlide: false,
      errors: result.errors,
    };
  }

  const slides = normalizeDeckSlides(result.deck);

  return {
    status: "ok",
    slides,
    deckTitle: result.deck.metadata.title,
    totalSlides: slides.length,
    isSingleSlide: slides.length === 1,
    errors: [],
  };
}

/**
 * Clamps a requested slide index into the valid range for a deck of
 * `totalSlides` slides, so the view stays in bounds after the deck
 * changes (for example when the user returns to the step after edits).
 * Returns 0 for an empty deck.
 */
export function clampSlideIndex(index: number, totalSlides: number): number {
  if (!Number.isFinite(index) || totalSlides <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), totalSlides - 1);
}