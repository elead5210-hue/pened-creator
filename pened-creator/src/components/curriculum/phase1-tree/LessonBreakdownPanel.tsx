
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildLessonBreakdownPrompt,
  lessonBreakdownResponseSchema,
  PROJECT_ID,
  type CurriculumNode,
} from "@/lib/curriculum/shared/schema";
import { ensureLessonFromBreakdown, getLesson, getLessonBreakdown, saveLessonBreakdown, subscribe } from "@/lib/curriculum/shared/db";
import { ApiError } from "@/lib/curriculum/shared/apiClient";

interface LessonBreakdownPanelProps {
  /** The LESSON leaf node currently selected for breakdown generation. */
  node: CurriculumNode;
  /** The full curriculum tree, used to build the prompt with surrounding context. */
  tree: CurriculumNode | null;
  /** Called when the panel should close without necessarily having saved anything. */
  onClose: () => void;
  /** Called once a breakdown has been successfully parsed and saved for this node. */
  onSaved: () => void;
}

/** Turns a checkExisting() failure into a short, human-readable message,
 * calling out an unreachable API distinctly from a request the server
 * rejected. */
function describeCheckError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 0
      ? "Couldn't reach the server. Check your connection."
      : err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * The single Phase 1 entry point for creating, updating, or regenerating a
 * lesson's breakdown. Handles both the first-ever paste for a node and
 * re-pasting to overwrite an existing one, so Phase 2's Lesson Detail can
 * stay read-only for the breakdown itself and simply link back here for
 * edits (see `docs/merge-architecture.md`).
 */
