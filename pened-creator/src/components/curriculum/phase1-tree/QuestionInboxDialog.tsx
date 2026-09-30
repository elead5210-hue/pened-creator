import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ExamQuestionSchema,
  AiResponseSchema,
  extractNodeHints,
  expand,
  PROJECT_ID,
  QUESTION_NODE_TYPE,
  type ExamQuestion,
  type QuestionStatus,
  type CurriculumNode,
} from "@/lib/curriculum/shared/schema";
import {
  getQuestions,
  saveQuestion,
  addQuestion,
  addNode,
  removeNodeBySourceQuestionId,
  getAllNodes,
  subscribe,
} from "@/lib/curriculum/shared/db";
import { ApiError } from "@/lib/curriculum/shared/apiClient";
import { NodePicker } from "@/components/curriculum/phase1-tree/NodePicker";

interface QuestionInboxDialogProps {
  /**
   * The element that opens the dialog (e.g. a Button). When provided, it's
   * used as the DialogTrigger; when omitted, a default "Import questions"
   * trigger button is rendered instead.
   */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Defaults to this app's single stable project id when not supplied. */
  projectId?: string;
  /**
   * When set, the matching question's card is scrolled into view and
   * visually highlighted once the dialog opens - used to jump back to the
   * question that produced a given tree node.
   */
  highlightQuestionId?: string;
}

/** Turns a refreshQuestions() failure into a short, human-readable
 * message, calling out an unreachable API distinctly from a request the
 * server rejected. */
function describeLoadError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 0 ? "Couldn't reach the server. Check your connection." : err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

function statusBadgeVariant(status: QuestionStatus): "outline" | "secondary" | "default" {
  switch (status) {
    case "applied":
      return "default";
    case "responded":
      return "secondary";
    case "draft":
    default:
      return "outline";
  }
}

interface QuestionCardProps {
  question: ExamQuestion;
  projectId: string;
  tree: CurriculumNode | null;
  onUpdated: (updated: ExamQuestion) => void;
  isHighlighted?: boolean;
}

