
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { saveImagePrompts, type LessonRecord } from "@/lib/curriculum/shared/db";
import { ApiError } from "@/lib/curriculum/shared/apiClient";
import { validateImagePromptResponse, type ImagePromptValidationError } from "@/lib/curriculum/shared/schema";

const PLACEHOLDER_JSON =
  '[\n  {\n    "id": "img-01",\n    "sourceTool": "...",\n    "description": "...",\n    "imagePrompt": "...",\n    "style": "...",\n    "aspectRatio": "16:9",\n    "altText": "..."\n  },\n  ...\n]';

interface PasteImagePromptResponseFormProps {
  /** The lesson id (project_id:lesson_node_id) to save these image prompts to. */
  lessonId: string | null | undefined;
  /** Called once the pasted image-prompt JSON has been validated and saved. */
  onSaved: (lessonRecord: LessonRecord) => void;
  /** Called when the form is dismissed without saving. */
  onCancel: () => void;
}

/**
 * Turns a saveImagePrompts() failure into a short, human-readable message,
 * mirroring PasteResponseForm's describeSaveError so the two paste flows
 * fail the same way.
 */
function describeSaveError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) {
      return "Couldn't reach the server. Check your connection and try saving again.";
    }
    if (err.status === 404) {
      return "This lesson no longer exists - it may have been deleted elsewhere. Go back and re-open it from the curriculum tree.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Failed to save the image prompts. Please try again.";
}

/**
 * Strips markdown code fences (```json ... ``` or ``` ... ```) from pasted
 * text and extracts the JSON array between the first "[" and the last "]",
 * so a reply with stray prose or fences around the array still parses -
 * matching the prototype's extractJsonArray().
 */
function extractJsonArray(raw: string): unknown {
  const stripped = raw.trim().replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON array found in the pasted text.");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * "Paste AI Response" form for the Image Generation step: a textarea for
 * pasting the AI-returned image-prompt JSON array (markdown fences are
 * stripped automatically), inline field-level validation feedback, and a
 * save action that persists the parsed array via saveImagePrompts.
 * Mirrors PasteResponseForm.tsx's structure so the two paste steps behave
 * identically from the user's point of view.
 */
export function PasteImagePromptResponseForm({
  lessonId,
  onSaved,
  onCancel,
}: PasteImagePromptResponseFormProps) {
  const [rawText, setRawText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ImagePromptValidationError[]>([]);

  function clearErrors() {
    setSummaryError(null);
    setFieldErrors([]);
  }

  /**
   * Parses and validates the raw textarea value. Throws a plain Error
   * (with a single message) for empty input, malformed JSON, or no array
   * found. Returns { parsed, valid, errors } for a structurally valid
   * array that fails item-level validation, so the caller can render a
   * field list.
   */
  function parseAndValidate(text: string) {
    const trimmed = text.trim();

    if (!trimmed) {
      throw new Error("Please paste the AI response JSON before saving.");
    }

    let parsed: unknown;
    try {
      parsed = extractJsonArray(trimmed);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { valid, errors } = validateImagePromptResponse(parsed);

    return { parsed, valid, errors };
  }

  async function handleSave() {
    clearErrors();

    if (!lessonId) {
      setSummaryError("No lesson is selected to save these image prompts to.");
      return;
    }

    let result: { parsed: unknown; valid: boolean; errors: ImagePromptValidationError[] };
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
      const lessonRecord = await saveImagePrompts(lessonId, result.parsed as unknown[]);
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
        <CardTitle>Paste the AI's Response</CardTitle>
        <CardDescription>
          Paste the AI's reply to the image prompt request below — the JSON array of image
          prompts (markdown code fences are fine, they'll be stripped automatically). It will be
          validated before saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="paste-image-prompt-json-input">Paste AI response JSON</Label>
          <Textarea
            id="paste-image-prompt-json-input"
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
                ? "1 problem was found with the pasted response:"
                : `${fieldErrors.length} problems were found with the pasted response:`}
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
              {fieldErrors.map((error, index) => (
                <li key={`${error.path}-${index}`}>
                  {error.path !== "$" ? `${error.path}: ${error.message}` : error.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Render Image Cards"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}