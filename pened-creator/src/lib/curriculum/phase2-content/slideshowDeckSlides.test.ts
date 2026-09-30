import { describe, expect, it } from "vitest";

import { clampSlideIndex, extractSlides, normalizeDeckSlides } from "./slideshowDeckSlides";
import { parseAndValidateDeck } from "./slideshowDeckValidator";

function makeTextElement(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "text",
    position: { x: 10, y: 20 },
    size: { width: 300, height: "auto" },
    content: "Hello",
    ...overrides,
  };
}

function makeSlide(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id}`,
    elements: [makeTextElement(`${id}-el-1`)],
    ...overrides,
  };
}

function makeDeck(slides: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    version: "v1",
    id: "deck-1",
    metadata: { title: "My Deck" },
    slides,
    ...overrides,
  };
}

describe("extractSlides", () => {
  describe("valid decks", () => {
    it("extracts slides in deck order from a parsed object", () => {
      const deck = makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]);
      const result = extractSlides(deck);

      expect(result.status).toBe("ok");
      expect(result.totalSlides).toBe(3);
      expect(result.deckTitle).toBe("My Deck");
      expect(result.isSingleSlide).toBe(false);
      expect(result.errors).toEqual([]);
      expect(result.slides.map((s) => s.id)).toEqual(["a", "b", "c"]);
    });

    it("assigns zero-based index and one-based number", () => {
      const result = extractSlides(makeDeck([makeSlide("a"), makeSlide("b")]));

      expect(result.slides.map((s) => s.index)).toEqual([0, 1]);
      expect(result.slides.map((s) => s.number)).toEqual([1, 2]);
    });

    it("keeps the original slide object untouched in `data`", () => {
      const slide = makeSlide("a", { notes: "speaker notes" });
      const result = extractSlides(makeDeck([slide]));

      expect(result.status).toBe("ok");
      expect(result.slides[0].data).toBe(slide);
    });

    it("parses a JSON string", () => {
      const result = extractSlides(JSON.stringify(makeDeck([makeSlide("a"), makeSlide("b")])));

      expect(result.status).toBe("ok");
      expect(result.totalSlides).toBe(2);
    });

    it("parses pasted text wrapped in markdown fences and prose", () => {
      const raw = `Here is your deck:\n\`\`\`json\n${JSON.stringify(makeDeck([makeSlide("a")]))}\n\`\`\`\nEnjoy!`;
      const result = extractSlides(raw);

      expect(result.status).toBe("ok");
      expect(result.totalSlides).toBe(1);
    });

    it("accepts every supported element type", () => {
      const slide = makeSlide("a", {
        elements: [
          makeTextElement("t"),
          { id: "i", type: "image", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, src: "/a.png" },
          { id: "s", type: "shape", position: { x: 0, y: 0 }, size: { width: 10, height: 10 } },
          { id: "v", type: "video", position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, src: "/a.mp4" },
        ],
      });
      const result = extractSlides(makeDeck([slide]));

      expect(result.status).toBe("ok");
    });
  });

  describe("titles", () => {
    it("falls back to 'Slide N' when the title is missing", () => {
      const result = extractSlides(makeDeck([makeSlide("a", { title: undefined }), makeSlide("b")]));

      expect(result.slides[0].title).toBe("Slide 1");
      expect(result.slides[1].title).toBe("Title b");
    });

    it("falls back to 'Slide N' when the title is blank", () => {
      const result = extractSlides(makeDeck([makeSlide("a"), makeSlide("b", { title: "   " })]));

      expect(result.slides[1].title).toBe("Slide 2");
    });

    it("trims whitespace around a title", () => {
      const result = extractSlides(makeDeck([makeSlide("a", { title: "  Padded  " })]));

      expect(result.slides[0].title).toBe("Padded");
    });
  });

  describe("missing and extra fields", () => {
    it("accepts a slide with an empty elements array", () => {
      const result = extractSlides(makeDeck([makeSlide("a", { elements: [] })]));

      expect(result.status).toBe("ok");
      expect(result.slides[0].data.elements).toEqual([]);
    });

    it("passes unknown extra fields through", () => {
      const result = extractSlides(
        makeDeck([makeSlide("a", { transition: "fade", extra: { nested: true } })], { theme: "dark" }),
      );

      expect(result.status).toBe("ok");
      expect(result.slides[0].data.transition).toBe("fade");
      expect(result.slides[0].data.extra).toEqual({ nested: true });
    });

    it("accepts an object background", () => {
      const result = extractSlides(
        makeDeck([makeSlide("a", { background: { kind: "gradient", css: "linear-gradient(#000,#fff)" } })]),
      );

      expect(result.status).toBe("ok");
    });

    it("is invalid when a slide is missing its id", () => {
      const result = extractSlides(makeDeck([makeSlide("a", { id: undefined })]));

      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.path === "slides[0].id")).toBe(true);
    });

    it("is invalid when a slide is missing its elements array", () => {
      const result = extractSlides(makeDeck([makeSlide("a", { elements: undefined })]));

      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.path === "slides[0].elements")).toBe(true);
    });

    it("is invalid when an element has an unknown type", () => {
      const slide = makeSlide("a", { elements: [makeTextElement("x", { type: "hologram" })] });
      const result = extractSlides(makeDeck([slide]));

      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.path === "slides[0].elements[0].type")).toBe(true);
    });

    it("is invalid when an image element has no src", () => {
      const slide = makeSlide("a", {
        elements: [{ id: "i", type: "image", position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }],
      });
      const result = extractSlides(makeDeck([slide]));

      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.path === "slides[0].elements[0].src")).toBe(true);
    });

    it("is invalid when the version is not v1", () => {
      const result = extractSlides(makeDeck([makeSlide("a")], { version: "v2" }));

      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.path === "version")).toBe(true);
    });

    it("is invalid when metadata.title is missing", () => {
      const result = extractSlides(makeDeck([makeSlide("a")], { metadata: {} }));

      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.path === "metadata.title")).toBe(true);
    });

    it("reports errors for several slides at once", () => {
      const result = extractSlides(
        makeDeck([makeSlide("a", { id: "" }), makeSlide("b", { elements: "nope" })]),
      );

      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.path === "slides[0].id")).toBe(true);
      expect(result.errors.some((e) => e.path === "slides[1].elements")).toBe(true);
    });
  });

  describe("malformed input", () => {
    it("is invalid for text with no JSON object", () => {
      const result = extractSlides("this is not json at all");

      expect(result.status).toBe("invalid");
      expect(result.slides).toEqual([]);
      expect(result.errors[0].path).toBe("$");
    });

    it("is invalid for broken JSON", () => {
      const result = extractSlides('{"version": "v1", "slides": [');

      expect(result.status).toBe("invalid");
      expect(result.errors[0].path).toBe("$");
    });

    it("is invalid when the top-level value is an array", () => {
      const result = extractSlides([makeSlide("a")]);

      expect(result.status).toBe("invalid");
      expect(result.errors[0].path).toBe("$");
    });

    it("is invalid when the top-level value is a number", () => {
      const result = extractSlides(42);

      expect(result.status).toBe("invalid");
    });

    it("is invalid when slides is not an array", () => {
      const result = extractSlides(makeDeck("nope" as unknown as unknown[]));

      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.path === "slides")).toBe(true);
    });

    it("never throws on unusual input", () => {
      const inputs: unknown[] = [true, false, {}, [], () => 1, Symbol.iterator.toString(), NaN];

      for (const input of inputs) {
        expect(() => extractSlides(input)).not.toThrow();
      }
    });
  });

  describe("empty and missing data", () => {
    it("is empty for null", () => {
      const result = extractSlides(null);

      expect(result.status).toBe("empty");
      expect(result.slides).toEqual([]);
      expect(result.totalSlides).toBe(0);
    });

    it("is empty for undefined", () => {
      expect(extractSlides(undefined).status).toBe("empty");
    });

    it("is empty for a blank string", () => {
      expect(extractSlides("").status).toBe("empty");
      expect(extractSlides("   \n\t ").status).toBe("empty");
    });

    it("is invalid (not empty) for a deck with an empty slides array", () => {
      const result = extractSlides(makeDeck([]));

      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.path === "slides")).toBe(true);
    });
  });

  describe("single-slide decks", () => {
    it("flags a deck with exactly one slide", () => {
      const result = extractSlides(makeDeck([makeSlide("only")]));

      expect(result.status).toBe("ok");
      expect(result.totalSlides).toBe(1);
      expect(result.isSingleSlide).toBe(true);
      expect(result.slides).toHaveLength(1);
      expect(result.slides[0].index).toBe(0);
      expect(result.slides[0].number).toBe(1);
    });

    it("does not flag a two-slide deck as single", () => {
      const result = extractSlides(makeDeck([makeSlide("a"), makeSlide("b")]));

      expect(result.isSingleSlide).toBe(false);
    });
  });
});

