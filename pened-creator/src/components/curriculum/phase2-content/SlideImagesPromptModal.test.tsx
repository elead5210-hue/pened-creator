import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SlideImagesPromptModal, type SlideImagesPromptLesson } from "./SlideImagesPromptModal";

const mocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(),
  downloadTextFile: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/curriculum/phase2-content/download", () => ({
  copyTextToClipboard: (...args: unknown[]) => mocks.copyTextToClipboard(...args),
  downloadTextFile: (...args: unknown[]) => mocks.downloadTextFile(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
    info: vi.fn(),
  },
}));

const SLIDE = {
  id: "slide-3",
  title: "Cell walls",
  elements: [
    {
      id: "slide-3-text-1",
      type: "text",
      position: { x: 10, y: 10 },
      size: { width: 300, height: 60 },
      content: "Cell walls give plants their shape",
    },
  ],
};

const OTHER_SLIDE = {
  id: "slide-4",
  title: "Chloroplasts",
  elements: [
    {
      id: "slide-4-text-1",
      type: "text",
      position: { x: 10, y: 10 },
      size: { width: 300, height: 60 },
      content: "Chloroplasts capture sunlight",
    },
  ],
};

const LESSON: SlideImagesPromptLesson = {
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
    {
      // Has an image prompt but was never uploaded, so it must not be listed.
      id: "img-02",
      description: "A leaf under a microscope",
      altText: "Leaf under a microscope",
    },
  ],
  images: { "img-01": "plant-cell.png" },
};

const LESSON_WITHOUT_IMAGES: SlideImagesPromptLesson = {
  id: "proj-1:node-9",
  project_id: "proj-1",
  lesson_node_id: "node-9",
  imagePrompts: [{ id: "img-01", description: "A labelled diagram of a plant cell" }],
  images: null,
};

function getPromptTextarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: /generated prompt/i }) as HTMLTextAreaElement;
}

/** The footer "Close" button (the corner X button also has the name "Close" but contains an icon). */
function getFooterCloseButton(): HTMLElement {
  const button = screen
    .getAllByRole("button", { name: "Close" })
    .find((candidate) => !candidate.querySelector("svg"));
  if (!button) throw new Error("Footer Close button not found");
  return button;
}

/** Test harness that owns the `open` state like a real parent would. */
function Harness({
  lesson = LESSON,
  slide = SLIDE,
  initialOpen = true,
  onOpenChangeSpy,
}: {
  lesson?: SlideImagesPromptLesson | null;
  slide?: unknown;
  initialOpen?: boolean;
  onOpenChangeSpy?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add images
      </button>
      <SlideImagesPromptModal
        open={open}
        onOpenChange={(next) => {
          onOpenChangeSpy?.(next);
          setOpen(next);
        }}
        slide={slide}
        lesson={lesson}
        slideNumber={3}
        slideTitle="Cell walls"
      />
    </>
  );
}

