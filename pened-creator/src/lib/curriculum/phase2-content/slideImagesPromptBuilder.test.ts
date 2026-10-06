import { describe, expect, it } from "vitest";

import { buildSlideImagesPrompt, getUploadedImageDescriptions } from "./slideImagesPromptBuilder";

function makeSlide(overrides: Record<string, unknown> = {}) {
  return {
    id: "slide-1",
    title: "Photosynthesis",
    elements: [
      {
        id: "slide-1-text-1",
        type: "text",
        position: { x: 40, y: 40 },
        size: { width: 500, height: "auto" },
        content: "Plants convert light into energy.",
      },
    ],
    ...overrides,
  };
}

function makeLesson(overrides: Record<string, unknown> = {}) {
  return {
    imagePrompts: [
      {
        id: "img-01",
        sourceTool: "introduction",
        description: "A green leaf in sunlight",
        altText: "Leaf in sunlight",
      },
      {
        id: "img-02",
        sourceTool: "vocabulary:chlorophyll",
        description: "Close-up of chloroplasts",
        altText: "Chloroplasts under a microscope",
      },
    ],
    images: { "img-01": "img-01.png", "img-02": "img-02.png" },
    ...overrides,
  };
}

describe("getUploadedImageDescriptions", () => {
  it("joins image prompts with uploaded images by id, in prompt order", () => {
    const result = getUploadedImageDescriptions(makeLesson());

    expect(result).toEqual([
      {
        id: "img-01",
        description: "A green leaf in sunlight",
        altText: "Leaf in sunlight",
        src: "img-01.png",
        sourceTool: "introduction",
      },
      {
        id: "img-02",
        description: "Close-up of chloroplasts",
        altText: "Chloroplasts under a microscope",
        src: "img-02.png",
        sourceTool: "vocabulary:chlorophyll",
      },
    ]);
  });

  it("excludes prompts that have no uploaded image", () => {
    const result = getUploadedImageDescriptions(makeLesson({ images: { "img-02": "img-02.png" } }));

    expect(result.map((image) => image.id)).toEqual(["img-02"]);
  });

  it("excludes prompts whose uploaded filename is blank or not a string", () => {
    const result = getUploadedImageDescriptions(makeLesson({ images: { "img-01": "  ", "img-02": 5 } }));

    expect(result).toEqual([]);
  });

  it("ignores uploaded images that have no matching prompt", () => {
    const result = getUploadedImageDescriptions(makeLesson({ images: { "img-01": "a.png", orphan: "b.png" } }));

    expect(result.map((image) => image.id)).toEqual(["img-01"]);
  });

  it("returns an empty array for missing or malformed input", () => {
    expect(getUploadedImageDescriptions(null)).toEqual([]);
    expect(getUploadedImageDescriptions(undefined)).toEqual([]);
    expect(getUploadedImageDescriptions({})).toEqual([]);
    expect(getUploadedImageDescriptions({ imagePrompts: "nope" })).toEqual([]);
    expect(getUploadedImageDescriptions({ imagePrompts: [null, 3, { description: "no id" }], images: {} })).toEqual([]);
  });

  it("tolerates a null images map", () => {
    expect(getUploadedImageDescriptions({ imagePrompts: [{ id: "img-01" }], images: null })).toEqual([]);
  });
});

