#!/usr/bin/env node
/**
 * Checks a running pened-server against the slideshow interactive-content
 * contract that pened-tools depends on. See
 * docs/api-handoff/slideshow-interactive-content.md for the contract and the
 * reasoning behind each check.
 *
 *   npm run verify:pened-server
 *
 * Nothing here is committed or hard-coded: the server URL, keys and lesson
 * ids are read from environment variables when the script runs, and every
 * secret is redacted from anything the script prints.
 *
 * REQUIRED
 *   PENED_SERVER_URL   Public origin pened-tools will use, e.g.
 *                      https://pened-server.fly.dev (no trailing slash).
 *   PENED_API_KEY      The key pened-tools will send as x-api-key. Use the
 *                      read-only key if there is one.
 *
 * OPTIONAL READ CHECKS (each check is skipped when its variable is unset)
 *   VERIFY_LESSON_WITH_SLIDESHOW   Lesson id that has a slideshow entry.
 *   VERIFY_LESSON_NULL_CONTENT     Lesson id whose interactiveContent is null.
 *   VERIFY_LESSON_NO_SLIDESHOW     Lesson id with entries but no slideshow.
 *   VERIFY_LESSON_COLON_ID         Lesson id whose node id has extra colons,
 *                                  e.g. <project-id>:n_a:b:c (must exist).
 *   VERIFY_UNKNOWN_LESSON          Lesson id that does not exist (default:
 *                                  a made-up id).
 *
 * OPTIONAL WRITE ROUND TRIP (changes data, then restores it)
 *   VERIFY_WRITE=1                 Turn the round trip on.
 *   VERIFY_WRITE_LESSON            Lesson id to write to. USE A SCRATCH LESSON.
 *   VERIFY_SESSION_COOKIE          Full Cookie header value of a logged-in
 *                                  pened-creator session (this is a secret).
 *   VERIFY_DECK_KB                 Approximate deck size, default 1500.
 *
 * Exit code: 0 if every check that ran passed, 1 if any failed, 2 if the
 * script is misconfigured.
 */

const env = process.env;

const BASE_RAW = (env.PENED_SERVER_URL ?? "").trim();
const API_KEY = (env.PENED_API_KEY ?? "").trim();
const SESSION_COOKIE = (env.VERIFY_SESSION_COOKIE ?? "").trim();

const LESSON_ID_PATTERN = /^[^:\s/]+:[^\s/]+$/;
const ELEMENT_TYPES = ["text", "image", "shape", "video"];
const PENED_TOOLS_TIMEOUT_MS = 8000;
const UNKNOWN_LESSON =
  (env.VERIFY_UNKNOWN_LESSON ?? "").trim() ||
  "00000000-0000-4000-8000-000000000000:n_verify_does_not_exist";

// ---------------------------------------------------------------------------
// Output. Everything goes through redact() so a secret can never be printed,
// even inside an error message or a response body snippet.
// ---------------------------------------------------------------------------

const secrets = [API_KEY, SESSION_COOKIE].filter((value) => value.length >= 4);