describe("SlideImagesPromptModal", () => {
  beforeEach(() => {
    mocks.copyTextToClipboard.mockReset();
    mocks.copyTextToClipboard.mockResolvedValue(undefined);
    mocks.downloadTextFile.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  describe("rendering", () => {
    it("renders nothing while closed", () => {
      render(<Harness initialOpen={false} />);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders a labelled dialog with a title and description", () => {
      render(<Harness />);

      const dialog = screen.getByRole("dialog", { name: "Add images to slide 3" });
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByText(/Cell walls/)).toBeInTheDocument();
      expect(dialog).toHaveAccessibleDescription(/nothing is saved from here/i);
    });

    it("shows the prompt in a labelled, read-only textarea", () => {
      render(<Harness />);

      const textarea = getPromptTextarea();
      expect(textarea).toHaveAttribute("readonly");
      expect(textarea.value.length).toBeGreaterThan(0);
    });

    it("includes the current slide's data in the prompt", () => {
      render(<Harness />);

      const { value } = getPromptTextarea();
      expect(value).toContain("slide-3");
      expect(value).toContain("Cell walls give plants their shape");
    });

    it("lists the uploaded images by id, description and src", () => {
      render(<Harness />);

      const { value } = getPromptTextarea();
      expect(value).toContain("img-01");
      expect(value).toContain("A labelled diagram of a plant cell");
      expect(value).toContain("plant-cell.png");
    });

    it("leaves out images that were never uploaded", () => {
      render(<Harness />);

      const { value } = getPromptTextarea();
      expect(value).not.toContain("img-02");
      expect(value).not.toContain("A leaf under a microscope");
    });

    it("says how many uploaded images are listed", () => {
      render(<Harness />);

      expect(screen.getByTestId("slide-images-count")).toHaveTextContent("1 uploaded image listed in the prompt.");
      expect(screen.queryByTestId("slide-images-no-images")).not.toBeInTheDocument();
    });

    it("rebuilds the prompt when the slide changes", () => {
      const { rerender } = render(
        <SlideImagesPromptModal
          open
          onOpenChange={() => {}}
          slide={SLIDE}
          lesson={LESSON}
          slideNumber={3}
        />,
      );
      expect(getPromptTextarea().value).toContain("Cell walls give plants their shape");

      rerender(
        <SlideImagesPromptModal
          open
          onOpenChange={() => {}}
          slide={OTHER_SLIDE}
          lesson={LESSON}
          slideNumber={4}
        />,
      );

      const { value } = getPromptTextarea();
      expect(value).toContain("Chloroplasts capture sunlight");
      expect(value).not.toContain("Cell walls give plants their shape");
      expect(screen.getByRole("dialog", { name: "Add images to slide 4" })).toBeInTheDocument();
    });

    it("falls back to a generic title when no slide number is given", () => {
      render(<SlideImagesPromptModal open onOpenChange={() => {}} slide={SLIDE} lesson={LESSON} />);

      expect(screen.getByRole("dialog", { name: "Add images to this slide" })).toBeInTheDocument();
    });
  });

  describe("no uploaded images", () => {
    it("shows a clear no-images message", () => {
      render(<Harness lesson={LESSON_WITHOUT_IMAGES} />);

      const message = screen.getByTestId("slide-images-no-images");
      expect(message).toHaveTextContent(/no images uploaded yet/i);
      expect(message).toHaveTextContent(/upload images in the image generation step/i);
      expect(screen.queryByTestId("slide-images-count")).not.toBeInTheDocument();
    });

    it("disables copy and download", () => {
      render(<Harness lesson={LESSON_WITHOUT_IMAGES} />);

      expect(screen.getByRole("button", { name: "Copy to Clipboard" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Download as Text" })).toBeDisabled();
    });

    it("still lets the user close the modal", () => {
      render(<Harness lesson={LESSON_WITHOUT_IMAGES} />);

      expect(getFooterCloseButton()).toBeEnabled();
    });

    it("treats a missing lesson the same as a lesson with no images", () => {
      render(<Harness lesson={null} />);

      expect(screen.getByTestId("slide-images-no-images")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy to Clipboard" })).toBeDisabled();
    });

    it("tells the AI not to invent images in the displayed prompt", () => {
      render(<Harness lesson={LESSON_WITHOUT_IMAGES} />);

      expect(getPromptTextarea().value).toMatch(/no images/i);
    });
  });

  describe("copy", () => {
    it("copies the displayed prompt to the clipboard and confirms", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const promptText = getPromptTextarea().value;
      await user.click(screen.getByRole("button", { name: "Copy to Clipboard" }));

      await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Copied!"));
      expect(mocks.copyTextToClipboard).toHaveBeenCalledTimes(1);
      expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(promptText);
    });

    it("shows an error when copying fails", async () => {
      const user = userEvent.setup();
      mocks.copyTextToClipboard.mockRejectedValue(new Error("nope"));
      render(<Harness />);

      await user.click(screen.getByRole("button", { name: "Copy to Clipboard" }));

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      // The button is usable again after a failed copy.
      await waitFor(() => expect(screen.getByRole("button", { name: "Copy to Clipboard" })).toBeEnabled());
    });
  });

  describe("download", () => {
    it("downloads the displayed prompt with a filename built from the lesson and slide", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const promptText = getPromptTextarea().value;
      await user.click(screen.getByRole("button", { name: "Download as Text" }));

      expect(mocks.downloadTextFile).toHaveBeenCalledTimes(1);
      expect(mocks.downloadTextFile).toHaveBeenCalledWith(promptText, "proj-1_node-9_slide-3_images-prompt.txt");
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Downloaded.");
    });

    it("shows an error when the download fails", async () => {
      const user = userEvent.setup();
      mocks.downloadTextFile.mockImplementation(() => {
        throw new Error("blocked");
      });
      render(<Harness />);

      await user.click(screen.getByRole("button", { name: "Download as Text" }));

      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });
  });

  describe("closing", () => {
    it("closes from the footer Close button", async () => {
      const user = userEvent.setup();
      const onOpenChangeSpy = vi.fn();
      render(<Harness onOpenChangeSpy={onOpenChangeSpy} />);

      await user.click(getFooterCloseButton());

      expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("closes with the Escape key", async () => {
      const user = userEvent.setup();
      const onOpenChangeSpy = vi.fn();
      render(<Harness onOpenChangeSpy={onOpenChangeSpy} />);

      await user.keyboard("{Escape}");

      expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("can be reopened after closing", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Add images" }));

      expect(await screen.findByRole("dialog", { name: "Add images to slide 3" })).toBeInTheDocument();
      expect(getPromptTextarea().value).toContain("Cell walls give plants their shape");
    });
  });

  describe("focus", () => {
    it("moves focus into the dialog when it opens", async () => {
      const user = userEvent.setup();
      render(<Harness initialOpen={false} />);

      await user.click(screen.getByRole("button", { name: "Add images" }));

      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    });

    it("returns focus to the element that opened the dialog after Escape", async () => {
      const user = userEvent.setup();
      render(<Harness initialOpen={false} />);

      const opener = screen.getByRole("button", { name: "Add images" });
      // Explicitly focus the opener first so the previously focused element is
      // deterministic (a click alone doesn't reliably focus a button in jsdom).
      act(() => {
        opener.focus();
      });
      expect(opener).toHaveFocus();

      await user.click(opener);
      await screen.findByRole("dialog");

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(opener).toHaveFocus(), { timeout: 2000 });
    });

    it("returns focus to the opener after using the footer Close button", async () => {
      const user = userEvent.setup();
      render(<Harness initialOpen={false} />);

      const opener = screen.getByRole("button", { name: "Add images" });
      act(() => {
        opener.focus();
      });

      await user.click(opener);
      await screen.findByRole("dialog");

      await user.click(getFooterCloseButton());
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(opener).toHaveFocus(), { timeout: 2000 });
    });
  });
});