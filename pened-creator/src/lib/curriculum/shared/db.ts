import type {
  CurriculumNode,
  ExamQuestion,
  InteractiveContentEntry,
  LessonBreakdown,
  YoutubeKeywordSavedResponse,
  YoutubeKeywordSaveInput,
} from "./schema";
import type { FlatNode } from "./schema";
import {
  buildCategorizationPrompt,
  expand,
  lessonInteractiveContentResponseSchema,
  validateLessonBreakdownDocument,
  youtubeKeywordSaveInputSchema,
  youtubeKeywordSavedResponseSchema,
  PROJECT_ID,
} from "./schema";
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from "./apiClient";
// Lesson-record shaping helpers live in ../phase2-content/lessonRecord
// (ported from contentBuilder's src/models/lesson.js — see
// docs/merge-architecture.md). This module owns persistence while
// lessonRecord.ts keeps owning what a valid lesson record looks like and
// how its status lifecycle transitions.
import {
  createLessonRecord,
  updateLessonRecord,
  setLessonStatus,
  setLessonGeneratedContent,
  setLessonImagePrompts,
  setLessonImage,
  setLessonImageNoBg,
  setLessonSlideshowDeck,
  buildLessonId,
} from "../phase2-content/lessonRecord";
// A lesson's slideshow deck is stored on the server as the `slideshow`
// entry of the lesson's interactiveContent (the same entry pened-tools
// loads by lesson id). These pure helpers read and replace that entry
// without touching other tools' entries.
import {
  getSlideshowDeck,
  upsertSlideshowEntry,
} from "../phase2-content/slideshowInteractiveContent";
// Structural deck validation (the same rules pened-tools applies when it
// loads a deck by lesson id), re-checked here before any deck is saved.
import { formatDeckErrors, validateDeck } from "../phase2-content/slideshowDeckValidator";

/**
 * A lesson record as created/shaped by ../phase2-content/lessonRecord.ts (createLessonRecord /
 * updateLessonRecord / setLessonStatus / setLessonGeneratedContent /
 * setLessonImagePrompts / setLessonImage / setLessonImageNoBg).
 */
