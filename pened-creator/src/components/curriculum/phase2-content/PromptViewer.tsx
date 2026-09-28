
import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadTextFile, buildPromptFilename, copyTextToClipboard } from "@/lib/curriculum/phase2-content/download";

interface PromptViewerProps {
  /** The generated prompt text to display. */
  promptText: string;
  /** Explicit filename for the download action; falls back to buildPromptFilename(). */
  filename?: string;
  /** Called when the panel should close. */
  onClose: () => void;
}

/**
 * Read-only panel that displays a generated AI prompt for review, with
 * copy-to-clipboard and download-as-text actions. Intended to be shown
 * inside a modal overlay after the user triggers "Generate Prompt" on
 * a lesson.
 *
 * The copy (copyTextToClipboard) and download (downloadTextFile) actions
 * are shared helpers from @/lib/curriculum/download, so other prompt-style
 * views (e.g. ImagePromptGenerator) can reuse this exact same pattern.
 */
export function PromptViewer({ promptText, filename, onClose }: PromptViewerProps) {
  const [isCopying, setIsCopying] = useState(false);

  const currentFilename = filename || buildPromptFilename();

  async function handleCopy() {
    setIsCopying(true);
    try {
      await copyTextToClipboard(promptText || "");
      toast.success("Copied!");
    } catch {
      toast.error("Copy failed — select the text manually.");
    } finally {
      setIsCopying(false);
    }
  }

  function handleDownload() {
    try {
      downloadTextFile(promptText, currentFilename);
      toast.success("Downloaded.");
    } catch {
      toast.error("Download failed — try copying instead.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Generated Prompt</CardTitle>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={promptText || ""}
          readOnly
          spellCheck={false}
          rows={20}
          className="min-h-[360px] font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleDownload}>
            Download as Text
          </Button>
          <Button size="sm" onClick={handleCopy} disabled={isCopying}>
            {isCopying ? "Copying..." : "Copy to Clipboard"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}