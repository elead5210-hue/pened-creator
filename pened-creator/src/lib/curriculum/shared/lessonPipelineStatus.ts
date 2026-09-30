
import type { LessonRecord } from "./db";

/**
 * Which stage of the tree → breakdown → prompt → content → images
 * pipeline a given lesson is currently in. Every surface that shows
 * lesson status (the curriculum tree, the global toolbar, Lesson Detail)
 * derives it from this single set of values instead of each
 * reimplementing its own hasBreakdown/hasContent/hasImagePrompts
 * booleans, so the phase/pipeline framing stays consistent everywhere
 * the user navigates.
 *
 * Stages, in pipeline order:
 *   - "no-breakdown": no breakdown has been saved for this lesson node yet
 *     (Phase 1 work not started).
 *   - "breakdown-saved": a breakdown is saved, but no content prompt has
 *     been generated yet (Phase 1 done, Phase 2 not started).
 *   - "prompt-generated": a content prompt has been generated for this
 *     lesson, but the AI's response hasn't been pasted back in yet
 *     (Phase 2 in progress).
 *   - "content-generated": AI-generated content has been saved for this
 *     lesson (Phase 2 core content complete).
 *   - "images-generated": image prompts have been generated for this
 *     lesson's content via the Image Generation step. Strictly builds on
 *     "content-generated" (a lesson can't reach this stage without
 *     content to base image prompts on), but is an optional extra step
 *     rather than a hard requirement of Phase 2.
 */
export type PipelineStage =
  | "no-breakdown"
  | "breakdown-saved"
  | "prompt-generated"
  | "content-generated"
  | "images-generated";

/**
 * Derives a lesson's pipeline stage from whether it has a saved breakdown
 * and, if a lesson record exists, that record's own status/generatedContent/
 * imagePrompts.
 *
 * `hasBreakdown` should reflect the saved LessonBreakdown for the node
 * (from `getLessonBreakdown`/the `hasBreakdown` lookup built in
 * routes/index.tsx), independent of whether a lesson record has been
 * created yet - a breakdown can exist for a moment before
 * `ensureLessonFromBreakdown` finishes creating its lesson record.
 *
 * `lessonRecord` is the corresponding LessonRecord from `getLesson`, or
 * null/undefined if none exists yet.
 */
export function computeLessonPipelineStage(
  hasBreakdown: boolean,
  lessonRecord: LessonRecord | null | undefined,
): PipelineStage {
  if (!hasBreakdown) {
    return "no-breakdown";
  }

  const hasImagePrompts =
    Array.isArray(lessonRecord?.imagePrompts) && lessonRecord.imagePrompts.length > 0;
  if (hasImagePrompts || lessonRecord?.status === "images-generated") {
    return "images-generated";
  }

  const hasGeneratedContent =
    Array.isArray(lessonRecord?.generatedContent) && lessonRecord.generatedContent.length > 0;
  if (hasGeneratedContent || lessonRecord?.status === "content-generated") {
    return "content-generated";
  }

  const hasGeneratedPrompt =
    typeof lessonRecord?.generatedPrompt === "string" && lessonRecord.generatedPrompt.length > 0;
  if (hasGeneratedPrompt || lessonRecord?.status === "prompt-generated") {
    return "prompt-generated";
  }

  return "breakdown-saved";
}

/** Short, human-readable label for a pipeline stage (e.g. for a badge). */
export function formatPipelineStageLabel(stage: PipelineStage): string {
  switch (stage) {
    case "no-breakdown":
      return "No breakdown";
    case "breakdown-saved":
      return "Breakdown saved";
    case "prompt-generated":
      return "Prompt generated";
    case "content-generated":
      return "Content generated";
    case "images-generated":
      return "Images generated";
    default:
      return stage;
  }
}

/**
 * Which phase (1 or 2) a pipeline stage belongs to. "no-breakdown" and
 * "breakdown-saved" are Phase 1 concerns (the breakdown doesn't exist yet,
 * or exists but content generation hasn't started); "prompt-generated",
 * "content-generated", and "images-generated" are all Phase 2 concerns.
 */
export function pipelineStagePhase(stage: PipelineStage): 1 | 2 {
  return stage === "no-breakdown" || stage === "breakdown-saved" ? 1 : 2;
}

