
import { getTools, type Tool } from "@/lib/tools/toolsClient";
import { SLIDESHOW_TOOL_ID } from "./slideshowInteractiveContent";

/**
 * Assembles the final AI prompt for a lesson from three parts:
 *   1. A fixed instruction block explaining the task and output contract.
 *   2. The lesson's stored context JSON (as pasted/saved by the user).
 *   3. The registered tools list fetched from the API (GET /api/tools),
 *      describing each available content tool and the JSON schema it
 *      consumes.
 *
 * The prompt is returned both as a single assembled string (ready to
 * copy/paste into an AI tool) and as its constituent parts, in case a
 * caller wants to send them as separate structured fields instead.
 *
 * Ported from contentBuilder's src/prompt/promptBuilder.js so it sits
 * alongside buildLessonBreakdownPrompt (see ./schema.ts) as one continuous
 * prompting pipeline: buildLessonBreakdownPrompt produces the breakdown,
 * this module turns a saved breakdown into the content-generation prompt.
 * The tools section is fetched live via getTools() from
 * @/lib/tools/toolsClient - the same data layer the Tool Registry page
 * uses - so the prompt always reflects the server's actual registered
 * tools, and is labeled TOOL REGISTRY in both the instructions and the
 * assembled prompt, matching the Tool Registry page's name for this
 * same data.
 */

/** A lesson record shape sufficient for building a content-generation prompt. */
export interface LessonPromptRecord {
  breakdown?: unknown;
  [key: string]: unknown;
}

export interface LessonPromptParts {
  instruction: string;
  lessonContext: unknown;
  toolRegistry: Tool[];
}

export interface LessonPromptResult {
  prompt: string;
  parts: LessonPromptParts;
}

/**
 * Fixed instruction block sent to the AI on every prompt. Describes the
 * task, the available tools, and the expected output contract. Kept as
 * a plain template string so it's easy to review/tweak in one place.
 */
const INSTRUCTION_BLOCK = `You are an instructional content generator.

You will be given:
1. LESSON CONTEXT — a JSON object describing a single lesson: its objectives,
   outcomes, key vocabulary, suggested activities, assessment ideas, and
   prerequisites.
2. TOOL REGISTRY — a JSON array describing the content tools available
   to render lesson content in the target application. Each tool entry has:
   - "id": the identifier you must use to reference this tool
   - "name": a human-readable name
   - "description": what the tool is for
   - "inputSchema": the JSON Schema the tool's data must conform to

Your task is to generate a sequence of content blocks that together form a
complete lesson, using ONLY the tools listed in TOOL REGISTRY. Do not
invent new tools or fields that are not present in a tool's inputSchema.

Output requirements:
- Respond with ONLY a single JSON array, no other text before or after it.
- Each element of the array must be an object of the form:
  { "tool": "<tool id>", "data": { ...fields matching that tool's inputSchema... }, "slide": { ...slide-authoring hints, see below... } }
- Every "data" object must strictly satisfy the inputSchema of the
  referenced tool, including all required fields.
- Every element must also include a "slide" object with these
  slide-authoring hints, used later to assemble a slideshow deck from this
  same content without a separate generation pass:
  - "durationSeconds": a reasonable number of seconds a learner would
    spend on this block as a slide (e.g. 20-90 depending on how much
    content it holds).
  - "transition": one of "fade", "slide", "cut" — how this slide should
    enter relative to the previous one.
  - "background": one of "light", "dark", "image" — the intended
    background treatment for this slide; use "image" only for blocks whose
    tool is primarily illustrative.
- Ground all generated content in the provided LESSON CONTEXT — do not
  fabricate objectives, vocabulary, or activities that contradict it.
- Order the array in a sensible instructional sequence (e.g. introduction
  first, assessments last).`;

/**
 * Builds the full prompt for a given lesson record.
 *
 * Async because the TOOL REGISTRY section is now fetched live via
 * getTools() (see @/lib/tools/toolsClient.ts) rather than read from a
 * static in-repo registry.
 *
 * @param lessonRecord - a saved lesson record (see contentBuilder's
 *   src/models/lesson.js), expected to have a `.breakdown` field containing
 *   the original pasted JSON.
 */
export async function buildLessonPrompt(lessonRecord: LessonPromptRecord): Promise<LessonPromptResult> {
  if (!lessonRecord || typeof lessonRecord !== "object") {
    throw new Error("buildLessonPrompt requires a lesson record.");
  }

  if (!lessonRecord.breakdown || typeof lessonRecord.breakdown !== "object") {
    throw new Error("Lesson record is missing its breakdown JSON.");
  }

  const lessonContext = lessonRecord.breakdown;
  const allTools = await getTools();
  // Slideshow decks are assembled deterministically by slideshowDeckBuilder.ts
  // from the other blocks' slide hints - never authored directly by the AI -
  // so exclude the slideshow tool from the per-block TOOL REGISTRY offered here.
  const toolRegistry = allTools.filter((tool) => tool.id !== SLIDESHOW_TOOL_ID);

  const prompt = [
    INSTRUCTION_BLOCK,
    "",
    "LESSON CONTEXT:",
    JSON.stringify(lessonContext, null, 2),
    "",
    "TOOL REGISTRY:",
    JSON.stringify(toolRegistry, null, 2),
  ].join("\n");

  return {
    prompt,
    parts: {
      instruction: INSTRUCTION_BLOCK,
      lessonContext,
      toolRegistry,
    },
  };
}