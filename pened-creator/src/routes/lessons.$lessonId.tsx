
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookCheck,
  ImagePlus,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getAllNodes,
  getLessonBreakdown,
  getLesson,
  saveSlideshowDeck,
  subscribe,
  updateLesson,
  type LessonRecord,
} from "@/lib/curriculum/shared/db";
import { ApiError } from "@/lib/curriculum/shared/apiClient";
import { expand, PROJECT_ID, type CurriculumNode, type LessonBreakdown } from "@/lib/curriculum/shared/schema";
import { buildLessonPrompt } from "@/lib/curriculum/phase2-content/promptBuilder";
import { buildPromptFilename } from "@/lib/curriculum/phase2-content/download";
import {
  computeLessonPipelineStage,
  getPhase2StepStatuses,
  hasContentGenerated,
  type PipelineStage,
} from "@/lib/curriculum/shared/lessonPipelineStatus";
import { LessonPipelineBadge } from "@/components/shell/LessonPipelineBadge";
import { PromptViewer } from "@/components/curriculum/phase2-content/PromptViewer";
import { PasteResponseForm } from "@/components/curriculum/phase2-content/PasteResponseForm";
import { LessonContentView } from "@/components/curriculum/phase2-content/LessonContentView";
import ImagePromptGenerator from "@/components/curriculum/phase2-content/ImagePromptGenerator";
import { YoutubeKeywordGenerator } from "@/components/curriculum/phase2-content/YoutubeKeywordGenerator";
import { StepSidebar, type StepSidebarItem } from "@/components/curriculum/phase2-content/StepSidebar";
import { SlideshowDeckGenerator } from "@/components/curriculum/phase2-content/SlideshowDeckGenerator";
import { SlideDataViewer } from "@/components/curriculum/phase2-content/SlideDataViewer";
import { GamesPlaceholder } from "@/components/curriculum/phase3-games/GamesPlaceholder";
import { LessonStatus } from "@/lib/curriculum/phase2-content/lessonRecord";
import type { SlideshowDeck } from "@/lib/curriculum/phase2-content/slideshowDeckValidator";
import { requireAuth } from "@/lib/auth/routeGuard";

// Codegen audit note: this file exports exactly one Route via
// createFileRoute("/lessons/$lessonId") (matching its filename, per
// TanStack Router's file-based convention), does not re-export or
// redeclare Route anywhere else, and its imports (db.ts, apiClient.ts,
// schema.ts, promptBuilder.ts, download.ts, lessonPipelineStatus.ts,
// the phase2-content components, lessonRecord.ts, routeGuard.ts) are all
// plain lib/component modules that don't import back from this route or
// from routeTree.gen.ts - so there's no cycle here for the router plugin
// to trip over. Nothing in this file needed to change as a result of the
// audit; the routeTree.gen.ts codegen failure lies elsewhere.
export const Route = createFileRoute("/lessons/$lessonId")({
  beforeLoad: ({ location }) => requireAuth(location),
  head: () => ({
    meta: [
      { title: "Lesson detail — Curriculum Treeview" },
      {
        name: "description",
        content:
          "The saved breakdown, generated prompt, and AI-generated content for this lesson.",
      },
    ],
  }),
  component: LessonDetail,
});

/** Depth-first search for the node with the given id, anywhere in the tree. */
function findNodeById(node: CurriculumNode, id: string): CurriculumNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

/** Turns a load() failure into a short, human-readable message, calling out
 * an unreachable API distinctly from a request the server rejected. */
function describeLoadError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 0
      ? "Couldn't reach the server. Check your connection and try again."
      : err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong while loading this lesson.";
}

interface BreakdownListProps {
  title: string;
  items: string[];
}

