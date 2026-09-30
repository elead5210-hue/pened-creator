
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { saveSlideshowDeck, SlideshowSaveError, type LessonRecord } from "@/lib/curriculum/shared/db";
import { ApiError } from "@/lib/curriculum/shared/apiClient";
import {
  parseAndValidateDeck,
  validateDeck,
  type DeckError,
  type SlideshowDeck,
} from "@/lib/curriculum/phase2-content/slideshowDeckValidator";

const PLACEHOLDER_JSON =
  '{\n  "version": "v1",\n  "id": "...",\n  "metadata": { "title": "..." },\n  "slides": [\n    {\n      "id": "slide-1",\n      "elements": [ ... ]\n    }\n  ]\n}';

interface PasteSlideshowDeckResponseFormProps {
  /** The lesson id (project_id:lesson_node_id) to save this deck to. */
  lessonId: string | null | undefined;
  /** Called once the pasted deck JSON has been validated and saved. */
  onSaved: (lessonRecord: LessonRecord) => void;
  /** Called when the form is dismissed without saving. */
  onCancel: () => void;
}

/**
 * Turns a saveSlideshowDeck() failure into a short, human-readable
 * message, mirroring PasteResponseForm's/PasteImagePromptResponseForm's
 * describeSaveError so every paste flow fails the same way.
 */
function describeSaveError(err: unknown): string {
  // saveSlideshowDeck already maps auth, size-limit, server, network and
  // "server didn't store it" failures to a specific, displayable message.
  if (err instanceof SlideshowSaveError) {
    return err.message;
  }
  if (err instanceof ApiError) {
    if (err.status === 0) {
      return "Couldn't reach the server. Check your connection and try saving again.";
    }
    if (err.status === 404) {
      return "This lesson no longer exists - it may have been deleted elsewhere. Go back and re-open it from the curriculum tree.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Failed to save the slideshow deck. Please try again.";
}

/**
 * "Paste AI Response" form for the Slideshow Data step (step 7): a
 * textarea for pasting the AI-returned Deck JSON object (markdown fences
 * are stripped automatically), inline field-level validation feedback,
 * and a save action that persists the parsed deck via
 * saveSlideshowDeck(lessonId, deck). Mirrors
 * PasteImagePromptResponseForm.tsx's structure, but works over a single
 * JSON object (a Deck) rather than a JSON array of items, so it uses the
 * shared parseAndValidateDeck helper (object extraction plus validation,
 * returning a typed deck or structured per-field errors) instead of
 * extractJsonArray and validateImagePromptResponse.
 */
export function PasteSlideshowDeckResponseForm({
  lessonId,
  onSaved,
  onCancel,
}: PasteSlideshowDeckResponseFormProps) {
  const [rawText, setRawText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<DeckError[]>([]);
  // Server-side save failures (auth, size limit, network, ...), kept apart
  // from summaryError/fieldErrors, which describe problems with the pasted
  // text itself. The pasted text is kept so the user can simply retry.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Synchronous guard against a second save starting before the isSaving
  // state update has re-rendered (e.g. a fast double-click).
  const savingRef = useRef(false);

  function clearErrors() {
    setSummaryError(null);
    setFieldErrors([]);
    setSaveError(null);
  }

  /**
   * Parses and validates the raw textarea value with the shared typed
   * parser. Throws a plain Error (with a single message) for empty input,
   * malformed JSON, or no object found. Returns { deck, errors } where
   * `deck` is the typed deck when valid (null otherwise) and `errors` is
   * the structured per-field error list, so the caller can render it.
   */
  function parseAndValidate(text: string): { deck: SlideshowDeck | null; errors: DeckError[] } {
    const trimmed = text.trim();

    if (!trimmed) {
      throw new Error("Please paste the AI response JSON before saving.");
    }

    const result = parseAndValidateDeck(trimmed);

    if (result.ok) {
      return { deck: result.deck, errors: [] };
    }

    // A single "$" error means the text couldn't be parsed as a JSON
    // object at all: surface it as a summary message rather than a field list.
    if (result.errors.length === 1 && result.errors[0].path === "$") {
      throw new Error(result.errors[0].message);
    }

    return { deck: null, errors: result.errors };
  }

  async function handleSave() {
    if (savingRef.current) return;
    clearErrors();

    if (!lessonId) {
      setSummaryError("No lesson is selected to save this slideshow deck to.");
      return;
    }

    let result: { deck: SlideshowDeck | null; errors: DeckError[] };
    try {
      result = parseAndValidate(rawText);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err));
      return;
    }

    const deck = result.deck;
    if (!deck) {
      setFieldErrors(result.errors);
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      const lessonRecord = await saveSlideshowDeck(lessonId, deck);
      // Only discard the pasted text once the returned record actually has
      // the deck; otherwise keep it so the user can retry.
      if (lessonRecord.slideshowDeck) {
        setRawText("");
      }
      onSaved(lessonRecord);
    } catch (err) {
      if (err instanceof SlideshowSaveError && err.reason === "invalid_deck") {
        // The deck was rejected by validation, not by the server, so show it
        // as a list of problems with the pasted deck (re-derived from the
        // validator), not as a failed save. Fall back to the error's own
        // message if the validator finds nothing to list.
        const { errors } = validateDeck(deck);
        if (errors.length > 0) {
          setFieldErrors(errors);
        } else {
          setSummaryError(err.message);
        }
      } else {
        setSaveError(describeSaveError(err));
      }
    } finally {
      savingRef.current = false;
      setIsSaving(false);
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
          Paste the AI's reply to the slideshow-data request below — a single JSON object (markdown
          code fences are fine, they'll be stripped automatically). The deck is checked against
          pened-tools' structural rules before it is saved: it needs at least one slide, every slide
          needs an elements array, every element type must be text, image, shape or video, and any
          title, id or background must be well-formed. A deck that fails these checks isn't saved,
          because pened-tools wouldn't be able to play it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="paste-slideshow-deck-json-input">Paste AI response JSON</Label>
          <Textarea
            id="paste-slideshow-deck-json-input"
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

        {saveError ? (
          <div role="alert" className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-xs font-medium text-destructive">
              The slideshow data wasn't saved: {saveError}
            </p>
            <p className="text-xs text-muted-foreground">
              Your pasted response is still here and it passed validation. Fix the problem above, then
              save again.
            </p>
          </div>
        ) : null}

        {hasFieldErrors ? (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-xs font-medium text-destructive">
              {fieldErrors.length === 1
                ? "1 problem was found with the pasted deck. It wasn't saved, because pened-tools couldn't play it as it is:"
                : `${fieldErrors.length} problems were found with the pasted deck. It wasn't saved, because pened-tools couldn't play it as it is:`}
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
              {fieldErrors.map((error, index) => (
                <li key={`${error.path}-${index}`}>
                  {error.path !== "$" ? `${error.path}: ${error.message}` : error.message}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Your pasted text is still in the box. Fix these problems (or ask the AI to fix them),
              then save again.
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : saveError ? "Retry Save" : "Save Slideshow Data"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}