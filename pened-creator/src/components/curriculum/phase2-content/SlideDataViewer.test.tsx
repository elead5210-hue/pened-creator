import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SlideDataViewer } from "./SlideDataViewer";

function makeSlide(id: string, overrides: Record<string, unknown> = {}) {
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

const LESSON = {
  id: "proj-1:node-9",
  project_id: "proj-1",
  lesson_node_id: "node-9",
  imagePrompts: [
    {
      id: "img-01",
      sourceTool: "slideshow",
      description: "A labelled diagram of a plant cell",
      altText: "Plant cell diagram",
    },
  ],
  images: { "img-01": "plant-cell.png" },
};

const LESSON_WITHOUT_IMAGES = {
  id: "proj-1:node-9",
  project_id: "proj-1",
  lesson_node_id: "node-9",
  imagePrompts: [{ id: "img-01", description: "A labelled diagram of a plant cell" }],
  images: null,
};

function getAddImagesButton(slideNumber: number) {
  return screen.getByRole("button", { name: `Add images to slide ${slideNumber}` });
}

function getPromptText() {
  return (screen.getByRole("textbox", { name: /generated prompt/i }) as HTMLTextAreaElement).value;
}

function getPrevious() {
  return screen.getByRole("button", { name: "Previous slide" });
}

function getNext() {
  return screen.getByRole("button", { name: "Next slide" });
}

describe("SlideDataViewer", () => {
  describe("navigation", () => {
    it("shows the first slide's data on load", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])} />);

      expect(screen.getAllByText("Title a").length).toBeGreaterThan(0);
      expect(screen.getByText("Content for a")).toBeTruthy();
      expect(screen.queryByText("Content for b")).toBeNull();
      expect(screen.getAllByText("Slide 1 of 3").length).toBeGreaterThan(0);
    });

    it("moves to the next slide when Next is clicked", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])} />);

      fireEvent.click(getNext());

      expect(screen.getByText("Content for b")).toBeTruthy();
      expect(screen.queryByText("Content for a")).toBeNull();
      expect(screen.getAllByText("Slide 2 of 3").length).toBeGreaterThan(0);
    });

    it("moves back to the previous slide when Previous is clicked", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])} />);

      fireEvent.click(getNext());
      fireEvent.click(getNext());
      expect(screen.getByText("Content for c")).toBeTruthy();

      fireEvent.click(getPrevious());

      expect(screen.getByText("Content for b")).toBeTruthy();
      expect(screen.getAllByText("Slide 2 of 3").length).toBeGreaterThan(0);
    });

    it("walks through every slide in deck order", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])} />);

      expect(screen.getByText("Content for a")).toBeTruthy();
      fireEvent.click(getNext());
      expect(screen.getByText("Content for b")).toBeTruthy();
      fireEvent.click(getNext());
      expect(screen.getByText("Content for c")).toBeTruthy();
    });

    it("moves between slides with the arrow keys", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      const nav = screen.getByRole("navigation", { name: "Slide navigation" });

      fireEvent.keyDown(nav, { key: "ArrowRight" });
      expect(screen.getByText("Content for b")).toBeTruthy();

      fireEvent.keyDown(nav, { key: "ArrowLeft" });
      expect(screen.getByText("Content for a")).toBeTruthy();
    });

    it("starts on initialIndex, clamped into range", () => {
      const deck = makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")]);
      const { unmount } = render(<SlideDataViewer slideshowDeck={deck} initialIndex={1} />);
      expect(screen.getByText("Content for b")).toBeTruthy();
      unmount();

      render(<SlideDataViewer slideshowDeck={deck} initialIndex={99} />);
      expect(screen.getByText("Content for c")).toBeTruthy();
    });
  });

  describe("disabled states", () => {
    it("disables Previous on the first slide", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      expect((getPrevious() as HTMLButtonElement).disabled).toBe(true);
      expect((getNext() as HTMLButtonElement).disabled).toBe(false);
    });

    it("disables Next on the last slide", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      fireEvent.click(getNext());

      expect((getNext() as HTMLButtonElement).disabled).toBe(true);
      expect((getPrevious() as HTMLButtonElement).disabled).toBe(false);
    });

    it("enables both buttons on a middle slide", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])} />);

      fireEvent.click(getNext());

      expect((getPrevious() as HTMLButtonElement).disabled).toBe(false);
      expect((getNext() as HTMLButtonElement).disabled).toBe(false);
    });

    it("does not go past the last slide on ArrowRight", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      const nav = screen.getByRole("navigation", { name: "Slide navigation" });
      fireEvent.keyDown(nav, { key: "ArrowRight" });
      fireEvent.keyDown(nav, { key: "ArrowRight" });

      expect(screen.getByText("Content for b")).toBeTruthy();
      expect(screen.getAllByText("Slide 2 of 2").length).toBeGreaterThan(0);
    });

    it("does not go before the first slide on ArrowLeft", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      const nav = screen.getByRole("navigation", { name: "Slide navigation" });
      fireEvent.keyDown(nav, { key: "ArrowLeft" });

      expect(screen.getByText("Content for a")).toBeTruthy();
      expect(screen.getAllByText("Slide 1 of 2").length).toBeGreaterThan(0);
    });
  });

  describe("single-slide decks", () => {
    it("disables both Previous and Next", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("only")])} />);

      expect((getPrevious() as HTMLButtonElement).disabled).toBe(true);
      expect((getNext() as HTMLButtonElement).disabled).toBe(true);
    });

    it("shows the single slide and a single-slide message", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("only")])} />);

      expect(screen.getByText("Content for only")).toBeTruthy();
      expect(screen.getAllByText("Slide 1 of 1").length).toBeGreaterThan(0);
      expect(screen.getByText("This deck has a single slide.")).toBeTruthy();
    });
  });

  describe("slide data display", () => {
    it("falls back to 'Slide N' when a slide has no title", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a", { title: undefined })])} />);

      expect(screen.getAllByText("Slide 1").length).toBeGreaterThan(0);
    });

    it("shows a message for a slide with no elements", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a", { elements: [] })])} />);

      expect(screen.getByText("This slide has no elements.")).toBeTruthy();
    });

    it("shows extra slide fields under 'Other fields'", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a", { transition: "fade" })])} />);

      expect(screen.getByText("Other fields")).toBeTruthy();
      expect(screen.getByText("transition")).toBeTruthy();
      expect(screen.getByText("fade")).toBeTruthy();
    });

    it("accepts a JSON string as the saved deck", () => {
      render(<SlideDataViewer slideshowDeck={JSON.stringify(makeDeck([makeSlide("a"), makeSlide("b")]))} />);

      expect(screen.getByText("Content for a")).toBeTruthy();
      expect(screen.getAllByText("Slide 1 of 2").length).toBeGreaterThan(0);
    });

    it("includes the deck title in the heading", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a")])} />);

      expect(screen.getByText(/My Deck/)).toBeTruthy();
    });
  });

  describe("empty and invalid data", () => {
    it("shows an empty state for null", () => {
      render(<SlideDataViewer slideshowDeck={null} />);

      expect(screen.getByText(/No slideshow data has been saved/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Next slide" })).toBeNull();
    });

    it("shows an empty state for undefined", () => {
      render(<SlideDataViewer slideshowDeck={undefined} />);

      expect(screen.getByText(/No slideshow data has been saved/)).toBeTruthy();
    });

    it("shows an empty state for a blank string", () => {
      render(<SlideDataViewer slideshowDeck="   " />);

      expect(screen.getByText(/No slideshow data has been saved/)).toBeTruthy();
    });

    it("shows an error alert for malformed JSON", () => {
      render(<SlideDataViewer slideshowDeck={"{ not valid json"} />);

      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/couldn't be read/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Next slide" })).toBeNull();
    });

    it("lists validation errors for a deck that fails validation", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a", { elements: undefined })])} />);

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("slides[0].elements");
    });

    it("treats a deck with an empty slides array as invalid", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([])} />);

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("slides");
      expect(screen.queryByRole("button", { name: "Next slide" })).toBeNull();
    });
  });

  describe("deck changes", () => {
    it("returns to the first slide when the deck shrinks (content changed)", () => {
      const { rerender } = render(
        <SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])} />,
      );

      fireEvent.click(getNext());
      fireEvent.click(getNext());
      expect(screen.getByText("Content for c")).toBeTruthy();

      rerender(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      // Any change in deck content resets the view to the first slide.
      expect(screen.getByText("Content for a")).toBeTruthy();
      expect(screen.queryByText("Content for c")).toBeNull();
      expect(screen.getAllByText("Slide 1 of 2").length).toBeGreaterThan(0);
    });

    it("clamps an out-of-range initialIndex into range and keeps navigation working", () => {
      render(
        <SlideDataViewer
          slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])}
          initialIndex={50}
        />,
      );

      expect(screen.getByText("Content for b")).toBeTruthy();
      expect(screen.getAllByText("Slide 2 of 2").length).toBeGreaterThan(0);
      expect((getNext() as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(getPrevious());

      expect(screen.getByText("Content for a")).toBeTruthy();
      expect(screen.getAllByText("Slide 1 of 2").length).toBeGreaterThan(0);
    });

    it("clamps a negative initialIndex to the first slide", () => {
      render(
        <SlideDataViewer
          slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])}
          initialIndex={-5}
        />,
      );

      expect(screen.getByText("Content for a")).toBeTruthy();
      expect((getPrevious() as HTMLButtonElement).disabled).toBe(true);
    });

    it("switches from empty to slides when a deck is saved", () => {
      const { rerender } = render(<SlideDataViewer slideshowDeck={null} />);
      expect(screen.getByText(/No slideshow data has been saved/)).toBeTruthy();

      rerender(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a")])} />);

      expect(screen.getByText("Content for a")).toBeTruthy();
    });

    it("returns to the first slide when the deck content is edited", () => {
      const { rerender } = render(
        <SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])} />,
      );

      fireEvent.click(getNext());
      fireEvent.click(getNext());
      expect(screen.getByText("Content for c")).toBeTruthy();

      rerender(
        <SlideDataViewer
          slideshowDeck={makeDeck([makeSlide("x"), makeSlide("y"), makeSlide("z"), makeSlide("w")])}
        />,
      );

      expect(screen.getByText("Content for x")).toBeTruthy();
      expect(screen.getAllByText("Slide 1 of 4").length).toBeGreaterThan(0);
    });

    it("keeps the current slide when the deck is re-supplied with identical content", () => {
      const { rerender } = render(
        <SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])} />,
      );

      fireEvent.click(getNext());
      expect(screen.getByText("Content for b")).toBeTruthy();

      // A new object with the same content, as a background refresh would produce.
      rerender(
        <SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])} />,
      );

      expect(screen.getByText("Content for b")).toBeTruthy();
      expect(screen.getAllByText("Slide 2 of 3").length).toBeGreaterThan(0);
    });
  });

  describe("accessibility", () => {
    it("does not steal focus on initial mount", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      const region = screen.getByRole("region", { name: "Title a, slide 1 of 2" });
      expect(document.activeElement).not.toBe(region);
    });

    it("moves focus to the slide region after navigating", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      fireEvent.click(getNext());

      const region = screen.getByRole("region", { name: "Title b, slide 2 of 2" });
      expect(document.activeElement).toBe(region);
    });

    it("moves focus to the slide region after arrow-key navigation", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      const nav = screen.getByRole("navigation", { name: "Slide navigation" });
      fireEvent.keyDown(nav, { key: "ArrowRight" });

      const region = screen.getByRole("region", { name: "Title b, slide 2 of 2" });
      expect(document.activeElement).toBe(region);
    });

    it("does not move focus when the deck is replaced with different content", () => {
      const { rerender } = render(
        <SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />,
      );

      fireEvent.click(getNext());
      (document.activeElement as HTMLElement | null)?.blur();

      rerender(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("x"), makeSlide("y")])} />);

      const region = screen.getByRole("region", { name: "Title x, slide 1 of 2" });
      expect(document.activeElement).not.toBe(region);
    });

    it("labels the navigation and its buttons", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      expect(screen.getByRole("navigation", { name: "Slide navigation" })).toBeTruthy();
      expect(getPrevious()).toBeTruthy();
      expect(getNext()).toBeTruthy();
    });

    it("announces the current position in a polite live region", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      const status = screen.getByRole("status");
      expect(status.getAttribute("aria-live")).toBe("polite");
      expect(status.textContent).toContain("Slide 1 of 2");

      fireEvent.click(getNext());

      expect(screen.getByRole("status").textContent).toContain("Slide 2 of 2");
    });

    it("labels the slide card region with its title and position", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      expect(screen.getByRole("region", { name: "Title a, slide 1 of 2" })).toBeTruthy();
    });
  });

  describe("Add images button and prompt modal", () => {
    it("does not show the Add images button when no lesson is supplied", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} />);

      expect(screen.queryByRole("button", { name: /add images/i })).toBeNull();
    });

    it("shows the Add images button when a lesson is supplied", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} lesson={LESSON} />);

      expect(getAddImagesButton(1)).toBeTruthy();
    });

    it("does not show the button in the empty or invalid states", () => {
      const { rerender } = render(<SlideDataViewer slideshowDeck={null} lesson={LESSON} />);
      expect(screen.queryByRole("button", { name: /add images/i })).toBeNull();

      rerender(<SlideDataViewer slideshowDeck={"{ not valid json"} lesson={LESSON} />);
      expect(screen.queryByRole("button", { name: /add images/i })).toBeNull();
    });

    it("does not open the modal until the button is clicked", () => {
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a")])} lesson={LESSON} />);

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens the modal with the prompt for the current slide", async () => {
      const user = userEvent.setup();
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} lesson={LESSON} />);

      await user.click(getAddImagesButton(1));

      expect(await screen.findByRole("dialog", { name: "Add images to slide 1" })).toBeTruthy();
      const prompt = getPromptText();
      expect(prompt).toContain("Content for a");
      expect(prompt).not.toContain("Content for b");
    });

    it("lists the lesson's uploaded image descriptions in the prompt", async () => {
      const user = userEvent.setup();
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a")])} lesson={LESSON} />);

      await user.click(getAddImagesButton(1));
      await screen.findByRole("dialog");

      const prompt = getPromptText();
      expect(prompt).toContain("img-01");
      expect(prompt).toContain("A labelled diagram of a plant cell");
      expect(prompt).toContain("plant-cell.png");
    });

    it("shows the no-images message when the lesson has no uploaded images", async () => {
      const user = userEvent.setup();
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a")])} lesson={LESSON_WITHOUT_IMAGES} />);

      await user.click(getAddImagesButton(1));
      await screen.findByRole("dialog");

      expect(screen.getByTestId("slide-images-no-images")).toBeTruthy();
      expect((screen.getByRole("button", { name: "Copy to Clipboard" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("follows navigation: the modal opens for whichever slide is shown", async () => {
      const user = userEvent.setup();
      render(
        <SlideDataViewer
          slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b"), makeSlide("c")])}
          lesson={LESSON}
        />,
      );

      // Slide 1.
      await user.click(getAddImagesButton(1));
      await screen.findByRole("dialog", { name: "Add images to slide 1" });
      expect(getPromptText()).toContain("Content for a");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      // Slide 2.
      fireEvent.click(getNext());
      await user.click(getAddImagesButton(2));
      await screen.findByRole("dialog", { name: "Add images to slide 2" });
      let prompt = getPromptText();
      expect(prompt).toContain("Content for b");
      expect(prompt).not.toContain("Content for a");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      // Slide 3.
      fireEvent.click(getNext());
      await user.click(getAddImagesButton(3));
      await screen.findByRole("dialog", { name: "Add images to slide 3" });
      prompt = getPromptText();
      expect(prompt).toContain("Content for c");
      expect(prompt).not.toContain("Content for b");
    });

    it("closes with Escape and stays on the same slide", async () => {
      const user = userEvent.setup();
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} lesson={LESSON} />);

      fireEvent.click(getNext());
      await user.click(getAddImagesButton(2));
      await screen.findByRole("dialog");

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      expect(screen.getByText("Content for b")).toBeTruthy();
      expect(screen.getAllByText("Slide 2 of 2").length).toBeGreaterThan(0);
    });

    it("returns focus to the Add images button when the modal closes", async () => {
      const user = userEvent.setup();
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} lesson={LESSON} />);

      const button = getAddImagesButton(1);
      // Focus the button explicitly so the previously focused element is
      // deterministic (a click alone doesn't reliably focus a button in jsdom).
      act(() => {
        button.focus();
      });
      expect(button).toHaveFocus();

      await user.click(button);
      await screen.findByRole("dialog");

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(getAddImagesButton(1)).toHaveFocus(), { timeout: 2000 });
    });

    it("returns focus to the button after closing with the modal's Close button", async () => {
      const user = userEvent.setup();
      render(<SlideDataViewer slideshowDeck={makeDeck([makeSlide("a")])} lesson={LESSON} />);

      await user.click(getAddImagesButton(1));
      const dialog = await screen.findByRole("dialog");

      const closeButton = Array.from(dialog.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === "Close" && !candidate.querySelector("svg"),
      );
      expect(closeButton).toBeTruthy();
      await user.click(closeButton as HTMLElement);

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(getAddImagesButton(1)).toHaveFocus(), { timeout: 2000 });
    });

    it("closes the modal if the deck's content changes while it is open", async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <SlideDataViewer slideshowDeck={makeDeck([makeSlide("a"), makeSlide("b")])} lesson={LESSON} />,
      );

      await user.click(getAddImagesButton(1));
      await screen.findByRole("dialog");

      rerender(
        <SlideDataViewer slideshowDeck={makeDeck([makeSlide("x"), makeSlide("y")])} lesson={LESSON} />,
      );

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getByText("Content for x")).toBeTruthy();
    });
  });
});