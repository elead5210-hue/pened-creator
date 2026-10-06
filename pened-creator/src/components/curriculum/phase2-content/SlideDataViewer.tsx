import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clampSlideIndex, extractSlides } from "@/lib/curriculum/phase2-content/slideshowDeckSlides";
import { replaceSlideInDeck } from "@/lib/curriculum/phase2-content/slideImagesResponse";
import {
  formatDeckErrors,
  parseAndValidateDeck,
  type SlideData,
  type SlideshowDeck,
} from "@/lib/curriculum/phase2-content/slideshowDeckValidator";
import { SlideDataBreadcrumbNav } from "./SlideDataBreadcrumbNav";
import { SlideDataCard } from "./SlideDataCard";
import { SlideImagesPromptModal, type SlideImagesPromptLesson } from "./SlideImagesPromptModal";

export interface SlideDataViewerProps {
  /**
   * The lesson's saved slideshow deck: a parsed deck object, raw/JSON text,
   * or null/undefined when nothing has been saved yet.
   */
  slideshowDeck: unknown;
  /** Optional zero-based slide index to start on (clamped into range). */
  initialIndex?: number;
  /**
   * The lesson record (or any object with `imagePrompts`, `images` and,
   * optionally, `imagesNoBg`). When supplied, each slide card shows an
   * "Add images" button that opens a modal with the prompt for the slide
   * currently shown, listing the lesson's uploaded images. An image that has a
   * background-removed version is listed with that version's exact URL as its
   * `src`, so the correct image is applied. The whole lesson object is passed
   * to the modal unchanged, so `imagesNoBg` reaches the prompt builder. When
   * omitted, the button is not shown.
   */
  lesson?: SlideImagesPromptLesson | null;
  /**
   * Called with the complete updated deck when the slide currently shown is
   * replaced (for example by the "Add images" modal). The parent saves it
   * and passes the saved deck back as `slideshowDeck`. The returned promise
   * should reject if the save fails, so the caller of the apply handler can
   * show the error. When the saved deck comes back, the viewer stays on the
   * slide that was edited instead of resetting to the first slide. When
   * omitted, the modal gets no apply handler.
   */
  onSlideUpdated?: (deck: SlideshowDeck) => Promise<void> | void;
}

/**
 * Returns a copy of `slide` without its image elements. All other elements
 * and fields are kept as they are. A slide with no elements array is
 * returned unchanged.
 */
function removeImageElements(slide: SlideData): SlideData {
  const record = slide as unknown as Record<string, unknown>;
  if (!Array.isArray(record.elements)) return slide;
  const remaining = record.elements.filter((element) => {
    if (element === null || typeof element !== "object") return true;
    return (element as { type?: unknown }).type !== "image";
  });
  return { ...record, elements: remaining } as unknown as SlideData;
}

/** Copies a JSON-like value with object keys sorted, so key order never matters. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonicalize(source[key])]),
    );
  }
  return value;
}

/**
 * A signature of a deck's content that ignores object key order and whether
 * the deck is given as an object or as JSON text. The server can return a
 * saved deck with its keys in a different order, so comparing plain
 * JSON.stringify output would wrongly treat our own save as a new deck.
 */
function canonicalSignature(value: unknown): string {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return parsed as string;
    }
  }
  try {
    return JSON.stringify(canonicalize(parsed)) ?? "";
  } catch {
    return "";
  }
}

/**
 * The per-slide data step shown after the slideshow data has been pasted and
 * saved. Extracts the slides from the saved deck and shows one slide's data
 * object per card, with breadcrumb-style Previous/Next navigation. Handles
 * the empty (nothing saved) and invalid (unparseable or failing validation)
 * states. When the deck's content changes, the view resets to the first
 * slide; clamping only guards against an out-of-range index (for example a
 * too-large or negative `initialIndex`). The one exception is a deck this
 * viewer itself handed to `onSlideUpdated`: when that saved deck comes back
 * as the new `slideshowDeck`, the view stays on the slide that was edited.
 */
