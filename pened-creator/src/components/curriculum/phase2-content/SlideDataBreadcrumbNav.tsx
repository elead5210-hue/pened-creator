import { useCallback, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

export interface SlideDataBreadcrumbNavProps {
  /** Zero-based index of the slide currently shown. */
  currentIndex: number;
  /** Total number of slides in the deck. */
  totalSlides: number;
  /** Title of the current slide, shown as the last breadcrumb item. */
  currentTitle?: string;
  /** Called with the new zero-based index when the user navigates. */
  onNavigate: (index: number) => void;
  /** Optional extra class names for the wrapper. */
  className?: string;
}

/**
 * Breadcrumb-style Previous/Next navigation for the per-slide data view.
 *
 * Shows "Slide N of M" (plus the slide's title) as a breadcrumb trail, with
 * Previous and Next buttons that are disabled at the first and last slide.
 * Arrow Left/Right also move between slides when focus is inside this
 * component. The current position is announced to screen readers through a
 * polite live region.
 */
export function SlideDataBreadcrumbNav({
  currentIndex,
  totalSlides,
  currentTitle,
  onNavigate,
  className,
}: SlideDataBreadcrumbNavProps) {
  const hasSlides = totalSlides > 0;
  const lastIndex = Math.max(totalSlides - 1, 0);
  const safeIndex = Math.min(Math.max(currentIndex, 0), lastIndex);
  const isFirst = !hasSlides || safeIndex <= 0;
  const isLast = !hasSlides || safeIndex >= lastIndex;
  const positionLabel = hasSlides ? `Slide ${safeIndex + 1} of ${totalSlides}` : "No slides";

  const goPrevious = useCallback(() => {
    if (!isFirst) onNavigate(safeIndex - 1);
  }, [isFirst, onNavigate, safeIndex]);

  const goNext = useCallback(() => {
    if (!isLast) onNavigate(safeIndex + 1);
  }, [isLast, onNavigate, safeIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  }

  const trimmedTitle = currentTitle?.trim();

  return (
    <nav
      aria-label="Slide navigation"
      className={cn("flex flex-wrap items-center justify-between gap-2", className)}
      onKeyDown={handleKeyDown}
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={goPrevious}
        disabled={isFirst}
        aria-label="Previous slide"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Previous
      </Button>

      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="justify-center">
          <BreadcrumbItem>
            <span className="text-xs text-muted-foreground">{positionLabel}</span>
          </BreadcrumbItem>
          {hasSlides && trimmedTitle ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate text-xs font-medium">{trimmedTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={goNext}
        disabled={isLast}
        aria-label="Next slide"
      >
        Next
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      <span className="sr-only" role="status" aria-live="polite">
        {positionLabel}
        {hasSlides && trimmedTitle ? `: ${trimmedTitle}` : ""}
      </span>
    </nav>
  );
}