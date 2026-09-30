import { Check, Circle, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StepUnlockStatus } from "@/lib/curriculum/shared/lessonPipelineStatus";

/**
 * Visual status a single step renders as. Distinct from `StepUnlockStatus`
 * (the lib-level "locked" | "complete" | "available" produced from pipeline
 * data): this adds "current", which only exists in the UI layer and depends
 * on which step is currently selected, not on pipeline stage.
 */
export type StepStatus = StepUnlockStatus | "current";

export interface StepSidebarItem<TValue extends string = string> {
  /** The tab/step value this entry navigates to (e.g. "breakdown"). */
  value: TValue;
  /** Short label shown next to the step number, e.g. "Generate Prompt". */
  label: string;
  /**
   * Unlock status for this step, derived from pipeline data (see
   * `getPhase2StepUnlockStatus`/`getPhase2StepStatuses` in
   * lessonPipelineStatus.ts) rather than computed here from list position.
   * A "locked" step renders dimmed with a lock icon and ignores
   * clicks/keyboard activation regardless of where it sits in the list.
   */
  status: StepUnlockStatus;
  /** Optional one-line note shown under the label (e.g. "Content generated").
   * Only shown in the vertical (md+) layout - the horizontal mobile/tablet
   * pill row hides it to keep each pill compact. */
  description?: string;
}

interface StepSidebarProps<TValue extends string = string> {
  /** Ordered list of steps in the Phase 2 lifecycle. */
  steps: StepSidebarItem<TValue>[];
  /** The value of the currently active step. */
  activeValue: TValue;
  /** Called with a step's value when the user clicks/activates an
   * unlocked step that isn't already active. */
  onSelect: (value: TValue) => void;
  className?: string;
}

/**
 * Combines a step's pipeline-derived unlock status with whether it's the
 * currently active step to get the status actually rendered:
 *   - "locked" always wins, regardless of active state.
 *   - the active, unlocked step renders as "current".
 *   - otherwise the step's own unlock status ("complete"/"available") is
 *     used as-is.
 */
function displayStatusFor(status: StepUnlockStatus, isActive: boolean): StepStatus {
  if (status === "locked") return "locked";
  if (isActive) return "current";
  return status;
}

function StepIndicator({ status, stepNumber }: { status: StepStatus; stepNumber: number }) {
  if (status === "locked") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
        <Lock className="size-3" />
      </span>
    );
  }

  if (status === "complete") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-600">
        <Check className="size-3.5" />
      </span>
    );
  }

  if (status === "current") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary/10 text-xs font-semibold text-primary">
        {stepNumber}
      </span>
    );
  }

  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-transparent text-xs font-medium text-muted-foreground">
      {stepNumber}
    </span>
  );
}

/**
 * Vertical, persistent list of the Phase 2 lifecycle steps (Breakdown,
 * Generate Prompt, Paste AI Response, View Content, ...). Intended to sit
 * in a right-hand rail next to the main editing area, replacing the old
 * horizontal Tabs/TabsList so the main pane can be wider.
 *
 * Each step's unlock status ("locked" / "complete" / "available") is
 * supplied by the caller - typically sourced from
 * `getPhase2StepStatuses`/`getPhase2StepUnlockStatus` in
 * lessonPipelineStatus.ts - so this component never re-derives status from
 * list position and stays visually in sync with LessonPipelineBadge.
 *
 * Responsive behavior: below the `md` breakpoint (where the two-column
 * workarea in lessons.$lessonId.tsx collapses to a single column), this
 * renders as a horizontally scrollable row of compact pills instead of the
 * full vertical rail - a full-width vertical stack of steps would otherwise
 * push the actual step content far down the page on narrow viewports. Each
 * pill keeps its status indicator but hides `description` and the
 * "available" dot to stay compact; the label truncates via `max-w` rather
 * than the vertical layout's flex-based `min-w-0` truncation, since a
 * horizontally scrolling flex row doesn't constrain child widths the same
 * way a column does. At `md` and above, the layout reverts to the original
 * vertical `flex-col`/`w-64` rail with full labels and descriptions.
 */
export function StepSidebar<TValue extends string = string>({
  steps,
  activeValue,
  onSelect,
  className,
}: StepSidebarProps<TValue>) {
  return (
    <nav
      aria-label="Phase 2 steps"
      className={cn(
        "flex w-full flex-row gap-1 overflow-x-auto rounded-lg border border-border bg-card p-2",
        "md:w-64 md:flex-col md:overflow-x-visible",
        className,
      )}
    >
      {steps.map((step, index) => {
        const isActive = step.value === activeValue;
        const status = displayStatusFor(step.status, isActive);
        const isLocked = status === "locked";

        return (
          <button
            key={step.value}
            type="button"
            disabled={isLocked}
            aria-current={status === "current" ? "step" : undefined}
            onClick={() => {
              if (isLocked || status === "current") return;
              onSelect(step.value);
            }}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors",
              "md:shrink md:w-full md:items-start md:gap-3 md:whitespace-normal md:py-2.5",
              status === "current" && "bg-primary/10 text-foreground",
              !isLocked && status !== "current" && "text-foreground hover:bg-muted",
              isLocked && "cursor-not-allowed text-muted-foreground opacity-60",
            )}
          >
            <StepIndicator status={status} stepNumber={index + 1} />
            <span className="flex min-w-0 max-w-32 flex-col md:max-w-none">
              <span className={cn("truncate font-medium", status === "current" && "text-primary")}>
                {step.label}
              </span>
              {step.description ? (
                <span className="hidden truncate text-xs text-muted-foreground md:block">
                  {step.description}
                </span>
              ) : null}
            </span>
            {status === "available" && !step.description ? (
              <Circle className="ml-auto hidden size-2 shrink-0 self-center fill-current text-transparent md:block" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
