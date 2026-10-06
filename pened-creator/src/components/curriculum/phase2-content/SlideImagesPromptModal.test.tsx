import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SlideImagesPromptModal, type SlideImagesPromptLesson } from "./SlideImagesPromptModal";
import type { SlideData } from "@/lib/curriculum/phase2-content/slideshowDeckValidator";

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
  onApplySlide,
}: {
  lesson?: SlideImagesPromptLesson | null;
  slide?: unknown;
  initialOpen?: boolean;
  onOpenChangeSpy?: (open: boolean) => void;
  onApplySlide?: (slide: SlideData) => Promise<void>;
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
        onApplySlide={onApplySlide}
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
      // Assert on the dialog's accessible description rather than a text query:
      // the prompt textarea's contents also contain the slide title, so a bare
      // getByText(/Cell walls/) would match more than one element.
      expect(dialog).toHaveAccessibleDescription(/Cell walls/);
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

    it("lists the exact background-removed image URL as the src when one exists", () => {
      const noBgUrl = "https://cdn.example.com/lessons/plant-cell-nobg.png?v=3";
      render(<Harness lesson={{ ...LESSON, imagesNoBg: { "img-01": noBgUrl } }} />);

      const { value } = getPromptTextarea();
      expect(value).toContain(`src: ${noBgUrl}`);
      expect(value).not.toContain("plant-cell.png");
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

  describe("paste the AI's response", () => {
    const IMAGE_EL = {
      id: "slide-3-image-1",
      type: "image",
      position: { x: 400, y: 20 },
      size: { width: 320, height: 240 },
      src: "plant-cell.png",
    };

    /** The current slide with extra elements appended, like a correct AI response. */
    function updatedSlide(...extra: unknown[]) {
      return { ...SLIDE, elements: [...SLIDE.elements, ...extra] };
    }

    const VALID_RESPONSE = JSON.stringify(updatedSlide(IMAGE_EL));

    function makeApply() {
      return vi.fn<(slide: SlideData) => Promise<void>>().mockResolvedValue(undefined);
    }

    function getPasteTextarea(): HTMLTextAreaElement {
      return screen.getByRole("textbox", { name: /paste the ai's response/i }) as HTMLTextAreaElement;
    }

    function getApplyButton(): HTMLElement {
      return screen.getByRole("button", { name: /apply to slide|saving/i });
    }

    function pasteResponse(text: string) {
      fireEvent.change(getPasteTextarea(), { target: { value: text } });
    }

    /** The corner X button (the footer Close button has no icon). */
    function getCornerCloseButton(): HTMLElement {
      const button = screen
        .getAllByRole("button", { name: "Close" })
        .find((candidate) => candidate.querySelector("svg"));
      if (!button) throw new Error("Corner Close button not found");
      return button;
    }

    describe("availability", () => {
      it("is hidden when there is no onApplySlide", () => {
        render(<Harness />);

        expect(screen.queryByTestId("slide-images-apply-area")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Apply to slide" })).not.toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: /paste the ai's response/i })).not.toBeInTheDocument();
      });

      it("keeps the read-only description when there is no onApplySlide", () => {
        render(<Harness />);

        expect(screen.getByRole("dialog")).toHaveAccessibleDescription(/nothing is saved from here/i);
      });

      it("shows a labelled textarea and an Apply to slide button when onApplySlide is provided", () => {
        render(<Harness onApplySlide={makeApply()} />);

        expect(getPasteTextarea()).toBeEnabled();
        expect(getPasteTextarea().value).toBe("");
        expect(screen.getByRole("button", { name: "Apply to slide" })).toBeEnabled();
      });

      it("describes the saving behavior instead of saying nothing is saved", () => {
        render(<Harness onApplySlide={makeApply()} />);

        const dialog = screen.getByRole("dialog");
        expect(dialog).toHaveAccessibleDescription(/paste its response below/i);
        expect(dialog).not.toHaveAccessibleDescription(/nothing is saved from here/i);
      });

      it("keeps the read-only prompt, copy and download", () => {
        render(<Harness onApplySlide={makeApply()} />);

        expect(getPromptTextarea()).toHaveAttribute("readonly");
        expect(screen.getByRole("button", { name: "Copy to Clipboard" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Download as Text" })).toBeEnabled();
      });

      it("is disabled, with an explanation, when there are no uploaded images", () => {
        render(<Harness lesson={LESSON_WITHOUT_IMAGES} onApplySlide={makeApply()} />);

        expect(getPasteTextarea()).toBeDisabled();
        expect(screen.getByRole("button", { name: "Apply to slide" })).toBeDisabled();
        expect(screen.getByTestId("slide-images-apply-area")).toHaveTextContent(
          /no uploaded images, so there is nothing to apply/i,
        );
      });

      it("is disabled when there is no lesson", () => {
        render(<Harness lesson={null} onApplySlide={makeApply()} />);

        expect(getPasteTextarea()).toBeDisabled();
        expect(screen.getByRole("button", { name: "Apply to slide" })).toBeDisabled();
      });
    });

    describe("a successful apply", () => {
      it("calls onApplySlide with the validated slide, shows a success toast and closes the modal", async () => {
        const user = userEvent.setup();
        const onApply = makeApply();
        const onOpenChangeSpy = vi.fn();
        render(<Harness onApplySlide={onApply} onOpenChangeSpy={onOpenChangeSpy} />);

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());

        await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
        expect(onApply).toHaveBeenCalledWith(updatedSlide(IMAGE_EL));
        await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Images added to the slide."));
        expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      });

      it("accepts a response wrapped in a code fence and stray prose", async () => {
        const user = userEvent.setup();
        const onApply = makeApply();
        render(<Harness onApplySlide={onApply} />);

        pasteResponse(`Here is the slide:\n\`\`\`json\n${JSON.stringify(updatedSlide(IMAGE_EL), null, 2)}\n\`\`\`\nEnjoy!`);
        await user.click(getApplyButton());

        await waitFor(() => expect(onApply).toHaveBeenCalledWith(updatedSlide(IMAGE_EL)));
      });

      it("returns focus to the element that opened the modal", async () => {
        const user = userEvent.setup();
        render(<Harness initialOpen={false} onApplySlide={makeApply()} />);

        const opener = screen.getByRole("button", { name: "Add images" });
        act(() => {
          opener.focus();
        });
        await user.click(opener);
        await screen.findByRole("dialog");

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        await waitFor(() => expect(opener).toHaveFocus(), { timeout: 2000 });
      });
    });

    describe("validation errors", () => {
      async function applyAndGetAlert(text: string, onApply = makeApply()) {
        const user = userEvent.setup();
        render(<Harness onApplySlide={onApply} />);

        pasteResponse(text);
        await user.click(getApplyButton());

        const alert = await screen.findByRole("alert");
        expect(onApply).not.toHaveBeenCalled();
        return { alert, onApply, user };
      }

      it("reports text with no JSON in it", async () => {
        const { alert } = await applyAndGetAlert("Sorry, I can't help with that.");

        expect(alert).toHaveTextContent(/1 problem was found with the response/i);
        expect(alert).toHaveTextContent(/no json object found/i);
      });

      it("reports invalid JSON", async () => {
        const { alert } = await applyAndGetAlert("{ id: slide-3 }");

        expect(alert).toHaveTextContent(/invalid json/i);
      });

      it("reports an empty paste", async () => {
        const { alert } = await applyAndGetAlert("   ");

        expect(alert).toHaveTextContent("Paste the AI's response first.");
      });

      it("reports a structural error with the field path", async () => {
        const { alert } = await applyAndGetAlert(JSON.stringify(updatedSlide({ ...IMAGE_EL, src: undefined })));

        expect(alert).toHaveTextContent(/slide\.elements\[1\]\.src/);
        expect(alert).not.toHaveTextContent("slides[0]");
      });

      it("reports a removed element", async () => {
        const { alert } = await applyAndGetAlert(JSON.stringify({ ...SLIDE, elements: [IMAGE_EL] }));

        expect(alert).toHaveTextContent(/slide-3-text-1/);
        expect(alert).toHaveTextContent(/was removed/i);
      });

      it("reports an invented src", async () => {
        const { alert } = await applyAndGetAlert(JSON.stringify(updatedSlide({ ...IMAGE_EL, src: "invented.png" })));

        expect(alert).toHaveTextContent(/slide\.elements\[1\]\.src/);
        expect(alert).toHaveTextContent(/invented\.png/);
      });

      it("reports a response that adds no image", async () => {
        const { alert } = await applyAndGetAlert(JSON.stringify(SLIDE));

        expect(alert).toHaveTextContent(/doesn't add any images/i);
      });

      it("reports a response for a different slide", async () => {
        const { alert } = await applyAndGetAlert(JSON.stringify({ ...updatedSlide(IMAGE_EL), id: "slide-9" }));

        expect(alert).toHaveTextContent(/slide\.id/);
      });

      it("checks the response against the slide the modal is showing", async () => {
        const user = userEvent.setup();
        const onApply = makeApply();
        render(<Harness slide={OTHER_SLIDE} onApplySlide={onApply} />);

        // A correct response for slide-3, pasted while slide-4 is shown.
        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());

        expect(await screen.findByRole("alert")).toHaveTextContent(/slide\.id/);
        expect(onApply).not.toHaveBeenCalled();
      });

      it("lists every problem as its own list item", async () => {
        // The original text element is removed and the new image uses an invented src.
        const { alert } = await applyAndGetAlert(
          JSON.stringify({ ...SLIDE, elements: [{ ...IMAGE_EL, src: "invented.png" }] }),
        );

        expect(alert).toHaveTextContent(/2 problems were found with the response/i);
        const items = within(alert).getAllByRole("listitem");
        expect(items).toHaveLength(2);
      });

      it("keeps the pasted text so it can be fixed and retried", async () => {
        const onApply = makeApply();
        const { user } = await applyAndGetAlert("not json", onApply);

        expect(getPasteTextarea().value).toBe("not json");

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());

        await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
        expect(onApply).toHaveBeenCalledWith(updatedSlide(IMAGE_EL));
      });

      it("does not show a success toast or close the modal", async () => {
        await applyAndGetAlert("not json");

        expect(mocks.toastSuccess).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
    });

    describe("a failed save", () => {
      async function applyWithFailingSave(error: unknown) {
        const user = userEvent.setup();
        const onApply = vi.fn<(slide: SlideData) => Promise<void>>().mockRejectedValue(error);
        const onOpenChangeSpy = vi.fn();
        render(<Harness onApplySlide={onApply} onOpenChangeSpy={onOpenChangeSpy} />);

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());

        const alert = await screen.findByRole("alert");
        return { alert, onApply, onOpenChangeSpy, user };
      }

      it("shows the save error as its own message, not as a list of problems", async () => {
        const { alert } = await applyWithFailingSave(new Error("Your session expired. Sign in again."));

        expect(alert).toHaveTextContent("Couldn't save the slide");
        expect(alert).toHaveTextContent("Your session expired. Sign in again.");
        expect(alert).not.toHaveTextContent(/problems? (was|were) found/i);
        expect(within(alert).queryAllByRole("listitem")).toHaveLength(0);
      });

      it("uses a general message when the error has none", async () => {
        const { alert } = await applyWithFailingSave("boom");

        expect(alert).toHaveTextContent(/something went wrong while saving the slide/i);
      });

      it("keeps the pasted text and the modal open", async () => {
        const { onOpenChangeSpy } = await applyWithFailingSave(new Error("Network error"));

        expect(getPasteTextarea().value).toBe(VALID_RESPONSE);
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(onOpenChangeSpy).not.toHaveBeenCalled();
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
      });

      it("lets the user try again", async () => {
        const user = userEvent.setup();
        const onApply = vi
          .fn<(slide: SlideData) => Promise<void>>()
          .mockRejectedValueOnce(new Error("Network error"))
          .mockResolvedValueOnce(undefined);
        render(<Harness onApplySlide={onApply} />);

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());
        await screen.findByRole("alert");

        expect(screen.getByRole("button", { name: "Apply to slide" })).toBeEnabled();
        expect(getPasteTextarea()).toBeEnabled();

        await user.click(getApplyButton());

        await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(mocks.toastSuccess).toHaveBeenCalledWith("Images added to the slide.");
      });

      it("replaces a validation error with the save error and the other way round", async () => {
        const user = userEvent.setup();
        const onApply = vi.fn<(slide: SlideData) => Promise<void>>().mockRejectedValue(new Error("Network error"));
        render(<Harness onApplySlide={onApply} />);

        pasteResponse("not json");
        await user.click(getApplyButton());
        expect(await screen.findByRole("alert")).toHaveTextContent(/no json object found/i);

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save the slide"));
        expect(screen.getAllByRole("alert")).toHaveLength(1);

        pasteResponse("not json");
        await user.click(getApplyButton());
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no json object found/i));
        expect(screen.getByRole("alert")).not.toHaveTextContent("Couldn't save the slide");
      });
    });

    describe("while saving", () => {
      function startSave() {
        let finishSave!: () => void;
        const onApply = vi.fn<(slide: SlideData) => Promise<void>>(
          () =>
            new Promise<void>((resolve) => {
              finishSave = resolve;
            }),
        );
        return { onApply, finishSave: () => finishSave() };
      }

      it("disables the textarea and buttons and marks the dialog busy", async () => {
        const user = userEvent.setup();
        const { onApply, finishSave } = startSave();
        render(<Harness onApplySlide={onApply} />);

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());

        await waitFor(() => expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled());
        expect(getPasteTextarea()).toBeDisabled();
        expect(getFooterCloseButton()).toBeDisabled();
        expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");

        await act(async () => {
          finishSave();
        });
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      });

      it("cannot be dismissed with Escape or the corner close button", async () => {
        const user = userEvent.setup();
        const { onApply, finishSave } = startSave();
        const onOpenChangeSpy = vi.fn();
        render(<Harness onApplySlide={onApply} onOpenChangeSpy={onOpenChangeSpy} />);

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());
        await waitFor(() => expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled());

        await user.keyboard("{Escape}");
        await user.click(getCornerCloseButton());

        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(onOpenChangeSpy).not.toHaveBeenCalled();

        await act(async () => {
          finishSave();
        });
        await waitFor(() => expect(onOpenChangeSpy).toHaveBeenCalledWith(false));
      });

      it("does not start a second save while one is running", async () => {
        const user = userEvent.setup();
        const { onApply, finishSave } = startSave();
        render(<Harness onApplySlide={onApply} />);

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());
        await waitFor(() => expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled());
        await user.click(screen.getByRole("button", { name: "Saving..." }));

        expect(onApply).toHaveBeenCalledTimes(1);

        await act(async () => {
          finishSave();
        });
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      });

      it("can be dismissed again once a failed save has finished", async () => {
        const user = userEvent.setup();
        const onApply = vi.fn<(slide: SlideData) => Promise<void>>().mockRejectedValue(new Error("Network error"));
        render(<Harness onApplySlide={onApply} />);

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());
        await screen.findByRole("alert");

        await user.keyboard("{Escape}");

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      });
    });

    describe("clearing", () => {
      it("clears the pasted text and any errors when the modal closes", async () => {
        const user = userEvent.setup();
        render(<Harness onApplySlide={makeApply()} />);

        pasteResponse("not json");
        await user.click(getApplyButton());
        await screen.findByRole("alert");

        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        await user.click(screen.getByRole("button", { name: "Add images" }));
        await screen.findByRole("dialog");

        expect(getPasteTextarea().value).toBe("");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });

      it("clears the pasted text and any errors when the slide changes", async () => {
        const user = userEvent.setup();
        const onApply = makeApply();
        const { rerender } = render(
          <SlideImagesPromptModal
            open
            onOpenChange={() => {}}
            slide={SLIDE}
            lesson={LESSON}
            slideNumber={3}
            onApplySlide={onApply}
          />,
        );

        pasteResponse("not json");
        await user.click(getApplyButton());
        await screen.findByRole("alert");

        rerender(
          <SlideImagesPromptModal
            open
            onOpenChange={() => {}}
            slide={OTHER_SLIDE}
            lesson={LESSON}
            slideNumber={4}
            onApplySlide={onApply}
          />,
        );

        expect(getPasteTextarea().value).toBe("");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });

      it("keeps the pasted text when the same slide is handed back as a new object", () => {
        const onApply = makeApply();
        const { rerender } = render(
          <SlideImagesPromptModal
            open
            onOpenChange={() => {}}
            slide={SLIDE}
            lesson={LESSON}
            slideNumber={3}
            onApplySlide={onApply}
          />,
        );

        pasteResponse("work in progress");

        rerender(
          <SlideImagesPromptModal
            open
            onOpenChange={() => {}}
            slide={structuredClone(SLIDE)}
            lesson={LESSON}
            slideNumber={3}
            onApplySlide={onApply}
          />,
        );

        expect(getPasteTextarea().value).toBe("work in progress");
      });
    });

    describe("accessibility", () => {
      it("labels the textarea and describes it with the hint", () => {
        render(<Harness onApplySlide={makeApply()} />);

        const textarea = getPasteTextarea();
        expect(textarea).toHaveAccessibleName("Paste the AI's response");
        expect(textarea).toHaveAccessibleDescription(/paste the complete updated slide as json/i);
        expect(textarea).not.toHaveAttribute("aria-invalid");
      });

      it("links the error to the textarea and marks it invalid", async () => {
        const user = userEvent.setup();
        render(<Harness onApplySlide={makeApply()} />);

        pasteResponse("not json");
        await user.click(getApplyButton());
        const alert = await screen.findByRole("alert");

        const textarea = getPasteTextarea();
        expect(textarea).toHaveAttribute("aria-invalid", "true");
        expect(textarea.getAttribute("aria-describedby")).toContain(alert.id);
        expect(textarea).toHaveAccessibleDescription(/no json object found/i);
        expect(textarea).toHaveAccessibleDescription(/paste the complete updated slide as json/i);
      });

      it("moves focus to the alert when a response fails the checks", async () => {
        const user = userEvent.setup();
        render(<Harness onApplySlide={makeApply()} />);

        pasteResponse("not json");
        await user.click(getApplyButton());
        const alert = await screen.findByRole("alert");

        await waitFor(() => expect(alert).toHaveFocus());
      });

      it("moves focus to the alert again on a repeated failure", async () => {
        const user = userEvent.setup();
        render(<Harness onApplySlide={makeApply()} />);

        pasteResponse("not json");
        await user.click(getApplyButton());
        const alert = await screen.findByRole("alert");
        await waitFor(() => expect(alert).toHaveFocus());

        act(() => {
          getPasteTextarea().focus();
        });
        expect(getPasteTextarea()).toHaveFocus();

        await user.click(getApplyButton());

        await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
      });

      it("moves focus to the alert when saving fails", async () => {
        const user = userEvent.setup();
        const onApply = vi.fn<(slide: SlideData) => Promise<void>>().mockRejectedValue(new Error("Network error"));
        render(<Harness onApplySlide={onApply} />);

        pasteResponse(VALID_RESPONSE);
        await user.click(getApplyButton());
        const alert = await screen.findByRole("alert");

        await waitFor(() => expect(alert).toHaveFocus());
      });
    });
  });
});