describe("buildSlideImagesPrompt", () => {
  describe("slide data", () => {
    it("embeds the slide JSON", () => {
      const slide = makeSlide();
      const { prompt } = buildSlideImagesPrompt(slide, makeLesson());

      expect(prompt).toContain("SLIDE DATA");
      expect(prompt).toContain(JSON.stringify(slide, null, 2));
      expect(prompt).toContain("Plants convert light into energy.");
    });

    it("does not mutate the slide", () => {
      const slide = makeSlide();
      const before = JSON.stringify(slide);

      buildSlideImagesPrompt(slide, makeLesson());

      expect(JSON.stringify(slide)).toBe(before);
    });

    it("does not throw for a malformed slide", () => {
      expect(() => buildSlideImagesPrompt(null, makeLesson())).not.toThrow();
      expect(() => buildSlideImagesPrompt(undefined, makeLesson())).not.toThrow();
      expect(() => buildSlideImagesPrompt("nope", makeLesson())).not.toThrow();
    });
  });

  describe("uploaded images", () => {
    it("lists each uploaded image with id, src, description and alt text", () => {
      const { prompt, images, hasImages } = buildSlideImagesPrompt(makeSlide(), makeLesson());

      expect(hasImages).toBe(true);
      expect(images).toHaveLength(2);
      expect(prompt).toContain("UPLOADED IMAGES");
      expect(prompt).toContain("id: img-01");
      expect(prompt).toContain("src: img-01.png");
      expect(prompt).toContain("description: A green leaf in sunlight");
      expect(prompt).toContain("altText: Leaf in sunlight");
      expect(prompt).toContain("id: img-02");
      expect(prompt).toContain("src: img-02.png");
      expect(prompt).toContain("description: Close-up of chloroplasts");
    });

    it("lists the exact background-removed image URL as the src when one exists", () => {
      const noBgUrl = "https://cdn.example.com/lessons/img-01-nobg.png?v=2";
      const { prompt, images } = buildSlideImagesPrompt(
        makeSlide(),
        makeLesson({ imagesNoBg: { "img-01": noBgUrl } }),
      );

      expect(images.find((image) => image.id === "img-01")?.src).toBe(noBgUrl);
      expect(prompt).toContain(`src: ${noBgUrl}`);
      expect(prompt).not.toContain("src: img-01.png");
      // An image without a background-removed version keeps its uploaded src.
      expect(prompt).toContain("src: img-02.png");
    });

    it("falls back to the uploaded src when the background-removed value is blank or not a string", () => {
      const { images } = buildSlideImagesPrompt(
        makeSlide(),
        makeLesson({ imagesNoBg: { "img-01": "  ", "img-02": 7 } }),
      );

      expect(images.map((image) => image.src)).toEqual(["img-01.png", "img-02.png"]);
    });

    it("does not list images that were never uploaded", () => {
      const { prompt, images } = buildSlideImagesPrompt(makeSlide(), makeLesson({ images: { "img-01": "img-01.png" } }));

      expect(images.map((image) => image.id)).toEqual(["img-01"]);
      expect(prompt).not.toContain("id: img-02");
      expect(prompt).not.toContain("Close-up of chloroplasts");
    });
  });

  describe("no uploaded images", () => {
    it("reports no images and tells the AI to return the slide unchanged", () => {
      const { prompt, images, hasImages } = buildSlideImagesPrompt(makeSlide(), makeLesson({ images: {} }));

      expect(hasImages).toBe(false);
      expect(images).toEqual([]);
      expect(prompt).toContain("No images have been uploaded for this lesson yet.");
      expect(prompt).toContain("NO IMAGES ARE AVAILABLE");
      expect(prompt).toContain("Return the slide unchanged");
    });

    it("handles a missing lesson", () => {
      const { prompt, hasImages } = buildSlideImagesPrompt(makeSlide(), null);

      expect(hasImages).toBe(false);
      expect(prompt).toContain("NO IMAGES ARE AVAILABLE");
    });

    it("does not include the no-images instruction when images exist", () => {
      const { prompt } = buildSlideImagesPrompt(makeSlide(), makeLesson());

      expect(prompt).not.toContain("NO IMAGES ARE AVAILABLE");
      expect(prompt).not.toContain("No images have been uploaded");
    });
  });

  describe("existing image elements", () => {
    it("says the slide has no image elements when there are none", () => {
      const { prompt } = buildSlideImagesPrompt(makeSlide(), makeLesson());

      expect(prompt).toContain("This slide does not contain any image elements yet.");
    });

    it("mentions an existing image element and asks to keep it", () => {
      const slide = makeSlide({
        elements: [
          {
            id: "existing-img",
            type: "image",
            position: { x: 0, y: 0 },
            size: { width: 100, height: 100 },
            src: "img-01.png",
          },
        ],
      });
      const { prompt } = buildSlideImagesPrompt(slide, makeLesson());

      expect(prompt).toContain("This slide already contains 1 image element.");
      expect(prompt).toContain("Keep every existing element exactly as it is");
      expect(prompt).not.toContain("does not contain any image elements yet");
    });

    it("pluralizes the count of existing image elements", () => {
      const image = (id: string) => ({
        id,
        type: "image",
        position: { x: 0, y: 0 },
        size: { width: 10, height: 10 },
        src: "img-01.png",
      });
      const { prompt } = buildSlideImagesPrompt(makeSlide({ elements: [image("a"), image("b")] }), makeLesson());

      expect(prompt).toContain("This slide already contains 2 image elements.");
    });

    it("tolerates a slide whose elements are missing or not an array", () => {
      expect(buildSlideImagesPrompt({ id: "s" }, makeLesson()).prompt).toContain("does not contain any image elements");
      expect(buildSlideImagesPrompt({ id: "s", elements: "x" }, makeLesson()).prompt).toContain(
        "does not contain any image elements",
      );
    });
  });

  describe("schema rules", () => {
    it("restates the image element rules used by the deck validator", () => {
      const { prompt } = buildSlideImagesPrompt(makeSlide(), makeLesson());

      expect(prompt).toContain("IMAGE ELEMENT RULES");
      expect(prompt).toContain('"type" must be exactly "image"');
      expect(prompt).toContain('"id" is required');
      expect(prompt).toContain('"src" is required');
      expect(prompt).toContain('"position" is required');
      expect(prompt).toContain('"size" is required');
      expect(prompt).toContain('the literal string "auto"');
    });

    it("tells the AI to use only uploaded images and never invent a src", () => {
      const { prompt } = buildSlideImagesPrompt(makeSlide(), makeLesson());

      expect(prompt).toContain("Use ONLY images from the UPLOADED IMAGES list");
      expect(prompt).toContain("Never invent, guess or modify a src");
    });

    it("tells the AI not to change existing slide fields", () => {
      const { prompt } = buildSlideImagesPrompt(makeSlide(), makeLesson());

      expect(prompt).toContain('do not change the slide\'s "id", "title", "background"');
    });

    it("includes an example image element", () => {
      const { prompt } = buildSlideImagesPrompt(makeSlide(), makeLesson());

      expect(prompt).toContain("Example image element:");
      expect(prompt).toContain('"type": "image"');
    });
  });

  describe("response format", () => {
    it("asks for a single JSON object with no prose or code fences", () => {
      const { prompt } = buildSlideImagesPrompt(makeSlide(), makeLesson());

      expect(prompt).toContain("RESPONSE FORMAT");
      expect(prompt).toContain("ONLY the complete updated slide as a single valid JSON object");
      expect(prompt).toContain("Do not include any prose");
      expect(prompt).toContain("markdown code fences");
    });

    it("puts the response format last", () => {
      const { prompt } = buildSlideImagesPrompt(makeSlide(), makeLesson());

      expect(prompt.indexOf("RESPONSE FORMAT")).toBeGreaterThan(prompt.indexOf("SLIDE DATA"));
      expect(prompt.indexOf("SLIDE DATA")).toBeGreaterThan(prompt.indexOf("UPLOADED IMAGES"));
    });
  });

  it("is deterministic", () => {
    const first = buildSlideImagesPrompt(makeSlide(), makeLesson()).prompt;
    const second = buildSlideImagesPrompt(makeSlide(), makeLesson()).prompt;

    expect(first).toBe(second);
  });
});