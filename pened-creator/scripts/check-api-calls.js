#!/usr/bin/env node
/**
 * Fails the build if any code in src/ calls the API without going through the
 * shared API client. Run by `npm run apicalls:check`, and from `lint` and
 * `prebuild`, in the same way as check-folder-boundaries.js and
 * check-no-client-secrets.js.
 *
 * Why this exists: in production this app and the API are on different hosts
 * (pened-creator.fly.dev and pened-server.fly.dev). A relative URL such as
 * fetch("/api/tool-suggestions") resolves against THIS app's origin, which has
 * no such route, so the request 404s and never reaches the API. That shipped
 * once because the tool suggestions client called fetch() directly, and its
 * unit test and mock adapter never noticed. All API traffic must go through
 * src/lib/curriculum/shared/apiClient.ts, which builds absolute URLs from the
 * validated VITE_API_URL, sends the session cookie, and shapes errors.
 *
 * What it checks (every .ts, .tsx, .js, .jsx and .mjs file under src/, except
 * test files, src/test/, and the allowed client files listed below):
 *   1. A string literal starting with /api passed straight to fetch(), for
 *      example fetch("/api/tools"). This is the exact bug described above.
 *   2. Any other fetch() call whose URL is not built with apiUrl(...), for
 *      example fetch(SOME_PATH) or fetch(`${base}/api/x`). Use apiGet, apiPost,
 *      apiPut or apiDelete instead, or fetch(apiUrl(path), ...) when the
 *      request needs something those helpers don't offer.
 *
 * Calls like handler.fetch(...) (a method on another object) are not
 * fetch() the global, so they are ignored. Comments and the contents of
 * strings are ignored when looking for calls, so mentioning fetch( in a
 * comment or a message is fine.
 *
 * It prints the file, the line number and the rule for each problem. It never
 * prints the contents of a line. Exit code 0 means clean, 1 means violations.
 *
 * If a file genuinely needs to call fetch() itself (for example a request to a
 * different, non-API host), add its path to ALLOWED_FILES below, with a
 * comment that says why.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "src");

/** Paths (relative to the project root, with forward slashes) allowed to call fetch() directly. */
const ALLOWED_FILES = new Set([
  // The shared client itself: builds every request URL from VITE_API_URL.
  "src/lib/curriculum/shared/apiClient.ts",
  // Session endpoints (/api/auth/*). Kept on the allow list in case it ever
  // needs to call fetch() directly; today it goes through apiClient.
  "src/lib/auth/authClient.ts",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Recursively lists source files under a directory. */
function listSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...listSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/** Whether a file is a test file or test support file, which may stub or call fetch freely. */
function isTestFile(relativePath) {
  return TEST_FILE_PATTERN.test(relativePath) || relativePath.startsWith("src/test/");
}

/**
 * Produces two strings the same length as the input, so offsets line up:
 *  - `stripped`: comments replaced with spaces (newlines kept), strings intact.
 *  - `masked`:   comments AND the contents of strings replaced with spaces
 *                (the quotes are kept), used for finding calls and matching
 *                parentheses without being fooled by text inside strings.
 * This is a lightweight scanner, not a full parser, which is enough for a
 * guard like this. Template literals are treated as plain strings.
 */
function scan(source) {
  const stripped = source.split("");
  const masked = source.split("");
  const blank = (arr, i) => {
    if (arr[i] !== "\n" && arr[i] !== "\r") arr[i] = " ";
  };

  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") {
        blank(stripped, i);
        blank(masked, i);
        i += 1;
      }
    } else if (ch === "/" && next === "*") {
      blank(stripped, i);
      blank(masked, i);
      blank(stripped, i + 1);
      blank(masked, i + 1);
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        blank(stripped, i);
        blank(masked, i);
        i += 1;
      }
      if (i < n) {
        blank(stripped, i);
        blank(masked, i);
        blank(stripped, i + 1);
        blank(masked, i + 1);
        i += 2;
      }
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          blank(masked, i);
          i += 1;
          if (i < n) blank(masked, i);
          i += 1;
          continue;
        }
        // A plain quote can't span lines; stop so one stray quote (for
        // example inside a regex) doesn't swallow the rest of the file.
        if (source[i] === "\n" && quote !== "`") break;
        blank(masked, i);
        i += 1;
      }
      if (i < n && source[i] === quote) i += 1;
    } else {
      i += 1;
    }
  }

  return { stripped: stripped.join(""), masked: masked.join("") };
}

/** 1-based line number of an offset. */
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Returns the [start, end) range of the first argument of a call, given the
 * offset just after its opening parenthesis, using the masked text so that
 * brackets inside strings don't count.
 */
function firstArgumentRange(masked, openParenEnd) {
  let depth = 0;
  for (let i = openParenEnd; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return [openParenEnd, i];
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      return [openParenEnd, i];
    }
  }
  return [openParenEnd, masked.length];
}

/** Finds violations in one file. Returns [{ line, rule }]. */
function checkSource(source) {
  const { stripped, masked } = scan(source);
  const violations = [];

  // Global fetch( only: not preceded by a dot or identifier character, so
  // handler.fetch( and refetch( are ignored. window./globalThis./self. are
  // still the global, so they are matched.
  const callPattern = /(^|[^\w$.])((?:window|globalThis|self)\s*\.\s*)?fetch\s*\(/g;
  let match;
  while ((match = callPattern.exec(masked)) !== null) {
    const callStart = match.index + match[1].length;
    const openParenEnd = match.index + match[0].length;
    const [argStart, argEnd] = firstArgumentRange(masked, openParenEnd);
    const firstArg = stripped.slice(argStart, argEnd).trim();
    const line = lineOf(source, callStart);

    if (/^apiUrl\s*\(/.test(firstArg)) continue;

    if (/^(["'`])\s*\/api(\/|\b)/.test(firstArg)) {
      violations.push({
        line,
        rule:
          'fetch() with a relative "/api/..." string. In production this hits the frontend origin and 404s. ' +
          "Use apiGet/apiPost/apiPut/apiDelete, or fetch(apiUrl(path), ...).",
      });
    } else {
      violations.push({
        line,
        rule:
          "fetch() whose URL is not built with apiUrl(). Go through the shared client in " +
          "src/lib/curriculum/shared/apiClient.ts (apiGet/apiPost/apiPut/apiDelete, or apiUrl(path)).",
      });
    }
  }

  return violations;
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`check-api-calls: src/ not found at ${SRC_DIR}`);
    process.exit(1);
  }

  const problems = [];
  let scanned = 0;

  for (const file of listSourceFiles(SRC_DIR)) {
    const relative = path.relative(ROOT, file).split(path.sep).join("/");
    if (ALLOWED_FILES.has(relative) || isTestFile(relative)) continue;

    scanned += 1;
    const source = fs.readFileSync(file, "utf8");
    for (const violation of checkSource(source)) {
      problems.push({ file: relative, ...violation });
    }
  }

  if (problems.length > 0) {
    console.error("API calls that bypass the shared API client:\n");
    for (const problem of problems) {
      console.error(`  ${problem.file}:${problem.line}\n    ${problem.rule}\n`);
    }
    console.error(
      `${problems.length} violation${problems.length === 1 ? "" : "s"}. ` +
        "See the header of scripts/check-api-calls.js for why this rule exists.",
    );
    process.exit(1);
  }

  console.log(`check-api-calls: OK (${scanned} files scanned, no API calls bypass the shared client).`);
}

main();