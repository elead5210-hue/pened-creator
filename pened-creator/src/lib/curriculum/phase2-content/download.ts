
/**
 * Small browser download/clipboard utilities. Used to let the user save
 * generated text (e.g. an AI prompt) to disk as a .txt file, via a Blob
 * and a temporary, invisible anchor element, and to copy text to the
 * clipboard with a consistent availability check across callers.
 */

/**
 * Sanitizes an arbitrary string into a safe-ish filename fragment:
 * strips characters that are problematic across filesystems and
 * collapses whitespace/separators into single hyphens.
 */
function sanitizeFilenamePart(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Triggers a browser download of `text` as a file named `filename`.
 *
 * @param text - file contents
 * @param filename - desired filename, e.g. "lesson-prompt.txt"
 * @param mimeType - defaults to "text/plain;charset=utf-8"
 */
export function downloadTextFile(
  text: string | null | undefined,
  filename: string | null | undefined,
  mimeType: string = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([text ?? ""], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "download.txt";
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoke on a slight delay to ensure the download has been picked up
  // by the browser before the object URL is invalidated.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Copies `text` to the clipboard using `document.execCommand('copy')` via
 * a temporary, off-screen, focused-and-selected `<textarea>`. This is the
 * fallback path used when the async Clipboard API is unavailable - most
 * notably when the app is loaded over plain HTTP on a LAN (a non-secure
 * context), where `navigator.clipboard` is not exposed by the browser at
 * all - or when that API's write is rejected for some other reason.
 *
 * @throws Error if execCommand('copy') is unavailable or reports failure.
 */
function copyTextToClipboardFallback(text: string): void {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    throw new Error("Clipboard fallback unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  // Keep it out of the visible layout/viewport and out of the tab order,
  // while still being focusable/selectable (display:none elements can't
  // be focused, so this uses off-screen positioning instead).
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  const previousActiveElement = document.activeElement as HTMLElement | null;
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let succeeded = false;
  try {
    succeeded = document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
    previousActiveElement?.focus();
  }

  if (!succeeded) {
    throw new Error("Clipboard fallback copy command failed");
  }
}

/**
 * Copies `text` to the clipboard via the async Clipboard API, falling
 * back to `copyTextToClipboardFallback`'s execCommand('copy') approach
 * when that API is unavailable (e.g. non-secure context such as plain
 * HTTP on a LAN, or an unsupported browser) or when its write is
 * rejected, so every caller (PromptViewer, ImagePromptCard, ...) can
 * share one try/catch -> toast pattern instead of re-checking
 * `navigator.clipboard` individually. Throws only if both the primary
 * API and the fallback fail.
 *
 * @param text - the text to copy. `null`/`undefined` is treated as "".
 * @throws Error if neither the Clipboard API nor the fallback succeed.
 */
export async function copyTextToClipboard(text: string | null | undefined): Promise<void> {
  const value = text ?? "";

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the execCommand fallback below - e.g. some
      // browsers reject the async write in contexts where it's exposed
      // but not actually permitted.
    }
  }

  copyTextToClipboardFallback(value);
}

/**
 * Triggers the browser's native print dialog via window.print().
 *
 * Kept as a thin wrapper (rather than having callers reach for
 * `window.print()` directly) so every print trigger in the app shares one
 * place to add availability checks or additional behavior later, the same
 * way copyTextToClipboard centralizes clipboard access. What actually
 * ends up on the printed page is controlled separately, by this app's
 * `@media print` rules (see styles.css) scoped to a `.worksheet-print`
 * wrapper - this function only opens the print dialog.
 *
 * @throws Error if window.print is unavailable (e.g. non-browser
 *   environment, such as during server-side rendering).
 */
export function triggerPrint(): void {
  if (typeof window === "undefined" || typeof window.print !== "function") {
    throw new Error("Printing is unavailable in this environment");
  }
  window.print();
}

/**
 * Builds a reasonable .txt filename for a generated lesson prompt from
 * its project_id and lesson_node_id.
 */
export function buildPromptFilename({
  project_id,
  lesson_node_id,
}: { project_id?: string; lesson_node_id?: string } = {}): string {
  const projectPart = sanitizeFilenamePart(project_id) || "project";
  const lessonPart = sanitizeFilenamePart(lesson_node_id) || "lesson";
  return `${projectPart}_${lessonPart}_prompt.txt`;
}

/**
 * Builds a reasonable .txt filename for a generated Phase 3 (Interactive
 * Tools) prompt from its project_id and lesson_node_id, distinct from
 * buildPromptFilename's Phase 2 content-generation prompt filename.
 */
export function buildPhase3PromptFilename({
  project_id,
  lesson_node_id,
}: { project_id?: string; lesson_node_id?: string } = {}): string {
  const projectPart = sanitizeFilenamePart(project_id) || "project";
  const lessonPart = sanitizeFilenamePart(lesson_node_id) || "lesson";
  return `${projectPart}_${lessonPart}_phase3-prompt.txt`;
}

/**
 * Builds a reasonable .txt filename for a generated image-prompt request
 * (the Image Generation step's Step 1+2 output) from its project_id and
 * lesson_node_id, distinct from the Phase 2/Phase 3 content-prompt
 * filenames above.
 */
export function buildImagePromptFilename({
  project_id,
  lesson_node_id,
}: { project_id?: string; lesson_node_id?: string } = {}): string {
  const projectPart = sanitizeFilenamePart(project_id) || "project";
  const lessonPart = sanitizeFilenamePart(lesson_node_id) || "lesson";
  return `${projectPart}_${lessonPart}_image-prompt-request.txt`;
}

/**
 * Builds a reasonable .txt filename for a generated "Generate Slideshow
 * Data" (Step 7) lesson-to-deck conversion prompt from its project_id and
 * lesson_node_id, distinct from the other Phase 2/Phase 3 prompt
 * filenames above.
 */
export function buildSlideshowPromptFilename({
  project_id,
  lesson_node_id,
}: { project_id?: string; lesson_node_id?: string } = {}): string {
  const projectPart = sanitizeFilenamePart(project_id) || "project";
  const lessonPart = sanitizeFilenamePart(lesson_node_id) || "lesson";
  return `${projectPart}_${lessonPart}_slideshow-prompt.txt`;
}