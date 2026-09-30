import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  saveGeneratedImage,
  removeImageBackground,
  saveBackgroundRemovedImage,
  searchGeneratedImages,
  type GeneratedImageSearchResult,
  type LessonRecord,
} from "@/lib/curriculum/shared/db";
import { imagePromptItemSchema, type ImagePromptItem } from "@/lib/curriculum/shared/schema";
import { ImagePromptCard } from "./ImagePromptCard";

interface ImagePromptCardGridProps {
  /** The lesson whose saved imagePrompts/images/imagesNoBg this grid renders and updates. */
  lessonRecord: LessonRecord;
  /** Called with the freshly-saved lesson record after an image upload/background-removal persists. */
  onSaved: (lessonRecord: LessonRecord) => void;
}

/**
 * Splits a lesson's raw `imagePrompts` (stored as `unknown[]`) into the
 * entries that actually match ImagePromptItem's shape and the ones that
 * don't, so a single malformed entry can't take down the whole grid -
 * mirrors ContentDispatcher's per-block defensiveness for the Phase 2
 * content view.
 */
function partitionImagePrompts(imagePrompts: unknown[]): {
  valid: ImagePromptItem[];
  invalidCount: number;
} {
  const valid: ImagePromptItem[] = [];
  let invalidCount = 0;

  for (const raw of imagePrompts) {
    const result = imagePromptItemSchema.safeParse(raw);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalidCount += 1;
    }
  }

  return { valid, invalidCount };
}

/**
 * Renders one ImagePromptCard at a time - for the currently-selected
 * ImagePromptItem on `lessonRecord.imagePrompts` - showing its already-
 * uploaded image (from `lessonRecord.images`) and its background-removed
 * counterpart (from `lessonRecord.imagesNoBg`), if either exists, plus a
 * step indicator ("Image 2 of 6") with Previous/Next controls so the user
 * works through the prompts one at a time instead of scanning a grid.
 *
 * This is the single source of truth for persisting every image
 * action against the lesson record and reporting the result back via
 * onSaved, so ImagePromptCard itself never talks to db.ts directly:
 * - On upload, persists via saveGeneratedImage(lessonId, promptId, dataUrl)
 *   - merging it into the lesson's `images` map on the server.
 * - On "Remove background", persists via
 *   removeImageBackground(lessonId, promptId) - the server looks up the
 *   already-uploaded source image itself and merges the result into the
 *   lesson's `images_no_bg` map.
 * - On a manual replacement upload for the background-removed image
 *   (used when the automatic result didn't process correctly), persists
 *   via saveBackgroundRemovedImage(lessonId, promptId, dataUrl) - merging
 *   the replacement into the same `images_no_bg` map.
 *
 * None of these keep the result only in local component state, so every
 * change survives reloads and is visible across tabs/sessions (db.ts's
 * subscribe/notify live-update mechanism picks each of them up too).
 */
export function ImagePromptCardGrid({ lessonRecord, onSaved }: ImagePromptCardGridProps) {
  const rawImagePrompts = Array.isArray(lessonRecord.imagePrompts) ? lessonRecord.imagePrompts : [];
  const { valid: items, invalidCount } = partitionImagePrompts(rawImagePrompts);
  const images = lessonRecord.images ?? {};
  const imagesNoBg = lessonRecord.imagesNoBg ?? {};

  // Which of `items` is currently shown. Clamped against the current
  // items.length below (rather than in a useEffect) so a shrinking list
  // (e.g. after re-pasting a shorter AI response) can't leave this
  // pointing past the end.
  const [currentIndex, setCurrentIndex] = useState(0);
  const safeIndex = items.length === 0 ? 0 : Math.min(currentIndex, items.length - 1);
  const currentItem = items[safeIndex];
  const hasCurrentImage = Boolean(currentItem && images[currentItem.id]);

  // Tag-based "reuse an existing image?" suggestions for the currently-
  // shown prompt (see db.ts's searchGeneratedImages). Only meaningful
  // before an image has been uploaded for this prompt - once one exists
  // there's nothing to suggest reusing in its place - and only when the
  // prompt actually has tags to search by (older/legacy prompts may not).
  const [suggestedImages, setSuggestedImages] = useState<GeneratedImageSearchResult[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  useEffect(() => {
    const tags = currentItem?.tags ?? [];

    if (!currentItem || hasCurrentImage || tags.length === 0) {
      setSuggestedImages([]);
      setIsLoadingSuggestions(false);
      return;
    }

    let cancelled = false;
    setIsLoadingSuggestions(true);

    searchGeneratedImages(tags)
      .then((results) => {
        if (!cancelled) setSuggestedImages(results);
      })
      .catch(() => {
        // Best-effort suggestions - a failed lookup just means none are
        // shown, not a blocking error for the rest of the step.
        if (!cancelled) setSuggestedImages([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSuggestions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentItem, hasCurrentImage]);

  function goToPrevious() {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }

  function goToNext() {
    setCurrentIndex((i) => Math.min(items.length - 1, i + 1));
  }

  async function handleUpload(promptId: string, dataUrl: string) {
    const updated = await saveGeneratedImage(lessonRecord.id, promptId, dataUrl);
    onSaved(updated);
  }

  async function handleRemoveBackground(promptId: string) {
    const updated = await removeImageBackground(lessonRecord.id, promptId);
    onSaved(updated);
  }

  async function handleReplaceBackgroundImage(promptId: string, dataUrl: string) {
    const updated = await saveBackgroundRemovedImage(lessonRecord.id, promptId, dataUrl);
    onSaved(updated);
  }

  // Picking a suggested image is persisted exactly like a fresh upload -
  // saveGeneratedImage merges it into the same `images` map either way -
  // so the rest of the app (imagesNoBg, status transitions, etc.) can't
  // tell the difference after the fact.
  async function handleSelectSuggestedImage(promptId: string, imageData: string) {
    const updated = await saveGeneratedImage(lessonRecord.id, promptId, imageData);
    setSuggestedImages([]);
    onSaved(updated);
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No image prompts have been saved for this lesson yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {invalidCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {invalidCount === 1
            ? "1 saved image prompt has an unexpected shape and was skipped."
            : `${invalidCount} saved image prompts have an unexpected shape and were skipped.`}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={goToPrevious} disabled={safeIndex === 0}>
          Previous
        </Button>
        <span className="font-mono text-xs text-muted-foreground">
          Image {safeIndex + 1} of {items.length}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={goToNext}
          disabled={safeIndex === items.length - 1}
        >
          Next
        </Button>
      </div>

      <div className="grid grid-cols-1">
        <ImagePromptCard
          key={currentItem.id}
          item={currentItem}
          imageUrl={images[currentItem.id] ?? null}
          bgRemovedImageUrl={imagesNoBg[currentItem.id] ?? null}
          suggestedImages={suggestedImages}
          isLoadingSuggestions={isLoadingSuggestions}
          onUpload={handleUpload}
          onRemoveBackground={handleRemoveBackground}
          onReplaceBackgroundImage={handleReplaceBackgroundImage}
          onSelectSuggestedImage={handleSelectSuggestedImage}
        />
      </div>
    </div>
  );
}
