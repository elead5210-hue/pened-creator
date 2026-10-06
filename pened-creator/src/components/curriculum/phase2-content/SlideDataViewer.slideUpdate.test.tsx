import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { SlideDataViewer } from "./SlideDataViewer";
import type { SlideshowDeck } from "@/lib/curriculum/phase2-content/slideshowDeckValidator";

const mocks = vi.hoisted(() => ({
  /** What each click on the mock modal's "Mock apply" button ended in, in order. */
  outcomes: [] as string[],
  /** The image element the mock modal adds to the slide it is given. */
  imageElement: {
    id: "mock-image-1",
    type: "image",
    position: { x: 400, y: 20 },
    size: { width: 320, height: 240 },
    src: "plant-cell.png",
  },
}));

// The real modal has no paste area yet, so replace it with a stand-in that
// calls onApplySlide the way the paste area will: with the slide it was given
// plus one new image element. It records whether that call resolved or
// rejected, so tests can check what the caller of onApplySlide sees.
vi.mock("./SlideImagesPromptModal", async () => {
  const React = await import("react");

  return {
    SlideImagesPromptModal: (props: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      slide: { elements: unknown[] };
      slideNumber?: number;
      onApplySlide?: (slide: unknown) => Promise<void>;
    }) => {
      if (!props.open) return null;

      return React.createElement(
        "div",
        { role: "dialog", "aria-label": `Mock prompt modal for slide ${props.slideNumber}` },
        React.createElement("span", { "data-testid": "mock-has-apply" }, props.onApplySlide ? "yes" : "no"),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: async () => {
              const updated = { ...props.slide, elements: [...props.slide.elements, mocks.imageElement] };
              try {
                await props.onApplySlide?.(updated);
                mocks.outcomes.push("resolved");
              } catch (err) {
                mocks.outcomes.push(`rejected:${err instanceof Error ? err.message : String(err)}`);
              }
            },
          },
          "Mock apply",
        ),
        React.createElement(
          "button",
          { type: "button", onClick: () => props.onOpenChange(false) },
          "Mock close",
        ),
      );
    },
  };
});

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: toastMocks.success, error: toastMocks.error },
}));

const LESSON = {
  id: "proj-1:node-9",
  project_id: "proj-1",
  lesson_node_id: "node-9",
  imagePrompts: [{ id: "img-01", description: "A labelled diagram of a plant cell" }],
  images: { "img-01": "plant-cell.png" },
};

function makeSlide(id: string) {
  return {
    id,
    title: `Title ${id}`,
    elements: [
      {
        id: `${id}-el-1`,
        type: "text",
        position: { x: 10, y: 20 },
        size: { width: 300, height: "auto" },
        content: `Content for ${id}`,
      },
    ],
  };
}

function makeDeck(slides: unknown[]) {
  return {
    version: "v1",
    id: "deck-1",
    metadata: { title: "My Deck" },
    slides,
  };
}

/** A slide with its text element plus two image elements. */
function makeSlideWithImages(id: string) {
  const slide = makeSlide(id);
  return {
    ...slide,
    elements: [
      ...slide.elements,
      {
        id: `${id}-img-1`,
        type: "image",
        position: { x: 400, y: 20 },
        size: { width: 320, height: 240 },
        src: "plant-cell.png",
      },
      {
        id: `${id}-img-2`,
        type: "image",
        position: { x: 400, y: 300 },
        size: { width: 200, height: 200 },
        src: "leaf.png",
      },
    ],
  };
}

/** A copy of a JSON value with every object's keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, child]) => [key, reverseKeys(child)]),
    );
  }
  return value;
}

type SaveFn = (deck: SlideshowDeck) => Promise<void>;

/** Renders the viewer and gives back a way to hand it a new deck, like the route does after a save. */
function renderViewer(deck: unknown, onSlideUpdated?: SaveFn) {
  const utils = render(<SlideDataViewer slideshowDeck={deck} lesson={LESSON} onSlideUpdated={onSlideUpdated} />);

  return {
    ...utils,
    setDeck: (next: unknown) =>
      utils.rerender(<SlideDataViewer slideshowDeck={next} lesson={LESSON} onSlideUpdated={onSlideUpdated} />),
  };
}

function goToNextSlide() {
  fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
}

