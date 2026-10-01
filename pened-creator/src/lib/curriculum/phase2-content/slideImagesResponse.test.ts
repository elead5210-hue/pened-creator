import { describe, expect, it } from "vitest";

import {
  getAllowedImageSrcs,
  parseSlideImagesResponse,
  replaceSlideInDeck,
  type SlideImagesResponseResult,
} from "./slideImagesResponse";
import type { DeckError, SlideData, SlideElementData, SlideshowDeck } from "./slideshowDeckValidator";

const ORIGINAL: SlideData = {
  id: "slide-1",
  title: "Cell walls",
  background: "#ffffff",
  elements: [
    {
      id: "slide-1-text-1",
      type: "text",
      position: { x: 10, y: 10 },
      size: { width: 300, height: 60 },
      content: "Cell walls give plants their shape",
    },
    {
      id: "slide-1-text-2",
      type: "text",
      position: { x: 10, y: 100 },
      size: { width: 300, height: "auto" },
      content: "They are made of cellulose",
    },
  ],
};

const ALLOWED = ["plant-cell.png", "leaf.png"];

function imageEl(id: string, src: string): SlideElementData {
  return {
    id,
    type: "image",
    position: { x: 400, y: 20 },
    size: { width: 320, height: 240 },
    src,
    alt: "An image",
  };
}

/** The original slide with extra elements appended. */
function withElements(...extra: SlideElementData[]): SlideData {
  return { ...ORIGINAL, elements: [...ORIGINAL.elements, ...extra] };
}

function parse(raw: string, original: SlideData = ORIGINAL, allowed: Iterable<string> = ALLOWED) {
  return parseSlideImagesResponse(raw, original, allowed);
}

function expectSuccess(result: SlideImagesResponseResult) {
  if (!result.ok) {
    throw new Error(`Expected success but got errors: ${JSON.stringify(result.errors)}`);
  }
  return result;
}

function failure(result: SlideImagesResponseResult): DeckError[] {
  expect(result.ok).toBe(false);
  expect(result.slide).toBeNull();
  expect(result.addedElements).toEqual([]);
  return result.errors;
}