export function LessonBreakdownPanel({ node, tree, onClose, onSaved }: LessonBreakdownPanelProps) {
  const navigate = useNavigate();
  const [pastedText, setPastedText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whether this node already has a saved breakdown and/or lesson record,
  // fetched fresh whenever the selected node changes (and kept live via
  // subscribe, in case the underlying data changes elsewhere while this
  // panel is open). Drives the "create" vs "regenerate" framing below and
  // whether the "View lesson detail" link forward into Phase 2 is shown.
  const [hasSavedBreakdown, setHasSavedBreakdown] = useState(false);
  const [lessonRecordId, setLessonRecordId] = useState<string | null>(null);
  // True while checkExisting()'s network calls are in flight. Distinct
  // from `isSaving` (which guards the paste-and-save action below) - this
  // one gates the "create" vs "regenerate" framing in the header, which
  // now depends on a real fetch rather than an effectively-instant
  // IndexedDB read, so it can briefly be stale/unknown on first render.
  const [isCheckingExisting, setIsCheckingExisting] = useState(true);

  // Guards against re-toasting the same "couldn't check existing
  // breakdown" error on every subscribe()-triggered re-check while the
  // network stays down - one toast per node visit is enough; it resets
  // whenever the node changes or a check finally succeeds.
  const hasToastedCheckErrorRef = useRef(false);

  const prompt = buildLessonBreakdownPrompt(node, tree);

  useEffect(() => {
    let cancelled = false;
    hasToastedCheckErrorRef.current = false;

    async function checkExisting() {
      if (!node.id) {
        if (!cancelled) {
          setHasSavedBreakdown(false);
          setLessonRecordId(null);
          setIsCheckingExisting(false);
        }
        return;
      }

      if (!cancelled) setIsCheckingExisting(true);

      let hadError = false;

      try {
        const saved = await getLessonBreakdown(node.id);
        if (!cancelled) setHasSavedBreakdown(Boolean(saved));
      } catch (err) {
        hadError = true;
        // A failed check must NOT be treated as "no breakdown exists" -
        // that would let the user believe they're creating a fresh
        // breakdown when one may already be saved, and silently clobber
        // it. Leave hasSavedBreakdown untouched (it keeps its last-known
        // value) and surface the failure instead.
        if (!cancelled && !hasToastedCheckErrorRef.current) {
          hasToastedCheckErrorRef.current = true;
          toast.error("Couldn't check for an existing breakdown", {
            description: describeCheckError(err),
          });
        }
      }

      try {
        const record = await getLesson(`${PROJECT_ID}:${node.id}`);
        if (!cancelled) setLessonRecordId(record ? record.id : null);
      } catch (err) {
        hadError = true;
        if (!cancelled && !hasToastedCheckErrorRef.current) {
          hasToastedCheckErrorRef.current = true;
          toast.error("Couldn't check for an existing lesson record", {
            description: describeCheckError(err),
          });
        }
      }

      if (!cancelled) {
        if (!hadError) hasToastedCheckErrorRef.current = false;
        setIsCheckingExisting(false);
      }
    }

    checkExisting();
    const unsubscribe = subscribe(checkExisting);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [node.id]);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("Prompt copied", {
        description: "Paste it into your AI assistant, then paste the JSON reply back here.",
      });
    } catch {
      toast.error("Couldn't copy to clipboard - select and copy the prompt text manually instead.");
    }
  };

  const handleSave = async () => {
    setError(null);

    if (!node.id) {
      setError("This lesson node has no id yet - re-import the tree before generating a breakdown.");
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(pastedText);
    } catch {
      setError("That doesn't look like valid JSON. Please paste the AI's raw JSON reply.");
      return;
    }

    const result = lessonBreakdownResponseSchema.safeParse(parsedJson);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      setError(
        firstIssue
          ? `Response didn't match the expected shape: ${firstIssue.path.join(".") || "(root)"} - ${firstIssue.message}`
          : "Response didn't match the expected shape."
      );
      return;
    }

    if (result.data.project_id !== PROJECT_ID) {
      setError(
        `This response is for a different project (project_id "${result.data.project_id}" doesn't match this project). Paste the reply generated for this project instead.`
      );
      return;
    }

    if (result.data.lesson_node_id !== node.id) {
      setError(
        `This response is for a different lesson (lesson_node_id "${result.data.lesson_node_id}" doesn't match "${node.id}"). Paste the reply generated for this lesson instead.`
      );
      return;
    }

    setIsSaving(true);
    try {
      await saveLessonBreakdown(node.id, result.data.breakdown);

      // Only navigate into Phase 2 if a lesson record now actually exists
      // for this node - if ensureLessonFromBreakdown fails, there's nothing
      // for the Phase 2 page to show, so stay put and fall back to the
      // normal onSaved() close-panel behavior instead of routing the user
      // to a lesson detail page with no lesson record behind it.
      let lessonEnsured = false;
      try {
        await ensureLessonFromBreakdown(result.data);
        lessonEnsured = true;
      } catch (lessonErr) {
        // The breakdown itself is saved either way; surface lesson hand-off
        // failures as a toast rather than blocking on them, since the user
        // can still retry lesson creation later from the lesson detail view.
        toast.error("Breakdown saved, but couldn't create/update the lesson record", {
          description: lessonErr instanceof Error ? lessonErr.message : undefined,
        });
      }

      toast.success(hasSavedBreakdown ? "Lesson breakdown updated" : "Lesson breakdown saved", {
        description: node.label,
      });
      setPastedText("");

      if (lessonEnsured) {
        navigate({ to: "/lessons/$lessonId", params: { lessonId: node.id } });
      } else {
        onSaved();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn't save this breakdown: ${err.message}`
          : "Couldn't save this breakdown."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="w-96 shrink-0">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">
            {isCheckingExisting
              ? "Checking..."
              : hasSavedBreakdown
                ? "Regenerate breakdown"
                : "Break down"}
            : {node.label}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {isCheckingExisting
              ? "Checking whether this lesson already has a saved breakdown..."
              : hasSavedBreakdown
                ? "This lesson already has a saved breakdown. Copy the prompt below to an AI assistant, then paste its JSON reply back in to overwrite it."
                : "Copy the prompt below to an AI assistant, then paste its JSON reply back in to save the breakdown."}
          </p>
          {lessonRecordId ? (
            <Link
              to="/lessons/$lessonId"
              params={{ lessonId: node.id ?? "" }}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              View lesson detail <ArrowRight className="size-3" />
            </Link>
          ) : null}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Prompt</span>
            <Button size="sm" variant="outline" onClick={handleCopyPrompt}>
              <Copy className="size-3.5" /> Copy prompt
            </Button>
          </div>
          <Textarea
            value={prompt}
            readOnly
            className="min-h-[140px] font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>

        <div className="space-y-2 border-t border-dashed border-border pt-3">
          <span className="text-xs font-medium text-muted-foreground">Paste AI response</span>
          <Textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder={`Paste the AI's JSON reply here, e.g. {"version":"v1","project_id":"...","lesson_node_id":"...","breakdown":{...}}`}
            className="min-h-[140px] font-mono text-xs"
            disabled={isSaving}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || isCheckingExisting || pastedText.trim().length === 0}
            >
              {isSaving ? "Saving..." : hasSavedBreakdown ? "Regenerate breakdown" : "Save breakdown"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}