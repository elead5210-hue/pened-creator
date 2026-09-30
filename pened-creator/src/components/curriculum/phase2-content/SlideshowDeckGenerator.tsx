import { useState } from "react";
import { Copy, Download, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  copyTextToClipboard,
  downloadTextFile,
  buildSlideshowPromptFilename,
} from "@/lib/curriculum/phase2-content/download";
import { buildSlideshowPromptRequest } from "@/lib/curriculum/phase2-content/slideshowPromptBuilder";
import { resolveSlideshowLink } from "@/lib/curriculum/phase2-content/slideshowToolUrl";
import type { LessonRecord } from "@/lib/curriculum/shared/db";
import { PasteSlideshowDeckResponseForm } from "./PasteSlideshowDeckResponseForm";

/**
 * The Phase 2 "Generate Slideshow Data" step (step 7), matching the
 * PromptViewer + PasteResponseForm / PasteImagePromptResponseForm pattern
 * used by the other Phase 2 generators:
 *   Step 1 - build the lesson-to-deck conversion prompt from this lesson's
 *     saved generatedContent (plus imagePrompts/images context) via
 *     buildSlideshowPromptRequest, with copy/download actions matching
 *     PromptViewer's pattern (via download.ts's shared helpers).
 *   Step 2 - paste the AI's reply (PasteSlideshowDeckResponseForm) until
 *     the deck has been saved on the server (it is loaded back as
 *     lesson.slideshowDeck from the lesson's slideshow interactiveContent
 *     entry), then show a saved-deck summary
 *     with a "Paste a different response" action to replace it, mirroring
 *     ImagePromptGenerator's saved/replace toggling.
 */
export interface SlideshowDeckGeneratorProps {
  lesson: LessonRecord;
  /** Called with the freshly-saved lesson record once a pasted deck is saved. */
  onLessonUpdated?: (lesson: LessonRecord) => void;
}

function hasSavedSlideshowDeck(lesson: LessonRecord): boolean {
  return Boolean(lesson.slideshowDeck);
}