function paths(errors: DeckError[]): string[] {
  return errors.map((error) => error.path);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

describe("parseSlideImagesResponse", () => {
  describe("valid responses", () => {
    it("accepts a slide with one new uploaded image", () => {
      const updated = withElements(imageEl("slide-1-image-1", "plant-cell.png"));

      const result = expectSuccess(parse(JSON.stringify(updated)));

      expect(result.slide).toEqual(updated);
      expect(result.addedElements).toEqual([imageEl("slide-1-image-1", "plant-cell.png")]);
      expect(result.errors).toEqual([]);
    });

    it("accepts several new images using different uploaded srcs", () => {
      const updated = withElements(
        imageEl("slide-1-image-1", "plant-cell.png"),
        imageEl("slide-1-image-2", "leaf.png"),
      );

      const result = expectSuccess(parse(JSON.stringify(updated)));

      expect(result.addedElements.map((element) => element.id)).toEqual(["slide-1-image-1", "slide-1-image-2"]);
    });

    it("accepts a new image inserted between existing elements", () => {
      const updated: SlideData = {
        ...ORIGINAL,
        elements: [ORIGINAL.elements[0], imageEl("slide-1-image-1", "leaf.png"), ORIGINAL.elements[1]],
      };

      const result = expectSuccess(parse(JSON.stringify(updated)));

      expect(result.addedElements).toHaveLength(1);
    });

    it("accepts the same uploaded src on two different new elements", () => {
      const updated = withElements(
        imageEl("slide-1-image-1", "plant-cell.png"),
        imageEl("slide-1-image-2", "plant-cell.png"),
      );

      expectSuccess(parse(JSON.stringify(updated)));
    });

    it("ignores the order of keys inside existing elements", () => {
      const reordered = {
        elements: [
          {
            content: "Cell walls give plants their shape",
            size: { height: 60, width: 300 },
            position: { y: 10, x: 10 },
            type: "text",
            id: "slide-1-text-1",
          },
          ORIGINAL.elements[1],
          imageEl("slide-1-image-1", "plant-cell.png"),
        ],
        background: "#ffffff",
        title: "Cell walls",
        id: "slide-1",
      };

      expectSuccess(parse(JSON.stringify(reordered)));
    });

    it("does not mutate the original slide", () => {
      const original = deepFreeze(structuredClone(ORIGINAL));
      const updated = withElements(imageEl("slide-1-image-1", "plant-cell.png"));

      expectSuccess(parse(JSON.stringify(updated), original));

      expect(original).toEqual(ORIGINAL);
    });

    it("accepts the allowed srcs as any iterable", () => {
      const updated = withElements(imageEl("slide-1-image-1", "plant-cell.png"));

      expectSuccess(parse(JSON.stringify(updated), ORIGINAL, new Set(["plant-cell.png"])));
    });
  });

  describe("tolerated formatting", () => {
    const updated = withElements(imageEl("slide-1-image-1", "plant-cell.png"));

    it("accepts JSON inside a markdown code fence", () => {
      const raw = "```json\n" + JSON.stringify(updated, null, 2) + "\n```";

      expectSuccess(parse(raw));
    });

    it("accepts JSON inside a fence with no language", () => {
      const raw = "```\n" + JSON.stringify(updated) + "\n```";

      expectSuccess(parse(raw));
    });

    it("accepts JSON surrounded by stray prose", () => {
      const raw = `Here is the updated slide:\n${JSON.stringify(updated, null, 2)}\nLet me know if you need anything else.`;

      expectSuccess(parse(raw));
    });

    it("accepts surrounding whitespace", () => {
      expectSuccess(parse(`\n\n   ${JSON.stringify(updated)}   \n`));
    });
  });

  describe("wrapper objects", () => {
    const updated = withElements(imageEl("slide-1-image-1", "plant-cell.png"));

    it("unwraps { slide: ... }", () => {
      const result = expectSuccess(parse(JSON.stringify({ slide: updated })));

      expect(result.slide).toEqual(updated);
    });

    it("unwraps a deck with a single slide", () => {
      const result = expectSuccess(parse(JSON.stringify({ version: "v1", id: "d", slides: [updated] })));

      expect(result.slide).toEqual(updated);
    });

    it("picks the slide with the original id out of a deck with several slides", () => {
      const other: SlideData = { id: "slide-2", elements: [] };

      const result = expectSuccess(parse(JSON.stringify({ slides: [other, updated] })));

      expect(result.slide.id).toBe("slide-1");
    });

    it("rejects a wrapped deck with several slides and none matching the original id", () => {
      const raw = JSON.stringify({
        slides: [
          { id: "slide-8", elements: [] },
          { id: "slide-9", elements: [] },
        ],
      });

      const errors = failure(parse(raw));

      expect(paths(errors)).toContain("slide.elements");
    });
  });

  describe("unparseable text", () => {
    it("rejects text with no JSON object", () => {
      const errors = failure(parse("Sorry, I can't do that."));

      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("$");
      expect(errors[0].message).toMatch(/no json object/i);
    });

    it("rejects an empty response", () => {
      const errors = failure(parse(""));

      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("$");
    });

    it("rejects a truncated object", () => {
      const errors = failure(parse('{ "id": "slide-1", "elements": ['));

      expect(paths(errors)).toEqual(["$"]);
    });

    it("rejects invalid JSON between braces", () => {
      const errors = failure(parse("{ id: slide-1 }"));

      expect(paths(errors)).toEqual(["$"]);
      expect(errors[0].message).toMatch(/invalid json/i);
    });
  });

  describe("structural problems (reported by the deck validator)", () => {
    it("rejects a slide with no elements array", () => {
      const errors = failure(parse(JSON.stringify({ id: "slide-1", title: "Cell walls" })));

      expect(paths(errors)).toContain("slide.elements");
    });

    it("rejects a new image element with no src, using slide-relative paths", () => {
      const noSrc = { ...imageEl("slide-1-image-1", "plant-cell.png") } as Record<string, unknown>;
      delete noSrc.src;
      const raw = JSON.stringify({ ...ORIGINAL, elements: [...ORIGINAL.elements, noSrc] });

      const errors = failure(parse(raw));

      expect(paths(errors)).toContain("slide.elements[2].src");
      for (const error of errors) {
        expect(error.path).not.toContain("slides[0]");
        expect(error.message).not.toContain("slides[0]");
      }
    });

    it("rejects a new image with a bad position", () => {
      const bad = { ...imageEl("slide-1-image-1", "plant-cell.png"), position: { x: "left", y: 0 } };
      const raw = JSON.stringify({ ...ORIGINAL, elements: [...ORIGINAL.elements, bad] });

      const errors = failure(parse(raw));

      expect(paths(errors)).toContain("slide.elements[2].position.x");
    });

    it("rejects a slide that is not an object once unwrapped", () => {
      const errors = failure(parse(JSON.stringify({ slide: "nope" })));

      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("existing content must be kept", () => {
    it("rejects a response that removes an existing element", () => {
      const updated: SlideData = {
        ...ORIGINAL,
        elements: [ORIGINAL.elements[0], imageEl("slide-1-image-1", "plant-cell.png")],
      };

      const errors = failure(parse(JSON.stringify(updated)));

      expect(paths(errors)).toContain("slide.elements");
      expect(errors.some((error) => /removed/i.test(error.message) && error.message.includes("slide-1-text-2"))).toBe(
        true,
      );
    });

    it("rejects a response that edits an existing element", () => {
      const edited: SlideElementData = { ...ORIGINAL.elements[0], content: "Something else entirely" };
      const updated: SlideData = {
        ...ORIGINAL,
        elements: [edited, ORIGINAL.elements[1], imageEl("slide-1-image-1", "plant-cell.png")],
      };

      const errors = failure(parse(JSON.stringify(updated)));

      expect(paths(errors)).toContain("slide.elements[0]");
      expect(errors.some((error) => /changed/i.test(error.message))).toBe(true);
    });

    it("rejects a response that moves an existing element", () => {
      const moved: SlideElementData = { ...ORIGINAL.elements[1], position: { x: 500, y: 500 } };
      const updated: SlideData = {
        ...ORIGINAL,
        elements: [ORIGINAL.elements[0], moved, imageEl("slide-1-image-1", "plant-cell.png")],
      };

      const errors = failure(parse(JSON.stringify(updated)));

      expect(paths(errors)).toContain("slide.elements[1]");
    });

    it("rejects a response that reorders the existing elements", () => {
      const updated: SlideData = {
        ...ORIGINAL,
        elements: [ORIGINAL.elements[1], ORIGINAL.elements[0], imageEl("slide-1-image-1", "plant-cell.png")],
      };

      const errors = failure(parse(JSON.stringify(updated)));

      expect(errors.some((error) => /reordered/i.test(error.message))).toBe(true);
    });

    it("rejects a changed slide id", () => {
      const updated: SlideData = { ...withElements(imageEl("slide-1-image-1", "plant-cell.png")), id: "slide-9" };

      const errors = failure(parse(JSON.stringify(updated)));

      expect(paths(errors)).toEqual(["slide.id"]);
      expect(errors[0].message).toContain("slide-1");
    });

    it("rejects a changed title", () => {
      const updated: SlideData = { ...withElements(imageEl("slide-1-image-1", "plant-cell.png")), title: "New title" };

      const errors = failure(parse(JSON.stringify(updated)));

      expect(paths(errors)).toEqual(["slide.title"]);
    });

    it("rejects a changed background", () => {
      const updated: SlideData = { ...withElements(imageEl("slide-1-image-1", "plant-cell.png")), background: "#000" };

      const errors = failure(parse(JSON.stringify(updated)));

      expect(paths(errors)).toEqual(["slide.background"]);
    });

    it("rejects a new slide-level field", () => {
      const updated: SlideData = {
        ...withElements(imageEl("slide-1-image-1", "plant-cell.png")),
        transition: "fade",
      };

      const errors = failure(parse(JSON.stringify(updated)));

      expect(paths(errors)).toEqual(["slide.transition"]);
    });

    it("rejects a removed slide-level field", () => {
      const updated = withElements(imageEl("slide-1-image-1", "plant-cell.png")) as Record<string, unknown>;
      delete updated.background;

      const errors = failure(parse(JSON.stringify(updated)));

      expect(paths(errors)).toEqual(["slide.background"]);
    });
  });

  describe("additions must be uploaded images", () => {
    it("rejects a new element that is not an image", () => {
      const text: SlideElementData = {
        id: "slide-1-text-3",
        type: "text",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 20 },
        content: "Extra text",
      };

      const errors = failure(parse(JSON.stringify(withElements(text))));

      expect(paths(errors)).toContain("slide.elements[2].type");
    });

    it("rejects a new shape or video element", () => {
      const shape: SlideElementData = {
        id: "slide-1-shape-1",
        type: "shape",
        position: { x: 0, y: 0 },
        size: { width: 100, height: 20 },
      };

      const errors = failure(parse(JSON.stringify(withElements(shape))));

      expect(paths(errors)).toContain("slide.elements[2].type");
    });

    it("rejects an invented src", () => {
      const errors = failure(parse(JSON.stringify(withElements(imageEl("slide-1-image-1", "invented.png")))));

      expect(paths(errors)).toEqual(["slide.elements[2].src"]);
      expect(errors[0].message).toContain("invented.png");
    });

    it("rejects an external URL that is not an uploaded image", () => {
      const raw = JSON.stringify(withElements(imageEl("slide-1-image-1", "https://example.com/photo.png")));

      const errors = failure(parse(raw));

      expect(paths(errors)).toEqual(["slide.elements[2].src"]);
    });

    it("requires the src to match exactly, including case", () => {
      const errors = failure(parse(JSON.stringify(withElements(imageEl("slide-1-image-1", "Plant-Cell.png")))));

      expect(paths(errors)).toEqual(["slide.elements[2].src"]);
    });

    it("reports every invented src, not just the first", () => {
      const raw = JSON.stringify(
        withElements(imageEl("slide-1-image-1", "a.png"), imageEl("slide-1-image-2", "b.png")),
      );

      const errors = failure(parse(raw));

      expect(paths(errors)).toEqual(["slide.elements[2].src", "slide.elements[3].src"]);
    });
  });

  describe("unique ids", () => {
    it("rejects two new images with the same id", () => {
      const raw = JSON.stringify(
        withElements(imageEl("slide-1-image-1", "plant-cell.png"), imageEl("slide-1-image-1", "leaf.png")),
      );

      const errors = failure(parse(raw));

      expect(paths(errors)).toEqual(["slide.elements[2].id", "slide.elements[3].id"]);
    });

    it("rejects a new image that reuses an existing element's id", () => {
      const raw = JSON.stringify(withElements(imageEl("slide-1-text-1", "plant-cell.png")));

      const errors = failure(parse(raw));

      expect(paths(errors)).toEqual(["slide.elements[2].id"]);
    });
  });

  describe("no new images", () => {
    it("rejects a response identical to the original slide", () => {
      const errors = failure(parse(JSON.stringify(ORIGINAL)));

      expect(paths(errors)).toEqual(["slide.elements"]);
      expect(errors[0].message).toMatch(/doesn't add any images/i);
    });

    it("rejects a response with an empty elements array when the original had none", () => {
      const original: SlideData = { id: "slide-1", elements: [] };

      const errors = failure(parse(JSON.stringify(original), original));

      expect(paths(errors)).toEqual(["slide.elements"]);
    });
  });

  describe("no uploaded images", () => {
    it("rejects every response when there are no allowed srcs", () => {
      const updated = withElements(imageEl("slide-1-image-1", "plant-cell.png"));

      const errors = failure(parse(JSON.stringify(updated), ORIGINAL, []));

      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("$");
      expect(errors[0].message).toMatch(/no uploaded images/i);
    });

    it("reports the missing images before trying to read the response", () => {
      const errors = failure(parse("not json", ORIGINAL, []));

      expect(errors[0].message).toMatch(/no uploaded images/i);
    });
  });

  describe("several problems at once", () => {
    it("reports a removed element and an invented src together", () => {
      const updated: SlideData = {
        ...ORIGINAL,
        elements: [ORIGINAL.elements[0], imageEl("slide-1-image-1", "invented.png")],
      };

      const errors = failure(parse(JSON.stringify(updated)));

      expect(paths(errors)).toContain("slide.elements");
      expect(paths(errors)).toContain("slide.elements[1].src");
    });
  });
});

describe("getAllowedImageSrcs", () => {
  it("returns the srcs of uploaded images only, in image prompt order", () => {
    const lesson = {
      imagePrompts: [
        { id: "img-01", description: "One" },
        { id: "img-02", description: "Two, never uploaded" },
        { id: "img-03", description: "Three" },
      ],
      images: { "img-01": "one.png", "img-03": "three.png" },
    };

    expect(getAllowedImageSrcs(lesson)).toEqual(["one.png", "three.png"]);
  });

  it("returns an empty list when nothing has been uploaded", () => {
    expect(getAllowedImageSrcs({ imagePrompts: [{ id: "img-01" }], images: null })).toEqual([]);
    expect(getAllowedImageSrcs(null)).toEqual([]);
    expect(getAllowedImageSrcs(undefined)).toEqual([]);
  });

  it("can be passed straight to parseSlideImagesResponse", () => {
    const lesson = { imagePrompts: [{ id: "img-01" }], images: { "img-01": "plant-cell.png" } };
    const updated = withElements(imageEl("slide-1-image-1", "plant-cell.png"));

    expectSuccess(parse(JSON.stringify(updated), ORIGINAL, getAllowedImageSrcs(lesson)));
  });
});

describe("replaceSlideInDeck", () => {
  const SLIDE_0: SlideData = { id: "slide-0", title: "Zero", elements: [] };
  const SLIDE_2: SlideData = { id: "slide-2", title: "Two", elements: [] };

  function makeDeck(): SlideshowDeck {
    return {
      version: "v1",
      id: "deck-1",
      title: "My Deck",
      background: "#eeeeee",
      metadata: { title: "My Deck", id: "meta-1" },
      theme: "blue",
      slides: [structuredClone(SLIDE_0), structuredClone(ORIGINAL), structuredClone(SLIDE_2)],
    } as unknown as SlideshowDeck;
  }

  const UPDATED = withElements(imageEl("slide-1-image-1", "plant-cell.png"));

  it("replaces only the slide at the given index", () => {
    const deck = makeDeck();

    const result = replaceSlideInDeck(deck, 1, UPDATED);

    expect(result.slides).toHaveLength(3);
    expect(result.slides[1]).toBe(UPDATED);
    expect(result.slides[0]).toBe(deck.slides[0]);
    expect(result.slides[2]).toBe(deck.slides[2]);
  });

  it("can replace the first and the last slide", () => {
    const deck = makeDeck();

    expect(replaceSlideInDeck(deck, 0, UPDATED).slides.map((slide) => slide.id)).toEqual([
      "slide-1",
      "slide-1",
      "slide-2",
    ]);
    expect(replaceSlideInDeck(deck, 2, UPDATED).slides[2]).toBe(UPDATED);
  });

  it("keeps every other deck field and the metadata untouched", () => {
    const deck = makeDeck();

    const result = replaceSlideInDeck(deck, 1, UPDATED);

    expect(result.version).toBe("v1");
    expect(result.id).toBe("deck-1");
    expect(result.title).toBe("My Deck");
    expect(result.background).toBe("#eeeeee");
    expect(result.metadata).toBe(deck.metadata);
    expect((result as Record<string, unknown>).theme).toBe("blue");
  });

  it("returns a new deck and a new slides array", () => {
    const deck = makeDeck();

    const result = replaceSlideInDeck(deck, 1, UPDATED);

    expect(result).not.toBe(deck);
    expect(result.slides).not.toBe(deck.slides);
  });

  it("never mutates the deck or the slide it is given", () => {
    const deck = deepFreeze(makeDeck());
    const slide = deepFreeze(structuredClone(UPDATED));
    const deckBefore = structuredClone(makeDeck());

    const result = replaceSlideInDeck(deck, 1, slide);

    expect(deck).toEqual(deckBefore);
    expect(deck.slides[1]).toEqual(ORIGINAL);
    expect(result.slides[1]).toEqual(UPDATED);
  });

  it("throws a RangeError for an index outside the deck", () => {
    const deck = makeDeck();

    expect(() => replaceSlideInDeck(deck, -1, UPDATED)).toThrow(RangeError);
    expect(() => replaceSlideInDeck(deck, 3, UPDATED)).toThrow(RangeError);
    expect(() => replaceSlideInDeck(deck, 1.5, UPDATED)).toThrow(RangeError);
    expect(() => replaceSlideInDeck(deck, Number.NaN, UPDATED)).toThrow(RangeError);
  });

  it("works with the result of parseSlideImagesResponse", () => {
    const deck = makeDeck();
    const parsed = expectSuccess(parse(JSON.stringify(UPDATED)));

    const result = replaceSlideInDeck(deck, 1, parsed.slide);

    expect(result.slides[1].elements).toHaveLength(3);
    expect(result.slides[1].elements[2]).toEqual(imageEl("slide-1-image-1", "plant-cell.png"));
  });
});