describe("normalizeDeckSlides", () => {
  it("maps a validated deck to normalized slides", () => {
    const parsed = parseAndValidateDeck(makeDeck([makeSlide("a"), makeSlide("b", { title: undefined })]));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const slides = normalizeDeckSlides(parsed.deck);

    expect(slides).toHaveLength(2);
    expect(slides[0]).toMatchObject({ index: 0, number: 1, id: "a", title: "Title a" });
    expect(slides[1]).toMatchObject({ index: 1, number: 2, id: "b", title: "Slide 2" });
  });
});

describe("clampSlideIndex", () => {
  it("returns the index when it is in range", () => {
    expect(clampSlideIndex(2, 5)).toBe(2);
  });

  it("clamps a negative index to 0", () => {
    expect(clampSlideIndex(-3, 5)).toBe(0);
  });

  it("clamps an index past the end to the last slide", () => {
    expect(clampSlideIndex(10, 5)).toBe(4);
  });

  it("returns 0 for an empty deck", () => {
    expect(clampSlideIndex(3, 0)).toBe(0);
  });

  it("returns 0 for a single-slide deck", () => {
    expect(clampSlideIndex(4, 1)).toBe(0);
  });

  it("returns 0 for non-finite indexes", () => {
    expect(clampSlideIndex(NaN, 5)).toBe(0);
    expect(clampSlideIndex(Infinity, 5)).toBe(0);
  });

  it("truncates fractional indexes", () => {
    expect(clampSlideIndex(2.9, 5)).toBe(2);
  });
});