export type LessonRecord = {
  id: string;
  project_id: string;
  lesson_node_id: string;
  breakdown: unknown;
  status: string;
  generatedPrompt: string | null;
  generatedContent: unknown[] | null;
  /**
   * Parsed array of image-prompt objects returned by the AI for the Image
   * Generation step ({ id, sourceTool, description, imagePrompt, style,
   * aspectRatio, altText }), or null if that step hasn't been run for this
   * lesson yet.
   */
  imagePrompts: unknown[] | null;
  /**
   * Map of image-prompt id -> uploaded image data (a data URL or hosted
   * URL) for images the user has generated and uploaded against an
   * imagePrompts entry. Null until at least one image has been uploaded.
   */
  images: Record<string, string> | null;
  /**
   * Map of image-prompt id -> background-removed image data (a data URL
   * or hosted URL), mirroring `images`. Populated either automatically
   * (see removeImageBackground, which calls the server's background-
   * removal endpoint against an already-uploaded `images` entry) or
   * manually (see saveBackgroundRemovedImage, used when the automatic
   * result needs to be replaced). Null until a background-removed image
   * exists for at least one prompt.
   */
  imagesNoBg: Record<string, string> | null;
  /**
   * Saved slideshow Deck JSON, pasted back from an AI response to the
   * "Generate Slideshow Data" step's prompt (see
   * ../phase2-content/slideshowPromptBuilder.ts) and validated against
   * the Deck schema (see ../phase2-content/slideshowDeckValidator.ts)
   * before being saved via saveSlideshowDeck. Null until that step has
   * been completed for this lesson.
   */
  slideshowDeck: unknown | null;
  /**
   * The lesson's interactiveContent entries as stored by pened-server
   * (`{ tool, data }` per tool), or null when nothing has been saved. The
   * slideshow deck lives in the first `tool === "slideshow"` entry;
   * `slideshowDeck` above is derived from it by getLesson. Entries for
   * other tools must be passed through unchanged on every write.
   */
  interactiveContent?: InteractiveContentEntry[] | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to table updates (fires after every write). */
export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

// ---------------------------------------------------------------------------
// Curriculum tree nodes — backed by the penedv1-server API (GET/PUT/POST
// /api/nodes, DELETE /api/nodes/by-source-question/:sourceQuestionId),
// scoped by the app's PROJECT_ID. Node ids are now assigned by the server.
// Each function below keeps its original signature and still calls
// notify() after a successful write, so callers relying on the
// subscribe/notify reactivity pattern don't need to change.
// ---------------------------------------------------------------------------

/** All curriculum tree nodes for the current project, flattened. */
export async function getAllNodes(): Promise<FlatNode[]> {
  return apiGet<FlatNode[]>("/api/nodes", { projectId: PROJECT_ID });
}

/** Replace the whole table with a new flattened tree. */
export async function replaceNodes(rows: FlatNode[]): Promise<void> {
  // The server validates this body against flatNodeArraySchema = z.array(...),
  // i.e. it expects the array itself as the body, not wrapped in an object.
  await apiPut<void>("/api/nodes", rows, { projectId: PROJECT_ID });
  notify();
}

export async function clearNodes(): Promise<void> {
  await replaceNodes([]);
}

/**
 * Append a single new child node under parentId — used to file a confirmed
 * exam question into the tree without having to rewrite the whole table.
 * Sibling position, depth, and the new node's id are all computed
 * server-side from the current tree state, so the caller only needs to
 * know the target parent, not the current tree shape.
 */
export async function addNode(
  parentId: string,
  label: string,
  type: string,
  sourceQuestionId?: string,
): Promise<FlatNode> {
  const created = await apiPost<FlatNode>(
    "/api/nodes",
    {
      projectId: PROJECT_ID,
      parentId,
      label,
      type,
      ...(sourceQuestionId ? { sourceQuestionId } : {}),
    },
    { projectId: PROJECT_ID },
  );
  notify();
  return created;
}

/**
 * Delete the tree node (and any of its descendants) that was created for a
 * given exam question, identified by sourceQuestionId — used to undo a
 * confirmed placement so the question can be re-applied elsewhere. A no-op
 * (but still a successful, notifying write) if no matching node exists,
 * since the caller may be retrying after a partial failure. Cascading
 * deletion of descendants is handled server-side.
 */
export async function removeNodeBySourceQuestionId(sourceQuestionId: string): Promise<void> {
  await apiDelete(`/api/nodes/by-source-question/${encodeURIComponent(sourceQuestionId)}`, {
    projectId: PROJECT_ID,
  });
  notify();
}

// ---------------------------------------------------------------------------
// Exam questions — backed by the penedv1-server API (GET/POST/PUT
// /api/questions, DELETE /api/questions/:id), scoped by projectId. Question
// ids are now assigned by the server. As with the curriculum tree functions
// above, each function keeps its original signature and calls notify()
// after a successful write.
// ---------------------------------------------------------------------------

/** All exam questions belonging to a project, oldest first. */
export async function getQuestions(projectId: string): Promise<ExamQuestion[]> {
  const rows = await apiGet<ExamQuestion[]>("/api/questions", { projectId });
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Create a new draft question: builds its categorization prompt from the
 * current curriculum tree and persists it in the "draft" status.
 */
export async function addQuestion(projectId: string, questionText: string): Promise<ExamQuestion> {
  const nodeRows = await getAllNodes();
  const tree: CurriculumNode | null = expand(nodeRows);
  const prompt = buildCategorizationPrompt(questionText, tree);

  const question = await apiPost<ExamQuestion>(
    "/api/questions",
    {
      questionText,
      prompt,
      status: "draft",
    },
    { projectId },
  );
  notify();

  return question;
}

/**
 * Persist an updated question record — in particular, saving a validated
 * parsedTitle/parsedSummary and moving its status to "responded" once the
 * user pastes a matching AI reply back in. This only updates the question
 * record; it does not touch the curriculum tree itself.
 */
export async function saveQuestion(question: ExamQuestion): Promise<void> {
  await apiPut<ExamQuestion>(`/api/questions/${encodeURIComponent(question.id)}`, question, {
    projectId: PROJECT_ID,
  });
  notify();
}

/** Deletes an exam question by id. */
export async function deleteQuestion(id: string): Promise<void> {
  await apiDelete(`/api/questions/${encodeURIComponent(id)}`, { projectId: PROJECT_ID });
  notify();
}

// ---------------------------------------------------------------------------
// Lesson breakdowns — backed by the penedv1-server API (GET/PUT
// /api/lesson-breakdowns/:nodeId, DELETE /api/lesson-breakdowns/:nodeId).
// As with the functions above, each keeps its original signature and calls
// notify() after a successful write.
// ---------------------------------------------------------------------------

/**
 * The saved lesson breakdown for a given lesson node id, or undefined if
 * none has been saved yet. A 404 from the API is treated as "not saved
 * yet" rather than an error, matching the old IndexedDB behavior of simply
 * returning undefined for a missing row.
 */
export async function getLessonBreakdown(nodeId: string): Promise<LessonBreakdown | undefined> {
  try {
    return await apiGet<LessonBreakdown>(`/api/lesson-breakdowns/${encodeURIComponent(nodeId)}`, {
      projectId: PROJECT_ID,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

/**
 * Persist (create or overwrite) the lesson breakdown for a given lesson
 * node id, following the same store-and-notify pattern as saveQuestion.
 */
export async function saveLessonBreakdown(nodeId: string, breakdown: LessonBreakdown): Promise<void> {
  await apiPut<LessonBreakdown>(`/api/lesson-breakdowns/${encodeURIComponent(nodeId)}`, breakdown, {
    projectId: PROJECT_ID,
  });
  notify();
}

/** Deletes the saved lesson breakdown for a given lesson node id. */
export async function deleteLessonBreakdown(nodeId: string): Promise<void> {
  await apiDelete(`/api/lesson-breakdowns/${encodeURIComponent(nodeId)}`, { projectId: PROJECT_ID });
  notify();
}

/**
 * Shape of an entry returned by the bulk list endpoint below
 * (GET /api/lesson-breakdowns?projectId=): the lesson node id under
 * `node_id`, with the saved breakdown nested under `breakdown`. This is
 * NOT the flat `LessonBreakdown & { lesson_node_id }` shape (there is no
 * `lesson_node_id` field on these rows) - the per-node GET returns the
 * bare breakdown since the id is already in the URL, but the list endpoint
 * has to carry the id explicitly instead, and does so as `node_id`.
 */
export type LessonBreakdownListEntry = { node_id: string; breakdown: LessonBreakdown };

/**
 * All lesson node ids in the current project that have a saved breakdown,
 * fetched in a single request instead of asking about each node
 * individually. Backs the curriculum tree's pipeline-status computation
 * (see routes/index.tsx), letting it look up "does this node have a
 * breakdown?" via Set membership instead of triggering a
 * GET /api/lesson-breakdowns/:nodeId per node - most of which would 404
 * for any lesson that hasn't been started yet.
 *
 * Reads each row's `node_id` (see LessonBreakdownListEntry) and drops any
 * row whose id isn't a non-empty string, so a malformed row can never put
 * a bogus entry (e.g. `undefined`) into the returned list - which would
 * otherwise make every lesson look like it has no breakdown.
 */
export async function listLessonBreakdowns(): Promise<string[]> {
  const rows = await apiGet<LessonBreakdownListEntry[]>("/api/lesson-breakdowns", {
    projectId: PROJECT_ID,
  });
  return rows
    .map((row) => row.node_id)
    .filter((nodeId): nodeId is string => typeof nodeId === "string" && nodeId.length > 0);
}

// ---------------------------------------------------------------------------
// Lesson records — backed by the penedv1-server API (POST/GET/PUT/DELETE
// /api/lessons). Record
// *shaping* (validation, defaults, status transitions, updatedAt bumping)
// is delegated to ../phase2-content/lessonRecord.ts. Lesson ids are still computed
// client-side via buildLessonId (project_id:lesson_node_id is a natural,
// deterministic key, unlike nodes/questions), and the API's 404 ("no such
// lesson")/409 ("already exists") responses are mapped back onto the same
// thrown-Error contract these functions always had, so existing callers
// don't need to change their error handling.
// ---------------------------------------------------------------------------

/**
 * Creates a new lesson record from a parsed breakdown JSON and persists it.
 * Throws if a lesson with the same id (project_id:lesson_node_id) already
 * exists, mirroring the previous IndexedDB behavior via the API's 409.
 */
export async function createLesson(breakdownJson: unknown): Promise<LessonRecord> {
  const record = createLessonRecord(breakdownJson) as LessonRecord;

  try {
    const created = await apiPost<LessonRecord>("/api/lessons", record);
    notify();
    return created;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      throw new Error(
        `A lesson with id "${record.id}" already exists (project_id + lesson_node_id must be unique).`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Slideshow deck persistence helpers. The deck is stored server-side as the
// lesson's `slideshow` interactiveContent entry (written through
// PUT /api/lessons/:id and read back through
// GET /api/lessons/:id/interactive-content), so pened-tools can load it by
// lesson id. Nothing here uses a pened-tools credential; requests go
// through apiClient with this app's own session.
// ---------------------------------------------------------------------------

/** Why a slideshow deck save (or read-back verification) failed. */
export type SlideshowSaveErrorReason =
  | "not_found"
  | "unauthorized"
  | "too_large"
  | "server"
  | "network"
  | "not_persisted"
  | "invalid_response"
  | "invalid_deck"
  | "unknown";

/**
 * Typed error thrown when a slideshow deck could not be saved to the
 * server. `reason` lets the UI show a specific, actionable message, and
 * `message` is always safe to display as-is.
 */
export class SlideshowSaveError extends Error {
  readonly reason: SlideshowSaveErrorReason;
  readonly status: number | undefined;

  constructor(reason: SlideshowSaveErrorReason, message: string, status?: number) {
    super(message);
    this.name = "SlideshowSaveError";
    this.reason = reason;
    this.status = status;
  }
}

/**
 * Throws a SlideshowSaveError (reason `invalid_deck`) if the deck fails
 * validateDeck, with every problem listed in the message. Runs before any
 * request is made, so a deck pened-tools would reject is never saved,
 * whether it was pasted, generated or migrated from the old local store.
 */
function assertDeckIsValid(deck: unknown): void {
  const { valid, errors } = validateDeck(deck);
  if (!valid) {
    throw new SlideshowSaveError(
      "invalid_deck",
      `The slideshow deck doesn't meet the format pened-tools requires, so it wasn't saved:\n${formatDeckErrors(errors)}`,
    );
  }
}

function toSlideshowSaveError(err: unknown, id: string): SlideshowSaveError {
  if (err instanceof SlideshowSaveError) return err;

  if (err instanceof ApiError) {
    if (err.status === 404) {
      return new SlideshowSaveError("not_found", `No lesson found with id "${id}".`, 404);
    }
    if (err.status === 401 || err.status === 403) {
      return new SlideshowSaveError(
        "unauthorized",
        "Your session has expired or you don't have permission to save this lesson. Sign in again and retry.",
        err.status,
      );
    }
    if (err.status === 413) {
      return new SlideshowSaveError(
        "too_large",
        "The slideshow deck is too large for the server to accept.",
        413,
      );
    }
    if (err.status >= 500) {
      return new SlideshowSaveError(
        "server",
        "The lesson server had a problem saving the slideshow. Try again in a moment.",
        err.status,
      );
    }
    return new SlideshowSaveError("unknown", err.message, err.status);
  }

  if (err instanceof Error && err.name === "ZodError") {
    return new SlideshowSaveError(
      "invalid_response",
      "The lesson server returned interactive content in an unexpected format.",
    );
  }

  if (err instanceof TypeError) {
    return new SlideshowSaveError(
      "network",
      "Couldn't reach the lesson server. Check your connection and retry.",
    );
  }

  return new SlideshowSaveError(
    "unknown",
    err instanceof Error ? err.message : "Saving the slideshow failed.",
  );
}

/**
 * A lesson's interactiveContent entries, read fresh from the server
 * (GET /api/lessons/:id/interactive-content) and validated at the
 * boundary. A 404 or a null value both mean "nothing saved yet" (null).
 */
async function fetchInteractiveContent(id: string): Promise<InteractiveContentEntry[] | null> {
  try {
    const data = await apiGet<unknown>(`/api/lessons/${encodeURIComponent(id)}/interactive-content`);
    return lessonInteractiveContentResponseSchema.parse(data).interactiveContent;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * The interactiveContent entries for a lesson record: taken from the
 * record itself when the server included the field (saves a request), and
 * otherwise fetched from the interactive-content endpoint.
 */
async function resolveInteractiveContent(
  record: LessonRecord,
): Promise<InteractiveContentEntry[] | null> {
  if (Object.prototype.hasOwnProperty.call(record, "interactiveContent")) {
    return lessonInteractiveContentResponseSchema.parse({
      id: record.id,
      interactiveContent: record.interactiveContent ?? null,
    }).interactiveContent;
  }
  return fetchInteractiveContent(record.id);
}

/**
 * Persists the given interactiveContent entries (already containing the
 * new slideshow entry) on the lesson, then reads them back from the
 * interactive-content endpoint to confirm the deck really was stored -
 * a server that silently drops the field must not look like a success.
 * Throws SlideshowSaveError on any failure; notifies subscribers only
 * after the read-back succeeds.
 */
async function writeSlideshowEntries(
  existing: LessonRecord,
  deck: unknown,
  entries: InteractiveContentEntry[],
): Promise<LessonRecord> {
  const id = existing.id;
  const updated = setLessonSlideshowDeck(existing, deck) as LessonRecord;

  // The deck is stored only inside interactiveContent; sending the derived
  // slideshowDeck field as well would double the request body for what can
  // be a very large deck.
  const body: Record<string, unknown> = { ...updated, interactiveContent: entries };
  delete body.slideshowDeck;

  let saved: LessonRecord;
  try {
    saved = await apiPut<LessonRecord>(`/api/lessons/${encodeURIComponent(id)}`, body);
  } catch (err) {
    throw toSlideshowSaveError(err, id);
  }

  let stored: InteractiveContentEntry[] | null;
  try {
    stored = await fetchInteractiveContent(id);
  } catch (err) {
    throw toSlideshowSaveError(err, id);
  }

  const storedDeck = getSlideshowDeck(stored);
  if (storedDeck === null) {
    throw new SlideshowSaveError(
      "not_persisted",
      "The server accepted the save but didn't store the slideshow deck. Check that pened-server saves interactiveContent.",
    );
  }

  notify();
  return { ...saved, interactiveContent: stored, slideshowDeck: storedDeck };
}

// One-time migration from the old browser-local deck store. Decks used to
// be kept in an IndexedDB database ("pened-slideshow-decks", object store
// "decks", keyed by lesson id, value = the deck) because the server didn't
// persist them. That store is read here directly, and only to move any
// leftover deck onto the server.
const LEGACY_DECK_DB = "pened-slideshow-decks";
const LEGACY_DECK_STORE = "decks";

/** Lesson ids already checked for a legacy local deck this page load. */
const legacyMigrationAttempted = new Set<string>();

/**
 * Opens the legacy deck database if it exists, or resolves null if it
 * doesn't (without creating it), IndexedDB is unavailable, or anything
 * fails - the migration must never break normal loading.
 */
function openLegacyDeckDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(LEGACY_DECK_DB);
      // An upgrade means the database didn't exist: abort so it isn't created.
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onsuccess = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(LEGACY_DECK_STORE)) {
          resolve(db);
        } else {
          db.close();
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Runs one request against the legacy deck store and resolves with its
 * result, or null if the store is missing or the request fails.
 */
async function withLegacyDeckStore(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  const db = await openLegacyDeckDb();
  if (!db) return null;

  return new Promise((resolve) => {
    const done = (value: unknown) => {
      db.close();
      resolve(value ?? null);
    };
    try {
      const tx = db.transaction(LEGACY_DECK_STORE, mode);
      const request = run(tx.objectStore(LEGACY_DECK_STORE));
      request.onsuccess = () => done(request.result);
      request.onerror = () => done(null);
      tx.onabort = () => done(null);
    } catch {
      done(null);
    }
  });
}

/**
 * If a lesson has a deck in the legacy local store, pushes it to the server
 * (as the slideshow interactiveContent entry) and removes the local copy.
 * Attempted at most once per lesson per page load. Returns the lesson's new
 * interactiveContent entries on success, or null if there was nothing to
 * migrate or the push failed (the local copy is kept so a later load can
 * retry).
 */
async function migrateLegacyLocalDeck(
  record: LessonRecord,
  entries: InteractiveContentEntry[] | null,
): Promise<InteractiveContentEntry[] | null> {
  if (legacyMigrationAttempted.has(record.id)) return null;
  legacyMigrationAttempted.add(record.id);

  const localDeck = await withLegacyDeckStore("readonly", (store) => store.get(record.id));
  if (localDeck === null || typeof localDeck !== "object") return null;

  try {
    assertDeckIsValid(localDeck);
    const written = await writeSlideshowEntries(
      record,
      localDeck,
      upsertSlideshowEntry(entries, localDeck),
    );
    await withLegacyDeckStore("readwrite", (store) => store.delete(record.id));
    return written.interactiveContent ?? null;
  } catch (err) {
    console.warn(
      `Couldn't move the locally stored slideshow deck for lesson "${record.id}" to the server; it will be retried on a later load.`,
      err,
    );
    return null;
  }
}

/**
 * Retrieves a single lesson record by id, or undefined if none exists.
 * The record's `interactiveContent` is the server's copy of the lesson's
 * tool entries and `slideshowDeck` is derived from its first slideshow
 * entry (null if none). If the server has no deck but an old browser-local
 * one exists, it is moved to the server once (see migrateLegacyLocalDeck).
 */
export async function getLesson(id: string): Promise<LessonRecord | undefined> {
  let record: LessonRecord | undefined;
  try {
    record = await apiGet<LessonRecord>(`/api/lessons/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }

  let entries = await resolveInteractiveContent(record);
  let deck = getSlideshowDeck(entries);

  if (deck === null) {
    const migrated = await migrateLegacyLocalDeck(record, entries);
    if (migrated) {
      entries = migrated;
      deck = getSlideshowDeck(entries);
    }
  }

  return { ...record, interactiveContent: entries, slideshowDeck: deck };
}

/** Retrieves all lesson records for the current project, optionally
 * filtered by status. Scoped to PROJECT_ID like every other call in this
 * file - without it, the server has no way to limit the response and
 * returns every lesson across every project, images and all, which is
 * large enough to crash the server on a single request. */
export async function listLessons(options: { status?: string } = {}): Promise<LessonRecord[]> {
  return apiGet<LessonRecord[]>("/api/lessons", { projectId: PROJECT_ID, status: options.status });
}

/** Updates an existing lesson record by merging in changes and bumping updatedAt. */
export async function updateLesson(id: string, changes: Record<string, unknown>): Promise<LessonRecord> {
  const existing = await getLesson(id);
  if (!existing) {
    throw new Error(`No lesson found with id "${id}".`);
  }

  const updated = updateLessonRecord(existing, changes) as LessonRecord;
  try {
    const saved = await apiPut<LessonRecord>(`/api/lessons/${encodeURIComponent(id)}`, updated);
    notify();
    return saved;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`No lesson found with id "${id}".`);
    }
    throw err;
  }
}

/**
 * Re-imports/updates the curriculum breakdown JSON for an existing lesson
 * (e.g. via the "Import Curriculum JSON" action). Validates the pasted JSON
 * the same way a brand-new lesson would be validated, then confirms it still
 * resolves to the same lesson id before persisting, so pasting JSON with a
 * different project_id/lesson_node_id can't silently change (or collide
 * with) another lesson's identity.
 */
export async function updateLessonBreakdown(id: string, breakdownJson: any): Promise<LessonRecord> {
  const { valid, errors } = validateLessonBreakdownDocument(breakdownJson);

  if (!valid) {
    const details = errors.map((error) => error.message).join(" ");
    throw new Error(`Invalid lesson breakdown JSON: ${details}`);
  }

  const existing = await getLesson(id);
  if (!existing) {
    throw new Error(`No lesson found with id "${id}".`);
  }

  const { project_id, lesson_node_id } = breakdownJson;
  const nextId = buildLessonId(project_id, lesson_node_id);

  if (nextId !== id) {
    throw new Error(
      `The pasted JSON's project_id/lesson_node_id ("${nextId}") doesn't match this lesson ("${id}"). ` +
        "Importing curriculum JSON can't change which lesson it belongs to.",
    );
  }

  const updated = updateLessonRecord(existing, {
    breakdown: breakdownJson,
    project_id,
    lesson_node_id,
  }) as LessonRecord;

  try {
    const saved = await apiPut<LessonRecord>(`/api/lessons/${encodeURIComponent(id)}`, updated);
    notify();
    return saved;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`No lesson found with id "${id}".`);
    }
    throw err;
  }
}

/**
 * Creates (or, if one already exists for this project_id/lesson_node_id,
 * updates) the lesson record for a validated {version, project_id,
 * lesson_node_id, breakdown} document — the same shape LessonBreakdownPanel
 * already validates a pasted AI reply against.
 *
 * This lets saving a lesson breakdown hand off directly into lesson
 * creation, in-process, without requiring a separate copy/paste through
 * contentBuilder's "New Lesson" / "Import Curriculum JSON" form: the first
 * successful breakdown save for a lesson node spins up its lesson record in
 * DRAFT status, and any later save just re-imports the breakdown into that
 * same record.
 */
export async function ensureLessonFromBreakdown(document: unknown): Promise<LessonRecord> {
  const { valid, errors } = validateLessonBreakdownDocument(document);

  if (!valid) {
    const details = errors.map((error) => error.message).join(" ");
    throw new Error(`Invalid lesson breakdown document: ${details}`);
  }

  const { project_id, lesson_node_id } = document as { project_id: string; lesson_node_id: string };
  const id = buildLessonId(project_id, lesson_node_id);

  const existing = await getLesson(id);
  if (existing) {
    return updateLessonBreakdown(id, document);
  }

  return createLesson(document);
}

/** Convenience helper to transition a lesson's status. */
export async function updateLessonStatus(id: string, status: string): Promise<LessonRecord> {
  const existing = await getLesson(id);
  if (!existing) {
    throw new Error(`No lesson found with id "${id}".`);
  }

  const updated = setLessonStatus(existing, status) as LessonRecord;
  try {
    const saved = await apiPut<LessonRecord>(`/api/lessons/${encodeURIComponent(id)}`, updated);
    notify();
    return saved;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`No lesson found with id "${id}".`);
    }
    throw err;
  }
}

/**
 * Saves AI-generated content onto a lesson record.
 * Loads the existing record, applies setLessonGeneratedContent, and
 * persists the result.
 */
export async function saveGeneratedContent(id: string, generatedContent: unknown[]): Promise<LessonRecord> {
  const existing = await getLesson(id);
  if (!existing) {
    throw new Error(`No lesson found with id "${id}".`);
  }

  const updated = setLessonGeneratedContent(existing, generatedContent) as LessonRecord;
  try {
    const saved = await apiPut<LessonRecord>(`/api/lessons/${encodeURIComponent(id)}`, updated);
    notify();
    return saved;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`No lesson found with id "${id}".`);
    }
    throw err;
  }
}

/**
 * Saves the AI-returned image prompts onto a lesson record for the Image
 * Generation step. Loads the existing record, applies
 * setLessonImagePrompts (which also transitions status to
 * IMAGES_GENERATED), and persists the result - mirroring
 * saveGeneratedContent's shape for the Phase 2 content step.
 */
export async function saveImagePrompts(id: string, imagePrompts: unknown[]): Promise<LessonRecord> {
  const existing = await getLesson(id);
  if (!existing) {
    throw new Error(`No lesson found with id "${id}".`);
  }

  const updated = setLessonImagePrompts(existing, imagePrompts) as LessonRecord;
  try {
    const saved = await apiPut<LessonRecord>(`/api/lessons/${encodeURIComponent(id)}`, updated);
    notify();
    return saved;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`No lesson found with id "${id}".`);
    }
    throw err;
  }
}

/**
 * Records a single uploaded image against an image-prompt id on a lesson
 * record, merging it into the existing `images` map rather than requiring
 * every image to be uploaded at once. Intended to be called once per
 * upload as the user works through the Image Generation step's prompt
 * cards.
 */
export async function saveGeneratedImage(
  id: string,
  promptId: string,
  imageData: string,
): Promise<LessonRecord> {
  const existing = await getLesson(id);
  if (!existing) {
    throw new Error(`No lesson found with id "${id}".`);
  }

  const updated = setLessonImage(existing, promptId, imageData) as LessonRecord;
  try {
    const saved = await apiPut<LessonRecord>(`/api/lessons/${encodeURIComponent(id)}`, updated);
    notify();
    return saved;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`No lesson found with id "${id}".`);
    }
    throw err;
  }
}

/**
 * A previously-uploaded image, indexed by its tags and returned by
 * searchGeneratedImages below, matching the penedv1-server's
 * GET /api/images/search response shape (see server's
 * src/routes/images.js).
 */
export type GeneratedImageSearchResult = {
  id: string;
  tags: string[];
  imageData: string;
  sourceLessonId: string | null;
  sourcePromptId: string | null;
  createdAt: string;
  /** How many of the requested tags this result's own tags overlap with. */
  matchCount: number;
};

/**
 * Looks up previously uploaded images whose tags overlap with the given
 * `tags`, ranked by number of matching tags (then recency) - backs the
 * Image Generation step's "reuse an existing image?" suggestions, so a
 * user doesn't have to generate/upload a new image for a prompt whose
 * tags closely match one already saved against an earlier prompt (on
 * this lesson or any other). Short-circuits to an empty array without
 * hitting the network for an empty or whitespace-only tags list, mirroring
 * the server's own "tags must contain at least one non-empty tag"
 * validation rather than sending a request guaranteed to 400.
 */
export async function searchGeneratedImages(tags: string[]): Promise<GeneratedImageSearchResult[]> {
  const cleanTags = tags.map((tag) => tag.trim()).filter(Boolean);
  if (cleanTags.length === 0) {
    return [];
  }

  return apiGet<GeneratedImageSearchResult[]>("/api/images/search", { tags: cleanTags.join(",") });
}

/**
 * Derives the stored filename for a background-removed image from its
 * plain counterpart's filename, by inserting "-cutout" immediately before
 * the extension (e.g. wild-type-ball-python.png ->
 * wild-type-ball-python-cutout.png). Accepts either a bare filename or a
 * full URL/data URL for the plain image - only the last path segment (up
 * to any query string) is treated as the filename, so callers can pass
 * lesson.images[promptId] directly.
 */
function deriveCutoutFilename(plainImageUrlOrName: string): string {
  const lastSegment = plainImageUrlOrName.split("/").pop() ?? plainImageUrlOrName;
  const withoutQuery = lastSegment.split("?")[0];
  const dotIndex = withoutQuery.lastIndexOf(".");

  if (dotIndex <= 0) {
    return `${withoutQuery}-cutout`;
  }

  const base = withoutQuery.slice(0, dotIndex);
  const extension = withoutQuery.slice(dotIndex);
  return `${base}-cutout${extension}`;
}

/**
 * Runs automatic background removal on a prompt's already-uploaded source
 * image (lesson.images[promptId]) by calling the server's dedicated
 * POST /api/lessons/:id/images/:promptId/remove-background endpoint - the
 * server looks up the source image itself, so no image data needs to be
 * sent from here. The plain image's filename is looked up first so a
 * matching "-cutout" filename can be passed as a naming hint, keeping the
 * plain/cutout pairing encoded in the stored filenames. The server persists
 * the result into the lesson's `images_no_bg` map and returns the full
 * updated record, which is returned as-is (no local re-shaping via
 * ../phase2-content/lessonRecord.ts is needed since the server already
 * applied the update).
 *
 * Intended to back the "Remove background" button on ImagePromptCard,
 * shown once an image has been uploaded for that prompt.
 */
export async function removeImageBackground(id: string, promptId: string): Promise<LessonRecord> {
  const existing = await getLesson(id);
  if (!existing) {
    throw new Error(`No lesson found with id "${id}".`);
  }

  const plainImage = existing.images?.[promptId];
  const filename = plainImage ? deriveCutoutFilename(plainImage) : undefined;

  try {
    const saved = await apiPost<LessonRecord>(
      `/api/lessons/${encodeURIComponent(id)}/images/${encodeURIComponent(promptId)}/remove-background`,
      filename ? { filename } : undefined,
    );
    notify();
    return saved;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`No lesson found with id "${id}".`);
    }
    throw err;
  }
}

/**
 * Manually overwrites a single entry in a lesson's `images_no_bg` map,
 * merging it in the same way saveGeneratedImage merges into `images`.
 * Intended for the "Replace" control on a background-removed image, used
 * when the automatic removeImageBackground result didn't process the
 * image correctly and the user uploads their own corrected version
 * instead.
 */
export async function saveBackgroundRemovedImage(
  id: string,
  promptId: string,
  imageData: string,
): Promise<LessonRecord> {
  const existing = await getLesson(id);
  if (!existing) {
    throw new Error(`No lesson found with id "${id}".`);
  }

  const plainImage = existing.images?.[promptId];
  const filename = plainImage ? deriveCutoutFilename(plainImage) : undefined;

  const updated = setLessonImageNoBg(existing, promptId, imageData, filename) as LessonRecord;
  try {
    const saved = await apiPut<LessonRecord>(`/api/lessons/${encodeURIComponent(id)}`, updated);
    notify();
    return saved;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`No lesson found with id "${id}".`);
    }
    throw err;
  }
}

/**
 * Saves a lesson's slideshow deck: loads the existing record, applies
 * setLessonSlideshowDeck with the caller-supplied deck, and persists the
 * result. The deck itself comes from the "Generate Slideshow Data" step's
 * prompt/paste flow (see ../phase2-content/slideshowPromptBuilder.ts and
 * ../phase2-content/slideshowDeckValidator.ts) - callers should validate
 * it first to show field-level feedback, but the deck is also re-validated
 * here with validateDeck before any request is made. A deck that fails
 * throws a SlideshowSaveError with reason `invalid_deck` (the message lists
 * every problem), so nothing pened-tools would reject can be saved. Safe to
 * call again later to replace a previously saved deck with a freshly
 * pasted one.
 *
 * The deck is stored on the server as the lesson's `slideshow`
 * interactiveContent entry: the lesson's current entries are read fresh,
 * the existing slideshow entry is replaced (or one is added) and every
 * other tool's entry is left untouched, and the merged array is saved. The
 * deck is then read back from the server, so this only resolves once the
 * deck is really stored. Throws SlideshowSaveError (with a `reason`) if the
 * save or the read-back fails; nothing is reported as saved in that case.
 */
export async function saveSlideshowDeck(id: string, deck: unknown): Promise<LessonRecord> {
  assertDeckIsValid(deck);

  const existing = await getLesson(id);
  if (!existing) {
    throw new Error(`No lesson found with id "${id}".`);
  }

  let current: InteractiveContentEntry[] | null;
  try {
    current = await fetchInteractiveContent(id);
  } catch (err) {
    throw toSlideshowSaveError(err, id);
  }

  return writeSlideshowEntries(existing, deck, upsertSlideshowEntry(current, deck));
}

// ---------------------------------------------------------------------------
// YouTube keyword responses — backed by the penedv1-server API
// (GET/PUT/DELETE /api/lessons/:lessonId/youtube-keyword-response). One
// saved response per lesson; saving again replaces it (idempotent upsert).
// As with the functions above, writes call notify() on success.
// ---------------------------------------------------------------------------

/**
 * The saved YouTube keyword response (raw pasted LLM text plus extracted
 * keywords) for a lesson, or undefined if none has been saved yet. A 404
 * is treated as "not saved yet" rather than an error. The payload is
 * validated at the boundary so a malformed server response fails loudly
 * here instead of surfacing as a confusing render error later.
 */
export async function getYoutubeKeywordResponse(
  lessonId: string,
): Promise<YoutubeKeywordSavedResponse | undefined> {
  try {
    const data = await apiGet<unknown>(
      `/api/lessons/${encodeURIComponent(lessonId)}/youtube-keyword-response`,
    );
    return youtubeKeywordSavedResponseSchema.parse(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

/**
 * Persists (creates or overwrites) the YouTube keyword response for a
 * lesson: the raw text the user pasted from the LLM and the validated
 * keywords extracted from it. Validates the input before sending, and
 * resolves with the record as stored by the server.
 */
export async function saveYoutubeKeywordResponse(
  lessonId: string,
  input: YoutubeKeywordSaveInput,
): Promise<YoutubeKeywordSavedResponse> {
  const validInput = youtubeKeywordSaveInputSchema.parse(input);
  const saved = await apiPut<unknown>(
    `/api/lessons/${encodeURIComponent(lessonId)}/youtube-keyword-response`,
    validInput,
  );
  const parsed = youtubeKeywordSavedResponseSchema.parse(saved);
  notify();
  return parsed;
}

/** Deletes the saved YouTube keyword response for a lesson. A missing one is a no-op. */
export async function deleteYoutubeKeywordResponse(lessonId: string): Promise<void> {
  try {
    await apiDelete(`/api/lessons/${encodeURIComponent(lessonId)}/youtube-keyword-response`);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      throw err;
    }
  }
  notify();
}

/**
 * Deletes a lesson record by id. A missing lesson is treated as a no-op.
 * Also clears any leftover browser-local legacy deck for this id, so a
 * later lesson created with the same id can't inherit stale deck data
 * through the one-time migration in getLesson.
 */
export async function deleteLesson(id: string): Promise<void> {
  try {
    await apiDelete(`/api/lessons/${encodeURIComponent(id)}`);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      throw err;
    }
  }
  await withLegacyDeckStore("readwrite", (store) => store.delete(id));
  legacyMigrationAttempted.delete(id);
  notify();
}