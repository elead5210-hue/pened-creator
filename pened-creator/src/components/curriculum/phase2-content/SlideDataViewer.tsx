import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clampSlideIndex, extractSlides } from "@/lib/curriculum/phase2-content/slideshowDeckSlides";
import { formatDeckErrors } from "@/lib/curriculum/phase2-content/slideshowDeckValidator";
import { SlideDataBreadcrumbNav } from "./SlideDataBreadcrumbNav";
import { SlideDataCard } from "./SlideDataCard";

export interface SlideDataViewerProps {
  /**
   * The lesson's saved slideshow deck: a parsed deck object, raw/JSON text,
   * or null/undefined when nothing has been saved yet.
   */
  slideshowDeck: unknown;
  /** Optional zero-based slide index to start on (clamped into range). */
  initialIndex?: number;
}

/**
 * The per-slide data step shown after the slideshow data has been pasted and
 * saved. Extracts the slides from the saved deck and shows one slide's data
 * object per card, with breadcrumb-style Previous/Next navigation. Handles
 * the empty (nothing saved) and invalid (unparseable or failing validation)
 * states. When the deck's content changes, the view resets to the first
 * slide; clamping only guards against an out-of-range index (for example a
 * too-large or negative `initialIndex`).
 */
export function SlideDataViewer({ slideshowDeck, initialIndex = 0 }: SlideDataViewerProps) {
  const extracted = useMemo(() => extractSlides(slideshowDeck), [slideshowDeck]);
  const [requestedIndex, setRequestedIndex] = useState(initialIndex);
  const headingRef = useRef<HTMLDivElement>(null);
  const hasNavigatedRef = useRef(false);

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
    hasNavigatedRef.current = false;
    setRequestedIndex(0);
  }, [deckSignature]);

  // After the user navigates, move focus to the card region so keyboard and
  // screen-reader users land on the new slide's content. This never runs on
  // the initial mount, because hasNavigatedRef is only set by handleNavigate.
  useEffect(() => {
    if (hasNavigatedRef.current) {
      headingRef.current?.focus();
    }
  }, [currentIndex]);

  function handleNavigate(index: number) {
    hasNavigatedRef.current = true;
    setRequestedIndex(clampSlideIndex(index, totalSlides));
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
        <SlideDataCard slide={current.data} slideNumber={current.number} title={current.title} />
      </div>
    </div>
  );
}