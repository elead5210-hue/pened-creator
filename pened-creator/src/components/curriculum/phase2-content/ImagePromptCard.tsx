
import { useRef, useState } from "react";
import { Eraser, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copyTextToClipboard } from "@/lib/curriculum/phase2-content/download";
import { uploadImage } from "@/lib/curriculum/shared/apiClient";
import type { GeneratedImageSearchResult } from "@/lib/curriculum/shared/db";
import type { ImagePromptItem } from "@/lib/curriculum/shared/schema";

interface ImagePromptCardProps {
  /** The AI-proposed image prompt this card renders. */
  item: ImagePromptItem;
  /** Already-uploaded image for this prompt (data URL or hosted URL), if any. */
  imageUrl?: string | null;
  /**
   * Already-saved background-removed image for this prompt (data URL or
   * hosted URL), if any - sourced from the lesson's `imagesNoBg` map (see
   * ImagePromptCardGrid), which is populated either automatically (the
   * "Remove background" button below) or manually (the "Replace" button
   * below).
   */
  bgRemovedImageUrl?: string | null;
  /**
   * Called with (promptId, hostedUrl) once the user picks a file to upload
   * and this component has uploaded it to the image bucket via
   * uploadImage(). The caller is responsible for persisting the hosted URL
   * (e.g. via saveGeneratedImage) and re-rendering with the new imageUrl.
   */
  onUpload: (promptId: string, dataUrl: string) => void | Promise<void>;
  /**
   * Called with (promptId) when the user clicks "Remove background". The
   * caller is responsible for calling the server (e.g. via
   * removeImageBackground, which looks up this prompt's already-uploaded
   * source image itself) and re-rendering once the result comes back -
   * this component only triggers the request and reports its outcome.
   * Only rendered once hasImage is true, since there's nothing to remove
   * the background from otherwise.
   */
  onRemoveBackground: (promptId: string) => void | Promise<void>;
  /**
   * Called with (promptId, dataUrl) once the user picks a replacement file
   * for the background-removed image - used when the automatic
   * onRemoveBackground result didn't process the image correctly. The
   * caller is responsible for persisting it (e.g. via
   * saveBackgroundRemovedImage, which overwrites just this prompt's entry
   * in the lesson's `images_no_bg` map) and re-rendering with the new
   * bgRemovedImageUrl - this component uploads the file via uploadImage()
   * and hands back the hosted URL, the same as onUpload. Also used for the
   * first upload of a background-removed image, before "Remove background"
   * has ever produced one - the caller's save simply writes this prompt's
   * entry in the `images_no_bg` map.
   */
  onReplaceBackgroundImage: (promptId: string, dataUrl: string) => void | Promise<void>;
  /**
   * Previously-uploaded images whose tags overlap with this prompt's tags,
   * ranked by match strength (see ImagePromptCardGrid's fetch via
   * searchGeneratedImages) - rendered as a row of selectable thumbnails so
   * the user can reuse one instead of generating/uploading a new image.
   * Only rendered when there's no uploaded image yet.
   */
  suggestedImages?: GeneratedImageSearchResult[];
  /** Whether suggestedImages is still being fetched for this prompt. */
  isLoadingSuggestions?: boolean;
  /**
   * Called with (promptId, imageData) when the user picks a suggested
   * thumbnail to reuse. The caller is responsible for persisting it (e.g.
   * via saveGeneratedImage, the same path onUpload uses) and re-rendering
   * with the new imageUrl - this component only reports which suggestion
   * was picked.
   */
  onSelectSuggestedImage?: (promptId: string, imageData: string) => void | Promise<void>;
}

/** Marks an error as coming from the upload step itself (as opposed to
 * the caller's persistence step), so the right toast can be shown. */
class UploadFailedError extends Error {
  constructor(message?: string) {
    super(message ?? "Upload failed.");
    this.name = "UploadFailedError";
  }
}

/**
 * Uploads a data URL to the image bucket and returns the hosted URL.
 * Throws an UploadFailedError if the upload fails or returns an empty URL,
 * so callers can skip persisting anything to the lesson.
 */
