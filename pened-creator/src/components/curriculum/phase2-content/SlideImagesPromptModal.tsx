import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copyTextToClipboard, downloadTextFile } from "@/lib/curriculum/phase2-content/download";
import {
  buildSlideImagesPrompt,
  type SlideImagesLessonInput,
} from "@/lib/curriculum/phase2-content/slideImagesPromptBuilder";
import { getAllowedImageSrcs, parseSlideImagesResponse } from "@/lib/curriculum/phase2-content/slideImagesResponse";
import type { DeckError, SlideData } from "@/lib/curriculum/phase2-content/slideshowDeckValidator";

/**
 * The parts of the lesson record this modal reads: the image data the prompt
 * builder needs, plus optional identifiers used only to name the download.
 */
export type SlideImagesPromptLesson = SlideImagesLessonInput & {
  id?: string | null;
  project_id?: string | null;
  lesson_node_id?: string | null;
};

export interface SlideImagesPromptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The slide's data object exactly as saved in the deck (the slide currently shown). */
  slide: unknown;
  /**
   * The lesson record (or any object with `imagePrompts` and `images`). When it
   * also has `imagesNoBg`, the exact background-removed image URL for each image
   * is passed through to the prompt builder and listed in the prompt as that
   * image's `src`.
   */
  lesson: SlideImagesPromptLesson | null | undefined;
  /** One-based slide number, for the title and download filename. */
  slideNumber?: number;
  /** The slide's title, shown in the description when present. */
  slideTitle?: string;
  /**
   * When provided, the modal shows a "Paste the AI's response" area under the
   * prompt. The pasted response is parsed and checked against the slide and
   * the lesson's uploaded images, and if it passes this is called with the
   * validated updated slide, which replaces the slide currently shown. It
   * should return a promise that rejects if saving fails: the modal then shows
   * the error, keeps the pasted text and stays open. When omitted, the modal
   * is read-only and nothing is saved from it.
   */
  onApplySlide?: (slide: SlideData) => Promise<void>;
}

/** Makes an arbitrary string safe to use as part of a filename. */
function sanitizeFilenamePart(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildFilename(lesson: SlideImagesPromptLesson | null | undefined, slideNumber?: number): string {
  const projectPart = sanitizeFilenamePart(lesson?.project_id) || "project";
  const lessonPart = sanitizeFilenamePart(lesson?.lesson_node_id) || "lesson";
  const slidePart = slideNumber && slideNumber > 0 ? `slide-${slideNumber}` : "slide";
  return `${projectPart}_${lessonPart}_${slidePart}_images-prompt.txt`;
}

/** Whether the slide prop has the minimum shape needed to check a response against it. */
function isSlideData(value: unknown): value is SlideData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as { id?: unknown; elements?: unknown };
  return typeof candidate.id === "string" && Array.isArray(candidate.elements);
}

/** A short message for a failed save, using the error's own message when it has one. */
function describeSaveError(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : "Something went wrong while saving the slide. Try again.";
}

/**
 * Read-only modal that builds and shows the "add images" prompt for one slide,
 * with copy-to-clipboard and download-as-text actions.
 *
 * Built on the Dialog primitive (Radix), which provides the focus trap,
 * Escape to close, click-outside dismissal, and the dialog ARIA roles. The
 * prompt is rebuilt from the `slide` and `lesson` props on every render (via
 * useMemo), so it always matches the slide currently shown.
 *
 * When `onApplySlide` is provided, a "Paste the AI's response" area sits under
 * the prompt. Applying runs the response through parseSlideImagesResponse
 * (the same deck validator rules, plus checks that the existing elements are
 * untouched and every new image is one of the uploaded images). Problems are
 * shown as a list of field paths in an alert and the pasted text is kept so
 * it can be fixed and retried; a response that passes is handed to
 * `onApplySlide`. A failed save is shown as its own message. While saving, the
 * paste area is disabled and the modal can't be dismissed. On success the
 * modal closes (focus returns to the "Add images" button), and the pasted
 * text and any errors are cleared whenever the modal closes or the slide
 * changes. Without `onApplySlide` the modal is read-only.
 *
 * When the lesson has no uploaded images the modal explains that, and the
 * copy and download actions are disabled because there is nothing to place.
 */
