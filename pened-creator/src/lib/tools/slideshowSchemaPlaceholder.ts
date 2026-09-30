
/**
 * Hardcoded placeholder for the slideshow app's slide-rendering JSON
 * schema. Unlike the tool registry (fetched live from /api/tools via
 * `toolsClient.ts`), this schema isn't served by any API yet - it's a
 * stand-in so the "Slideshow Schema" tab on the Tools Registry page has
 * something real-shaped to display. Replace `SLIDESHOW_SCHEMA_PLACEHOLDER`
 * (and `SLIDESHOW_SCHEMA_PLACEHOLDER_NOTE`) with the actual schema once
 * it's finalized elsewhere - no other code in this file should need to
 * change when that happens.
 */
export const SLIDESHOW_SCHEMA_PLACEHOLDER_NOTE =
  "This is a placeholder schema. The real slideshow schema will be added here once finalized.";

export const SLIDESHOW_SCHEMA_PLACEHOLDER = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "SlideshowDeck (placeholder)",
  description: SLIDESHOW_SCHEMA_PLACEHOLDER_NOTE,
  type: "object",
  required: ["title", "slides"],
  properties: {
    title: {
      type: "string",
      description: "Display title for the slideshow deck.",
    },
    slides: {
      type: "array",
      description: "Ordered list of slides in the deck.",
      items: {
        type: "object",
        required: ["id", "heading"],
        properties: {
          id: {
            type: "string",
            description: "Stable identifier for this slide.",
          },
          heading: {
            type: "string",
            description: "Short heading text shown at the top of the slide.",
          },
          body: {
            type: "string",
            description: "Main text content of the slide.",
          },
          imageUrl: {
            type: "string",
            description: "Optional URL of an image to display on the slide.",
          },
        },
      },
    },
  },
} as const;