export function SlideshowDeckGenerator({ lesson, onLessonUpdated }: SlideshowDeckGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [isCopying, setIsCopying] = useState(false);
  const [isCopyingDeck, setIsCopyingDeck] = useState(false);
  const [isReplacingDeck, setIsReplacingDeck] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  // Set when the save flow reported success but the returned lesson has no
  // deck, i.e. the server didn't confirm the save. Shown above the paste form.
  const [saveConfirmError, setSaveConfirmError] = useState<string | null>(null);

  const generatedContent = lesson.generatedContent;
  const hasContent = Array.isArray(generatedContent) && generatedContent.length > 0;
  const hasPrompt = prompt.length > 0;
  const deckSaved = hasSavedSlideshowDeck(lesson);

  const slideCount = Array.isArray((lesson.slideshowDeck as { slides?: unknown[] } | null)?.slides)
    ? (lesson.slideshowDeck as { slides: unknown[] }).slides.length
    : 0;

  // The pened-tools link carries only the lesson id (pened-tools loads the
  // deck from the server), so it is only built once a deck has been saved
  // on the lesson: before that it would point at a lesson with no
  // slideshow. A null result is shown as a visible error (invalid lesson id,
  // or VITE_TOOL_RENDERER_BASE_URL unset/invalid) instead of a broken link.
  const slideshowLink = deckSaved ? resolveSlideshowLink(lesson.id) : null;
  const slideshowToolUrl = slideshowLink?.ok ? slideshowLink.url : undefined;
  const slideshowLinkError = slideshowLink && !slideshowLink.ok ? slideshowLink.message : null;

  const filename = buildSlideshowPromptFilename({
    project_id: lesson.project_id,
    lesson_node_id: lesson.lesson_node_id,
  });

  function handleGenerate() {
    if (!hasContent) return;
    setGenerateError(null);
    try {
      const { prompt: request } = buildSlideshowPromptRequest(lesson);
      setPrompt(request);
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Failed to build the slideshow prompt.",
      );
    }
  }

  async function handleCopy() {
    if (!hasPrompt) return;
    setIsCopying(true);
    try {
      await copyTextToClipboard(prompt);
      toast.success("Copied!");
    } catch {
      toast.error("Copy failed — select the text manually.");
    } finally {
      setIsCopying(false);
    }
  }

  function handleDownload() {
    if (!hasPrompt) return;
    try {
      downloadTextFile(prompt, filename);
      toast.success("Downloaded.");
    } catch {
      toast.error("Download failed — try copying instead.");
    }
  }

  function handleDeckSaved(updated: LessonRecord) {
    // The deck only counts as saved once the record we get back has it
    // (the save reads it back from the server first). If it's missing,
    // keep the paste form open so the user can retry, and don't hand the
    // lesson to the parent as if it had been saved.
    if (!updated.slideshowDeck) {
      setSaveConfirmError(
        "The server didn't confirm that the slideshow data was saved, so nothing has changed. Please try saving again.",
      );
      toast.error("Slideshow data wasn't saved.");
      return;
    }

    setSaveConfirmError(null);
    setIsReplacingDeck(false);
    toast.success("Slideshow data saved to the lesson.");
    onLessonUpdated?.(updated);
  }

  async function handleCopyDeckJson() {
    if (!lesson.slideshowDeck) return;
    setIsCopyingDeck(true);
    try {
      await copyTextToClipboard(JSON.stringify(lesson.slideshowDeck, null, 2));
      toast.success("Deck JSON copied to clipboard.");
    } catch {
      toast.error("Copy failed — select the text manually.");
    } finally {
      setIsCopyingDeck(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {/* STEP 1: build + output */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-semibold">
              Step 1 — Build the slideshow prompt
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!hasContent ? (
              <p className="text-sm text-muted-foreground">
                Generate this lesson's content first — the slideshow prompt is built directly from
                the saved generated content (plus any image prompts already generated).
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Using this lesson's saved generated content. Build the lesson-to-deck conversion
                prompt below, then send it to an AI.
              </p>
            )}

            {generateError && <p className="text-sm text-destructive">{generateError}</p>}
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={!hasContent}
              className="ml-auto"
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              Generate prompt
            </Button>
          </CardFooter>
        </Card>

        {/* STEP 1 (cont.): output */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-semibold">Prompt to send to an AI</CardTitle>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                disabled={!hasPrompt || isCopying}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {isCopying ? "Copying..." : "Copy"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDownload}
                disabled={!hasPrompt}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download .txt
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {hasPrompt ? (
              <Textarea
                readOnly
                value={prompt}
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-[320px] resize-none font-mono text-xs leading-relaxed"
              />
            ) : (
              <div className="flex min-h-[320px] items-center justify-center rounded-md border border-dashed text-center text-xs font-mono text-muted-foreground">
                Generated prompt will appear here.
              </div>
            )}
          </CardContent>
          <CardFooter>
            <span className="font-mono text-xs text-muted-foreground">
              {hasPrompt
                ? "Prompt generated — copy it and paste it to an AI"
                : "Nothing generated yet"}
            </span>
          </CardFooter>
        </Card>
      </div>

      {/* STEP 2: paste the AI's response -> saved deck */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Step 2 — Paste the AI's response</h3>
          {deckSaved && !isReplacingDeck ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsReplacingDeck(true)}
            >
              Paste a different response
            </Button>
          ) : null}
        </div>

        {!deckSaved || isReplacingDeck ? (
          <>
            {saveConfirmError ? (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {saveConfirmError}
              </p>
            ) : null}
            <PasteSlideshowDeckResponseForm
              lessonId={lesson.id}
              onSaved={handleDeckSaved}
              onCancel={() => {
                setSaveConfirmError(null);
                setIsReplacingDeck(false);
              }}
            />
          </>
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-semibold">
                Slideshow data saved — <span className="font-medium">{slideCount}</span>{" "}
                {slideCount === 1 ? "slide" : "slides"}
              </CardTitle>
              <div className="flex gap-2">
                {slideshowToolUrl ? (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href={slideshowToolUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Open in pened-tools
                    </a>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyDeckJson}
                  disabled={isCopyingDeck}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  {isCopyingDeck ? "Copying..." : "Copy deck JSON"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {slideshowLinkError ? (
                <p role="alert" className="text-xs text-destructive">
                  Can't open this slideshow in pened-tools: {slideshowLinkError}
                </p>
              ) : null}
              <Textarea
                readOnly
                value={JSON.stringify(lesson.slideshowDeck, null, 2)}
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-[240px] resize-none font-mono text-xs leading-relaxed"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
