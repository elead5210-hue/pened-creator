
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentDispatcher } from "@/components/curriculum/phase2-content/toolRenderers/ContentDispatcher";
import type { LessonRecord } from "@/lib/curriculum/shared/db";

interface LessonContentViewProps {
  /** The lesson record whose generatedContent should be rendered. */
  lessonRecord: LessonRecord | null | undefined;
  /** Called when "View Details" is clicked, to navigate back to the lesson's detail/JSON/prompt view. */
  onViewDetails: (lessonRecord: LessonRecord) => void;
  /** Called when the panel should close. */
  onClose: () => void;
}

/**
 * Read-only "finished" view of a lesson: renders the lesson's saved
 * generatedContent by delegating each content block to the content
 * dispatcher. Intended to be shown inside a modal overlay once a lesson
 * has content generated and pasted in. Includes a "View Details" action
 * so users can navigate back to the lesson's detail/JSON/prompt view.
 *
 * This is a read-only AI-generated preview (it may include an Assessment
 * block posing a question to the learner) and is deliberately labeled
 * and worded to be distinct from the "Import Curriculum JSON" flow,
 * which is where the underlying curriculum JSON itself is pasted/edited.
 */
export function LessonContentView({ lessonRecord, onViewDetails, onClose }: LessonContentViewProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Generated Lesson Content</CardTitle>
        <div className="flex items-center gap-2">
          {lessonRecord ? (
            <Button size="sm" variant="secondary" onClick={() => onViewDetails(lessonRecord)}>
              View Details
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="size-6 shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Read-only preview of the AI-generated content for this lesson (it may include an
          Assessment question). This is not the curriculum JSON — to update that, use &quot;Import
          Curriculum JSON&quot; from the lesson&apos;s detail view instead.
        </p>

        {lessonRecord ? (
          <p className="text-sm font-medium">
            {lessonRecord.project_id} / {lessonRecord.lesson_node_id}
          </p>
        ) : null}

        <div className="space-y-4">
          <ContentDispatcher blocks={lessonRecord?.generatedContent} lessonId={lessonRecord?.id} />
        </div>
      </CardContent>
    </Card>
  );
}