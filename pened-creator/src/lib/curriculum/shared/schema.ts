import { z } from "zod";

/**
 * Minimal curriculum tree schema.
 *
 * {
 *   "label": "Root",            // required, non-empty string
 *   "type": "ROOT",             // required, non-empty string (UPPER_SNAKE by convention)
 *   "id": "optional-stable-id", // optional; generated when absent
 *   "children": []              // optional array of the same shape
 * }
 */
export type CurriculumNode = {
  id?: string | undefined;
  label: string;
  type: string;
  children?: CurriculumNode[] | undefined;
  /** Set when this node was created from a filed exam question, linking back to ExamQuestion.id. */
  sourceQuestionId?: string | undefined;
};

export const curriculumNodeSchema: z.ZodType<CurriculumNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1).optional(),
    label: z.string().min(1, "label is required"),
    type: z.string().min(1, "type is required"),
    children: z.array(curriculumNodeSchema).optional(),
    sourceQuestionId: z.string().min(1).optional(),
  }),
);

/** node.type used for the single implicit root of every curriculum tree. */
export const ROOT_NODE_TYPE = "ROOT";

/** node.type used for a curriculum/syllabus grouping directly under the root (e.g. "CAPS"). */
export const CURRICULUM_NODE_TYPE = "CURRICULUM";

/** node.type used for a grade/year-level grouping under a curriculum. */
export const GRADE_NODE_TYPE = "GRADE";

/** node.type used for a subject grouping under a grade. */
export const SUBJECT_NODE_TYPE = "SUBJECT";

/** node.type used for a topic grouping under a subject. */
export const TOPIC_NODE_TYPE = "TOPIC";

/** node.type used for nodes created by filing an exam question into the tree. */
export const QUESTION_NODE_TYPE = "QUESTION";

/** node.type used for leaf nodes representing an individual lesson. */
export const LESSON_NODE_TYPE = "LESSON";

/** A flat row as stored in IndexedDB. */
export type FlatNode = {
  id: string;
  /** The project this row belongs to. Required by the server's
   * flatNodeArraySchema on every row in a PUT /api/nodes body, and cross-
   * checked there against the projectId query parameter. */
  projectId: string;
  parentId: string | null;
  label: string;
  type: string;
  position: number;
  depth: number;
  /** Set when this node was created from a filed exam question, linking back to ExamQuestion.id. */
  sourceQuestionId?: string | undefined;
};

