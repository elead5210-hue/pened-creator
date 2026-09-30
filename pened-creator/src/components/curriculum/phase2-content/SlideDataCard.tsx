import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SlideData, SlideElementData } from "@/lib/curriculum/phase2-content/slideshowDeckValidator";

export interface SlideDataCardProps {
  /** The slide object to display. */
  slide: SlideData;
  /** One-based position of this slide in the deck, for the heading. */
  slideNumber: number;
  /** Display title for the slide (already falls back to "Slide N"). */
  title: string;
}

/** Keys shown in dedicated rows, so they're left out of the element's "other fields" list. */
const ELEMENT_KNOWN_KEYS = new Set(["id", "type", "position", "size", "content", "src"]);

function formatSize(value: number | "auto"): string {
  return value === "auto" ? "auto" : String(value);
}

function formatBackground(background: SlideData["background"]): string | null {
  if (background === undefined || background === null) return null;
  if (typeof background === "string") return background;
  try {
    return JSON.stringify(background, null, 2);
  } catch {
    return String(background);
  }
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ElementRow({ element, index }: { element: SlideElementData; index: number }) {
  const otherFields = Object.entries(element).filter(([key]) => !ELEMENT_KNOWN_KEYS.has(key));

  return (
    <li className="space-y-1.5 rounded-md border bg-muted/30 p-3" aria-label={`Element ${index + 1}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-xs uppercase">
          {element.type}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">{element.id}</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Position</dt>
        <dd className="font-mono">
          x: {element.position.x}, y: {element.position.y}
        </dd>

        <dt className="text-muted-foreground">Size</dt>
        <dd className="font-mono">
          {formatSize(element.size.width)} × {formatSize(element.size.height)}
        </dd>

        {typeof element.content === "string" ? (
          <>
            <dt className="text-muted-foreground">Content</dt>
            <dd className="whitespace-pre-wrap break-words">{element.content}</dd>
          </>
        ) : null}

        {typeof element.src === "string" ? (
          <>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="break-all font-mono">{element.src}</dd>
          </>
        ) : null}

        {otherFields.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="break-words font-mono">{formatUnknown(value)}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/**
 * Card showing one slide's data object in a readable layout: its id, title,
 * background, and each element with its type, position, size, and
 * type-specific fields (content or src). Any other slide-level fields the
 * AI included are listed under "Other fields" so nothing is hidden.
 */
export function SlideDataCard({ slide, slideNumber, title }: SlideDataCardProps) {
  const background = formatBackground(slide.background);
  const elements = Array.isArray(slide.elements) ? slide.elements : [];
  const otherSlideFields = Object.entries(slide).filter(
    ([key]) => !["id", "title", "background", "elements"].includes(key),
  );

  return (
    <Card aria-labelledby={`slide-data-card-title-${slideNumber}`}>
      <CardHeader>
        <CardTitle id={`slide-data-card-title-${slideNumber}`}>{title}</CardTitle>
        <CardDescription>
          Slide {slideNumber} · <span className="font-mono">{slide.id}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Title</dt>
          <dd>{typeof slide.title === "string" && slide.title.trim() ? slide.title : "(none)"}</dd>

          <dt className="text-muted-foreground">Background</dt>
          <dd>
            {background === null ? (
              "(none)"
            ) : (
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono">
                {background}
              </pre>
            )}
          </dd>
        </dl>

        <section className="space-y-2" aria-label="Slide elements">
          <h3 className="text-sm font-medium">
            Elements <span className="text-muted-foreground">({elements.length})</span>
          </h3>
          {elements.length === 0 ? (
            <p className="text-xs text-muted-foreground">This slide has no elements.</p>
          ) : (
            <ul className="space-y-2">
              {elements.map((element, index) => (
                <ElementRow key={`${element.id}-${index}`} element={element} index={index} />
              ))}
            </ul>
          )}
        </section>

        {otherSlideFields.length > 0 ? (
          <section className="space-y-1" aria-label="Other slide fields">
            <h3 className="text-sm font-medium">Other fields</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {otherSlideFields.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="break-words font-mono">{formatUnknown(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}