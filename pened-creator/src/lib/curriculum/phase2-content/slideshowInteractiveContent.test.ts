import { describe, expect, it } from "vitest";

import { replaceSlideInDeck } from "./slideImagesResponse";
import {
  getSlideshowDeck,
  SLIDESHOW_TOOL_ID,
  upsertSlideshowEntry,
  type InteractiveContentEntry,
} from "./slideshowInteractiveContent";
import type { SlideData, SlideshowDeck } from "./slideshowDeckValidator";

function makeSlide(id: string): SlideData {
  return {
    id,
    title: `Title ${id}`,
    elements: [
      {
        id: `${id}-text-1`,
        type: "text",
        position: { x: 10, y: 10 },
        size: { width: 300, height: 60 },
        content: `Content for ${id}`,
      },
    ],
  };
}

function makeDeck(): SlideshowDeck {
  return {
    version: "v1",
    id: "deck-1",
    metadata: { title: "My Deck" },
    slides: [makeSlide("slide-1"), makeSlide("slide-2"), makeSlide("slide-3")],
  } as SlideshowDeck;
}

/** The slide at index 1 with one image added, like an applied "add images" response. */
function makeUpdatedSlide(): SlideData {
  const slide = makeSlide("slide-2");
  return {
    ...slide,
    elements: [
      ...slide.elements,
      {
        id: "slide-2-image-1",
        type: "image",
        position: { x: 400, y: 20 },
        size: { width: 320, height: 240 },
        src: "plant-cell.png",
      },
    ],
  };
}

const QUIZ_ENTRY: InteractiveContentEntry = { tool: "quiz", data: { questions: ["q1", "q2"] } };
const FLASHCARDS_ENTRY: InteractiveContentEntry = { tool: "flashcards", data: { cards: [1, 2, 3] }, version: 2 };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function slideshowEntries(entries: InteractiveContentEntry[]) {
  return entries.filter((entry) => entry.tool === SLIDESHOW_TOOL_ID);
}