/**
 * Whether Phase 2's core AI-generated content exists for a lesson at the
 * given pipeline stage. True for "content-generated" and for
 * "images-generated" (which strictly builds on content already existing),
 * false otherwise.
 *
 * Centralized here so any surface that only cares "has this lesson's
 * content been generated" (e.g. the View Content tab's empty-state check)
 * doesn't hardcode a stale `stage === "content-generated"` equality that
 * silently goes false once a lesson advances past that stage into the
 * optional Image Generation step.
 */
export function hasContentGenerated(stage: PipelineStage): boolean {
  return stage === "content-generated" || stage === "images-generated";
}

/**
 * Whether Phase 3 (the Games section) is unlocked for a lesson at the
 * given pipeline stage. Unlike the old Interactive Tools feature this
 * replaces, Games is just a placeholder with nothing to generate from a
 * lesson's content yet, so it's always unlocked regardless of pipeline
 * stage.
 *
 * Centralized here so every surface that needs to gate a Phase 3 entry
 * point (e.g. Lesson Detail's "Games" tab, the global toolbar) checks the
 * same condition instead of each reimplementing this check or hardcoding
 * their own "always available" assumption.
 */
export function isPhase3Unlocked(_stage: PipelineStage): boolean {
  return true;
}

/**
 * The individual steps shown in Lesson Detail's Phase 2 step list, in
 * pipeline order. Kept here (rather than inline in the route or the
 * sidebar component) so the step-status mapping below and any other
 * consumer share one canonical list of step identifiers.
 *
 * "youtube-keywords" and "image-generation" are both optional steps built
 * on top of a lesson's already-generated content, so both unlock once
 * that content exists - like "view-content", neither requires the other
 * to have made any progress:
 *   - "youtube-keywords" is a session-only side step (generates YouTube
 *     search keywords from the lesson's content and shows matching
 *     videos) with no persisted stage of its own, so it never reports
 *     "complete" - see getPhase2StepUnlockStatus below.
 *   - "image-generation" builds an image-prompt request from the
 *     lesson's already-generated content, and its own progress is
 *     persisted (it reports "complete" once "images-generated" is
 *     reached).
 *   - "slide-data" is a read-only view of the slideshow deck saved by
 *     the "slideshow-data" step, so it stays locked until a deck has been
 *     saved on the lesson and is otherwise "available" (it has no work of
 *     its own to complete).
 */
export const PHASE2_STEPS = [
  "breakdown",
  "generate-prompt",
  "paste-response",
  "view-content",
  "youtube-keywords",
  "image-generation",
  "slideshow-data",
  "slide-data",
  "games",
] as const;

export type Phase2Step = (typeof PHASE2_STEPS)[number];

/**
 * Status of a single step in a step list (e.g. Lesson Detail's vertical
 * Phase 2 sidebar), independent of which step the user currently has
 * selected in the UI:
 *   - "locked": the step can't be opened yet given the lesson's current
 *     pipeline stage.
 *   - "complete": the step's own work is done (e.g. a prompt has already
 *     been generated), though the user may still revisit it.
 *   - "available": the step can be opened but hasn't been completed yet.
 *
 * Deliberately does not include "current" - that depends on which step the
 * UI has navigated to (e.g. `activeTab`), not on pipeline data, so callers
 * combine this with their own active-step check rather than this module
 * trying to guess it.
 */
export type StepUnlockStatus = "locked" | "complete" | "available";

/**
 * Maps a lesson's pipeline stage (plus whether a lesson record exists yet)
 * to the unlock status of a single Phase 2 step. Centralizing this means
 * the step list's checkmark/lock rendering always agrees with
 * LessonPipelineBadge and computeLessonPipelineStage instead of a
 * component re-deriving "is this step done" from stage/index position.
 *
 * `hasLessonRecord` mirrors the same gate the old Tabs implementation used
 * for "Generate Prompt"/"Paste AI Response" (disabled until a lesson
 * record exists for the breakdown).
 */