export function SlideImagesPromptModal({
  open,
  onOpenChange,
  slide,
  lesson,
  slideNumber,
  slideTitle,
  onApplySlide,
}: SlideImagesPromptModalProps) {
  const [isCopying, setIsCopying] = useState(false);

  // Paste-the-response area state.
  const [pastedText, setPastedText] = useState("");
  const [applyErrors, setApplyErrors] = useState<DeckError[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Bumped each time an error is shown, so focus moves to the alert on every
  // failed attempt, even when the message is the same as last time.
  const [errorFocusToken, setErrorFocusToken] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);

  const textareaId = useId();
  const noImagesId = `${textareaId}-no-images`;
  const imageCountId = `${textareaId}-image-count`;
  const pasteId = `${textareaId}-paste`;
  const pasteHintId = `${textareaId}-paste-hint`;
  const applyErrorId = `${textareaId}-apply-error`;

  // The element that had focus when the modal opened, so focus can be
  // restored to it explicitly on close instead of relying only on the dialog
  // primitive's unmount-time focus restore.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  // Only build the prompt while the modal is open.
  const result = useMemo(() => (open ? buildSlideImagesPrompt(slide, lesson) : null), [open, slide, lesson]);

  const promptText = result?.prompt ?? "";
  const imageCount = result?.images.length ?? 0;
  const hasImages = result?.hasImages ?? false;

  const filename = useMemo(() => buildFilename(lesson, slideNumber), [lesson, slideNumber]);

  // Capture the trigger when the modal opens and restore focus to it once
  // the modal has closed (Escape, Close button, or click-outside).
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const active = document.activeElement;
      previouslyFocusedRef.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
    } else if (!open && wasOpenRef.current) {
      const target = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (target && target.isConnected) {
        // Wait a tick so this runs after the dialog primitive has unmounted
        // and finished its own focus handling.
        const timer = setTimeout(() => {
          if (target.isConnected) target.focus();
        }, 0);
        wasOpenRef.current = open;
        return () => clearTimeout(timer);
      }
    }
    wasOpenRef.current = open;
  }, [open]);

  async function handleCopy() {
    if (!hasImages) return;
    setIsCopying(true);
    try {
      await copyTextToClipboard(promptText);
      toast.success("Copied!");
    } catch {
      toast.error("Copy failed — select the text manually.");
    } finally {
      setIsCopying(false);
    }
  }

  function handleDownload() {
    if (!hasImages) return;
    try {
      downloadTextFile(promptText, filename);
      toast.success("Downloaded.");
    } catch {
      toast.error("Download failed — try copying instead.");
    }
  }

  // A signature of the slide's content, so the pasted text is only cleared
  // when the slide really changes, not when the same slide is handed back as
  // a new object by a background refresh.
  const slideKey = useMemo(() => {
    try {
      return JSON.stringify(slide) ?? "";
    } catch {
      return "";
    }
  }, [slide]);

  // Clear the pasted text and any errors whenever the modal opens or closes or
  // the slide changes, so a response for one slide is never applied to another.
  useEffect(() => {
    setPastedText("");
    setApplyErrors(null);
    setSaveError(null);
  }, [open, slideKey, slideNumber]);

  // Move focus to the error alert whenever an error is shown, so keyboard and
  // screen-reader users land on it.
  useEffect(() => {
    if (errorFocusToken > 0) {
      errorRef.current?.focus();
    }
  }, [errorFocusToken]);

  function showApplyErrors(errors: DeckError[]) {
    setSaveError(null);
    setApplyErrors(errors);
    setErrorFocusToken((token) => token + 1);
  }

  function showSaveError(message: string) {
    setApplyErrors(null);
    setSaveError(message);
    setErrorFocusToken((token) => token + 1);
  }

  // The modal can't be dismissed while a save is in flight (Escape, the close
  // button and a click outside all come through here).
  function handleOpenChange(next: boolean) {
    if (!next && isSaving) return;
    onOpenChange(next);
  }

  async function handleApply() {
    if (!onApplySlide || isSaving) return;

    if (!pastedText.trim()) {
      showApplyErrors([{ path: "$", message: "Paste the AI's response first." }]);
      return;
    }

    if (!isSlideData(slide)) {
      showApplyErrors([{ path: "$", message: "This slide's data couldn't be read, so a response can't be applied." }]);
      return;
    }

    const parsed = parseSlideImagesResponse(pastedText, slide, getAllowedImageSrcs(lesson));
    if (!parsed.ok) {
      showApplyErrors(parsed.errors);
      return;
    }

    setApplyErrors(null);
    setSaveError(null);
    setIsSaving(true);
    try {
      await onApplySlide(parsed.slide);
    } catch (err) {
      setIsSaving(false);
      showSaveError(describeSaveError(err));
      return;
    }

    setIsSaving(false);
    setPastedText("");
    toast.success("Images added to the slide.");
    onOpenChange(false);
  }

  const hasApplyErrors = applyErrors !== null && applyErrors.length > 0;
  const hasError = hasApplyErrors || saveError !== null;

  const slideLabel = slideNumber && slideNumber > 0 ? `slide ${slideNumber}` : "this slide";
  const title = slideNumber && slideNumber > 0 ? `Add images to slide ${slideNumber}` : "Add images to this slide";
  const trimmedSlideTitle = slideTitle?.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        data-testid="slide-images-prompt-modal"
        aria-busy={isSaving}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {trimmedSlideTitle ? `“${trimmedSlideTitle}”. ` : ""}
            {onApplySlide
              ? `Copy this prompt into an AI assistant, then paste its response below to add the images to ${slideLabel}. Applying it replaces ${slideLabel} in the saved deck.`
              : `Copy this prompt into an AI assistant to add image elements to ${slideLabel}. Nothing is saved from here.`}
          </DialogDescription>
        </DialogHeader>

        {!hasImages ? (
          <Alert id={noImagesId} role="status" data-testid="slide-images-no-images">
            <ImageOff className="size-4" aria-hidden="true" />
            <AlertTitle>No images uploaded yet</AlertTitle>
            <AlertDescription>
              This lesson has no uploaded images to place on the slide. Upload images in the Image Generation step,
              then come back to build this prompt. Copy and download are unavailable until then.
            </AlertDescription>
          </Alert>
        ) : (
          <p id={imageCountId} className="text-sm text-muted-foreground" data-testid="slide-images-count">
            {imageCount} uploaded image{imageCount === 1 ? "" : "s"} listed in the prompt.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor={textareaId}>Generated prompt (read-only)</Label>
          <Textarea
            id={textareaId}
            value={promptText}
            readOnly
            spellCheck={false}
            rows={18}
            className="min-h-[320px] font-mono text-xs"
            aria-describedby={hasImages ? imageCountId : noImagesId}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>

        {onApplySlide ? (
          <div className="space-y-2 border-t border-border pt-4" data-testid="slide-images-apply-area">
            <Label htmlFor={pasteId}>Paste the AI's response</Label>
            <p id={pasteHintId} className="text-xs text-muted-foreground">
              {hasImages
                ? `Paste the complete updated slide as JSON. It replaces ${slideLabel} in the saved deck, and nothing changes until it passes the checks.`
                : "There are no uploaded images, so there is nothing to apply. Upload images in the Image Generation step first."}
            </p>
            <Textarea
              id={pasteId}
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
              rows={8}
              spellCheck={false}
              disabled={!hasImages || isSaving}
              placeholder="Paste the AI's JSON response here"
              className="font-mono text-xs"
              aria-describedby={hasError ? `${pasteHintId} ${applyErrorId}` : pasteHintId}
              aria-invalid={hasError ? true : undefined}
            />

            {hasError ? (
              <div
                ref={errorRef}
                id={applyErrorId}
                role="alert"
                tabIndex={-1}
                data-testid="slide-images-apply-error"
                className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {saveError !== null ? (
                  <>
                    <p className="font-medium text-destructive">Couldn't save the slide</p>
                    <p className="break-words text-destructive">{saveError}</p>
                    <p className="text-muted-foreground">
                      Your pasted response is kept. Try applying it again.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-destructive">
                      {(applyErrors ?? []).length === 1
                        ? "1 problem was found with the response:"
                        : `${(applyErrors ?? []).length} problems were found with the response:`}
                    </p>
                    <ul className="list-disc space-y-1 pl-4 font-mono text-destructive">
                      {(applyErrors ?? []).map((error, index) => (
                        <li key={`${error.path}-${index}`} className="break-words">
                          {error.path !== "$" ? `${error.path}: ${error.message}` : error.message}
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground">
                      Fix the response (or ask the AI to correct it), then apply it again. Your pasted text is kept.
                    </p>
                  </>
                )}
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={handleApply} disabled={!hasImages || isSaving}>
                {isSaving ? "Saving..." : "Apply to slide"}
              </Button>
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={isSaving}>
            Close
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleDownload} disabled={!hasImages}>
            Download as Text
          </Button>
          <Button type="button" size="sm" onClick={handleCopy} disabled={!hasImages || isCopying}>
            {isCopying ? "Copying..." : "Copy to Clipboard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SlideImagesPromptModal;