function openModalForSlide(slideNumber: number) {
  fireEvent.click(screen.getByRole("button", { name: `Add images to slide ${slideNumber}` }));
}

async function applyInModal(expectedOutcomes = 1) {
  fireEvent.click(screen.getByRole("button", { name: "Mock apply" }));
  await waitFor(() => expect(mocks.outcomes).toHaveLength(expectedOutcomes));
}

function expectOnSlide(slideNumber: number, total: number, content: string) {
  expect(screen.getByText(content)).toBeInTheDocument();
  expect(screen.getAllByText(`Slide ${slideNumber} of ${total}`).length).toBeGreaterThan(0);
}

describe("SlideDataViewer: saving an updated slide", () => {
  beforeEach(() => {
    mocks.outcomes.length = 0;
  });

  describe("the deck handed to onSlideUpdated", () => {
    it("replaces only the slide currently shown", async () => {
      const slides = [makeSlide("a"), makeSlide("b"), makeSlide("c")];
      const deck = makeDeck(slides);
      const deckBefore = structuredClone(deck);
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      renderViewer(deck, onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();

      expect(onSlideUpdated).toHaveBeenCalledTimes(1);
      const savedDeck = onSlideUpdated.mock.calls[0][0];
      expect(savedDeck.slides).toHaveLength(3);
      expect(savedDeck.slides[0]).toEqual(slides[0]);
      expect(savedDeck.slides[1]).toEqual({
        ...slides[1],
        elements: [...slides[1].elements, mocks.imageElement],
      });
      expect(savedDeck.slides[2]).toEqual(slides[2]);
      expect(mocks.outcomes).toEqual(["resolved"]);
      // The deck the viewer was given is not changed.
      expect(deck).toEqual(deckBefore);
    });

    it("keeps the deck's other fields and metadata", async () => {
      const deck = { ...makeDeck([makeSlide("a"), makeSlide("b")]), title: "Deck title", theme: "blue" };
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      renderViewer(deck, onSlideUpdated);

      openModalForSlide(1);
      await applyInModal();

      const savedDeck = onSlideUpdated.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(savedDeck.version).toBe("v1");
      expect(savedDeck.id).toBe("deck-1");
      expect(savedDeck.title).toBe("Deck title");
      expect(savedDeck.theme).toBe("blue");
      expect(savedDeck.metadata).toEqual({ title: "My Deck" });
    });

    it("works from a deck saved as JSON text", async () => {
      const slides = [makeSlide("a"), makeSlide("b")];
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      renderViewer(JSON.stringify(makeDeck(slides)), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();

      const savedDeck = onSlideUpdated.mock.calls[0][0];
      expect(savedDeck.slides[0]).toEqual(slides[0]);
      expect(savedDeck.slides[1].elements).toHaveLength(2);
    });
  });

  describe("when the saved deck comes back", () => {
    it("stays on the edited slide", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();
      setDeck(onSlideUpdated.mock.calls[0][0]);

      expectOnSlide(2, 3, "Content for b");
      expect(screen.queryByText("Content for a")).toBeNull();
    });

    it("keeps the modal open", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();
      setDeck(onSlideUpdated.mock.calls[0][0]);

      expect(screen.getByRole("dialog", { name: "Mock prompt modal for slide 2" })).toBeInTheDocument();
    });

    it("shows the updated slide's new image element", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();
      setDeck(onSlideUpdated.mock.calls[0][0]);

      expect(screen.getByText("plant-cell.png")).toBeInTheDocument();
    });

    it("stays on the edited slide even when the server returns the keys in a different order", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();

      const savedDeck = onSlideUpdated.mock.calls[0][0];
      const reordered = reverseKeys(savedDeck);
      expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(savedDeck));
      setDeck(reordered);

      expectOnSlide(2, 3, "Content for b");
      expect(screen.getByRole("dialog", { name: "Mock prompt modal for slide 2" })).toBeInTheDocument();
    });

    it("stays on the edited slide when the deck comes back as JSON text", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();
      setDeck(JSON.stringify(onSlideUpdated.mock.calls[0][0]));

      expectOnSlide(2, 3, "Content for b");
    });

    it("still resets when a different deck is saved afterwards", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();
      setDeck(onSlideUpdated.mock.calls[0][0]);
      expectOnSlide(2, 3, "Content for b");

      setDeck(makeDeck([makeSlide("x"), makeSlide("y"), makeSlide("z")]));

      expectOnSlide(1, 3, "Content for x");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("a deck re-saved from somewhere else", () => {
    it("resets to the first slide", () => {
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]), vi.fn<SaveFn>());

      goToNextSlide();
      goToNextSlide();
      expectOnSlide(3, 3, "Content for c");

      setDeck(makeDeck([makeSlide("x"), makeSlide("y"), makeSlide("z")]));

      expectOnSlide(1, 3, "Content for x");
    });

    it("closes the modal", () => {
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b")]), vi.fn<SaveFn>());

      goToNextSlide();
      openModalForSlide(2);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      setDeck(makeDeck([makeSlide("x"), makeSlide("y")]));

      expect(screen.queryByRole("dialog")).toBeNull();
      expectOnSlide(1, 2, "Content for x");
    });

    it("resets even when onSlideUpdated is not provided", () => {
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b")]));

      goToNextSlide();
      setDeck(makeDeck([makeSlide("x"), makeSlide("y")]));

      expectOnSlide(1, 2, "Content for x");
    });

    it("still resets after an update was saved but never came back as the prop", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();

      // A different deck arrives instead of the one that was saved.
      setDeck(makeDeck([makeSlide("x"), makeSlide("y"), makeSlide("z")]));

      expectOnSlide(1, 3, "Content for x");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("a failed save", () => {
    it("rejects to the caller with the original error", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockRejectedValue(new Error("Your session expired."));
      renderViewer(makeDeck([makeSlide("a"), makeSlide("b")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();

      expect(onSlideUpdated).toHaveBeenCalledTimes(1);
      expect(mocks.outcomes).toEqual(["rejected:Your session expired."]);
    });

    it("leaves the view on the same slide with the modal open", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockRejectedValue(new Error("Network error"));
      renderViewer(makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();

      expectOnSlide(2, 3, "Content for b");
      expect(screen.getByRole("dialog", { name: "Mock prompt modal for slide 2" })).toBeInTheDocument();
      // Nothing was added to the slide shown.
      expect(screen.queryByText("plant-cell.png")).toBeNull();
    });

    it("can be retried and then succeeds", async () => {
      const onSlideUpdated = vi
        .fn<SaveFn>()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(undefined);
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal(1);
      await applyInModal(2);
      setDeck(onSlideUpdated.mock.calls[1][0]);

      expect(mocks.outcomes).toEqual(["rejected:Network error", "resolved"]);
      expectOnSlide(2, 2, "Content for b");
    });

    it("does not stop a later, genuine reset", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockRejectedValue(new Error("Network error"));
      const { setDeck } = renderViewer(makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]), onSlideUpdated);

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();
      expectOnSlide(2, 3, "Content for b");

      // The deck that failed to save turns up later from somewhere else (for
      // example saved in another tab). That is a genuine change, so it resets.
      setDeck(onSlideUpdated.mock.calls[0][0]);

      expectOnSlide(1, 3, "Content for a");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("resetting a slide", () => {
    beforeEach(() => {
      toastMocks.success.mockReset();
      toastMocks.error.mockReset();
    });

    function openResetDialog() {
      fireEvent.click(screen.getByRole("button", { name: "Reset slide" }));
      return screen.getByRole("alertdialog");
    }

    function confirmReset() {
      const dialog = openResetDialog();
      fireEvent.click(within(dialog).getByRole("button", { name: "Reset slide" }));
    }

    it("asks for confirmation and saves nothing until confirmed", () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      renderViewer(makeDeck([makeSlide("a"), makeSlideWithImages("b")]), onSlideUpdated);

      goToNextSlide();
      const dialog = openResetDialog();

      expect(dialog).toBeInTheDocument();
      expect(onSlideUpdated).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(onSlideUpdated).not.toHaveBeenCalled();
      expect(toastMocks.success).not.toHaveBeenCalled();
      expect(toastMocks.error).not.toHaveBeenCalled();
    });

    it("removes the image elements from the current slide only", async () => {
      const slides = [makeSlideWithImages("a"), makeSlideWithImages("b"), makeSlideWithImages("c")];
      const deck = makeDeck(slides);
      const deckBefore = structuredClone(deck);
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      renderViewer(deck, onSlideUpdated);

      goToNextSlide();
      confirmReset();
      await waitFor(() => expect(onSlideUpdated).toHaveBeenCalledTimes(1));

      const savedDeck = onSlideUpdated.mock.calls[0][0];
      expect(savedDeck.slides).toHaveLength(3);
      expect(savedDeck.slides[0]).toEqual(slides[0]);
      expect(savedDeck.slides[2]).toEqual(slides[2]);
      expect(savedDeck.slides[1].elements).toEqual([makeSlide("b").elements[0]]);
      // The deck the viewer was given is not changed.
      expect(deck).toEqual(deckBefore);
    });

    it("keeps the slide's non-image elements and other fields", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      renderViewer(makeDeck([makeSlideWithImages("a")]), onSlideUpdated);

      confirmReset();
      await waitFor(() => expect(onSlideUpdated).toHaveBeenCalledTimes(1));

      const savedSlide = onSlideUpdated.mock.calls[0][0].slides[0] as unknown as Record<string, unknown>;
      expect(savedSlide.id).toBe("a");
      expect(savedSlide.title).toBe("Title a");
      expect(savedSlide.elements).toEqual(makeSlide("a").elements);
    });

    it("stays on the same slide and shows no images once the saved deck comes back", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      const { setDeck } = renderViewer(
        makeDeck([makeSlide("a"), makeSlideWithImages("b"), makeSlide("c")]),
        onSlideUpdated,
      );

      goToNextSlide();
      expect(screen.getByText("plant-cell.png")).toBeInTheDocument();
      confirmReset();
      await waitFor(() => expect(onSlideUpdated).toHaveBeenCalledTimes(1));
      setDeck(onSlideUpdated.mock.calls[0][0]);

      expectOnSlide(2, 3, "Content for b");
      expect(screen.queryByText("plant-cell.png")).toBeNull();
      expect(screen.queryByText("leaf.png")).toBeNull();
    });

    it("reports success", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockResolvedValue(undefined);
      renderViewer(makeDeck([makeSlideWithImages("a")]), onSlideUpdated);

      confirmReset();

      await waitFor(() => expect(toastMocks.success).toHaveBeenCalledTimes(1));
      expect(toastMocks.error).not.toHaveBeenCalled();
    });

    it("reports failure with the error and leaves the slide as it was", async () => {
      const onSlideUpdated = vi.fn<SaveFn>().mockRejectedValue(new Error("Network error"));
      renderViewer(makeDeck([makeSlide("a"), makeSlideWithImages("b")]), onSlideUpdated);

      goToNextSlide();
      confirmReset();

      await waitFor(() => expect(toastMocks.error).toHaveBeenCalledTimes(1));
      expect(toastMocks.error.mock.calls[0][0]).toContain("Network error");
      expect(toastMocks.success).not.toHaveBeenCalled();
      expectOnSlide(2, 2, "Content for b");
      expect(screen.getByText("plant-cell.png")).toBeInTheDocument();
    });

    it("is not offered without onSlideUpdated", () => {
      renderViewer(makeDeck([makeSlideWithImages("a")]));

      expect(screen.queryByRole("button", { name: "Reset slide" })).toBeNull();
    });
  });

  describe("without onSlideUpdated", () => {
    it("gives the modal no apply handler", () => {
      renderViewer(makeDeck([makeSlide("a"), makeSlide("b")]));

      openModalForSlide(1);

      expect(screen.getByTestId("mock-has-apply")).toHaveTextContent("no");
    });

    it("gives the modal an apply handler when onSlideUpdated is provided", () => {
      renderViewer(makeDeck([makeSlide("a"), makeSlide("b")]), vi.fn<SaveFn>().mockResolvedValue(undefined));

      openModalForSlide(1);

      expect(screen.getByTestId("mock-has-apply")).toHaveTextContent("yes");
    });

    it("does nothing and does not reset when the modal's apply button is used", async () => {
      renderViewer(makeDeck([makeSlide("a"), makeSlide("b")]));

      goToNextSlide();
      openModalForSlide(2);
      await applyInModal();

      expect(mocks.outcomes).toEqual(["resolved"]);
      expectOnSlide(2, 2, "Content for b");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});