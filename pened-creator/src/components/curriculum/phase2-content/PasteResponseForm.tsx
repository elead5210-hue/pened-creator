import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { saveGeneratedContent, type LessonRecord } from "@/lib/curriculum/shared/db";
import { ApiError } from "@/lib/curriculum/shared/apiClient";
import { getTools } from "@/lib/tools/toolsClient";
import { validateGeneratedContent } from "@/lib/curriculum/phase2-content/contentValidator";

const PLACEHOLDER_JSON = '[\n  { "tool": "...", "data": { ... } },\n  ...\n]';

interface ContentError {
  blockIndex: number;
  path: string;
  message: string;
}

interface PasteResponseFormProps {
  /** The lesson id (project_id:lesson_node_id) to save this response to. */
  lessonId: string | null | undefined;
  /** Called once the pasted content JSON has been validated and saved. */
  onSaved: (lessonRecord: LessonRecord) => void;
  /** Called when the form is dismissed without saving. */
  onCancel: () => void;
}

/**
 * Turns a saveGeneratedContent() failure into a short, human-readable
 * message. Distinguishes the network being unreachable, the lesson having
 * been deleted elsewhere in the meantime (404 - a real possibility now
 * that this form's save can race with another tab/session), and any other
 * server-rejected request, since each calls for a different next step
 * from the user (retry, go back, or fix the input).
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
  return err instanceof Error ? err.message : "Failed to save the AI response. Please try again.";
}

/**
 * Turns a getTools() failure into a short, human-readable message, for
 * when the tool registry can't be fetched to validate the pasted
 * response against - distinct from describeSaveError above since this
 * failure happens before saving is even attempted.
 */
function describeToolRegistryError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) {
      return "Couldn't reach the server to load the tool registry. Check your connection and try again.";
    }
    return `Couldn't load the tool registry: ${err.message}`;
  }
  return err instanceof Error ? err.message : "Failed to load the tool registry. Please try again.";
}

/**
 * "Paste AI Response" form: a textarea for pasting the AI-generated content
 * JSON, inline block/field-level validation feedback, and a save action
 * that persists the parsed content via curricullumbuilder's unified db
 * module.
 */
export function PasteResponseForm({ lessonId, onSaved, onCancel }: PasteResponseFormProps) {
  const [rawText, setRawText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ContentError[]>([]);

  function clearErrors() {
    setSummaryError(null);
    setFieldErrors([]);
  }

  /**
   * Parses the raw textarea value into JSON. Throws a plain Error (with a
   * single message) for empty input or malformed JSON - content
   * validation against the live tool registry happens separately in
   * handleSave, since that requires an async fetch.
   */
  function parseResponse(text: string): unknown {
    const trimmed = text.trim();

    if (!trimmed) {
      throw new Error("Please paste the AI response JSON before saving.");
    }

    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleSave() {
    clearErrors();

    if (!lessonId) {
      setSummaryError("No lesson is selected to save this response to.");
      return;
    }

    let parsed: unknown;
    try {
      parsed = parseResponse(rawText);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err));
      return;
    }

    setIsSaving(true);

    let tools;
    try {
      tools = await getTools();
    } catch (err) {
      setIsSaving(false);
      setSummaryError(describeToolRegistryError(err));
      return;
    }

    const { valid, errors } = validateGeneratedContent(parsed, tools);
    if (!valid) {
      setIsSaving(false);
      setFieldErrors(errors);
      return;
    }

    try {
      const lessonRecord = await saveGeneratedContent(lessonId, parsed as unknown[]);
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
        <CardTitle>Paste AI Response</CardTitle>
        <CardDescription>
          Paste the AI-generated content JSON below. It will be validated before saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="paste-response-json-input">Paste AI response JSON</Label>
          <Textarea
            id="paste-response-json-input"
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
          <div
            role="alert"
            className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3"
          >
            <p className="text-xs font-medium text-destructive">{summaryError}</p>
          </div>
        ) : null}

        {hasFieldErrors ? (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3"
          >
            <p className="text-xs font-medium text-destructive">
              {fieldErrors.length === 1
                ? "1 problem was found with the pasted response:"
                : `${fieldErrors.length} problems were found with the pasted response:`}
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
              {fieldErrors.map((error, index) => (
                <li key={`${error.blockIndex}-${error.path}-${index}`}>
                  {error.blockIndex >= 0
                    ? `Block ${error.blockIndex}: ${error.message}`
                    : error.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Response"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