function QuestionCard({ question, projectId, tree, onUpdated, isHighlighted }: QuestionCardProps) {
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    question.confirmedNodeId,
  );
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement | null>(null);

  // Once a response is saved, default the picker to the best guess drawn
  // from the parsed summary - but only if nothing's been picked yet, so
  // reloading the tree in the background never clobbers a user's choice.
  useEffect(() => {
    setSelectedNodeId((prev) => {
      if (prev) return prev;
      if (question.confirmedNodeId) return question.confirmedNodeId;
      const hints = extractNodeHints(question.parsedSummary, tree);
      return hints[0]?.id;
    });
  }, [question.confirmedNodeId, question.parsedSummary, tree]);

  // Scroll the card into view whenever it becomes the highlighted target
  // (e.g. jumping back from a question-derived tree node).
  useEffect(() => {
    if (isHighlighted) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  const handleTogglePaste = () => {
    setError(null);
    setShowPasteArea((prev) => !prev);
  };

  const handleSave = async () => {
    setError(null);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(pastedText);
    } catch {
      setError("That doesn't look like valid JSON. Please paste the AI's raw JSON reply.");
      return;
    }

    const result = AiResponseSchema.safeParse(parsedJson);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      setError(
        firstIssue
          ? `Response didn't match the expected shape: ${firstIssue.path.join(".") || "(root)"} - ${firstIssue.message}`
          : "Response didn't match the expected shape.",
      );
      return;
    }

    if (result.data.version !== "v1") {
      setError(`Unsupported response version "${result.data.version}" - expected "v1".`);
      return;
    }

    if (result.data.project_id !== projectId) {
      setError(
        `This response is for a different project (project_id "${result.data.project_id}" doesn't match this project). Paste the reply generated for this project instead.`,
      );
      return;
    }

    const goal = result.data.goals[0];
    if (!goal) {
      setError("Response parsed, but the goals array was empty - nothing to save.");
      return;
    }

    setIsSaving(true);
    try {
      const updated: ExamQuestion = {
        ...question,
        parsedTitle: goal.title,
        parsedSummary: goal.summary,
        status: "responded",
      };

      const validated = ExamQuestionSchema.parse(updated);
      await saveQuestion(validated);
      onUpdated(validated);
      setShowPasteArea(false);
      setPastedText("");
      toast.success("AI response saved", {
        description: goal.title,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn't save this response: ${err.message}`
          : "Couldn't save this response.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmPlacement = async () => {
    if (!selectedNodeId) return;
    setConfirmError(null);
    setIsConfirming(true);
    try {
      const updated: ExamQuestion = { ...question, confirmedNodeId: selectedNodeId };
      const validated = ExamQuestionSchema.parse(updated);

      await addNode(
        selectedNodeId,
        validated.parsedTitle ?? validated.questionText,
        QUESTION_NODE_TYPE,
        validated.id,
      );

      const applied: ExamQuestion = { ...validated, status: "applied" };
      const validatedApplied = ExamQuestionSchema.parse(applied);
      await saveQuestion(validatedApplied);
      onUpdated(validatedApplied);
      toast.success("Placement confirmed");
    } catch (err) {
      setConfirmError(
        err instanceof Error
          ? `Couldn't save placement: ${err.message}`
          : "Couldn't save placement.",
      );
    } finally {
      setIsConfirming(false);
    }
  };

  const handleRemoveFromTree = async () => {
    setRemoveError(null);
    setIsRemoving(true);
    try {
      await removeNodeBySourceQuestionId(question.id);

      const reverted: ExamQuestion = { ...question, status: "responded" };
      const validated = ExamQuestionSchema.parse(reverted);
      await saveQuestion(validated);
      onUpdated(validated);
      toast.success("Removed from tree", {
        description: "Pick a node and confirm placement again to re-apply this question.",
      });
    } catch (err) {
      setRemoveError(
        err instanceof Error
          ? `Couldn't remove this placement: ${err.message}`
          : "Couldn't remove this placement.",
      );
    } finally {
      setIsRemoving(false);
    }
  };

  const placementSaved =
    Boolean(question.confirmedNodeId) && question.confirmedNodeId === selectedNodeId;

  return (
    <Card
      ref={cardRef}
      className={cn("mb-3 transition-shadow", isHighlighted && "ring-2 ring-primary shadow-md")}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-sm font-medium leading-snug">
            {question.parsedTitle ?? question.questionText}
          </CardTitle>
          {question.parsedSummary ? (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {question.parsedSummary}
            </p>
          ) : null}
        </div>
        <Badge variant={statusBadgeVariant(question.status)} className="shrink-0 capitalize">
          {question.status}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0">
        {!showPasteArea ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleTogglePaste}>
              Paste AI response
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder={`Paste the AI's JSON reply here, e.g. {"version":"v1","project_id":"...","goals":[{"title":"...","summary":"..."}]}`}
              className="min-h-[140px] font-mono text-xs"
              disabled={isSaving}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving || pastedText.trim().length === 0}
              >
                {isSaving ? "Saving..." : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowPasteArea(false);
                  setPastedText("");
                  setError(null);
                }}
                disabled={isSaving}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {question.parsedSummary ? (
          <div className="mt-3 space-y-2 rounded-md border border-dashed border-border p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MapPin className="size-3.5" />
              Confirm placement in the curriculum tree
            </div>
            <NodePicker
              tree={tree}
              value={selectedNodeId}
              onSelect={(node) => {
                setSelectedNodeId(node.id);
                setConfirmError(null);
              }}
              hintText={question.parsedSummary}
              placeholder="Choose the node this question belongs under..."
              disabled={isConfirming}
            />
            {confirmError ? <p className="text-xs text-destructive">{confirmError}</p> : null}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleConfirmPlacement}
                disabled={isConfirming || !selectedNodeId || placementSaved}
              >
                {isConfirming
                  ? "Saving..."
                  : placementSaved
                    ? "Placement confirmed"
                    : "Confirm placement"}
              </Button>
              {placementSaved && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-primary" />
                  Saved
                </span>
              )}
            </div>
            {question.status === "applied" ? (
              <div className="space-y-1.5 border-t border-dashed border-border pt-2">
                {removeError ? <p className="text-xs text-destructive">{removeError}</p> : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={handleRemoveFromTree}
                  disabled={isRemoving}
                >
                  {isRemoving ? "Removing..." : "Remove from tree"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function QuestionInboxDialog({
  children,
  open,
  onOpenChange,
  projectId,
  highlightQuestionId,
}: QuestionInboxDialogProps) {
  const effectiveProjectId = projectId ?? PROJECT_ID;

  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [newQuestionText, setNewQuestionText] = useState("");
  const [showAddArea, setShowAddArea] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [tree, setTree] = useState<CurriculumNode | null>(null);
  // True while the question list is being (re)fetched - the dialog used
  // to open onto data that was already sitting in IndexedDB, effectively
  // instantly; now it's a real network round trip, so the dialog needs a
  // visible loading state instead of briefly flashing "No questions yet".
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  // Set only when refreshQuestions() fails, so the dialog can show a
  // distinct "couldn't load" state (with a retry action) rather than
  // silently rendering an empty list that looks identical to "no
  // questions have been added yet".
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  const refreshQuestions = async () => {
    setIsLoadingQuestions(true);
    setQuestionsError(null);
    try {
      const loaded = await getQuestions(effectiveProjectId);
      setQuestions(loaded);
    } catch (err) {
      const message = describeLoadError(err);
      setQuestionsError(message);
      toast.error("Couldn't load questions", { description: message });
    } finally {
      setIsLoadingQuestions(false);
    }
  };

  const refreshTree = async () => {
    try {
      const rows = await getAllNodes();
      setTree(expand(rows));
    } catch {
      setTree(null);
    }
  };

  // Keep the curriculum tree fresh in the background (not just while the
  // dialog is open) so NodePicker always has current data the moment a
  // question needs its placement confirmed.
  useEffect(() => {
    void refreshTree();
    const unsubscribe = subscribe(refreshTree);
    return () => {
      unsubscribe();
    };
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange?.(nextOpen);
    if (nextOpen) {
      void refreshQuestions();
    }
  };

  const handleAddQuestion = async () => {
    const text = newQuestionText.trim();
    if (!text) return;

    setIsAdding(true);
    try {
      const created = await addQuestion(effectiveProjectId, text);
      setQuestions((prev) => [...prev, created]);
      setNewQuestionText("");
      setShowAddArea(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? `Couldn't add question: ${err.message}` : "Couldn't add question.",
      );
    } finally {
      setIsAdding(false);
    }
  };

  const handleQuestionUpdated = (updated: ExamQuestion) => {
    setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children ?? <Button variant="outline">Import questions</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Exam question inbox</DialogTitle>
          <DialogDescription>
            Add exam questions, copy them out to an AI assistant along with your curriculum tree,
            then paste each AI reply back in to file the question.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoadingQuestions ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Loading questions…</p>
          ) : questionsError ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-destructive/30 bg-destructive/5 p-4 text-center">
              <p className="text-sm text-destructive">Couldn't load questions</p>
              <p className="text-xs text-muted-foreground">{questionsError}</p>
              <Button size="sm" variant="outline" onClick={() => void refreshQuestions()}>
                Try again
              </Button>
            </div>
          ) : questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No questions yet. Add one below to get started.
            </p>
          ) : (
            questions.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                projectId={effectiveProjectId}
                tree={tree}
                onUpdated={handleQuestionUpdated}
                isHighlighted={Boolean(highlightQuestionId) && question.id === highlightQuestionId}
              />
            ))
          )}

          {!showAddArea ? (
            <Button size="sm" variant="secondary" onClick={() => setShowAddArea(true)}>
              Add question
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border p-3">
              <Textarea
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                placeholder="Paste or type the exam question here..."
                className="min-h-[100px] text-sm"
                disabled={isAdding}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleAddQuestion}
                  disabled={isAdding || newQuestionText.trim().length === 0}
                >
                  {isAdding ? "Adding..." : "Save question"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAddArea(false);
                    setNewQuestionText("");
                  }}
                  disabled={isAdding}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