/**
 * Whether every entry in a lesson's imagePrompts array has a matching
 * uploaded image in `images`. Distinct from stage === "images-generated"
 * (which only requires the imagePrompts array to be non-empty) - the
 * "slideshow-data" step additionally needs every planned image to have
 * actually been uploaded, since a slide can't reference an image that
 * doesn't exist yet (see ../phase2-content/slideshowDeckBuilder.ts).
 */
export function hasAllImagePromptsUploaded(lessonRecord: LessonRecord | null | undefined): boolean {
  const imagePrompts = lessonRecord?.imagePrompts;
  if (!Array.isArray(imagePrompts) || imagePrompts.length === 0) {
    return false;
  }

  const images = lessonRecord?.images ?? {};
  return imagePrompts.every((prompt) => {
    const id = (prompt as { id?: unknown })?.id;
    return typeof id === "string" && Boolean(images[id]);
  });
}

export function getPhase2StepUnlockStatus(
  step: Phase2Step,
  stage: PipelineStage,
  hasLessonRecord: boolean,
  lessonRecord?: LessonRecord | null,
): StepUnlockStatus {
  switch (step) {
    case "breakdown":
      // Always reachable once we're on this page at all - a breakdown is
      // a precondition for the whole Phase 2 view existing.
      return "complete";

    case "generate-prompt":
      if (!hasLessonRecord) return "locked";
      return stage === "prompt-generated" ||
        stage === "content-generated" ||
        stage === "images-generated"
        ? "complete"
        : "available";

    case "paste-response":
      if (!hasLessonRecord) return "locked";
      return stage === "content-generated" || stage === "images-generated"
        ? "complete"
        : "available";

    case "view-content":
      return stage === "content-generated" || stage === "images-generated"
        ? "complete"
        : "locked";

    case "youtube-keywords":
      // Unlocks under the same condition as image-generation (once the
      // lesson's content has been generated), independent of
      // image-generation's own progress - a lesson can complete
      // Image Generation without ever visiting this step, or vice versa.
      // This step is session-only (generated keywords/search results
      // aren't persisted anywhere on the lesson record), so it has no
      // stored completion signal to report and never resolves to
      // "complete" - it's either "locked" or "available".
      return stage === "content-generated" || stage === "images-generated"
        ? "available"
        : "locked";

    case "image-generation":
      // Image prompts are built from the finished lesson content, so this
      // step stays locked until content has actually been generated, then
      // reports "complete" once the AI's image prompts have themselves
      // been saved (stage === "images-generated").
      if (stage === "images-generated") return "complete";
      return stage === "content-generated" ? "available" : "locked";

    case "slideshow-data":
      // Builds directly on Image Generation's saved output, so it stays
      // locked until every planned image prompt has an uploaded image
      // (not just "at least one", unlike stage === "images-generated").
      // Reports "complete" once a deck has actually been assembled and
      // saved, mirroring how "image-generation" reports complete off of
      // stage rather than off of the unlock condition itself.
      if (!hasAllImagePromptsUploaded(lessonRecord)) return "locked";
      return lessonRecord?.slideshowDeck ? "complete" : "available";

    case "slide-data":
      // A per-slide view of the deck saved by "slideshow-data": locked
      // until a deck exists on the lesson record. It only displays data,
      // so it never resolves to "complete".
      return lessonRecord?.slideshowDeck ? "available" : "locked";

    case "games":
      // Phase 3's Games section is just a placeholder for now (see
      // isPhase3Unlocked above) with nothing to complete, so it's always
      // "available" regardless of pipeline stage.
      return "available";

    default:
      return "locked";
  }
}

/**
 * Convenience helper returning unlock status for every Phase 2 step at
 * once, in `PHASE2_STEPS` order - handy for building a step list's items
 * in one pass instead of calling `getPhase2StepUnlockStatus` per step.
 */
export function getPhase2StepStatuses(
  stage: PipelineStage,
  hasLessonRecord: boolean,
  lessonRecord?: LessonRecord | null,
): Record<Phase2Step, StepUnlockStatus> {
  return PHASE2_STEPS.reduce(
    (acc, step) => {
      acc[step] = getPhase2StepUnlockStatus(step, stage, hasLessonRecord, lessonRecord);
      return acc;
    },
    {} as Record<Phase2Step, StepUnlockStatus>,
  );
}