function BreakdownList({ title, items }: BreakdownListProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <h2 className="font-serif text-lg text-foreground">{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

type LifecycleTab =
  | "breakdown"
  | "generate-prompt"
  | "paste-response"
  | "view-content"
  | "youtube-keywords"
  | "image-generation"
  | "slideshow-data"
  | "slide-data"
  | "games";

/** Which tab a lesson should land on by default, based on how far along its
 * pipeline is - so visiting a lesson picks up wherever that lesson left
 * off instead of always starting on the Breakdown tab. Content-generated
 * lessons still default to "view-content" rather than jumping straight to
 * "image-generation" - image generation is an optional next step the user
 * opts into from the step list, not the default landing spot. A lesson that
 * has gone on to complete Image Generation ("images-generated") also
 * defaults to "view-content" for the same reason - it's still the natural
 * landing spot for reviewing a lesson's finished content, not the optional
 * step built on top of it. */
function defaultTabForStage(stage: PipelineStage): LifecycleTab {
  switch (stage) {
    case "content-generated":
    case "images-generated":
      return "view-content";
    case "prompt-generated":
      return "generate-prompt";
    case "breakdown-saved":
    case "no-breakdown":
    default:
      return "breakdown";
  }
}

/** Human-readable labels for the Phase 2 step list, in pipeline order.
 * Kept alongside `defaultTabForStage` since both describe the same
 * LifecycleTab/Phase2Step values from the UI's point of view. */
const STEP_LABELS: Record<LifecycleTab, string> = {
  breakdown: "Breakdown",
  "generate-prompt": "Generate Prompt",
  "paste-response": "Paste AI Response",
  "view-content": "View Content",
  "youtube-keywords": "YouTube Videos",
  "image-generation": "Image Generation",
  "slideshow-data": "Generate Slideshow Data",
  "slide-data": "Slide Data",
  games: "Games",
};

function LessonDetail() {
  const { lessonId } = Route.useParams();
  const [node, setNode] = useState<CurriculumNode | null | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<LessonBreakdown | null | undefined>(undefined);
  const [lessonRecord, setLessonRecord] = useState<LessonRecord | null | undefined>(undefined);
  // Set when load() itself fails (network error, non-2xx response, etc.)
  // on the very first fetch for this lessonId - kept distinct from
  // `node === null`, which legitimately means "this lesson node doesn't
  // exist in the tree". Without this, a network failure looked exactly
  // like a 404 ("This lesson couldn't be found"), which is misleading and
  // gives the user no way to retry. A failure on a later background
  // refresh (via subscribe) doesn't touch this - it's reported as a toast
  // instead, so it doesn't yank away content that's already on screen.
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<LifecycleTab>("breakdown");
  const [promptResult, setPromptResult] = useState<{ prompt: string } | null>(null);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

  // YouTube Videos step state (see STEP_LABELS["youtube-keywords"]): the
  // AI-proposed search keywords the user pastes back in, as plain
  // `keyword` strings (see PasteYoutubeKeywordResponseForm/
  // YoutubeKeywordGenerator). The grouped-by-keyword video results
  // themselves are fetched and held inside YoutubeKeywordGenerator, not
  // here - this only needs to remember which keywords were saved, so
  // that component can re-run its search whenever they change.
  // Deliberately plain component state rather than anything persisted via
  // db.ts/updateLesson - this step's whole point is a lightweight,
  // session-only side lookup, so it's reset below whenever the user
  // navigates to a different lesson, and doesn't survive a page refresh.
  const [youtubeKeywords, setYoutubeKeywords] = useState<string[] | null>(null);

  // Bumped whenever the Slide Data view should start fresh: when the user
  // navigates to a different lesson, or when the slideshow deck is re-saved.
  // It is used as part of SlideDataViewer's key so the viewer returns to the
  // first slide instead of keeping a stale position from an older deck.
  const [slideDataResetKey, setSlideDataResetKey] = useState(0);

  // Guards the one-time "pick up where you left off" tab default below so
  // it only fires once per lesson visit (on first load of this lessonId),
  // rather than yanking the user back to a different tab every time
  // `load()` re-runs (e.g. via the subscribe() live-update below) after
  // they've already manually switched tabs.
  const appliedDefaultTabFor = useRef<string | undefined>(undefined);

  // Tracks whether at least one load() pass has fully succeeded for the
  // current lessonId, so later failures (e.g. a subscribe()-triggered
  // refresh that happens to lose network mid-request) are reported as a
  // toast rather than replacing already-loaded content with the error
  // panel. Reset whenever the lessonId itself changes.
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    hasLoadedRef.current = false;
  }, [lessonId]);

  const load = useCallback(async () => {
    const errors: string[] = [];

    try {
      const rows = await getAllNodes();
      const tree = expand(rows);
      setNode(tree ? findNodeById(tree, lessonId) : null);
    } catch (err) {
      setNode(null);
      errors.push(describeLoadError(err));
    }

    try {
      const saved = await getLessonBreakdown(lessonId);
      setBreakdown(saved ?? null);
    } catch (err) {
      setBreakdown(null);
      errors.push(describeLoadError(err));
    }

    try {
      const record = await getLesson(`${PROJECT_ID}:${lessonId}`);
      setLessonRecord(record ?? null);
    } catch (err) {
      setLessonRecord(null);
      errors.push(describeLoadError(err));
    }

    if (errors.length === 0) {
      setLoadError(null);
      hasLoadedRef.current = true;
    } else if (!hasLoadedRef.current) {
      setLoadError(errors[0]);
    } else {
      toast.error("Couldn't refresh this lesson", { description: errors[0] });
    }
  }, [lessonId]);

  useEffect(() => {
    load();
    const unsubscribe = subscribe(load);
    return () => {
      unsubscribe();
    };
  }, [load]);

  // Reset the "already applied a default tab" guard whenever the user
  // navigates to a different lesson, so each lesson gets its own one-time
  // default-tab placement.
  useEffect(() => {
    appliedDefaultTabFor.current = undefined;
  }, [lessonId]);

  // The YouTube Videos step's keywords are scoped to a single lesson
  // visit, not persisted anywhere - reset them whenever the user
  // navigates to a different lesson so a previous lesson's keywords/videos
  // never bleed into this one.
  useEffect(() => {
    setYoutubeKeywords(null);
    setSlideDataResetKey((key) => key + 1);
  }, [lessonId]);

  // Whenever a fresh lesson record comes in with an already-saved
  // generatedPrompt (e.g. from a previous visit or another tab), reflect it
  // in the Generate Prompt tab's viewer without requiring the user to click
  // "Generate Prompt" again.
  useEffect(() => {
    if (lessonRecord?.generatedPrompt && typeof lessonRecord.generatedPrompt === "string") {
      setPromptResult({ prompt: lessonRecord.generatedPrompt });
    }
  }, [lessonRecord?.generatedPrompt]);

  const ready = node !== undefined && breakdown !== undefined && lessonRecord !== undefined;

  // Derived the same way as the curriculum tree and the global toolbar, so
  // this header's status framing never drifts from theirs.
  const pipelineStage = computeLessonPipelineStage(Boolean(breakdown), lessonRecord);
  // Uses hasContentGenerated() rather than a direct "content-generated"
  // equality check, so the View Content tab still shows the lesson's
  // content once the lesson has gone on to the optional
  // "images-generated" stage instead of regressing to "No content has
  // been generated for this lesson yet."
  const contentAvailable = hasContentGenerated(pipelineStage);

  // Per-step unlock status ("locked" / "complete" / "available"), derived
  // from pipeline stage in one shared place (lessonPipelineStatus.ts) so
  // the step sidebar never drifts from LessonPipelineBadge/the tree's own
  // status framing. `activeTab`'s own status is layered on top of this by
  // StepSidebar itself (rendered as "current"). This also covers
  // "image-generation", which stays locked until content-generated.
  const stepStatuses = getPhase2StepStatuses(pipelineStage, Boolean(lessonRecord), lessonRecord);
  const imageGenerationAvailable = stepStatuses["image-generation"] !== "locked";
  const youtubeKeywordsAvailable = stepStatuses["youtube-keywords"] !== "locked";
  const slideshowDataAvailable = stepStatuses["slideshow-data"] !== "locked";
  // The "slide-data" step's status comes from the shared lookup too: it
  // unlocks once a slideshow deck has been saved on the lesson.
  const savedSlideshowDeck = lessonRecord?.slideshowDeck ?? null;
  const slideDataAvailable = stepStatuses["slide-data"] !== "locked";
  // Whether to surface the "go generate images" call-to-action from the
  // View Content step: only once content actually exists, only while the
  // user hasn't already completed that step, and only once a lesson
  // record exists to hand off to ImagePromptGenerator.
  const showImageGenerationCta =
    Boolean(lessonRecord) && pipelineStage === "content-generated";

  // Once this lesson's data has finished loading, default the visible tab
  // to wherever the pipeline stage says the user left off - "breakdown" for
  // breakdown-saved, "generate-prompt" for prompt-generated, and
  // "view-content" for content-generated (and images-generated) - instead
  // of always starting on Breakdown. Only applies once per lessonId (see
  // the reset effect above) so it doesn't fight with the user manually
  // switching tabs afterward.
  useEffect(() => {
    if (!ready || !breakdown) return;
    if (appliedDefaultTabFor.current === lessonId) return;

    setActiveTab(defaultTabForStage(pipelineStage));
    appliedDefaultTabFor.current = lessonId;
  }, [ready, breakdown, pipelineStage, lessonId]);

  async function handleGeneratePrompt() {
    if (!lessonRecord) return;

    setIsGeneratingPrompt(true);
    let result;
    try {
      result = await buildLessonPrompt(lessonRecord);
    } catch (err) {
      toast.error("Failed to generate prompt", {
        description: err instanceof Error ? err.message : undefined,
      });
      setIsGeneratingPrompt(false);
      return;
    }

    setPromptResult(result);

    try {
      await updateLesson(lessonRecord.id, {
        generatedPrompt: result.prompt,
        status: LessonStatus.PROMPT_GENERATED,
      });
    } catch (err) {
      toast.error("Prompt generated, but failed to save lesson status", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsGeneratingPrompt(false);
    }
  }

  /**
   * Saves a deck in which one slide was updated from the Slide Data step.
   * It goes through the same saveSlideshowDeck path as the Generate
   * Slideshow Data step, which validates the whole deck again and stores it
   * as the lesson's single slideshow interactiveContent entry, then updates
   * the lesson record with what the server returned.
   *
   * Unlike a deck re-saved in the Generate Slideshow Data step, this does
   * NOT bump slideDataResetKey, so the viewer stays on the slide that was
   * edited. Failures (SlideshowSaveError: expired session, oversized deck,
   * network error, invalid deck) are deliberately not caught here: they
   * propagate to the caller so it can show them separately from the
   * response's validation errors.
   */
  async function handleSlideUpdated(deck: SlideshowDeck): Promise<void> {
    if (!lessonRecord) {
      throw new Error("This lesson has no record to save the slide to.");
    }

    const saved = await saveSlideshowDeck(lessonRecord.id, deck);
    setLessonRecord(saved);
  }

  const steps: StepSidebarItem<LifecycleTab>[] = (
    Object.keys(STEP_LABELS) as LifecycleTab[]
  ).map((value) => ({
    value,
    label: STEP_LABELS[value],
    // "games" (Phase 3) is included in PHASE2_STEPS/getPhase2StepStatuses
    // alongside the Phase 2 steps, so its status - always "available",
    // since Games is just a placeholder with nothing to unlock yet - comes
    // from the same shared lookup as every other step rather than being
    // special-cased here.
    status: stepStatuses[value],
  }));

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <Button variant="ghost" size="sm" asChild className="mb-6">
          <Link to="/">
            <ArrowLeft className="size-4" /> Back to curriculum
          </Link>
        </Button>

        {!ready ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center">
            <AlertCircle className="size-8 text-destructive" />
            <p className="text-sm font-medium text-foreground">Couldn't load this lesson</p>
            <p className="max-w-sm text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => load()}>
              Try again
            </Button>
          </div>
        ) : !node ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              This lesson couldn't be found — it may have been removed from the curriculum tree.
            </p>
          </div>
        ) : !breakdown ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <h1 className="font-serif text-2xl text-foreground">{node.label}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              No breakdown has been saved for this lesson yet.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <header className="flex items-start gap-3 border-b border-border pb-4">
              <BookCheck className="mt-1 size-6 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
                    Phase 2: Content Generation
                  </p>
                  <LessonPipelineBadge stage={pipelineStage} />
                </div>
                <h1 className="mt-1 font-serif text-3xl text-foreground">{node.label}</h1>
                {!lessonRecord ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    A breakdown is saved, but no lesson record was created for it yet.
                  </p>
                ) : null}
              </div>
            </header>

            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start">
              <div className="min-w-0">
                {activeTab === "breakdown" ? (
                  <div className="space-y-6">
                    <div className="space-y-6">
                      <BreakdownList title="Objectives" items={breakdown.objectives} />
                      <BreakdownList title="Outcomes" items={breakdown.outcomes} />
                      <BreakdownList title="Key vocabulary" items={breakdown.keyVocabulary} />
                      <BreakdownList
                        title="Suggested activities"
                        items={breakdown.suggestedActivities}
                      />
                      <BreakdownList title="Assessment ideas" items={breakdown.assessmentIdeas} />
                      <BreakdownList title="Prerequisites" items={breakdown.prerequisites} />
                    </div>
                    <div className="flex justify-end border-t border-dashed border-border pt-4">
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/" search={{ editLessonId: lessonId }}>
                          <Pencil className="size-3.5" /> Edit in curriculum tree
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : null}

                {activeTab === "generate-prompt" ? (
                  <div className="space-y-4">
                    {!lessonRecord ? (
                      <p className="text-sm text-muted-foreground">
                        Save a breakdown for this lesson before generating a content prompt.
                      </p>
                    ) : promptResult ? (
                      <PromptViewer
                        promptText={promptResult.prompt}
                        filename={buildPromptFilename({
                          project_id: lessonRecord.project_id,
                          lesson_node_id: lessonRecord.lesson_node_id,
                        })}
                        onClose={() => {
                          /* Prompt stays visible within the tab; nothing to dismiss here. */
                        }}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No prompt has been generated for this lesson yet.
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={handleGeneratePrompt}
                        disabled={!lessonRecord || isGeneratingPrompt}
                      >
                        {isGeneratingPrompt
                          ? "Generating..."
                          : promptResult
                            ? "Regenerate Prompt"
                            : "Generate Prompt"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {activeTab === "paste-response" ? (
                  !lessonRecord ? (
                    <p className="text-sm text-muted-foreground">
                      Save a breakdown for this lesson before pasting AI-generated content.
                    </p>
                  ) : (
                    <PasteResponseForm
                      lessonId={lessonRecord.id}
                      onSaved={async () => {
                        await load();
                        setActiveTab("view-content");
                        toast.success("AI response saved");
                      }}
                      onCancel={() => setActiveTab("breakdown")}
                    />
                  )
                ) : null}

                {activeTab === "view-content" ? (
                  !contentAvailable ? (
                    <p className="text-sm text-muted-foreground">
                      No content has been generated for this lesson yet.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {showImageGenerationCta ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ImagePlus className="size-4 shrink-0 text-emerald-600" />
                            <p className="text-sm text-foreground">
                              This lesson's content is ready. Generate image prompts for it next in
                              the Image Generation step.
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveTab("image-generation")}
                          >
                            Image Generation <ArrowRight className="size-3.5" />
                          </Button>
                        </div>
                      ) : null}
                      <LessonContentView
                        lessonRecord={lessonRecord}
                        onViewDetails={() => setActiveTab("breakdown")}
                        onClose={() => setActiveTab("breakdown")}
                      />
                    </div>
                  )
                ) : null}

                {activeTab === "youtube-keywords" ? (
                  // Locked-state message mirrors the image-generation
                  // tab's wording/condition exactly (gated on
                  // `!lessonRecord || !<step>Available`, same phrasing
                  // pattern: "Generate this lesson's content first - ...
                  // are built from the finished lesson JSON.") so both
                  // steps read as one consistent family in the UI, not
                  // two differently-worded locks.
                  !lessonRecord || !youtubeKeywordsAvailable ? (
                    <p className="text-sm text-muted-foreground">
                      Generate this lesson's content first - YouTube search keywords are built
                      from the finished lesson JSON.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Generate YouTube search keywords from this lesson's content, then look
                        up matching videos to watch. This step doesn't save anything to the
                        lesson record — keywords and results only last for this session.
                      </p>
                      <YoutubeKeywordGenerator
                        lessonRecord={lessonRecord}
                        savedKeywords={youtubeKeywords}
                        onKeywordsSaved={(keywords) => setYoutubeKeywords(keywords)}
                      />
                    </div>
                  )
                ) : null}

                {activeTab === "image-generation" ? (
                  !lessonRecord || !imageGenerationAvailable ? (
                    <p className="text-sm text-muted-foreground">
                      Generate this lesson's content first - image prompts are built from the
                      finished lesson JSON.
                    </p>
                  ) : (
                    <ImagePromptGenerator
                      lessonRecord={lessonRecord}
                      onSaved={async () => {
                        await load();
                      }}
                    />
                  )
                ) : null}

                {activeTab === "slideshow-data" ? (
                  !lessonRecord || !slideshowDataAvailable ? (
                    <p className="text-sm text-muted-foreground">
                      Upload an image for every image prompt in the Image Generation step first -
                      slideshow data is assembled from the lesson's finished content and images.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {slideDataAvailable ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
                          <p className="text-sm text-foreground">
                            The slideshow data is saved. Review each slide's data in the Slide Data
                            step.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveTab("slide-data")}
                          >
                            Next: Slide Data <ArrowRight className="size-3.5" />
                          </Button>
                        </div>
                      ) : null}
                      <SlideshowDeckGenerator
                        lesson={lessonRecord}
                        onLessonUpdated={(updated) => {
                          setLessonRecord(updated);
                          setSlideDataResetKey((key) => key + 1);
                        }}
                      />
                    </div>
                  )
                ) : null}

                {activeTab === "slide-data" ? (
                  !lessonRecord || !slideDataAvailable || !savedSlideshowDeck ? (
                    <p className="text-sm text-muted-foreground">
                      Paste and save the AI's response in the Generate Slideshow Data step first -
                      each slide's data is shown here once the deck is saved.
                    </p>
                  ) : (
                    <SlideDataViewer
                      key={`${lessonId}-${slideDataResetKey}`}
                      slideshowDeck={savedSlideshowDeck}
                      lesson={lessonRecord}
                      onSlideUpdated={handleSlideUpdated}
                    />
                  )
                ) : null}

                {activeTab === "games" ? <GamesPlaceholder /> : null}
              </div>

              <StepSidebar
                steps={steps}
                activeValue={activeTab}
                onSelect={(value) => setActiveTab(value)}
                className="md:sticky md:top-6"
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}