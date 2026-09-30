import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LessonRecord } from "@/lib/curriculum/shared/db";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  "prompt-generated": "Prompt Generated",
  "content-generated": "Content Generated",
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  "prompt-generated": "outline",
  "content-generated": "default",
};

function formatStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

function formatTimestamp(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

function hasGeneratedContent(lessonRecord: LessonRecord | null | undefined): boolean {
  return Array.isArray(lessonRecord?.generatedContent) && lessonRecord.generatedContent.length > 0;
}

interface LessonDetailPanelProps {
  /** The lesson record to display, or null/undefined to show the empty state. */
  lessonRecord: LessonRecord | null | undefined;
  /** Called when "Import Curriculum JSON" is clicked. */
  onImportCurriculum: (lessonRecord: LessonRecord) => void;
  /** Called when "Generate Prompt" is clicked. */
  onGeneratePrompt: (lessonRecord: LessonRecord) => void;
  /** Called when "Paste AI Response" is clicked. */
  onPasteResponse: (lessonRecord: LessonRecord) => void;
  /** Called when "View Content" is clicked (only enabled once content exists). */
  onViewContent: (lessonRecord: LessonRecord) => void;
}

/**
 * Lesson detail panel: read-only view of a saved lesson record.
 * Shows metadata (project_id, lesson_node_id, status, timestamps), the
 * full stored breakdown JSON, and "Import Curriculum JSON" /
 * "Generate Prompt" / "Paste AI Response" / "View Content" actions that
 * delegate to the caller for the currently rendered lesson. Used to
 * confirm the save flow persisted a lesson correctly, to re-import or
 * update the lesson's curriculum JSON, to kick off prompt generation, to
 * record a pasted AI response, and to view the finished generated content.
 */
export function LessonDetailPanel({
  lessonRecord,
  onImportCurriculum,
  onGeneratePrompt,
  onPasteResponse,
  onViewContent,
}: LessonDetailPanelProps) {
  if (!lessonRecord) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Select a lesson from the list to view its details.
          </p>
        </CardContent>
      </Card>
    );
  }

  let jsonText: string;
  try {
    jsonText = JSON.stringify(lessonRecord.breakdown, null, 2);
  } catch (err) {
    jsonText = `Unable to display JSON: ${err instanceof Error ? err.message : String(err)}`;
  }

  const contentAvailable = hasGeneratedContent(lessonRecord);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="truncate text-base">
          {lessonRecord.project_id} / {lessonRecord.lesson_node_id}
        </CardTitle>
        <Badge variant={STATUS_BADGE_VARIANT[lessonRecord.status] ?? "secondary"}>
          {formatStatusLabel(lessonRecord.status)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => onImportCurriculum(lessonRecord)}>
            Import Curriculum JSON
          </Button>
          <Button size="sm" onClick={() => onGeneratePrompt(lessonRecord)}>
            Generate Prompt
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onPasteResponse(lessonRecord)}>
            Paste AI Response
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!contentAvailable}
            onClick={() => contentAvailable && onViewContent(lessonRecord)}
          >
            View Content
          </Button>
        </div>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Project ID</dt>
          <dd className="truncate">{lessonRecord.project_id}</dd>

          <dt className="text-muted-foreground">Lesson Node ID</dt>
          <dd className="truncate">{lessonRecord.lesson_node_id}</dd>

          <dt className="text-muted-foreground">Status</dt>
          <dd>{formatStatusLabel(lessonRecord.status)}</dd>

          <dt className="text-muted-foreground">Created</dt>
          <dd>{formatTimestamp(lessonRecord.createdAt)}</dd>

          <dt className="text-muted-foreground">Updated</dt>
          <dd>{formatTimestamp(lessonRecord.updatedAt)}</dd>
        </dl>

        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Stored JSON</h3>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-mono text-xs">
            {jsonText}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
