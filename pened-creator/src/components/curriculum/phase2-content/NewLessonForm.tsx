
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  validateLessonBreakdownDocument,
  type LessonBreakdownValidationError,
} from "@/lib/curriculum/shared/schema";
import { createLesson, updateLessonBreakdown, type LessonRecord } from "@/lib/curriculum/shared/db";
import { ApiError } from "@/lib/curriculum/shared/apiClient";

const PLACEHOLDER_JSON =
  '{\n  "version": "v1",\n  "project_id": "...",\n  "lesson_node_id": "...",\n  "breakdown": { ... }\n}';

interface NewLessonFormProps {
  /**
   * Existing lesson record to re-import curriculum JSON onto. Omit to
   * create a brand-new lesson record instead.
   */
  initialLesson?: LessonRecord;
  /** Called once the pasted JSON has been validated and saved. */
  onSaved: (lessonRecord: LessonRecord) => void;
  /** Called when the form is dismissed without saving. */
  onCancel: () => void;
}

/**
 * "New Lesson" / "Import Curriculum JSON" entry form: a textarea for
 * pasting the lesson breakdown JSON, inline field-level validation
 * feedback, and a save action that persists the parsed record via
 * curricullumbuilder's unified db module.
 *
 * By default this creates a brand-new lesson record. Passing
 * `initialLesson` (an existing lesson record) switches the form into
 * edit mode: the textarea is pre-filled with that lesson's current
 * breakdown JSON, the heading/save button read "Import Curriculum
 * JSON" / "Save Changes", and saving calls updateLessonBreakdown
 * instead of createLesson.
 *
 * Both modes use consistent "curriculum JSON" language, since a new
 * lesson is created by importing curriculum JSON for the first time,
 * and an existing lesson is updated by re-importing it.
 */
export function NewLessonForm({ initialLesson, onSaved, onCancel }: NewLessonFormProps) {
  const isEditing = Boolean(initialLesson);

  const [rawText, setRawText] = useState(() => {
    if (!initialLesson) return "";
    try {
      return JSON.stringify(initialLesson.breakdown, null, 2);
    } catch {
      return "";
    }
  });
  const [isSaving, setIsSaving] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<LessonBreakdownValidationError[]>([]);

  const heading = isEditing ? "Import Curriculum JSON" : "New Lesson — Import Curriculum JSON";
  const saveButtonDefaultLabel = isEditing ? "Save Changes" : "Save Lesson";

  function clearErrors() {
    setSummaryError(null);
    setFieldErrors([]);
  }

  /**
   * Turns a createLesson/updateLessonBreakdown failure into a short,
   * human-readable message. db.ts already rewrites the 409 (id already
   * exists) and 404 (lesson missing) cases into friendly plain Errors, so
   * those normally arrive here pre-worded - but ApiError can still surface
   * directly for anything db.ts doesn't special-case (an unreachable
   * network, a 5xx, or any other status), so those are handled explicitly
   * here too rather than falling through to a generic "try again" message.
   */
  function describeSaveError(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 0) {
        return "Couldn't reach the server. Check your connection and try saving again.";
      }
      if (err.status === 409) {
        return "A lesson with this id already exists (project_id + lesson_node_id must be unique).";
      }
      if (err.status === 404) {
        return isEditing
          ? "This lesson no longer exists - it may have been deleted elsewhere. Go back and re-open it from the curriculum tree."
          : "Couldn't save this lesson - the request was rejected as not found. Please try again.";
      }
      return err.message;
    }
    if (err instanceof Error) return err.message;
    return isEditing ? "Failed to save changes. Please try again." : "Failed to save lesson. Please try again.";
  }

  /**
   * Parses and validates the raw textarea value. Throws a plain Error
   * (with a single message) for empty input or malformed JSON. Returns
   * { parsed, valid, errors } for structurally valid JSON that fails
   * schema validation, so the caller can render a field list.
   */
  function parseAndValidate(text: string) {
    const trimmed = text.trim();

    if (!trimmed) {
      throw new Error(
        isEditing
          ? "Please paste the curriculum JSON before saving."
          : "Please paste curriculum JSON before saving.",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { valid, errors } = validateLessonBreakdownDocument(parsed);

    return { parsed, valid, errors };
  }

  async function handleSave() {
    clearErrors();

    let result: { parsed: unknown; valid: boolean; errors: LessonBreakdownValidationError[] };
    try {
      result = parseAndValidate(rawText);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err));
      return;
    }

    if (!result.valid) {
      setFieldErrors(result.errors);
      return;
    }

    setIsSaving(true);
    try {
      const lessonRecord = initialLesson
        ? await updateLessonBreakdown(initialLesson.id, result.parsed)
        : await createLesson(result.parsed);
      setIsSaving(false);
      setRawText("");
      onSaved(lessonRecord);
    } catch (err) {
      setIsSaving(false);
      setSummaryError(describeSaveError(err));
    }
  }

  function handleCancel() {
    clearErrors();
    setRawText("");
    onCancel();
  }

  const hasFieldErrors = fieldErrors.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
        <CardDescription>
          Paste the lesson breakdown JSON below. It will be validated before saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="new-lesson-json-input">Paste curriculum JSON</Label>
          <Textarea
            id="new-lesson-json-input"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={PLACEHOLDER_JSON}
            spellCheck={false}
            rows={16}
            disabled={isSaving}
            className="min-h-[280px] font-mono text-xs"
          />
        </div>

        {summaryError ? (
          <div role="alert" className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-xs font-medium text-destructive">{summaryError}</p>
          </div>
        ) : null}

        {hasFieldErrors ? (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-xs font-medium text-destructive">
              {fieldErrors.length === 1
                ? "1 problem was found with the pasted JSON:"
                : `${fieldErrors.length} problems were found with the pasted JSON:`}
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
              {fieldErrors.map((error, index) => (
                <li key={`${error.path}-${index}`}>{error.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : saveButtonDefaultLabel}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}