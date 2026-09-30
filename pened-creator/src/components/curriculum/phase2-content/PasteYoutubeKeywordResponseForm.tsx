
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { validateYoutubeKeywordResponse, type YoutubeKeywordItem, type YoutubeKeywordValidationError } from "@/lib/curriculum/shared/schema";
import { saveYoutubeKeywordResponse } from "@/lib/curriculum/shared/db";
import { ApiError } from "@/lib/curriculum/shared/apiClient";

const PLACEHOLDER_JSON =
  '[\n  {\n    "keyword": "...",\n    "sourceTool": "...",\n    "reason": "..."\n  },\n  ...\n]';

interface PasteYoutubeKeywordResponseFormProps {
  /** The lesson this response belongs to. The pasted response and its
   * extracted keywords are saved to the API under this lesson id
   * (PUT /api/lessons/:lessonId/youtube-keyword-response). */
  lessonId: string;
  /** Previously saved raw response text, used to pre-fill the textarea
   * when the user returns to this step. */
  initialRawResponse?: string;
  /** Called once the pasted keyword JSON has been validated AND saved to
   * the API, with the parsed keyword list, so the caller can use it
   * (e.g. to run YouTube searches). */
  onSaved: (keywords: YoutubeKeywordItem[]) => void;
  /** Called when the form is dismissed without saving. */
  onCancel: () => void;
}

/**
 * Strips markdown code fences (```json ... ``` or ``` ... ```) from pasted
 * text and extracts the JSON array between the first "[" and the last "]",
 * so a reply with stray prose or fences around the array still parses -
 * mirrors PasteImagePromptResponseForm's extractJsonArray().
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
 * "Paste AI Response" form for the YouTube Videos step: a textarea for
 * pasting the AI-returned keyword JSON array (markdown fences are stripped
 * automatically), inline field-level validation feedback, and a "save"
 * action that hands the parsed array straight back to the caller via
 * onSaved - no server round-trip, since this step's keywords are
 * session-only and never persisted. Mirrors
 * PasteImagePromptResponseForm.tsx's structure (minus the persistence
 * call) so the paste steps across Phase 2 behave identically from the
 * user's point of view.
 */
export function PasteYoutubeKeywordResponseForm({
  lessonId,
  initialRawResponse,
  onSaved,
  onCancel,
}: PasteYoutubeKeywordResponseFormProps) {
  const [rawText, setRawText] = useState(initialRawResponse ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  // Synchronous guard against double-submits (state updates are async, so
  // a fast double-click could otherwise slip past isSaving).
  const savingRef = useRef(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<YoutubeKeywordValidationError[]>([]);

  function clearErrors() {
    setSummaryError(null);
    setFieldErrors([]);
    setSaveSucceeded(false);
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

    const { valid, errors } = validateYoutubeKeywordResponse(parsed);

    return { parsed, valid, errors };
  }

  async function handleSave() {
    if (savingRef.current) return;
    clearErrors();

    let result: { parsed: unknown; valid: boolean; errors: YoutubeKeywordValidationError[] };
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

    const keywords = result.parsed as YoutubeKeywordItem[];

    savingRef.current = true;
    setIsSaving(true);
    try {
      await saveYoutubeKeywordResponse(lessonId, {
        rawResponse: rawText,
        keywords,
      });
    } catch (err) {
      setSummaryError(
        err instanceof ApiError
          ? `Could not save the response: ${err.message}`
          : "Could not save the response. Please try again.",
      );
      savingRef.current = false;
      setIsSaving(false);
      return;
    }

    savingRef.current = false;
    setIsSaving(false);
    setSaveSucceeded(true);
    onSaved(keywords);
  }

  function handleCancel() {
    if (savingRef.current) return;
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
          Paste the AI's reply to the keyword request below — the JSON array of search keywords
          (markdown code fences are fine, they'll be stripped automatically). It will be
          validated and then saved with this lesson, so it's still here if you leave and come
          back.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="paste-youtube-keyword-json-input">Paste AI response JSON</Label>
          <Textarea
            id="paste-youtube-keyword-json-input"
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              setSaveSucceeded(false);
            }}
            disabled={isSaving}
            placeholder={PLACEHOLDER_JSON}
            spellCheck={false}
            rows={16}
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

        {saveSucceeded ? (
          <p role="status" className="text-xs font-medium text-emerald-600">
            Response saved.
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Use These Keywords"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}