async function uploadToBucket(dataUrl: string): Promise<string> {
  let hostedUrl: string;
  try {
    hostedUrl = await uploadImage(dataUrl);
  } catch (err) {
    throw new UploadFailedError(err instanceof Error ? err.message : undefined);
  }
  if (typeof hostedUrl !== "string" || hostedUrl.trim().length === 0) {
    throw new UploadFailedError("The server did not return an image URL.");
  }
  return hostedUrl;
}

/** Builds the text copied by "Copy prompt + aspect ratio": the image prompt
 * itself plus its aspect ratio on a new line, matching the prototype's
 * buildCopyText(). */
function buildCopyText(item: ImagePromptItem): string {
  const parts = [item.imagePrompt || ""];
  parts.push(`Aspect ratio: ${item.aspectRatio || "16:9"}`);
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Single image-prompt card, porting the prototype's .img-card UI: a tag
 * row (aspect ratio, style, sourceTool) with the prompt's id, its
 * description, an upload zone that shows the persisted image once one has
 * been uploaded, a second preview zone for that image's background-removed
 * counterpart (with its own manual "Replace" control), a "Remove
 * background" action once an image exists, the full prompt text, and a
 * "Copy prompt + aspect ratio" button. Rendered in a grid by
 * ImagePromptCardGrid, one per saved ImagePromptItem.
 *
 * All three tags (aspect ratio, style, sourceTool) render as plain outline
 * Badges - they're descriptive data values, not status signals, so they
 * don't use the emerald/sky/amber status colors reserved elsewhere in the
 * app (LessonPipelineBadge, StepSidebar, MCQFlashcardsRenderer) for
 * completion/info/warning states.
 */
export function ImagePromptCard({
  item,
  imageUrl,
  bgRemovedImageUrl,
  onUpload,
  onRemoveBackground,
  onReplaceBackgroundImage,
  suggestedImages,
  isLoadingSuggestions,
  onSelectSuggestedImage,
}: ImagePromptCardProps) {
  const [isCopying, setIsCopying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);
  const [isReplacingBackgroundImage, setIsReplacingBackgroundImage] = useState(false);
  const [isSelectingSuggestion, setIsSelectingSuggestion] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgReplaceInputRef = useRef<HTMLInputElement>(null);

  const hasImage = Boolean(imageUrl);
  const hasBgRemovedImage = Boolean(bgRemovedImageUrl);

  async function handleCopy() {
    setIsCopying(true);
    try {
      await copyTextToClipboard(buildCopyText(item));
      toast.success("Copied!");
    } catch {
      toast.error("Copy failed — select the text manually.");
    } finally {
      setIsCopying(false);
    }
  }

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so choosing the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const hostedUrl = await uploadToBucket(String(reader.result));
        await onUpload(item.id, hostedUrl);
      } catch (err) {
        toast.error(
          err instanceof UploadFailedError
            ? "Image upload failed — nothing was saved"
            : "Failed to save the uploaded image",
          {
            description: err instanceof Error ? err.message : undefined,
          },
        );
      } finally {
        setIsUploading(false);
      }
    };
    reader.onerror = () => {
      setIsUploading(false);
      toast.error("Could not read that file — try a different image.");
    };
    reader.readAsDataURL(file);
  }

  async function handleSelectSuggestedImage(suggestion: GeneratedImageSearchResult) {
    if (!onSelectSuggestedImage) return;
    setIsSelectingSuggestion(true);
    try {
      await onSelectSuggestedImage(item.id, suggestion.imageData);
    } catch (err) {
      toast.error("Failed to use the suggested image", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSelectingSuggestion(false);
    }
  }

  async function handleRemoveBackground() {
    setIsRemovingBackground(true);
    try {
      await onRemoveBackground(item.id);
      toast.success("Background removed!");
    } catch (err) {
      toast.error("Failed to remove the background", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsRemovingBackground(false);
    }
  }

  function handleReplaceBackgroundImageClick() {
    bgReplaceInputRef.current?.click();
  }

  function handleBgReplaceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so choosing the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;

    setIsReplacingBackgroundImage(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const hostedUrl = await uploadToBucket(String(reader.result));
        await onReplaceBackgroundImage(item.id, hostedUrl);
        toast.success(
          hasBgRemovedImage ? "Background-removed image replaced!" : "Background-removed image uploaded!",
        );
      } catch (err) {
        toast.error(
          err instanceof UploadFailedError
            ? "Image upload failed — nothing was saved"
            : "Failed to save the replacement image",
          {
            description: err instanceof Error ? err.message : undefined,
          },
        );
      } finally {
        setIsReplacingBackgroundImage(false);
      }
    };
    reader.onerror = () => {
      setIsReplacingBackgroundImage(false);
      toast.error("Could not read that file — try a different image.");
    };
    reader.readAsDataURL(file);
  }

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b bg-muted/30 p-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{item.aspectRatio || "16:9"}</Badge>
          {item.style ? <Badge variant="outline">{item.style}</Badge> : null}
          {item.sourceTool ? <Badge variant="outline">{item.sourceTool}</Badge> : null}
          {(item.tags ?? []).map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.id}</span>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 p-3">
        {item.description ? <p className="text-sm text-foreground">{item.description}</p> : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {!hasImage && suggestedImages && suggestedImages.length > 0 ? (
          <div className="space-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Reuse an existing image?
            </span>
            <div className="flex gap-1.5 overflow-x-auto">
              {suggestedImages.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => handleSelectSuggestedImage(suggestion)}
                  disabled={isSelectingSuggestion}
                  className="shrink-0 overflow-hidden rounded-md border transition hover:border-primary disabled:pointer-events-none disabled:opacity-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={suggestion.imageData}
                    alt={`Suggested reuse image (${suggestion.matchCount} matching tag${suggestion.matchCount === 1 ? "" : "s"})`}
                    className="h-16 w-16 object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        ) : !hasImage && isLoadingSuggestions ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            Looking for reusable images…
          </span>
        ) : null}

        <div
          className={
            hasImage
              ? "overflow-hidden rounded-md border"
              : "flex min-h-[130px] flex-col items-center justify-center gap-2 rounded-md border border-dashed p-3 text-center"
          }
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl ?? undefined}
              alt={item.altText || item.description || `Generated image for ${item.id}`}
              className="max-h-[220px] w-full object-cover"
            />
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              No image yet — generate one, then upload it here
            </span>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Background removed
            </span>
            <button
              type="button"
              onClick={handleReplaceBackgroundImageClick}
              disabled={isReplacingBackgroundImage}
              className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              {isReplacingBackgroundImage
                ? hasBgRemovedImage
                  ? "Replacing..."
                  : "Uploading..."
                : hasBgRemovedImage
                  ? "Replace"
                  : "Upload"}
            </button>
          </div>

          <input
            ref={bgReplaceInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleBgReplaceFileChange}
          />

          <div
            className={
              hasBgRemovedImage
                ? // A checkered-ish muted background makes a transparent PNG's
                  // removed background visually obvious, unlike a plain white
                  // card background it could blend into.
                  "overflow-hidden rounded-md border bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
                : "flex min-h-[100px] flex-col items-center justify-center gap-1 rounded-md border border-dashed p-3 text-center"
            }
          >
            {hasBgRemovedImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={bgRemovedImageUrl ?? undefined}
                alt={`Background-removed image for ${item.id}`}
                className="max-h-[220px] w-full object-cover"
              />
            ) : (
              <span className="font-mono text-xs text-muted-foreground">
                {hasImage
                  ? 'No background-removed image yet — upload one here, or click "Remove background" below'
                  : "No background-removed image yet — upload one here"}
              </span>
            )}
          </div>
        </div>

        <pre className="max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-2.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
          {buildCopyText(item)}
        </pre>

        <div className="mt-auto flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={handleCopy}
              disabled={isCopying}
            >
              {isCopying ? "Copying..." : "Copy prompt + aspect ratio"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={handleUploadClick}
              disabled={isUploading}
            >
              <Upload className="mr-1.5 size-3.5" />
              {isUploading ? "Uploading..." : hasImage ? "Replace image" : "Upload image"}
            </Button>
          </div>

          {hasImage ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={handleRemoveBackground}
              disabled={isRemovingBackground}
            >
              <Eraser className="mr-1.5 size-3.5" />
              {isRemovingBackground ? "Removing background..." : "Remove background"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}