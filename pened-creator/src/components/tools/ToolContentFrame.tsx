
import { useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { encodeToolViewerUrl, ToolViewerEncodingError } from "@/lib/toolRenderer/toolViewerUrl";
import { SLIDESHOW_TOOL_ID } from "@/lib/curriculum/phase2-content/slideshowInteractiveContent";
import { resolveSlideshowLink } from "@/lib/curriculum/phase2-content/slideshowToolUrl";

interface ToolContentFrameProps {
  /** The registered tool id (from GET /api/tools) to render. */
  toolId: string;
  /** The content block's tool-specific payload, passed through as-is. */
  data: unknown;
  /**
   * Accessible label for the iframe and used in the "open in new tab"
   * link/fallback copy. Defaults to `toolId` when omitted.
   */
  title?: string;
  /** Iframe height. Defaults to 480px; accepts any CSS length. */
  height?: number | string;
  className?: string;
  /**
   * The lesson id (`<project_id>:<lesson_node_id>`) this block belongs to.
   * Only used when `toolId` is `SLIDESHOW_TOOL_ID`, to build a link to the
   * full-lesson slideshow (see @/lib/curriculum/phase2-content/slideshowToolUrl.ts's
   * resolveSlideshowLink) instead of trying to inline it.
   */
  lessonId?: string | null;
}

/**
 * Embeds a single TOOL REGISTRY content block by loading it, sandboxed,
 * in an iframe pointed at the Tool Renderer app (see
 * @/lib/toolRenderer/toolViewerUrl.ts's encodeToolViewerUrl and
 * @/lib/toolRenderer/config.ts's getToolRendererBaseUrl).
 *
 * Renders one of three things:
 *  - `VITE_TOOL_RENDERER_BASE_URL` unset: a clear inline message
 *    instead of a silently blank frame (encodeToolViewerUrl returns
 *    `undefined` in this case).
 *  - The iframe failed to load (`onError`): a fallback message with an
 *    "open in new tab" link to the same URL, since some content may not
 *    render inside a sandboxed iframe (e.g. it opens popups) even when
 *    the renderer itself is reachable.
 *  - Otherwise: the sandboxed iframe, with a skeleton shown until it
 *    fires `onLoad`, plus an "open in new tab" link underneath for when
 *    embedding isn't desired.
 *
 * A block whose `toolId` is `SLIDESHOW_TOOL_ID` is never inlined here -
 * slideshow decks are assembled deterministically from the lesson's other
 * blocks (see ../../lib/curriculum/phase2-content/slideshowDeckBuilder.ts)
 * and can be arbitrarily large, so this instead points at the full-lesson
 * slideshow link (`resolveSlideshowLink`). Likewise, if `encodeToolViewerUrl`
 * throws a `ToolViewerEncodingError` (e.g. the built URL is over
 * `MAX_TOOL_VIEWER_URL_LENGTH`), that's caught here and rendered as an
 * informative inline message rather than propagating as a render error.
 */
export function ToolContentFrame({ toolId, data, title, height = 480, className, lessonId }: ToolContentFrameProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const label = title ?? toolId;
  const resolvedHeight = typeof height === "number" ? `${height}px` : height;

  if (toolId === SLIDESHOW_TOOL_ID) {
    const link = resolveSlideshowLink(lessonId);
    return (
      <Alert className={className}>
        <AlertTriangle />
        <AlertTitle>Slideshow content isn&apos;t previewed here</AlertTitle>
        <AlertDescription>
          {link.ok ? (
            <>
              <p>
                Slideshow decks are assembled from this lesson&apos;s other blocks and can be too
                large to preview inline. View the full lesson slideshow instead.
              </p>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                Open full lesson slideshow <ExternalLink className="size-3.5" />
              </a>
            </>
          ) : (
            <p>{link.message}</p>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  let url: string | undefined;
  let encodingError: ToolViewerEncodingError | null = null;
  try {
    url = encodeToolViewerUrl(toolId, data);
  } catch (err) {
    if (err instanceof ToolViewerEncodingError) {
      encodingError = err;
    } else {
      throw err;
    }
  }

  if (encodingError) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertTriangle />
        <AlertTitle>Couldn&apos;t prepare &quot;{label}&quot; for preview</AlertTitle>
        <AlertDescription>
          <p>{encodingError.message}</p>
        </AlertDescription>
      </Alert>
    );
  }

  if (url === undefined) {
    return (
      <Alert className={className}>
        <AlertTriangle />
        <AlertTitle>Tool Renderer not configured</AlertTitle>
        <AlertDescription>
          Set <code className="font-mono text-xs">VITE_TOOL_RENDERER_BASE_URL</code> to preview
          &quot;{label}&quot; here.
        </AlertDescription>
      </Alert>
    );
  }

  if (errored) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertTriangle />
        <AlertTitle>Couldn&apos;t embed &quot;{label}&quot;</AlertTitle>
        <AlertDescription>
          <p>This tool couldn&apos;t be loaded in an embedded frame.</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
          >
            Open in new tab <ExternalLink className="size-3.5" />
          </a>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={cn("space-y-2 rounded-md border border-border p-4", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="relative w-full overflow-hidden rounded-md border border-border" style={{ height: resolvedHeight }}>
        {!loaded && <Skeleton className="absolute inset-0 h-full w-full rounded-none" />}
        <iframe
          src={url}
          title={label}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          className={cn("h-full w-full border-0", !loaded && "invisible")}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Open in new tab <ExternalLink className="size-3" />
      </a>
    </div>
  );
}