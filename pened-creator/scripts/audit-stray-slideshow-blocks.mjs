#!/usr/bin/env node
/**
 * Audits every lesson's saved `generatedContent` array for a stray
 * `{ tool: "slideshow", ... }` block — the bug described in
 * docs/qa/slideshow-lesson-id-links-checklist.md and fixed by excluding
 * the slideshow tool from ./src/lib/curriculum/phase2-content/promptBuilder.ts's
 * TOOL REGISTRY and rejecting it in ./src/lib/curriculum/phase2-content/
 * contentValidator.ts. Those two fixes stop *new* stray blocks from being
 * created; this script finds and removes any that were already saved
 * before they existed.
 *
 * A stray slideshow block only ever appears in `generatedContent` (the
 * per-block "Generated Lesson Content" preview). It is never the correct
 * `interactiveContent` slideshow entry (see
 * ../src/lib/curriculum/phase2-content/slideshowInteractiveContent.ts) —
 * that entry is left completely untouched by this script, no matter what
 * it contains.
 *
 *   npm run audit:stray-slideshow-blocks
 *
 * Nothing here is committed or hard-coded: the server URL and session
 * cookie are read from environment variables when the script runs, and
 * the cookie is redacted from anything the script prints.
 *
 * REQUIRED
 *   PENED_SERVER_URL       Origin of the pened-server API this app talks
 *                          to, e.g. https://pened-server.fly.dev (no
 *                          trailing slash). Same value as VITE_API_URL.
 *   AUDIT_SESSION_COOKIE   Full Cookie header value of a logged-in
 *                          pened-creator session (this is a secret) — the
 *                          same session-cookie auth
 *                          ../src/lib/curriculum/shared/apiClient.ts uses.
 *                          Log in via the app and copy the cookie from the
 *                          browser's dev tools.
 *
 * OPTIONAL
 *   AUDIT_WRITE=1           Actually save the cleaned-up lessons. Without
 *                           this, the script only reports what it found
 *                           (dry run) — the safe default.
 *   AUDIT_PROJECT_ID        Overrides the project id lessons are scoped
 *                           to. Defaults to PROJECT_ID from
 *                           ../src/lib/curriculum/shared/schema.ts, since
 *                           GET /api/lessons requires one.
 *
 * Exit code: 0 if the audit ran to completion (dry run or write), 1 if
 * any lesson failed to load or save, 2 if the script is misconfigured.
 */

const env = process.env;

// Same value as ../src/lib/curriculum/shared/schema.ts's PROJECT_ID.
// This is the only project pened-creator currently manages, and
// GET /api/lessons requires a projectId, so this script needs the same
// constant db.ts's listLessons() always sends.
const DEFAULT_PROJECT_ID = "5f510b86-4c72-49e7-b4f0-dabba8733592";

// Same value as ../src/lib/curriculum/phase2-content/slideshowInteractiveContent.ts's
// SLIDESHOW_TOOL_ID. Duplicated here (rather than imported) because this
// script runs standalone with plain Node, outside the app's Vite/TS build.
const SLIDESHOW_TOOL_ID = "slideshow";

const BASE_RAW = (env.PENED_SERVER_URL ?? "").trim();
const SESSION_COOKIE = (env.AUDIT_SESSION_COOKIE ?? "").trim();
const PROJECT_ID = (env.AUDIT_PROJECT_ID ?? "").trim() || DEFAULT_PROJECT_ID;
const WRITE = (env.AUDIT_WRITE ?? "") === "1";

// ---------------------------------------------------------------------------
// Output. Everything goes through redact() so the session cookie can never
// be printed, even inside an error message or a response body snippet.
// ---------------------------------------------------------------------------

const secrets = [SESSION_COOKIE].filter((value) => value.length >= 4);

function redact(text) {
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

function log(line = "") {
  console.log(redact(line));
}

function snippet(text, max = 200) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function exitMisconfigured(message) {
  console.error(redact(`Configuration problem: ${message}`));
  console.error("Run with PENED_SERVER_URL and AUDIT_SESSION_COOKIE set. See the header of this script for the rest.");
  process.exit(2);
}

if (typeof fetch !== "function") exitMisconfigured("this script needs Node 18 or newer (global fetch).");
if (!BASE_RAW) exitMisconfigured("PENED_SERVER_URL is not set.");
if (!SESSION_COOKIE) exitMisconfigured("AUDIT_SESSION_COOKIE is not set.");

let baseUrl;
try {
  baseUrl = new URL(BASE_RAW);
} catch {
  exitMisconfigured("PENED_SERVER_URL is not a valid absolute URL.");
}
if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
  exitMisconfigured("PENED_SERVER_URL must start with http:// or https://.");
}

