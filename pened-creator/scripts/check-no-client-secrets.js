#!/usr/bin/env node
/**
 * Fails the build if pened-creator could use or expose secrets it must not
 * have. Run by `npm run secrets:check`, and from `lint` and `prebuild`, in
 * the same way as check-folder-boundaries.js.
 *
 * Why this exists: pened-tools' own server reads slideshow decks from
 * pened-server using PENED_API_KEY and PENED_SERVER_URL. Those are Fly
 * secrets on the pened-tools app. pened-creator must never use them, and it
 * must never put a secret in a VITE_* variable, because VITE_* values are read
 * at build time and shipped to every browser in the client bundle.
 *
 * What it checks (in src/, .env*, Dockerfile, *.toml and vite.config.*):
 *   1. Any mention of PENED_API_KEY or PENED_SERVER_URL (also inside a longer
 *      name such as VITE_PENED_API_KEY) outside comments.
 *   2. Any VITE_* name that looks like a secret: it contains KEY, SECRET,
 *      TOKEN or PASSWORD.
 *
 * Comment-only lines are ignored, so a comment that warns against these names
 * (for example in .env.example) is fine. A name in code, in a string, or on a
 * line that also has code is a violation, even if a comment follows it.
 *
 * It prints the file, the line number and the rule for each problem. It never
 * prints a line's contents or any value, so a real secret in a .env file is
 * not echoed into a build log. Exit code 0 means clean, 1 means violations.
 *
 * If a VITE_* name is a false positive (a public identifier that happens to
 * contain KEY), add its exact name to ALLOWED_VITE_NAMES below, with a comment
 * that says why it is public.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Exact VITE_* names that are allowed even though they look secret-like. */
const ALLOWED_VITE_NAMES = new Set([
  // Add public identifiers here, with the reason. Empty on purpose.
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".output",
  ".vite",
  "dist",
  ".routes-check-tmp",
]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".html"]);

const TOOLS_SECRET_NAME = /PENED_(?:API_KEY|SERVER_URL)/i;
const SECRET_LIKE_VITE_NAME = /VITE_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*/gi;

// ---------------------------------------------------------------------------
// Finding the files to scan
// ---------------------------------------------------------------------------

/** Files scanned with `#` comments: env files, Dockerfile, fly.toml. */
function isHashCommentFile(name) {
  return name.startsWith(".env") || name === "Dockerfile" || name.endsWith(".toml");
}

function isCodeFile(name) {
  return CODE_EXTENSIONS.has(path.extname(name));
}

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), files);
    } else if (entry.isFile() && isCodeFile(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
}

function collectFiles() {
  const files = [];
  walk(path.join(ROOT, "src"), files);

  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(ROOT, { withFileTypes: true });
  } catch {
    // ROOT is always readable when the script runs from the repo.
  }
  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const isEnvLike = name.startsWith(".env") || name === "Dockerfile" || name.endsWith(".toml");
    const isViteConfig = /^vite\.config\.[cm]?[jt]s$/.test(name);
    if (isEnvLike || isViteConfig) files.push(path.join(ROOT, name));
  }
  return files;
}

// ---------------------------------------------------------------------------
// Working out which text on each line is code
// ---------------------------------------------------------------------------

/**
 * Returns, for each line, the text that is not a comment-only line: an empty
 * string for a comment-only line (so nothing on it can trigger a violation),
 * and the code after a closing block-comment marker when a block comment ends
 * on the line. A line with code and a trailing comment is kept whole, so a
 * name in the code part is still found.
 */
function codeLines(text, hashComments) {
  const lines = text.split(/\r?\n/);
  if (hashComments) {
    return lines.map((line) => (line.trim().startsWith("#") ? "" : line));
  }

  let inBlock = false;
  return lines.map((line) => {
    let rest = line;

    if (inBlock) {
      const close = rest.indexOf("*/");
      if (close === -1) return "";
      inBlock = false;
      rest = rest.slice(close + 2);
    }

    // Strip any run of leading comments, then look at what remains.
    for (;;) {
      const trimmed = rest.trim();
      if (trimmed.startsWith("//")) return "";
      if (trimmed.startsWith("/*")) {
        const close = trimmed.indexOf("*/", 2);
        if (close === -1) {
          inBlock = true;
          return "";
        }
        rest = trimmed.slice(close + 2);
        continue;
      }
      return rest;
    }
  });
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const violations = [];

function report(file, lineNumber, rule) {
  violations.push({
    file: path.relative(ROOT, file).split(path.sep).join("/"),
    line: lineNumber,
    rule,
  });
}

function scanFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }

  const lines = codeLines(text, isHashCommentFile(path.basename(file)));

  lines.forEach((code, index) => {
    if (!code) return;
    const lineNumber = index + 1;

    if (TOOLS_SECRET_NAME.test(code)) {
      report(
        file,
        lineNumber,
        "uses or references a pened-tools secret name (PENED_API_KEY / PENED_SERVER_URL). pened-creator must never use these.",
      );
    }

    for (const match of code.matchAll(SECRET_LIKE_VITE_NAME)) {
      const name = match[0].toUpperCase();
      if (ALLOWED_VITE_NAMES.has(name)) continue;
      report(
        file,
        lineNumber,
        `VITE_ variable "${match[0]}" has a secret-like name (KEY / SECRET / TOKEN / PASSWORD). VITE_* values are shipped to every browser.`,
      );
    }
  });
}

const files = collectFiles();
for (const file of files) scanFile(file);

if (violations.length > 0) {
  console.error(`check-no-client-secrets: ${violations.length} problem(s) found.\n`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.rule}`);
  }
  console.error(
    "\nLine contents are not printed, so that a real secret in a file is not written to the build log." +
      "\nFix: remove the secret name from the code, and keep secrets on the server side only." +
      "\npened-tools' PENED_API_KEY and PENED_SERVER_URL belong to the pened-tools Fly app." +
      "\nIf a VITE_* name is a public identifier, add it to ALLOWED_VITE_NAMES in scripts/check-no-client-secrets.js.",
  );
  process.exit(1);
}

console.log(
  `check-no-client-secrets: OK (${files.length} files scanned, no client-side secrets found).`,
);
