import { ChevronRight, FolderTree, FileText, HelpCircle } from "lucide-react";
import type { CurriculumNode } from "@/lib/curriculum/shared/schema";
import { LESSON_NODE_TYPE } from "@/lib/curriculum/shared/schema";
import { cn } from "@/lib/utils";
import { LessonPipelineBadge } from "@/components/shell/LessonPipelineBadge";
import type { PipelineStage } from "@/lib/curriculum/shared/lessonPipelineStatus";

/**
 * Resolves a stable identifier for a tree node used both as its React key
 * and as the key under which its expand/collapse state is tracked.
 * Falls back to a label+index composite for nodes without an id (mirrors
 * the key fallback this component has always used for React's key prop),
 * though a stable node.id is strongly preferred since the fallback isn't
 * guaranteed to stay the same across reloads if sibling order shifts.
 */
function getNodeKey(node: CurriculumNode, index: number): string {
  return node.id ?? `${node.label}-${index}`;
}

/**
 * Resolves whether a given node key is currently expanded: an explicit
 * entry in the expandedIds map wins, otherwise falls back to the
 * previous default behavior of auto-expanding the first two levels.
 */
function isExpanded(nodeKey: string, depth: number, expandedIds: Record<string, boolean>): boolean {
  return Object.prototype.hasOwnProperty.call(expandedIds, nodeKey)
    ? expandedIds[nodeKey]
    : depth < 2;
}

interface NodeRowProps {
  node: CurriculumNode;
  nodeKey: string;
  depth: number;
  onQuestionNodeClick?: (sourceQuestionId: string) => void;
  /** Lookup of lesson node id -> its current PipelineStage. */
  pipelineStageByNodeId?: Record<string, PipelineStage>;
  /**
   * Called instead of the row's expand/collapse toggle when a LESSON leaf
   * node is clicked. Passed the node itself and whether it already has a
   * saved breakdown, so the caller can decide whether to open the prompt
   * panel or navigate to the lesson's detail route.
   */
  onLessonNodeClick?: (node: CurriculumNode, hasSavedBreakdown: boolean) => void;
  /**
   * Controlled expand/collapse state, keyed by node key (see getNodeKey).
   * A node key absent from this map falls back to the original
   * depth-based default (expanded for the first two levels) via
   * isExpanded, rather than every row managing its own local state.
   */
  expandedIds: Record<string, boolean>;
  /**
   * Called with a node's key when its expand/collapse toggle should flip.
   * The caller (ultimately TreeView's owner) is responsible for computing
   * the next boolean and persisting it - NodeRow itself no longer holds
   * any open/closed state.
   */
  onToggle: (nodeKey: string) => void;
}