export const EXAMPLE_TREE: CurriculumNode = {
  label: "Root",
  type: "ROOT",
  children: [
    {
      label: "CAPS",
      type: "CURRICULUM",
      children: [
        {
          label: "Grade 10",
          type: "GRADE",
          children: [
            {
              label: "Mathematics",
              type: "SUBJECT",
              children: [
                { label: "Algebra", type: "TOPIC" },
                { label: "Euclidean Geometry", type: "TOPIC" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

let counter = 0;
function makeId() {
  counter += 1;
  return `n_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/** Tree -> flat rows connected by parentId associations. */
export function flatten(root: CurriculumNode): FlatNode[] {
  const rows: FlatNode[] = [];
  const walk = (node: CurriculumNode, parentId: string | null, position: number, depth: number) => {
    const id = node.id ?? makeId();
    rows.push({
      id,
      projectId: PROJECT_ID,
      parentId,
      label: node.label,
      type: node.type,
      position,
      depth,
      ...(node.sourceQuestionId ? { sourceQuestionId: node.sourceQuestionId } : {}),
    });
    (node.children ?? []).forEach((child, i) => walk(child, id, i, depth + 1));
  };
  walk(root, null, 0, 0);
  return rows;
}

/** Flat rows -> nested tree. */
export function expand(rows: FlatNode[]): CurriculumNode | null {
  if (rows.length === 0) return null;
  const byParent = new Map<string | null, FlatNode[]>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);

  const build = (row: FlatNode): CurriculumNode => {
    const children = (byParent.get(row.id) ?? []).map(build);
    return {
      id: row.id,
      label: row.label,
      type: row.type,
      ...(children.length ? { children } : {}),
      ...(row.sourceQuestionId ? { sourceQuestionId: row.sourceQuestionId } : {}),
    };
  };

  const roots = byParent.get(null) ?? [];
  const first = roots[0];
  return first ? build(first) : null;
}

export function parseTree(input: unknown): CurriculumNode {
  return curriculumNodeSchema.parse(input);
}

/** A curriculum node surfaced as a likely target, with why it matched. */
export type NodeHint = {
  id: string;
  label: string;
  matchedBy: "id" | "label";
};

/**
 * Pull candidate target node ids/labels out of a parsedSummary string. AI
 * summaries are prompted to reference a node's id and label directly (see
 * buildCategorizationPrompt's CATEGORIZATION_SCHEMA_EXAMPLE), so this looks
 * for two kinds of evidence, in priority order:
 *  1. An explicit "n_<ts36>_<counter36>"-shaped id token (the format
 *     produced by makeId) that matches a real node in the tree.
 *  2. Any existing node's label mentioned verbatim in the summary text.
 * A node is only ever reported once, under whichever match found it first.
 */
export function extractNodeHints(summaryText: string | undefined, tree: CurriculumNode | null): NodeHint[] {
  const hints: NodeHint[] = [];
  if (!summaryText || !tree) return hints;

  const seen = new Set<string>();
  const nodesById = new Map<string, CurriculumNode>();
  const walk = (node: CurriculumNode) => {
    if (node.id) nodesById.set(node.id, node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);

  const idPattern = /\bn_[0-9a-z]+_[0-9a-z]+\b/gi;
  for (const match of summaryText.match(idPattern) ?? []) {
    const node = nodesById.get(match);
    if (node && node.id && !seen.has(node.id)) {
      seen.add(node.id);
      hints.push({ id: node.id, label: node.label, matchedBy: "id" });
    }
  }

  const lowerSummary = summaryText.toLowerCase();
  for (const node of nodesById.values()) {
    if (!node.id || seen.has(node.id)) continue;
    const label = node.label.trim();
    // Require a little length so short/common labels ("Set", "Data") don't
    // spuriously match unrelated prose in the summary.
    if (label.length >= 3 && lowerSummary.includes(label.toLowerCase())) {
      seen.add(node.id);
      hints.push({ id: node.id, label: node.label, matchedBy: "label" });
    }
  }

  return hints;
}

/** Lifecycle of a pasted exam question, from intake to being filed into the tree. */
export type QuestionStatus = "draft" | "responded" | "applied";

/**
 * A user-submitted exam question, with the generated categorization prompt
 * and (once the user pastes one back) the parsed AI response.
 */
export type ExamQuestion = {
  id: string;
  questionText: string;
  prompt: string;
  createdAt: number;
  status: QuestionStatus;
  parsedTitle?: string | undefined;
  parsedSummary?: string | undefined;
  /** The curriculum node id the user picked via NodePicker to file this question under, once confirmed. */
  confirmedNodeId?: string | undefined;
};

/**
 * Validates a persisted/round-tripped ExamQuestion. In particular this is
 * what guards the "record a validated AI response" write path: status must
 * be one of the three lifecycle stages, and parsedTitle/parsedSummary are
 * optional right up until a response has actually been parsed and saved.
 * confirmedNodeId is optional right up until the user has picked and
 * confirmed a target node in NodePicker.
 */
export const ExamQuestionSchema: z.ZodType<ExamQuestion> = z.object({
  id: z.string().min(1),
  questionText: z.string().min(1),
  prompt: z.string().min(1),
  createdAt: z.number(),
  status: z.enum(["draft", "responded", "applied"]),
  parsedTitle: z.string().min(1).optional(),
  parsedSummary: z.string().min(1).optional(),
  confirmedNodeId: z.string().min(1).optional(),
});

/** Stable identifier for this project, used when building AI response schemas. */
export const PROJECT_ID = "5f510b86-4c72-49e7-b4f0-dabba8733592";

/**
 * Shape an AI must reply with after reading an exam question and the current
 * curriculum tree: a short title for the question plus a summary describing
 * where it belongs in the tree.
 */
export type CategorizationResponse = {
  version: "v1";
  project_id: string;
  goals: Array<{ title: string; summary: string }>;
};

/**
 * Validates a pasted AI response against the expected {version, project_id,
 * goals: [{title, summary}]} shape. project_id must match this project's id,
 * and at least one goal (the categorization for the pasted question) is
 * required.
 */
export const categorizationResponseSchema: z.ZodType<CategorizationResponse> = z.object({
  version: z.literal("v1"),
  project_id: z.literal(PROJECT_ID),
  goals: z
    .array(
      z.object({
        title: z.string().min(1, "title is required"),
        summary: z.string().min(1, "summary is required"),
      }),
    )
    .min(1, "at least one goal is required"),
});

/**
 * Parse and validate a pasted AI response string. Throws a ZodError (via
 * .parse) with field-level detail on invalid shape, or a SyntaxError if the
 * input isn't valid JSON.
 */
export function parseCategorizationResponse(input: string): CategorizationResponse {
  const json: unknown = JSON.parse(input);
  return categorizationResponseSchema.parse(json);
}

/**
 * Alias for categorizationResponseSchema/CategorizationResponse under the
 * name callers use when validating a pasted AI reply (e.g. QuestionInboxDialog).
 * Kept as a distinct export rather than a rename since "categorization" is
 * the more precise name for what this schema actually checks.
 */
export const AiResponseSchema = categorizationResponseSchema;
export type AiResponse = CategorizationResponse;

const CATEGORIZATION_SCHEMA_EXAMPLE: CategorizationResponse = {
  version: "v1",
  project_id: PROJECT_ID,
  goals: [
    {
      title: "Factorising quadratic expressions",
      summary:
        "Categorize under CAPS > Grade 10 > Mathematics > Algebra (node id: n_...). This question asks the learner to factorise a quadratic expression, which matches the existing Algebra topic.",
    },
  ],
};

/**
 * Build the prompt sent to an AI to (1) generate a short title for a pasted
 * exam question and (2) suggest where it belongs in the current curriculum
 * tree. The AI is expected to reply with JSON matching CategorizationResponse.
 */
export function buildCategorizationPrompt(
  questionText: string,
  tree: CurriculumNode | null,
): string {
  const treeJson = tree ? JSON.stringify(tree, null, 2) : "null";

  return `You are an assistant that reads exam questions and files them into an existing curriculum tree.

Instructions:
1. Read the exam question below.
2. Generate one short, descriptive title (a few words) that summarizes what the question is testing.
3. Using the curriculum tree provided, identify the single best existing node this question should be categorized under. Reference it by its "id" and "label" in your summary. If no suitable node exists yet, say so in the summary and suggest where a new node should be added instead.
4. Respond with ONLY valid JSON matching the schema below — no prose, no markdown code fences, no extra keys.

Exam question:
"""
${questionText.trim()}
"""

Current curriculum tree:
${treeJson}

Respond with JSON matching exactly this schema:
${JSON.stringify(CATEGORIZATION_SCHEMA_EXAMPLE, null, 2)}`;
}

/**
 * A lesson's full breakdown: what it's teaching, how success is recognized,
 * the vocabulary learners need, how to run it, how to check understanding,
 * and what a learner should already know coming in.
 */
export type LessonBreakdown = {
  objectives: string[];
  outcomes: string[];
  keyVocabulary: string[];
  suggestedActivities: string[];
  assessmentIdeas: string[];
  prerequisites: string[];
};

/**
 * Validates a LessonBreakdown. Every list is required but may be empty
 * except objectives and outcomes, which must contain at least one entry —
 * a breakdown with no stated objective or outcome isn't a usable breakdown.
 */
export const lessonBreakdownSchema: z.ZodType<LessonBreakdown> = z.object({
  objectives: z.array(z.string().min(1)).min(1, "at least one objective is required"),
  outcomes: z.array(z.string().min(1)).min(1, "at least one outcome is required"),
  keyVocabulary: z.array(z.string().min(1)),
  suggestedActivities: z.array(z.string().min(1)),
  assessmentIdeas: z.array(z.string().min(1)),
  prerequisites: z.array(z.string().min(1)),
});

/**
 * Shape an AI must reply with after being asked to break down a single
 * lesson node: which project and lesson node the breakdown is for, plus the
 * breakdown itself.
 */
export type LessonBreakdownResponse = {
  version: "v1";
  project_id: string;
  lesson_node_id: string;
  breakdown: LessonBreakdown;
};

/**
 * Validates a pasted AI response against the expected {version, project_id,
 * lesson_node_id, breakdown} shape. project_id must match this project's id,
 * and lesson_node_id must be a non-empty string identifying the lesson leaf
 * node (see LESSON_NODE_TYPE) the breakdown applies to.
 */
export const lessonBreakdownResponseSchema: z.ZodType<LessonBreakdownResponse> = z.object({
  version: z.literal("v1"),
  project_id: z.literal(PROJECT_ID),
  lesson_node_id: z.string().min(1, "lesson_node_id is required"),
  breakdown: lessonBreakdownSchema,
});

/**
 * Parse and validate a pasted lesson breakdown AI response string. Throws a
 * ZodError (via .parse) with field-level detail on invalid shape, or a
 * SyntaxError if the input isn't valid JSON.
 */
export function parseLessonBreakdownResponse(input: string): LessonBreakdownResponse {
  const json: unknown = JSON.parse(input);
  return lessonBreakdownResponseSchema.parse(json);
}

/**
 * Field-level error entry describing what's wrong with one part of a pasted
 * lesson-breakdown document, in the shape UI paste-forms use to show inline
 * validation messages next to the offending field.
 */
export type LessonBreakdownValidationError = {
  path: string;
  message: string;
};

/**
 * Result of validating a pasted lesson-breakdown document for display
 * purposes: whether it's valid, plus every field-level error found (empty
 * when valid).
 */
export type LessonBreakdownValidationResult = {
  valid: boolean;
  errors: LessonBreakdownValidationError[];
};

/**
 * Validates a parsed (but not yet trusted) lesson-breakdown document against
 * lessonBreakdownResponseSchema and reports every problem found, rather than
 * throwing on the first one. This is the shared, non-throwing entry point
 * paste forms should use for inline field-level validation feedback — the
 * single source of truth for what a valid {version, project_id,
 * lesson_node_id, breakdown} document looks like, used by both this app's
 * own UI and contentBuilder's new-lesson paste form.
 *
 * Unlike parseLessonBreakdownResponse, this never throws: invalid JSON
 * should be caught by the caller before this is invoked (e.g. via
 * JSON.parse in a try/catch), and a value that fails schema validation is
 * reported via `errors` rather than as a thrown ZodError.
 *
 * @param data - the parsed JSON value to validate (unknown, not yet trusted)
 * @returns { valid, errors } where each error has a dot-notation `path`
 *   (e.g. "breakdown.objectives", or "$" for a root-level problem) and a
 *   human-readable `message`.
 */
export function validateLessonBreakdownDocument(data: unknown): LessonBreakdownValidationResult {
  const result = lessonBreakdownResponseSchema.safeParse(data);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors: LessonBreakdownValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "$",
    message: issue.message,
  }));

  return { valid: false, errors };
}

const LESSON_BREAKDOWN_SCHEMA_EXAMPLE: LessonBreakdownResponse = {
  version: "v1",
  project_id: PROJECT_ID,
  lesson_node_id: "n_...",
  breakdown: {
    objectives: ["Understand how to factorise a quadratic expression into two binomials."],
    outcomes: ["Learners can factorise a quadratic trinomial with a leading coefficient of 1."],
    keyVocabulary: ["quadratic expression", "factorising", "binomial", "trinomial"],
    suggestedActivities: [
      "Guided practice factorising a handful of quadratics as a class.",
      "Pair work: swap factorised answers and check each other's work by expanding.",
    ],
    assessmentIdeas: ["Short exit-ticket quiz with three unseen quadratics to factorise."],
    prerequisites: ["Multiplying two binomials (FOIL)", "Basic integer factor pairs"],
  },
};

/**
 * Build the prompt sent to an AI to break a single lesson node down into
 * objectives, outcomes, key vocabulary, suggested activities, assessment
 * ideas, and prerequisites. The full curriculum tree is embedded so the AI
 * can use the lesson's surrounding context (subject, grade, topic, sibling
 * lessons) when writing the breakdown. The AI is expected to reply with JSON
 * matching LessonBreakdownResponse, echoing back the given lesson node's id.
 */
export function buildLessonBreakdownPrompt(
  node: CurriculumNode,
  tree: CurriculumNode | null,
): string {
  const treeJson = tree ? JSON.stringify(tree, null, 2) : "null";
  const nodeId = node.id ?? "";

  return `You are an assistant that breaks a single lesson down into a full teaching plan.

Instructions:
1. Below is the lesson to break down, along with the full curriculum tree it belongs to. Use the surrounding curriculum — the subject, grade, topic, and any sibling nodes — for context on scope, level, and sequencing.
2. Break the lesson down into:
   - objectives: what the lesson sets out to teach (at least one)
   - outcomes: what a learner should be able to do afterward (at least one)
   - keyVocabulary: terms learners need to know for this lesson
   - suggestedActivities: how to actually run the lesson
   - assessmentIdeas: how to check whether learners understood it
   - prerequisites: what a learner should already know coming in
3. Respond with ONLY valid JSON matching the schema below — no prose, no markdown code fences, no extra keys.

Lesson to break down:
"""
${JSON.stringify({ id: nodeId, label: node.label, type: node.type }, null, 2)}
"""

Current curriculum tree:
${treeJson}

Respond with JSON matching exactly this schema:
${JSON.stringify({ ...LESSON_BREAKDOWN_SCHEMA_EXAMPLE, lesson_node_id: nodeId || "n_..." }, null, 2)}`;
}

/**
 * A single AI-proposed slideshow image, as returned by the Image
 * Generation step's request prompt (see ./imagePromptBuilder.ts's
 * buildImagePromptRequest RESPONSE FORMAT). Mirrors the shape documented
 * on LessonRecordShape.imagePrompts (see ./lessonRecord.ts).
 */
export type ImagePromptItem = {
  /** Short unique id within the response, e.g. "img-01". */
  id: string;
  /** Which section/tool this image supports, e.g. "introduction" or "vocabulary:morph". */
  sourceTool: string;
  /** One plain-language sentence describing what the image depicts. */
  description: string;
  /** Self-contained prompt for an AI image generator. */
  imagePrompt: string;
  /** Visual style, e.g. "flat vector illustration", "realistic photo". */
  style: string;
  /** One of "16:9", "4:3", "1:1", matching buildImagePromptRequest's contract. */
  aspectRatio: "16:9" | "4:3" | "1:1";
  /** Accessible alt text describing the image for screen readers. */
  altText: string;
  /** A few short, descriptive keyword tags for this image. Not yet consumed by the API - reserved for a future run. */
  tags?: string[];
};

/**
 * Validates a single ImagePromptItem against the exact schema
 * buildImagePromptRequest asks the AI to reply with. Every field is a
 * required, non-empty string except aspectRatio, which is restricted to
 * the three values the request prompt allows.
 */
export const imagePromptItemSchema: z.ZodType<ImagePromptItem> = z.object({
  id: z.string().min(1, "id is required"),
  sourceTool: z.string().min(1, "sourceTool is required"),
  description: z.string().min(1, "description is required"),
  imagePrompt: z.string().min(1, "imagePrompt is required"),
  style: z.string().min(1, "style is required"),
  aspectRatio: z.enum(["16:9", "4:3", "1:1"], {
    errorMap: () => ({ message: 'aspectRatio must be one of "16:9", "4:3", "1:1"' }),
  }),
  altText: z.string().min(1, "altText is required"),
  tags: z.array(z.string()).optional(),
});

/** An array of AI-proposed image prompts, as pasted back by the user. */
export const imagePromptResponseSchema = z.array(imagePromptItemSchema).min(
  1,
  "at least one image prompt is required",
);

/**
 * Field-level error entry describing what's wrong with one entry (or the
 * root) of a pasted image-prompt array, in the same shape
 * LessonBreakdownValidationError uses so paste forms can render both kinds
 * of validation feedback identically.
 */
export type ImagePromptValidationError = {
  path: string;
  message: string;
};

/**
 * Result of validating a pasted image-prompt array for display purposes:
 * whether it's valid, plus every field-level error found (empty when
 * valid).
 */
export type ImagePromptValidationResult = {
  valid: boolean;
  errors: ImagePromptValidationError[];
};

/**
 * Validates a parsed (but not yet trusted) image-prompt array against
 * imagePromptResponseSchema and reports every problem found, rather than
 * throwing on the first one — the non-throwing entry point
 * PasteImagePromptResponseForm should use for inline field-level
 * validation feedback, mirroring validateLessonBreakdownDocument's
 * pattern for the Phase 2 content-paste step.
 *
 * Unlike a plain `.parse()` call, this never throws: invalid JSON should
 * be caught by the caller before this is invoked (e.g. via JSON.parse in
 * a try/catch), and a value that fails schema validation is reported via
 * `errors` rather than as a thrown ZodError.
 *
 * @param data - the parsed JSON value to validate (unknown, not yet trusted)
 * @returns { valid, errors } where each error has a dot-notation `path`
 *   (e.g. "1.aspectRatio", or "$" for a root-level problem, such as the
 *   pasted value not being an array at all) and a human-readable `message`.
 */
export function validateImagePromptResponse(data: unknown): ImagePromptValidationResult {
  const result = imagePromptResponseSchema.safeParse(data);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors: ImagePromptValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "$",
    message: issue.message,
  }));

  return { valid: false, errors };
}

/**
 * A single AI-proposed YouTube search keyword, as returned by the YouTube
 * Videos step's request prompt (see ./youtubeKeywordPromptBuilder.ts's
 * buildYoutubeKeywordPromptRequest RESPONSE FORMAT). The saved `keyword`
 * strings are what get sent to POST /api/youtube/search once pasted back
 * in.
 */
export type YoutubeKeywordItem = {
  /** The exact search phrase to use on YouTube. */
  keyword: string;
  /** Which section/topic this keyword supports, e.g. "introduction" or "vocabulary:morph". */
  sourceTool: string;
  /** One plain-language sentence explaining why this search is useful for this lesson. */
  reason: string;
};

/**
 * Validates a single YoutubeKeywordItem against the exact schema
 * buildYoutubeKeywordPromptRequest asks the AI to reply with. Every field
 * is a required, non-empty string.
 */
export const youtubeKeywordItemSchema: z.ZodType<YoutubeKeywordItem> = z.object({
  keyword: z.string().min(1, "keyword is required"),
  sourceTool: z.string().min(1, "sourceTool is required"),
  reason: z.string().min(1, "reason is required"),
});

/** An array of AI-proposed YouTube search keywords, as pasted back by the user. */
export const youtubeKeywordResponseSchema = z.array(youtubeKeywordItemSchema).min(
  1,
  "at least one keyword is required",
);

/**
 * Field-level error entry describing what's wrong with one entry (or the
 * root) of a pasted keyword array, in the same shape
 * ImagePromptValidationError/LessonBreakdownValidationError use so paste
 * forms can render every kind of validation feedback identically.
 */
export type YoutubeKeywordValidationError = {
  path: string;
  message: string;
};

/**
 * Result of validating a pasted keyword array for display purposes:
 * whether it's valid, plus every field-level error found (empty when
 * valid).
 */
export type YoutubeKeywordValidationResult = {
  valid: boolean;
  errors: YoutubeKeywordValidationError[];
};

/**
 * Validates a parsed (but not yet trusted) YouTube-keyword array against
 * youtubeKeywordResponseSchema and reports every problem found, rather
 * than throwing on the first one — the non-throwing entry point a paste
 * form for the YouTube Videos step should use for inline field-level
 * validation feedback, mirroring validateImagePromptResponse's pattern.
 *
 * Unlike a plain `.parse()` call, this never throws: invalid JSON should
 * be caught by the caller before this is invoked (e.g. via JSON.parse in
 * a try/catch), and a value that fails schema validation is reported via
 * `errors` rather than as a thrown ZodError.
 *
 * @param data - the parsed JSON value to validate (unknown, not yet trusted)
 * @returns { valid, errors } where each error has a dot-notation `path`
 *   (e.g. "1.keyword", or "$" for a root-level problem, such as the pasted
 *   value not being an array at all) and a human-readable `message`.
 */
export function validateYoutubeKeywordResponse(data: unknown): YoutubeKeywordValidationResult {
  const result = youtubeKeywordResponseSchema.safeParse(data);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors: YoutubeKeywordValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "$",
    message: issue.message,
  }));

  return { valid: false, errors };
}

/**
 * A saved YouTube keyword response for a lesson, as stored by the API
 * (GET/PUT /api/lessons/:lessonId/youtube-keyword-response). Holds both
 * the raw text the user pasted from the LLM (so it can be re-shown and
 * re-parsed exactly as submitted) and the validated keywords extracted
 * from it. There is at most one saved response per lesson; saving again
 * replaces it.
 */
export type YoutubeKeywordSavedResponse = {
  /** The lesson this response belongs to. */
  lessonId: string;
  /** The raw, unmodified text the user pasted from the LLM. */
  rawResponse: string;
  /** The validated keywords extracted from rawResponse. */
  keywords: YoutubeKeywordItem[];
  /** ISO timestamp of when this lesson's response was first saved. */
  createdAt: string;
  /** ISO timestamp of the most recent save. */
  updatedAt: string;
};

/**
 * Payload sent to save a YouTube keyword response. lessonId is carried in
 * the URL path rather than the body, and timestamps are set server-side.
 */
export type YoutubeKeywordSaveInput = {
  rawResponse: string;
  keywords: YoutubeKeywordItem[];
};

/**
 * Validates a YoutubeKeywordSaveInput before it is sent to the API: the
 * raw response must be non-empty and the keywords must satisfy
 * youtubeKeywordResponseSchema (at least one, each fully populated).
 */
export const youtubeKeywordSaveInputSchema: z.ZodType<YoutubeKeywordSaveInput> = z.object({
  rawResponse: z.string().min(1, "rawResponse is required"),
  keywords: youtubeKeywordResponseSchema,
});

/**
 * Validates a saved YouTube keyword response as returned by the API, so a
 * malformed or outdated server payload is caught at the boundary rather
 * than surfacing as a confusing render error.
 */
export const youtubeKeywordSavedResponseSchema: z.ZodType<YoutubeKeywordSavedResponse> = z.object({
  lessonId: z.string().min(1, "lessonId is required"),
  rawResponse: z.string().min(1, "rawResponse is required"),
  keywords: youtubeKeywordResponseSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

/**
 * One entry in a lesson's `interactiveContent` array, as stored by
 * pened-server: `tool` names the pened-tools tool the entry belongs to
 * (e.g. "slideshow") and `data` is that tool's payload (for the slideshow,
 * the Deck JSON). Extra fields the server may add are preserved rather
 * than stripped, so an entry survives a read-modify-write round trip
 * unchanged.
 */
export type InteractiveContentEntry = {
  tool: string;
  data: unknown;
  [key: string]: unknown;
};

/**
 * Validates a single interactiveContent entry at the API boundary: `tool`
 * must be a non-empty string and the `data` key must be present (its
 * contents are tool-specific and are validated by whoever owns that tool,
 * e.g. ../phase2-content/slideshowDeckValidator.ts for the slideshow).
 * Unknown extra fields are passed through.
 */
export const interactiveContentEntrySchema: z.ZodType<
  InteractiveContentEntry,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    tool: z.string().min(1, "tool is required"),
    data: z.unknown(),
  })
  .passthrough()
  .refine((entry) => "data" in entry, { message: "data is required", path: ["data"] })
  .transform((entry): InteractiveContentEntry => ({ ...entry, tool: entry.tool, data: entry.data }));

/**
 * Response body of GET /api/lessons/:lessonId/interactive-content:
 * `{ id, interactiveContent }`, where `id` is the lesson id
 * (`<project_id>:<lesson_node_id>`) and `interactiveContent` is the
 * lesson's entries, or null when nothing has been saved yet.
 */
export type LessonInteractiveContentResponse = {
  id: string;
  interactiveContent: InteractiveContentEntry[] | null;
};

/**
 * Validates the interactive-content response so a malformed or outdated
 * server payload fails loudly here (with a ZodError naming the bad field)
 * instead of silently dropping or corrupting a lesson's other tools'
 * entries on the next save. A null `interactiveContent` is valid and means
 * "nothing saved yet".
 */
export const lessonInteractiveContentResponseSchema: z.ZodType<
  LessonInteractiveContentResponse,
  z.ZodTypeDef,
  unknown
> = z.object({
  id: z.string().min(1, "id is required"),
  interactiveContent: z.array(interactiveContentEntrySchema).nullable(),
});