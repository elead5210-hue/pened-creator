
import { Component, type ReactNode } from "react";
import { ToolContentFrame } from "@/components/tools/ToolContentFrame";

export interface ContentBlock {
  tool: string;
  data?: unknown;
}

/**
 * Renders a single unrecognized-tool placeholder block, for blocks with
 * a missing or non-string `tool` id. Blocks with a well-formed `tool` id
 * are always routed to `ToolContentFrame` instead (see ContentDispatcher
 * below), so malformed or truly-unknown content doesn't silently
 * disappear from the rendered view.
 */
function UnknownBlock({ tool }: { tool: string | undefined }) {
  return (
    <section className="space-y-1 rounded-md border border-dashed border-border p-4">
      <p className="text-sm text-muted-foreground">
        Unrecognized content block: &quot;{tool ?? "unknown"}&quot;. This tool is not in the current
        TOOL REGISTRY.
      </p>
    </section>
  );
}

interface BlockErrorBoundaryProps {
  tool: string | undefined;
  children: ReactNode;
}

interface BlockErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches rendering errors thrown by an individual block's renderer
 * component (e.g. from malformed `data`) and falls back to the unknown-
 * block placeholder, mirroring the try/catch-per-block behavior of the
 * original vanilla-JS content dispatcher.
 */
class BlockErrorBoundary extends Component<BlockErrorBoundaryProps, BlockErrorBoundaryState> {
  state: BlockErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): BlockErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <UnknownBlock tool={this.props.tool} />;
    }
    return this.props.children;
  }
}

/**
 * Renders an array of generated content blocks in sequence, dispatching
 * each one to the renderer matching its `tool` id. Blocks with an
 * unrecognized `tool` id (or that throw while rendering) render a
 * visible placeholder rather than being silently skipped.
 *
 * Usage:
 *   <ContentDispatcher blocks={lessonRecord.generatedContent} lessonId={lessonRecord.id} />
 */
export function ContentDispatcher({
  blocks,
  lessonId,
}: {
  blocks?: ContentBlock[] | unknown[] | null;
  /**
   * The lesson id (`<project_id>:<lesson_node_id>`) these blocks belong to.
   * Passed through to `ToolContentFrame` so a stray slideshow block can
   * link to the full-lesson slideshow instead of trying to inline it.
   */
  lessonId?: string | null;
}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No content has been generated for this lesson yet.
      </p>
    );
  }

  return (
    <>
      {blocks.map((rawBlock, index) => {
        const block = rawBlock as ContentBlock;
        const tool = block && typeof block.tool === "string" ? block.tool : undefined;

        if (!tool) {
          return <UnknownBlock key={index} tool={tool} />;
        }

        return (
          <BlockErrorBoundary key={index} tool={tool}>
            <ToolContentFrame toolId={tool} data={block?.data} lessonId={lessonId} />
          </BlockErrorBoundary>
        );
      })}
    </>
  );
}