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
  /** The lesson record (or any object with `imagePrompts` and `images`). */
  lesson: SlideImagesPromptLesson | null | undefined;
  /** One-based slide number, for the title and download filename. */
  slideNumber?: number;
  /** The slide's title, shown in the description when present. */
  slideTitle?: string;
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

/**
 * Read-only modal that builds and shows the "add images" prompt for one slide,
 * with copy-to-clipboard and download-as-text actions.
 *
 * Built on the Dialog primitive (Radix), which provides the focus trap,
 * Escape to close, click-outside dismissal, and the dialog ARIA roles. The
 * prompt is rebuilt from the `slide` and `lesson` props on every render (via
 * useMemo), so it always matches the slide currently shown. Nothing is done
 * with an AI's response: this modal only displays the prompt.
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
}: SlideImagesPromptModalProps) {
  const [isCopying, setIsCopying] = useState(false);

  const textareaId = useId();
  const noImagesId = `${textareaId}-no-images`;
  const imageCountId = `${textareaId}-image-count`;

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

  const slideLabel = slideNumber && slideNumber > 0 ? `slide ${slideNumber}` : "this slide";
  const title = slideNumber && slideNumber > 0 ? `Add images to slide ${slideNumber}` : "Add images to this slide";
  const trimmedSlideTitle = slideTitle?.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        data-testid="slide-images-prompt-modal"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {trimmedSlideTitle ? `“${trimmedSlideTitle}”. ` : ""}
            Copy this prompt into an AI assistant to add image elements to {slideLabel}. Nothing is saved from
            here.
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

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
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