const BASE = BASE_RAW.replace(/\/+$/, "");
const sessionHeaders = { cookie: SESSION_COOKIE, accept: "application/json" };

// ---------------------------------------------------------------------------
// HTTP. Redirects are never followed, matching scripts/verify-pened-server-slideshow.mjs.
// ---------------------------------------------------------------------------

async function request(method, path, { headers = {}, body, timeoutMs = 20000 } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, text, json };
}

function isSlideshowBlock(block) {
  return Boolean(block) && typeof block === "object" && !Array.isArray(block) && block.tool === SLIDESHOW_TOOL_ID;
}

// ---------------------------------------------------------------------------

async function main() {
  log(`Auditing lessons for project ${PROJECT_ID} at ${baseUrl.origin} (redirects are not followed)`);
  log(WRITE ? "Mode: WRITE — stray blocks will be removed and saved." : "Mode: DRY RUN — nothing will be saved (set AUDIT_WRITE=1 to actually clean up).");
  log("");

  const listRes = await request("GET", `/api/lessons?projectId=${encodeURIComponent(PROJECT_ID)}`, {
    headers: sessionHeaders,
  });

  if (listRes.status !== 200 || !Array.isArray(listRes.json)) {
    log(`Failed to list lessons: expected 200 with an array, got ${listRes.status}: ${snippet(listRes.text)}`);
    log("Is AUDIT_SESSION_COOKIE valid and still logged in?");
    process.exit(1);
  }

  const lessons = listRes.json;
  log(`Found ${lessons.length} lesson(s) for this project.`);
  log("");

  let affected = 0;
  let cleaned = 0;
  let failed = 0;

  for (const lesson of lessons) {
    const id = lesson && typeof lesson.id === "string" ? lesson.id : undefined;
    const generatedContent = Array.isArray(lesson?.generatedContent) ? lesson.generatedContent : null;

    if (!id || !generatedContent) continue;

    const strayIndexes = [];
    generatedContent.forEach((block, index) => {
      if (isSlideshowBlock(block)) strayIndexes.push(index);
    });

    if (strayIndexes.length === 0) continue;

    affected += 1;
    log(
      `${id}: ${strayIndexes.length} stray "${SLIDESHOW_TOOL_ID}" block(s) in generatedContent at index ` +
        `${strayIndexes.join(", ")} (of ${generatedContent.length} total block(s)).`,
    );

    if (!WRITE) continue;

    const cleanedContent = generatedContent.filter((block) => !isSlideshowBlock(block));

    // Load the full current record fresh (rather than reusing the list
    // response) so the PUT round-trips every other field unchanged, the
    // same way ../src/lib/curriculum/shared/db.ts's saveGeneratedContent
    // does via getLesson()+updateLessonRecord() before its own apiPut.
    const recordRes = await request("GET", `/api/lessons/${encodeURIComponent(id)}`, { headers: sessionHeaders });
    if (recordRes.status !== 200 || !recordRes.json || typeof recordRes.json !== "object") {
      failed += 1;
      log(`  FAILED to re-load lesson before saving: expected 200, got ${recordRes.status}: ${snippet(recordRes.text)}`);
      continue;
    }

    const record = recordRes.json;
    // slideshowDeck is a derived, in-memory field db.ts's getLesson() adds
    // on read (from the interactiveContent slideshow entry) and never a
    // real stored field — never send it back on a write.
    delete record.slideshowDeck;

    const saveRes = await request("PUT", `/api/lessons/${encodeURIComponent(id)}`, {
      headers: { ...sessionHeaders, "content-type": "application/json" },
      body: JSON.stringify({ ...record, generatedContent: cleanedContent }),
    });

    if (saveRes.status < 200 || saveRes.status >= 300) {
      failed += 1;
      log(`  FAILED to save cleaned-up lesson: expected 2xx, got ${saveRes.status}: ${snippet(saveRes.text)}`);
      continue;
    }

    cleaned += 1;
    log(`  Removed and saved.`);
  }

  log("");
  if (affected === 0) {
    log("No stray slideshow blocks found.");
  } else if (WRITE) {
    log(`${affected} lesson(s) affected: ${cleaned} cleaned up, ${failed} failed.`);
  } else {
    log(`${affected} lesson(s) affected (dry run — nothing saved). Re-run with AUDIT_WRITE=1 to clean them up.`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();