function NodeRow({
  node,
  nodeKey,
  depth,
  onQuestionNodeClick,
  pipelineStageByNodeId,
  onLessonNodeClick,
  expandedIds,
  onToggle,
}: NodeRowProps) {
  const open = isExpanded(nodeKey, depth, expandedIds);
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const sourceQuestionId = node.sourceQuestionId;
  const isQuestionNode = Boolean(sourceQuestionId);
  const isLessonNode = node.type === LESSON_NODE_TYPE && !hasChildren;
  // `undefined` means this lesson's stage hasn't been computed (its progress
  // is still loading, or the request failed). That is deliberately NOT
  // treated as "no-breakdown": showing a 'No breakdown' badge for a lesson
  // that may actually have saved work would be wrong, so an unknown stage
  // gets a neutral icon below instead of any pipeline badge.
  const pipelineStage: PipelineStage | undefined =
    isLessonNode && node.id ? pipelineStageByNodeId?.[node.id] : undefined;
  // Only true once a stage is known and it's past "no-breakdown"; an unknown
  // stage is neither saved nor unsaved, so this stays false for it.
  const isBreakdownSaved =
    isLessonNode && pipelineStage !== undefined && pipelineStage !== "no-breakdown";

  // LESSON leaf nodes don't expand/collapse (they have no children), so
  // clicking the row fires onLessonNodeClick instead of the usual toggle.
  // Non-lesson rows keep the original toggle-on-row-click behavior.
  function handleRowClick() {
    if (isLessonNode) {
      onLessonNodeClick?.(node, isBreakdownSaved);
      return;
    }
    if (hasChildren) onToggle(nodeKey);
  }

  return (
    <li>
      <div
        role={isLessonNode ? "button" : undefined}
        tabIndex={isLessonNode ? 0 : undefined}
        onClick={isLessonNode ? handleRowClick : undefined}
        onKeyDown={
          isLessonNode
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleRowClick();
                }
              }
            : undefined
        }
        className={cn(
          "group flex items-center gap-2 rounded-md py-1.5 pr-2 transition-colors hover:bg-accent",
          isLessonNode && "cursor-pointer",
        )}
        style={{ paddingLeft: `${depth * 1.25 + 0.25}rem` }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(nodeKey);
          }}
          disabled={!hasChildren}
          aria-label={hasChildren ? (open ? "Collapse" : "Expand") : undefined}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-transform",
            hasChildren ? "hover:text-foreground" : "opacity-0",
            open && "rotate-90",
          )}
        >
          <ChevronRight className="size-4" />
        </button>
        {isQuestionNode ? (
          <HelpCircle className="size-4 shrink-0 text-amber-500" />
        ) : isLessonNode ? (
          pipelineStage ? (
            <LessonPipelineBadge stage={pipelineStage} iconOnly />
          ) : (
            <FileText
              className="size-4 shrink-0 text-muted-foreground/60"
              aria-label="Lesson progress not loaded"
            />
          )
        ) : hasChildren ? (
          <FolderTree className="size-4 shrink-0 text-primary" />
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground" />
        )}
        {isQuestionNode && sourceQuestionId ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuestionNodeClick?.(sourceQuestionId);
            }}
            className="truncate text-left text-sm font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-primary"
            title="Jump to the originating question"
          >
            {node.label}
          </button>
        ) : (
          <span className="truncate text-sm font-medium text-foreground">{node.label}</span>
        )}
        <span className="ml-1 rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] tracking-wide text-secondary-foreground uppercase">
          {node.type}
        </span>
        {isQuestionNode && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-600 uppercase">
            From question
          </span>
        )}
        {isLessonNode && pipelineStage && isBreakdownSaved ? (
          <LessonPipelineBadge stage={pipelineStage} />
        ) : null}
        {hasChildren && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {children.length}
          </span>
        )}
      </div>
      {hasChildren && open && (
        <ul
          className="border-l border-border/70"
          style={{ marginLeft: `${depth * 1.25 + 0.9}rem` }}
        >
          {children.map((child, i) => (
            <NodeRow
              key={getNodeKey(child, i)}
              node={child}
              nodeKey={getNodeKey(child, i)}
              depth={0}
              onQuestionNodeClick={onQuestionNodeClick}
              pipelineStageByNodeId={pipelineStageByNodeId}
              onLessonNodeClick={onLessonNodeClick}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface TreeViewProps {
  tree: CurriculumNode;
  /** Called with the originating ExamQuestion.id when a question-derived node's label is clicked. */
  onQuestionNodeClick?: (sourceQuestionId: string) => void;
  /** Lookup of lesson node id -> its current PipelineStage. */
  pipelineStageByNodeId?: Record<string, PipelineStage>;
  /**
   * Called instead of the row's expand/collapse toggle when a LESSON leaf
   * node is clicked. Passed the node itself and whether it already has a
   * saved breakdown, so the caller can decide whether to open the prompt
   * panel or navigate to the lesson's detail route.
   */
  onLessonNodeClick?: (node: CurriculumNode, hasSavedBreakdown: boolean) => void;
  /**
   * Controlled expand/collapse state, keyed by node key (see getNodeKey),
   * lifted out of this component so it can be persisted (e.g. to
   * localStorage) by the caller and survive remounts/reloads. A node key
   * absent from this map falls back to the original depth-based default.
   */
  expandedIds: Record<string, boolean>;
  /**
   * Called with a node's key whenever its expand/collapse toggle should
   * flip - fired both from the chevron button and from clicking a
   * non-lesson row. The caller owns computing/persisting the resulting
   * state.
   */
  onToggle: (nodeKey: string) => void;
}

export function TreeView({
  tree,
  onQuestionNodeClick,
  pipelineStageByNodeId,
  onLessonNodeClick,
  expandedIds,
  onToggle,
}: TreeViewProps) {
  const rootKey = getNodeKey(tree, 0);

  return (
    <ul className="space-y-0.5">
      <NodeRow
        node={tree}
        nodeKey={rootKey}
        depth={0}
        onQuestionNodeClick={onQuestionNodeClick}
        pipelineStageByNodeId={pipelineStageByNodeId}
        onLessonNodeClick={onLessonNodeClick}
        expandedIds={expandedIds}
        onToggle={onToggle}
      />
    </ul>
  );
}