export function SlideDataViewer({ slideshowDeck, initialIndex = 0, lesson, onSlideUpdated }: SlideDataViewerProps) {
  const extracted = useMemo(() => extractSlides(slideshowDeck), [slideshowDeck]);
  const [requestedIndex, setRequestedIndex] = useState(initialIndex);
  const headingRef = useRef<HTMLDivElement>(null);
  const hasNavigatedRef = useRef(false);
  // The canonical signature of the deck most recently handed to
  // onSlideUpdated, so that deck coming back as the prop isn't mistaken for
  // a deck replaced elsewhere. Null when no update is waiting to come back.
  const pendingSavedSignatureRef = useRef<string | null>(null);
  const addImagesButtonRef = useRef<HTMLButtonElement>(null);
  const wasModalOpenRef = useRef(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const totalSlides = extracted.totalSlides;
  const currentIndex = clampSlideIndex(requestedIndex, totalSlides);

  // Safeguard for an out-of-range index (for example a too-large or negative
  // `initialIndex`): pull the stored index back into range so later
  // navigation starts from the slide that is actually shown. A deck whose
  // content changes (including one that shrinks) is handled separately
  // below, by resetting to the first slide.
  useEffect(() => {
    if (requestedIndex !== currentIndex) {
      setRequestedIndex(currentIndex);
    }
  }, [requestedIndex, currentIndex]);

  // A stable signature of the deck's content. The route reloads the lesson
  // record in the background, which can hand us a new object with identical
  // content; comparing the content (not the object identity) avoids resetting
  // the user's position on those no-op refreshes.
  const deckSignature = useMemo(() => {
    if (typeof slideshowDeck === "string") return slideshowDeck;
    try {
      return JSON.stringify(slideshowDeck) ?? "";
    } catch {
      return "";
    }
  }, [slideshowDeck]);
  const previousSignatureRef = useRef(deckSignature);

  // When the deck's content actually changes (e.g. the user re-saved it),
  // start again from the first slide, and don't move focus as a result of
  // that reset since the user didn't navigate.
  useEffect(() => {
    if (previousSignatureRef.current === deckSignature) return;
    previousSignatureRef.current = deckSignature;

    // If this is the deck this viewer just saved, keep the user where they
    // are. Any other change (for example a deck re-saved in the Generate
    // Slideshow Data step) falls through and resets as before.
    const pendingSignature = pendingSavedSignatureRef.current;
    pendingSavedSignatureRef.current = null;
    if (pendingSignature !== null && pendingSignature === canonicalSignature(slideshowDeck)) {
      return;
    }

    hasNavigatedRef.current = false;
    // Close the modal without pulling focus back: the user didn't close it.
    wasModalOpenRef.current = false;
    setIsModalOpen(false);
    setRequestedIndex(0);
  }, [deckSignature, slideshowDeck]);

  // After the user navigates, move focus to the card region so keyboard and
  // screen-reader users land on the new slide's content. This never runs on
  // the initial mount, because hasNavigatedRef is only set by handleNavigate.
  useEffect(() => {
    if (hasNavigatedRef.current) {
      headingRef.current?.focus();
    }
  }, [currentIndex]);

  // Return focus to the "Add images" button once the modal has closed
  // (Escape, Close button, or click-outside).
  useEffect(() => {
    if (isModalOpen) {
      wasModalOpenRef.current = true;
      return;
    }
    if (!wasModalOpenRef.current) return;
    wasModalOpenRef.current = false;
    const timer = setTimeout(() => {
      addImagesButtonRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [isModalOpen]);

  function handleNavigate(index: number) {
    hasNavigatedRef.current = true;
    setRequestedIndex(clampSlideIndex(index, totalSlides));
  }

  /**
   * Replaces the slide currently shown with `updatedSlide` in the saved deck
   * and hands the whole deck to `onSlideUpdated`. Rejects (with the parent's
   * error) if the save fails, leaving the view as it was.
   */
  async function handleApplySlide(updatedSlide: SlideData): Promise<void> {
    if (!onSlideUpdated) return;

    const parsed = parseAndValidateDeck(slideshowDeck);
    if (!parsed.ok) {
      throw new Error("The saved slideshow data couldn't be read, so the slide can't be updated.");
    }

    const updatedDeck = replaceSlideInDeck(parsed.deck, currentIndex, updatedSlide);
    const signature = canonicalSignature(updatedDeck);
    pendingSavedSignatureRef.current = signature;

    try {
      await onSlideUpdated(updatedDeck);
    } catch (err) {
      // The save failed, so no deck is coming back; don't let this stale
      // signature hide a later, genuine change.
      if (pendingSavedSignatureRef.current === signature) {
        pendingSavedSignatureRef.current = null;
      }
      throw err;
    }
  }

  /**
   * Removes every image element from `slide` (the slide currently shown) and
   * saves the deck through the same path as other slide updates. The view
   * stays on the same slide. Reports success or failure with a toast.
   */
  async function handleResetSlide(slide: SlideData): Promise<void> {
    setIsResetting(true);
    try {
      await handleApplySlide(removeImageElements(slide));
      toast.success("Slide reset. All images were removed from this slide.");
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Something went wrong.";
      toast.error(`Couldn't reset the slide. ${message}`);
    } finally {
      setIsResetting(false);
      setIsResetConfirmOpen(false);
    }
  }

  if (extracted.status === "empty") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Slide Data</CardTitle>
          <CardDescription>
            No slideshow data has been saved for this lesson yet. Paste and save the AI's response in
            the previous step to see each slide's data here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (extracted.status === "invalid") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Slide Data</CardTitle>
          <CardDescription>
            The saved slideshow data couldn't be read, so its slides can't be shown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div role="alert" className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-xs font-medium text-destructive">
              {extracted.errors.length === 1
                ? "1 problem was found with the saved deck:"
                : `${extracted.errors.length} problems were found with the saved deck:`}
            </p>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
              {formatDeckErrors(extracted.errors)}
            </pre>
            <p className="text-xs text-muted-foreground">
              Go back to the previous step and paste a corrected response, then save it again.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const current = extracted.slides[currentIndex];
  if (!current) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Slide Data{extracted.deckTitle ? ` — ${extracted.deckTitle}` : ""}</h2>
        <p className="text-xs text-muted-foreground">
          {extracted.isSingleSlide
            ? "This deck has a single slide."
            : `Use Previous and Next (or the left and right arrow keys) to move through the ${totalSlides} slides.`}
        </p>
      </div>

      <SlideDataBreadcrumbNav
        currentIndex={currentIndex}
        totalSlides={totalSlides}
        currentTitle={current.title}
        onNavigate={handleNavigate}
      />

      <div
        ref={headingRef}
        tabIndex={-1}
        role="region"
        aria-label={`${current.title}, slide ${current.number} of ${totalSlides}`}
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SlideDataCard
          slide={current.data}
          slideNumber={current.number}
          title={current.title}
          onAddImages={lesson ? () => setIsModalOpen(true) : undefined}
          addImagesButtonRef={addImagesButtonRef}
        />
      </div>

      {lesson && onSlideUpdated ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isResetting}
            onClick={() => setIsResetConfirmOpen(true)}
          >
            Reset slide
          </Button>
          <AlertDialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset this slide?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes every image from slide {current.number} so you can start the image
                  process over. Other slides and this slide's other elements are not changed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isResetting}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleResetSlide(current.data);
                  }}
                >
                  {isResetting ? "Resetting..." : "Reset slide"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}

      {lesson ? (
        <SlideImagesPromptModal
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          slide={current.data}
          lesson={lesson}
          slideNumber={current.number}
          slideTitle={current.title}
          onApplySlide={onSlideUpdated ? handleApplySlide : undefined}
        />
      ) : null}
    </div>
  );
}