import { useState } from "react";
import { Copy, Download, ImagePlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  copyTextToClipboard,
  downloadTextFile,
  buildImagePromptFilename,
} from "@/lib/curriculum/phase2-content/download";
import { buildImagePromptRequest } from "@/lib/curriculum/phase2-content/imagePromptBuilder";
import type { LessonRecord } from "@/lib/curriculum/shared/db";
import { PasteImagePromptResponseForm } from "./PasteImagePromptResponseForm";
import { ImagePromptCardGrid } from "./ImagePromptCardGrid";

const DEFAULT_MIN_IMAGES = 5;
const DEFAULT_MAX_IMAGES = 12;
const MIN_ALLOWED = 1;
const MAX_ALLOWED = 30;

interface ImagePromptGeneratorProps {
  /** The lesson this Image Generation step belongs to - its saved
   * generatedContent feeds Step 1+2, and its imagePrompts/images feed
   * Step 3. */
  lessonRecord: LessonRecord;
  /** Called with the freshly-saved lesson record whenever Step 3 saves a
   * pasted response or persists an uploaded image, so the caller can
   * reload/refresh its own copy of the lesson. */
  onSaved: (lessonRecord: LessonRecord) => void;
  className?: string;
}

function clampImageCount(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_MIN_IMAGES;
  return Math.min(MAX_ALLOWED, Math.max(MIN_ALLOWED, Math.trunc(value)));
}

function hasSavedImagePrompts(lessonRecord: LessonRecord): boolean {
  return Array.isArray(lessonRecord.imagePrompts) && lessonRecord.imagePrompts.length > 0;
}

/**
 * The Image Generation step's full flow:
 *   Step 1+2 - pick min/max images and the "no on-image text" option, then
 *     build the instruction prompt from lessonRecord.generatedContent via
 *     buildImagePromptRequest, with copy/download actions matching
 *     PromptViewer's pattern (via download.ts's shared helpers).
 *   Step 3 - paste the AI's reply (PasteImagePromptResponseForm) until
 *     lessonRecord.imagePrompts has been saved, then show the saved
 *     prompts as an upload-ready card grid (ImagePromptCardGrid) so
 *     previously-generated prompts and uploaded images reappear on reload
 *     instead of only living in this component's local state.
 *
 * Each step's heading uses a plain CardTitle, matching the sibling
 * PromptViewer/PasteResponseForm cards elsewhere in Phase 2 - the step
 * Cards don't add their own decorative markers, since StepSidebar already
 * numbers/marks the active step.
 */
export default function ImagePromptGenerator({
  lessonRecord,
  onSaved,
  className,
}: ImagePromptGeneratorProps) {
  const [minImages, setMinImages] = useState(DEFAULT_MIN_IMAGES);
  const [maxImages, setMaxImages] = useState(DEFAULT_MAX_IMAGES);
  const [noOnImageText, setNoOnImageText] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [isCopying, setIsCopying] = useState(false);
  const [isReplacingPrompts, setIsReplacingPrompts] = useState(false);

  const generatedContent = lessonRecord.generatedContent;
  const hasContent = Array.isArray(generatedContent) && generatedContent.length > 0;
  const hasPrompt = prompt.length > 0;
  const promptsSaved = hasSavedImagePrompts(lessonRecord);

  const filename = buildImagePromptFilename({
    project_id: lessonRecord.project_id,
    lesson_node_id: lessonRecord.lesson_node_id,
  });

  function handleGenerate() {
    if (!hasContent) return;

    let min = clampImageCount(minImages);
    let max = clampImageCount(maxImages);
    if (min > max) {
      [min, max] = [max, min];
    }
    setMinImages(min);
    setMaxImages(max);

    const request = buildImagePromptRequest(
      generatedContent as Record<string, unknown>[],
      min,
      max,
      noOnImageText,
    );
    setPrompt(request);
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

  function handleImagePromptsSaved(updated: LessonRecord) {
    setIsReplacingPrompts(false);
    onSaved(updated);
  }

  return (
    <div className={className}>
      <div className="grid gap-4 md:grid-cols-2">
        {/* STEP 1: options + generate */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-semibold">Step 1 — Image prompt options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!hasContent ? (
              <p className="text-sm text-muted-foreground">
                Generate this lesson's content first — the image prompt request is built directly
                from the saved generated content.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Using this lesson's saved generated content. Adjust the options below, then build
                the instruction prompt to send to an AI.
              </p>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="min-images" className="text-xs font-mono text-muted-foreground">
                  Min images
                </Label>
                <Input
                  id="min-images"
                  type="number"
                  min={MIN_ALLOWED}
                  max={MAX_ALLOWED}
                  value={minImages}
                  onChange={(e) => setMinImages(clampImageCount(Number(e.target.value)))}
                  className="w-20 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-images" className="text-xs font-mono text-muted-foreground">
                  Max images
                </Label>
                <Input
                  id="max-images"
                  type="number"
                  min={MIN_ALLOWED}
                  max={MAX_ALLOWED}
                  value={maxImages}
                  onChange={(e) => setMaxImages(clampImageCount(Number(e.target.value)))}
                  className="w-20 font-mono text-xs"
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox
                  id="no-on-image-text"
                  checked={noOnImageText}
                  onCheckedChange={(checked) => setNoOnImageText(checked === true)}
                />
                <Label
                  htmlFor="no-on-image-text"
                  className="text-xs font-mono text-muted-foreground"
                >
                  No on-image text
                </Label>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={!hasContent}
              className="ml-auto"
            >
              <ImagePlus className="mr-1.5 h-4 w-4" />
              Generate prompt
            </Button>
          </CardFooter>
        </Card>

        {/* STEP 2: output */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-semibold">
              Step 2 — Prompt to send to an AI
            </CardTitle>
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

      {/* STEP 3: paste the AI's response -> image prompt cards */}
      <div className="mt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Step 3 — Paste the AI's response</h3>
          {promptsSaved && !isReplacingPrompts ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsReplacingPrompts(true)}
            >
              Paste a different response
            </Button>
          ) : null}
        </div>

        {!promptsSaved || isReplacingPrompts ? (
          <PasteImagePromptResponseForm
            lessonId={lessonRecord.id}
            onSaved={handleImagePromptsSaved}
            onCancel={() => setIsReplacingPrompts(false)}
          />
        ) : (
          <ImagePromptCardGrid lessonRecord={lessonRecord} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}