function redact(text) {
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

function log(line = "") {
  console.log(redact(line));
}

const results = { pass: 0, fail: 0, skip: 0, warn: 0 };

function pass(name) {
  results.pass += 1;
  log(`PASS  ${name}`);
}

function fail(name, detail) {
  results.fail += 1;
  log(`FAIL  ${name}${detail ? `\n        ${String(detail).replace(/\n/g, "\n        ")}` : ""}`);
}

function skip(name, why) {
  results.skip += 1;
  log(`SKIP  ${name} (${why})`);
}

function warn(message) {
  results.warn += 1;
  log(`WARN  ${message}`);
}

function snippet(text, max = 160) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function exitMisconfigured(message) {
  console.error(redact(`Configuration problem: ${message}`));
  console.error(
    "Run with PENED_SERVER_URL and PENED_API_KEY set. See the header of this script for the rest.",
  );
  process.exit(2);
}

if (typeof fetch !== "function")
  exitMisconfigured("this script needs Node 18 or newer (global fetch).");
if (!BASE_RAW) exitMisconfigured("PENED_SERVER_URL is not set.");
if (!API_KEY) exitMisconfigured("PENED_API_KEY is not set.");

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

function requireLessonId(name, value) {
  if (!LESSON_ID_PATTERN.test(value)) {
    exitMisconfigured(
      `${name} is not in the <project_id>:<lesson_node_id> format (${LESSON_ID_PATTERN}).`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// HTTP. Redirects are never followed: pened-tools treats any 3xx as an
// invalid response, so a 3xx here is a failure, not something to chase.
// ---------------------------------------------------------------------------

async function request(method, path, { headers = {}, body, timeoutMs = 20000 } = {}) {
  const started = Date.now();
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
  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
    elapsedMs: Date.now() - started,
  };
}

const interactivePath = (lessonId) =>
  `/api/lessons/${encodeURIComponent(lessonId)}/interactive-content`;
const toolsHeaders = { "x-api-key": API_KEY, accept: "application/json" };

function readLesson(lessonId, headers = toolsHeaders, pathSuffix = "") {
  return request("GET", `${interactivePath(lessonId)}${pathSuffix}`, { headers });
}

// ---------------------------------------------------------------------------
// Shared assertions
// ---------------------------------------------------------------------------

/** Returns a list of problems found in a response body (never the values). */
function findLeaks(res, extraSecrets = []) {
  const problems = [];
  const body = `${res.text}\n${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n")}`;

  for (const secret of [...secrets, ...extraSecrets].filter((s) => s && s.length >= 4)) {
    if (body.includes(secret)) problems.push("contains a secret value");
  }

  const patterns = [
    [/https?:\/\/[^\s"'<>]+/i, "contains a URL"],
    [/\b[\w-]+(\.[\w-]+)*\.(internal|flycast)\b/i, "contains an internal hostname"],
    [/localhost|127\.0\.0\.1|0\.0\.0\.0/i, "contains a local address"],
    [/(postgres|postgresql|mysql|mongodb)(\+srv)?:\/\//i, "contains a database URL"],
    [/\bat\s+\S+\s+\([^)]*:\d+:\d+\)/, "contains a stack trace"],
    [/node_modules/, "contains a file path"],
  ];
  // Only the body is scanned for URLs and paths; headers legitimately carry
  // things like a Location or Server header.
  for (const [pattern, label] of patterns) {
    if (pattern.test(res.text)) problems.push(label);
  }
  return [...new Set(problems)];
}

function cacheProblems(res) {
  const problems = [];
  const cacheControl = (res.headers.get("cache-control") ?? "").toLowerCase();
  if (!cacheControl.includes("no-store")) {
    problems.push(
      `Cache-Control is ${cacheControl ? `"${cacheControl}"` : "missing"}, expected no-store`,
    );
  }
  const age = res.headers.get("age");
  if (age && Number(age) > 0) problems.push(`response was served from a cache (Age: ${age})`);
  return problems;
}

function isRedirect(res) {
  return res.status >= 300 && res.status < 400;
}

function slideshowEntries(entries) {
  return Array.isArray(entries)
    ? entries.filter((e) => e && typeof e === "object" && e.tool === "slideshow")
    : [];
}

/** The same structural rules pened-tools applies to a deck. */
function deckProblems(deck) {
  const problems = [];
  if (!deck || typeof deck !== "object") return ["deck is not an object"];
  if (!Array.isArray(deck.slides) || deck.slides.length === 0)
    return ["slides is not a non-empty array"];
  deck.slides.forEach((slide, i) => {
    if (!slide || !Array.isArray(slide.elements)) {
      problems.push(`slides[${i}].elements is not an array`);
      return;
    }
    slide.elements.forEach((el, j) => {
      if (!el || !ELEMENT_TYPES.includes(el.type))
        problems.push(`slides[${i}].elements[${j}].type is invalid`);
    });
  });
  return problems.slice(0, 5);
}

/** JSON with sorted keys, so two values compare equal regardless of key order. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Runs one check. `fn` returns nothing on success, or an array of problem
 * strings (or throws) on failure.
 */
async function check(name, fn) {
  try {
    const problems = await fn();
    if (Array.isArray(problems) && problems.length > 0) fail(name, problems.join("\n"));
    else pass(name);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  }
}

// Common "200 with the right id" assertions for a read response.
function expect200(res, lessonId) {
  const problems = [];
  if (isRedirect(res))
    return [`got a redirect (${res.status}); pened-tools does not follow redirects`];
  if (res.status !== 200) return [`expected 200, got ${res.status}: ${snippet(res.text)}`];
  if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
    problems.push(`content-type is "${res.headers.get("content-type")}", expected JSON`);
  }
  if (!res.json || typeof res.json !== "object") return [...problems, "body is not a JSON object"];
  if (res.json.id !== lessonId)
    problems.push(`body id is ${JSON.stringify(res.json.id)}, expected the decoded lesson id`);
  if (!("interactiveContent" in res.json)) problems.push("body has no interactiveContent field");
  return [...problems, ...cacheProblems(res), ...findLeaks(res).map((p) => `body ${p}`)];
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

async function runReadChecks() {
  log("Read contract (what pened-tools calls)");
  log("---------------------------------------");

  if (baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
    warn("PENED_SERVER_URL is not https. Use the public https URL that pened-tools will be given.");
  }
  if (BASE_RAW.endsWith("/"))
    warn(
      "PENED_SERVER_URL has a trailing slash; the checks below strip it. Give pened-tools the value without one.",
    );

  // 404 for an unknown lesson.
  await check("unknown lesson returns 404 with a clean JSON body and no-store", async () => {
    const res = await readLesson(requireLessonId("VERIFY_UNKNOWN_LESSON", UNKNOWN_LESSON));
    if (isRedirect(res))
      return [
        `got a redirect (${res.status}). The public URL must answer directly, with no http-to-https or host redirect.`,
      ];
    const problems = [];
    if (res.status !== 404) problems.push(`expected 404, got ${res.status}: ${snippet(res.text)}`);
    if (res.status === 404 && res.json === undefined) problems.push("404 body is not JSON");
    return [...problems, ...cacheProblems(res), ...findLeaks(res).map((p) => `404 body ${p}`)];
  });

  // Auth.
  await check("missing x-api-key returns 401 or 403", async () => {
    const res = await readLesson(UNKNOWN_LESSON, { accept: "application/json" });
    const problems = [];
    if (![401, 403].includes(res.status)) problems.push(`expected 401 or 403, got ${res.status}`);
    return [...problems, ...findLeaks(res).map((p) => `body ${p}`)];
  });

  await check("wrong x-api-key returns 401 or 403", async () => {
    const wrong = `wrong-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const res = await readLesson(UNKNOWN_LESSON, {
      "x-api-key": wrong,
      accept: "application/json",
    });
    const problems = [];
    if (![401, 403].includes(res.status)) problems.push(`expected 401 or 403, got ${res.status}`);
    return [...problems, ...findLeaks(res, [wrong]).map((p) => `body ${p}`)];
  });

  // A lesson with a slideshow.
  const withSlideshow = (env.VERIFY_LESSON_WITH_SLIDESHOW ?? "").trim();
  if (withSlideshow) {
    requireLessonId("VERIFY_LESSON_WITH_SLIDESHOW", withSlideshow);
    await check(
      "lesson with a slideshow returns 200, the right shape and exactly one slideshow entry",
      async () => {
        const res = await readLesson(withSlideshow);
        const problems = expect200(res, withSlideshow);
        if (problems.length > 0) return problems;
        const entries = slideshowEntries(res.json.interactiveContent);
        if (!Array.isArray(res.json.interactiveContent))
          return ["interactiveContent is not an array"];
        if (entries.length === 0) return ['no entry with tool "slideshow"'];
        const out = [];
        if (entries.length > 1)
          out.push(
            `${entries.length} slideshow entries; pened-tools uses the first, so there must be only one`,
          );
        out.push(...deckProblems(entries[0].data).map((p) => `deck: ${p}`));
        if (res.elapsedMs > PENED_TOOLS_TIMEOUT_MS)
          out.push(
            `took ${res.elapsedMs}ms, over pened-tools' ${PENED_TOOLS_TIMEOUT_MS}ms timeout`,
          );
        return out;
      },
    );
  } else {
    skip("lesson with a slideshow", "VERIFY_LESSON_WITH_SLIDESHOW not set");
  }

  // Null content.
  const nullContent = (env.VERIFY_LESSON_NULL_CONTENT ?? "").trim();
  if (nullContent) {
    requireLessonId("VERIFY_LESSON_NULL_CONTENT", nullContent);
    await check("lesson with nothing saved returns 200 with interactiveContent: null", async () => {
      const res = await readLesson(nullContent);
      const problems = expect200(res, nullContent);
      if (problems.length > 0) return problems;
      return res.json.interactiveContent === null
        ? []
        : [
            `interactiveContent is ${snippet(JSON.stringify(res.json.interactiveContent))}, expected null (not [] and not omitted)`,
          ];
    });
  } else {
    skip("lesson with null content", "VERIFY_LESSON_NULL_CONTENT not set");
  }

  // Entries but no slideshow.
  const noSlideshow = (env.VERIFY_LESSON_NO_SLIDESHOW ?? "").trim();
  if (noSlideshow) {
    requireLessonId("VERIFY_LESSON_NO_SLIDESHOW", noSlideshow);
    await check(
      "lesson with other entries but no slideshow returns 200 and no slideshow entry",
      async () => {
        const res = await readLesson(noSlideshow);
        const problems = expect200(res, noSlideshow);
        if (problems.length > 0) return problems;
        if (!Array.isArray(res.json.interactiveContent))
          return ["interactiveContent is not an array"];
        return slideshowEntries(res.json.interactiveContent).length === 0
          ? []
          : ["found a slideshow entry"];
      },
    );
  } else {
    skip("lesson with no slideshow entry", "VERIFY_LESSON_NO_SLIDESHOW not set");
  }

  // Colon ids.
  const colonId = (env.VERIFY_LESSON_COLON_ID ?? "").trim();
  if (colonId) {
    requireLessonId("VERIFY_LESSON_COLON_ID", colonId);
    const nodeId = colonId.slice(colonId.indexOf(":") + 1);
    if (!nodeId.includes(":"))
      exitMisconfigured(
        "VERIFY_LESSON_COLON_ID must have extra colons in the node id, e.g. <project-id>:n_a:b:c.",
      );
    await check("colon id sent as %3A (with extra colons in the node id) is matched", async () => {
      const path = interactivePath(colonId);
      if (!path.includes("%3A")) return ["the request path does not contain %3A (script bug)"];
      const res = await request("GET", path, { headers: toolsHeaders });
      return expect200(res, colonId);
    });
  } else {
    skip("colon id with extra colons", "VERIFY_LESSON_COLON_ID not set");
  }

  // No redirect on a trailing slash.
  await check("trailing-slash request does not redirect", async () => {
    const res = await readLesson(UNKNOWN_LESSON, toolsHeaders, "/");
    return isRedirect(res)
      ? [
          `got ${res.status}. A trailing-slash request must be served directly or 404, never redirected.`,
        ]
      : [];
  });

  log("");
}

// ---------------------------------------------------------------------------
// Optional write round trip. Saves a large deck, reads it back, saves a second
// deck and checks the slideshow entry was replaced, then restores the lesson.
// ---------------------------------------------------------------------------

function buildDeck(marker, targetKb) {
  const paragraph =
    `${marker} `.repeat(40) +
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20);
  const slides = [];
  let size = 0;
  let index = 0;
  while (size < targetKb * 1024) {
    index += 1;
    const slide = {
      id: `slide-${index}`,
      elements: [
        {
          id: `el-${index}-heading`,
          type: "text",
          content: `${marker} slide ${index}`,
          position: { x: 120, y: 100 },
          size: { width: 1600, height: 150 },
        },
        {
          id: `el-${index}-body`,
          type: "text",
          content: paragraph,
          position: { x: 120, y: 300 },
          size: { width: 1600, height: 600 },
        },
      ],
    };
    slides.push(slide);
    size += JSON.stringify(slide).length;
  }
  return { version: "v1", id: `verify-${marker}`, metadata: { title: `Verify ${marker}` }, slides };
}

async function runWriteRoundTrip() {
  log("Write round trip (changes data, then restores it)");
  log("---------------------------------------------------");

  if ((env.VERIFY_WRITE ?? "") !== "1") {
    skip("write round trip", "VERIFY_WRITE=1 not set");
    log("");
    return;
  }
  const lessonId = requireLessonId("VERIFY_WRITE_LESSON", (env.VERIFY_WRITE_LESSON ?? "").trim());
  if (!SESSION_COOKIE)
    exitMisconfigured("VERIFY_SESSION_COOKIE is required for the write round trip.");

  const targetKb = Number(env.VERIFY_DECK_KB) > 0 ? Number(env.VERIFY_DECK_KB) : 1500;
  const lessonPath = `/api/lessons/${encodeURIComponent(lessonId)}`;
  const sessionHeaders = { cookie: SESSION_COOKIE, accept: "application/json" };

  warn(`Writing to lesson ${lessonId}. Its interactiveContent will be restored at the end.`);

  const original = await readLesson(lessonId);
  if (original.status !== 200 || !original.json) {
    fail(
      "read the lesson before writing",
      `expected 200, got ${original.status}: ${snippet(original.text)}`,
    );
    log("");
    return;
  }
  const originalEntries = original.json.interactiveContent ?? null;
  const others = (originalEntries ?? []).filter((e) => !(e && e.tool === "slideshow"));

  const recordRes = await request("GET", lessonPath, { headers: sessionHeaders });
  if (recordRes.status !== 200 || !recordRes.json || typeof recordRes.json !== "object") {
    fail(
      "load the lesson record with the session cookie",
      `expected 200, got ${recordRes.status}. Is VERIFY_SESSION_COOKIE valid?`,
    );
    log("");
    return;
  }
  const record = recordRes.json;
  delete record.slideshowDeck; // a derived, in-memory field in pened-creator; never stored

  const save = (entries) =>
    request("PUT", lessonPath, {
      headers: { ...sessionHeaders, "content-type": "application/json" },
      body: JSON.stringify({ ...record, interactiveContent: entries }),
    });

  try {
    const deckA = buildDeck("A", targetKb);
    const deckB = buildDeck("B", targetKb);
    const sizeKb = Math.round(JSON.stringify(deckA).length / 1024);
    log(`      (test decks are about ${sizeKb} KB each)`);

    await check("save a large deck", async () => {
      const res = await save([...others, { tool: "slideshow", data: deckA }]);
      if (res.status === 413)
        return [
          "413: the body size limit is below the deck size. Raise it on PUT /api/lessons/:id (and any proxy).",
        ];
      return res.status >= 200 && res.status < 300
        ? []
        : [`expected 2xx, got ${res.status}: ${snippet(res.text)}`];
    });

    await check("large deck reads back unchanged, alone, within pened-tools' timeout", async () => {
      const res = await readLesson(lessonId);
      const problems = expect200(res, lessonId);
      if (problems.length > 0) return problems;
      const entries = slideshowEntries(res.json.interactiveContent);
      const out = [];
      if (entries.length !== 1) out.push(`${entries.length} slideshow entries, expected exactly 1`);
      if (entries[0] && canonical(entries[0].data) !== canonical(deckA))
        out.push("the deck read back differs from the deck saved (truncated or altered)");
      const others2 = (res.json.interactiveContent ?? []).filter(
        (e) => !(e && e.tool === "slideshow"),
      );
      if (canonical(others2) !== canonical(others)) out.push("other tools' entries changed");
      if (res.elapsedMs > PENED_TOOLS_TIMEOUT_MS)
        out.push(
          `read took ${res.elapsedMs}ms, over pened-tools' ${PENED_TOOLS_TIMEOUT_MS}ms timeout`,
        );
      return out;
    });

    await check("saving again replaces the slideshow entry instead of appending", async () => {
      const put = await save([...others, { tool: "slideshow", data: deckB }]);
      if (put.status < 200 || put.status >= 300)
        return [`save failed: ${put.status}: ${snippet(put.text)}`];
      const res = await readLesson(lessonId);
      const problems = expect200(res, lessonId);
      if (problems.length > 0) return problems;
      const entries = slideshowEntries(res.json.interactiveContent);
      const out = [];
      if (entries.length !== 1)
        out.push(`${entries.length} slideshow entries after the second save, expected exactly 1`);
      if (entries[0] && canonical(entries[0].data) !== canonical(deckB))
        out.push("the slideshow entry is not the second deck (the first is still being served)");
      return out;
    });
  } finally {
    await check("restore the lesson's original interactiveContent", async () => {
      const res = await save(originalEntries);
      if (res.status < 200 || res.status >= 300) {
        return [
          `restore failed (${res.status}). Restore lesson ${lessonId} by hand. Its original interactiveContent had ${(originalEntries ?? []).length} entries.`,
        ];
      }
      const back = await readLesson(lessonId);
      return canonical(back.json?.interactiveContent ?? null) === canonical(originalEntries)
        ? []
        : ["the restored interactiveContent doesn't match the original"];
    });
  }
  log("");
}

// ---------------------------------------------------------------------------

async function main() {
  log(`Checking pened-server at ${baseUrl.origin} (redirects are not followed)`);
  log("");

  try {
    await runReadChecks();
    await runWriteRoundTrip();
  } catch (err) {
    fail("run the checks", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }

  log(
    `${results.pass} passed, ${results.fail} failed, ${results.skip} skipped, ${results.warn} warnings`,
  );
  log("");
  log(
    "Not checked here (needs the pened-server code): that PENED_API_KEY is a separate read-only key",
  );
  log("that cannot write, and that no CORS change was made for this feature.");
  process.exit(results.fail > 0 ? 1 : 0);
}

main();