describe("saving an updated slide into a lesson's interactive content", () => {
  describe("a lesson that already has a slideshow entry", () => {
    function makeContent(): InteractiveContentEntry[] {
      return [
        structuredClone(QUIZ_ENTRY),
        { tool: SLIDESHOW_TOOL_ID, data: makeDeck(), savedBy: "server", revision: 7 },
        structuredClone(FLASHCARDS_ENTRY),
      ];
    }

    it("leaves exactly one slideshow entry", () => {
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(makeContent(), updatedDeck);

      expect(slideshowEntries(result)).toHaveLength(1);
      expect(result).toHaveLength(3);
    });

    it("stores the updated deck in that entry, with only the edited slide changed", () => {
      const original = makeDeck();
      const updatedDeck = replaceSlideInDeck(original, 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(makeContent(), updatedDeck);
      const saved = getSlideshowDeck(result) as SlideshowDeck;

      expect(saved).toBe(updatedDeck);
      expect(saved.slides[0]).toEqual(original.slides[0]);
      expect(saved.slides[1]).toEqual(makeUpdatedSlide());
      expect(saved.slides[2]).toEqual(original.slides[2]);
    });

    it("keeps the slideshow entry's position and extra fields", () => {
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(makeContent(), updatedDeck);

      expect(result.map((entry) => entry.tool)).toEqual(["quiz", SLIDESHOW_TOOL_ID, "flashcards"]);
      expect(result[1]).toEqual({ tool: SLIDESHOW_TOOL_ID, data: updatedDeck, savedBy: "server", revision: 7 });
    });

    it("passes other tools' entries through untouched and in order", () => {
      const content = makeContent();
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(content, updatedDeck);

      expect(result[0]).toBe(content[0]);
      expect(result[2]).toBe(content[2]);
      expect(result[0]).toEqual(QUIZ_ENTRY);
      expect(result[2]).toEqual(FLASHCARDS_ENTRY);
    });

    it("does not mutate the interactive content or the deck it is given", () => {
      const content = deepFreeze(makeContent());
      const contentBefore = structuredClone(content);
      const deck = deepFreeze(makeDeck());
      const deckBefore = structuredClone(deck);
      const updatedDeck = replaceSlideInDeck(deck, 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(content, updatedDeck);

      expect(content).toEqual(contentBefore);
      expect(deck).toEqual(deckBefore);
      expect(result).not.toBe(content);
    });

    it("is read back as the updated deck by getSlideshowDeck", () => {
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(makeContent(), updatedDeck);

      expect(getSlideshowDeck(result)).toBe(updatedDeck);
    });

    it("stays at one slideshow entry when the same update is saved twice", () => {
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const once = upsertSlideshowEntry(makeContent(), updatedDeck);
      const twice = upsertSlideshowEntry(once, updatedDeck);

      expect(slideshowEntries(twice)).toHaveLength(1);
      expect(twice).toEqual(once);
    });

    it("stays at one slideshow entry across several different slide updates", () => {
      let deck = makeDeck();
      let content = makeContent();

      for (const index of [0, 1, 2]) {
        deck = replaceSlideInDeck(deck, index, { ...makeSlide(`slide-${index + 1}`), title: `Edited ${index}` });
        content = upsertSlideshowEntry(content, deck);
      }

      expect(slideshowEntries(content)).toHaveLength(1);
      expect(content.map((entry) => entry.tool)).toEqual(["quiz", SLIDESHOW_TOOL_ID, "flashcards"]);
      expect((getSlideshowDeck(content) as SlideshowDeck).slides.map((slide) => slide.title)).toEqual([
        "Edited 0",
        "Edited 1",
        "Edited 2",
      ]);
    });
  });

  describe("a lesson with duplicate slideshow entries", () => {
    function makeContentWithDuplicates(): InteractiveContentEntry[] {
      const staleDeck = { ...makeDeck(), id: "stale-deck" };
      return [
        { tool: SLIDESHOW_TOOL_ID, data: makeDeck(), savedBy: "first" },
        structuredClone(QUIZ_ENTRY),
        { tool: SLIDESHOW_TOOL_ID, data: staleDeck, savedBy: "second" },
        structuredClone(FLASHCARDS_ENTRY),
        { tool: SLIDESHOW_TOOL_ID, data: staleDeck, savedBy: "third" },
      ];
    }

    it("collapses them into exactly one slideshow entry", () => {
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(makeContentWithDuplicates(), updatedDeck);

      expect(slideshowEntries(result)).toHaveLength(1);
    });

    it("keeps the first entry's position and extra fields and drops the later ones", () => {
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(makeContentWithDuplicates(), updatedDeck);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ tool: SLIDESHOW_TOOL_ID, data: updatedDeck, savedBy: "first" });
      expect(result.some((entry) => entry.savedBy === "second" || entry.savedBy === "third")).toBe(false);
    });

    it("passes other tools' entries through untouched and in order", () => {
      const content = makeContentWithDuplicates();
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(content, updatedDeck);

      expect(result.map((entry) => entry.tool)).toEqual([SLIDESHOW_TOOL_ID, "quiz", "flashcards"]);
      expect(result[1]).toBe(content[1]);
      expect(result[2]).toBe(content[3]);
    });

    it("reads back the updated deck, not a stale one", () => {
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(makeContentWithDuplicates(), updatedDeck);

      expect((getSlideshowDeck(result) as SlideshowDeck).id).toBe("deck-1");
      expect(getSlideshowDeck(result)).toBe(updatedDeck);
    });

    it("does not mutate the interactive content it is given", () => {
      const content = deepFreeze(makeContentWithDuplicates());
      const contentBefore = structuredClone(content);
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      upsertSlideshowEntry(content, updatedDeck);

      expect(content).toEqual(contentBefore);
      expect(content).toHaveLength(5);
    });
  });

  describe("a lesson with no slideshow entry yet", () => {
    it("appends exactly one slideshow entry after the other tools' entries", () => {
      const content = [structuredClone(QUIZ_ENTRY), structuredClone(FLASHCARDS_ENTRY)];
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(content, updatedDeck);

      expect(result.map((entry) => entry.tool)).toEqual(["quiz", "flashcards", SLIDESHOW_TOOL_ID]);
      expect(result[2]).toEqual({ tool: SLIDESHOW_TOOL_ID, data: updatedDeck });
      expect(slideshowEntries(result)).toHaveLength(1);
    });

    it("creates the single entry when nothing has been saved at all", () => {
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      for (const empty of [null, undefined, "not an array", {}]) {
        const result = upsertSlideshowEntry(empty, updatedDeck);

        expect(result).toEqual([{ tool: SLIDESHOW_TOOL_ID, data: updatedDeck }]);
      }
    });
  });

  describe("entries that are not recognisable slideshow entries", () => {
    it("passes them through untouched and still ends with one slideshow entry", () => {
      const odd: unknown[] = [null, "text", 42, { tool: "quiz" }, { data: "no tool" }];
      const updatedDeck = replaceSlideInDeck(makeDeck(), 1, makeUpdatedSlide());

      const result = upsertSlideshowEntry(odd, updatedDeck);

      expect(result.slice(0, 5)).toEqual(odd);
      expect(slideshowEntries(result)).toHaveLength(1);
      expect(result).toHaveLength(6);
    });
  });
});