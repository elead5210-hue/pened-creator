import { BookCheck, FileText, Images, Sparkles, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatPipelineStageLabel,
  type PipelineStage,
} from "@/lib/curriculum/shared/lessonPipelineStatus";

interface StageVisuals {
  icon: React.ReactNode;
  className: string;
}

/**
 * Icon + color treatment for each pipeline stage. Kept in one place so
 * TreeView, GlobalToolbar, and Lesson Detail's header all render the exact
 * same status framing instead of drifting apart over time.
 */
const STAGE_VISUALS: Record<PipelineStage, StageVisuals> = {
  "no-breakdown": {
    icon: <FileText className="size-3.5 shrink-0" />,
    className: "border-border bg-transparent text-muted-foreground",
  },
  "breakdown-saved": {
    icon: <BookCheck className="size-3.5 shrink-0" />,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  },
  "prompt-generated": {
    icon: <Wand2 className="size-3.5 shrink-0" />,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-600",
  },
  "content-generated": {
    icon: <Sparkles className="size-3.5 shrink-0" />,
    className: "border-violet-500/30 bg-violet-500/10 text-violet-600",
  },
  "images-generated": {
    icon: <Images className="size-3.5 shrink-0" />,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  },
};

interface LessonPipelineBadgeProps {
  stage: PipelineStage;
  /** Renders just the icon with no label/border, for tight spaces like a tree row. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Shared badge for a lesson's pipeline stage (no breakdown / breakdown
 * saved / prompt generated / content generated / images generated). Used
 * wherever lesson status is shown - the curriculum tree, the global
 * toolbar, and Lesson Detail's header - so the phase/pipeline framing is
 * visually identical everywhere the user navigates.
 */
export function LessonPipelineBadge({
  stage,
  iconOnly = false,
  className,
}: LessonPipelineBadgeProps) {
  const visuals = STAGE_VISUALS[stage];
  const label = formatPipelineStageLabel(stage);

  if (iconOnly) {
    return (
      <span
        className={cn("inline-flex items-center", className)}
        style={{ color: undefined }}
        title={label}
        aria-label={label}
      >
        <span className={cn("inline-flex", stageIconColorClass(stage))}>{visuals.icon}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase",
        visuals.className,
        className,
      )}
    >
      {visuals.icon}
      {label}
    </span>
  );
}

/** Just the text color portion of a stage's styling, for the icon-only variant. */
function stageIconColorClass(stage: PipelineStage): string {
  switch (stage) {
    case "no-breakdown":
      return "text-muted-foreground";
    case "breakdown-saved":
      return "text-emerald-500";
    case "prompt-generated":
      return "text-sky-500";
    case "content-generated":
      return "text-violet-500";
    case "images-generated":
      return "text-amber-500";
    default:
      return "text-muted-foreground";
  }
}
