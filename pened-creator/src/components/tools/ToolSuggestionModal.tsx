import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  TOOL_SUGGESTION_MAX_LENGTH,
  ToolSuggestionsApiError,
  submitToolSuggestion,
  validateToolSuggestionDescription,
} from "@/lib/tools/toolSuggestionsClient";

export interface ToolSuggestionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a suggestion has been saved successfully. */
  onSubmitted?: () => void;
}

type SubmitState = "idle" | "submitting" | "success";

/** Turns an API failure into a message suitable for showing to the user. */
function getErrorMessage(error: unknown): string {
  if (error instanceof ToolSuggestionsApiError) {
    if (error.code === "RATE_LIMITED" && error.retryAfterSeconds) {
      const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
      return `Too many suggestions. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    if (error.code === "UNAUTHENTICATED") {
      return "Please sign in to suggest a tool.";
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Modal for submitting a new tool suggestion.
 *
 * Built on the Dialog primitive (Radix), which provides the focus trap,
 * Escape to close, click-outside dismissal, and dialog ARIA roles. While a
 * submission is in flight the dialog cannot be dismissed, so the user does
 * not lose track of a pending request.
 */
export function ToolSuggestionModal({ open, onOpenChange, onSubmitted }: ToolSuggestionModalProps) {
  const [description, setDescription] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const textareaId = useId();
  const errorId = `${textareaId}-error`;
  const hintId = `${textareaId}-hint`;

  const isSubmitting = state === "submitting";
  const isSuccess = state === "success";

  // Reset everything each time the modal is closed so it reopens clean.
  useEffect(() => {
    if (!open) {
      setDescription("");
      setState("idle");
      setFieldError(null);
      setFormError(null);
      setTouched(false);
    }
  }, [open]);

  // Never leave a pending auto-close timer behind on unmount.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  function handleOpenChange(next: boolean) {
    if (isSubmitting) return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    onOpenChange(next);
  }

  function handleChange(value: string) {
    setDescription(value);
    setFormError(null);
    if (touched) {
      setFieldError(validateToolSuggestionDescription(value));
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || isSuccess) return;

    setTouched(true);
    const validationMessage = validateToolSuggestionDescription(description);
    if (validationMessage) {
      setFieldError(validationMessage);
      textareaRef.current?.focus();
      return;
    }

    setFieldError(null);
    setFormError(null);
    setState("submitting");

    try {
      await submitToolSuggestion({ description });
      setState("success");
      toast.success("Thanks! Your suggestion was sent.");
      onSubmitted?.();
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        onOpenChange(false);
      }, 1500);
    } catch (error) {
      setState("idle");
      if (error instanceof ToolSuggestionsApiError && error.fields?.description) {
        setFieldError(error.fields.description);
        textareaRef.current?.focus();
      } else {
        setFormError(getErrorMessage(error));
      }
    }
  }

  const trimmedLength = description.trim().length;
  const describedBy = [hintId, fieldError ? errorId : null].filter(Boolean).join(" ");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="tool-suggestion-modal"
        onOpenAutoFocus={(event) => {
          // Land focus in the textarea rather than the close button.
          event.preventDefault();
          textareaRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Suggest a tool</DialogTitle>
          <DialogDescription>
            Describe the tool you would like to see. What should it do, and how would it help your work?
          </DialogDescription>
        </DialogHeader>

        {isSuccess ? (
          <div
            className="flex flex-col items-center gap-2 py-8 text-center"
            role="status"
            data-testid="tool-suggestion-success"
          >
            <CheckCircle2 className="size-10 text-primary" aria-hidden="true" />
            <p className="text-sm font-medium">Suggestion sent</p>
            <p className="text-sm text-muted-foreground">Thanks for helping us improve. An admin will review it.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={textareaId}>Tool description</Label>
              <Textarea
                id={textareaId}
                ref={textareaRef}
                value={description}
                onChange={(event) => handleChange(event.target.value)}
                onBlur={() => {
                  setTouched(true);
                  setFieldError(validateToolSuggestionDescription(description));
                }}
                disabled={isSubmitting}
                rows={6}
                maxLength={TOOL_SUGGESTION_MAX_LENGTH + 200}
                placeholder="For example: a tool that turns a lesson into a printable worksheet with an answer key."
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={describedBy}
                data-testid="tool-suggestion-description"
              />
              <div className="flex items-start justify-between gap-3 text-xs">
                <p
                  id={errorId}
                  role={fieldError ? "alert" : undefined}
                  className="text-destructive"
                  data-testid="tool-suggestion-field-error"
                >
                  {fieldError}
                </p>
                <p id={hintId} className="ml-auto shrink-0 text-muted-foreground">
                  {trimmedLength}/{TOOL_SUGGESTION_MAX_LENGTH}
                </p>
              </div>
            </div>

            {formError ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                data-testid="tool-suggestion-form-error"
              >
                {formError}
              </div>
            ) : null}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
                data-testid="tool-suggestion-cancel"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="tool-suggestion-submit">
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Sending...
                  </>
                ) : (
                  "Send suggestion"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ToolSuggestionModal;