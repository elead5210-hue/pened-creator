#!/usr/bin/env node
/**
 * Fails the build if a source file imports across one of this project's
 * "blackboxed folder" boundaries (see docs/dependency-map.md) without that
 * import being documented in the importing folder's own README.md under
 * its "Parent dependencies" section.
 *
 * This is deliberately lightweight - a text/heuristic scan, not a real
 * TypeScript resolver - in the same spirit as the existing `routes:check`
 * script: it exists to catch *drift* between the READMEs (which are meant
 * to be a blackboxing contract an agent can trust) and what the code
 * actually imports, not to be a full static analysis tool.
 *
 * How it works:
 *   1. Every file under `src/` is assigned to at most one "boundary
 *      folder" (the folders listed in docs/dependency-map.md's Scope
 *      section) based on the longest matching path prefix. Files that
 *      don't fall under any boundary folder (e.g. src/router.tsx,
 *      src/lib/utils.ts) are never treated as *importers* that need
 *      checking, but they can still be valid *targets* of an import.
 *   2. For every import/export/dynamic-import specifier in a boundary
 *      file, the target is resolved to an actual file under `src/`.
 *      Bare package specifiers (no leading "." or "@/") are ignored -
 *      this script only cares about intra-project imports.
 *   3. If the resolved target lives inside the *same* boundary folder as
 *      the importer, it's an internal import and is ignored. Otherwise
 *      it's a "crossing" import, and the importer's own boundary
 *      README.md must mention it - either the full `@/...` specifier
 *      verbatim, or a matching path-prefix plus the target's base module
 *      name (to tolerate the prose style some READMEs use, e.g. grouping
 *      several imports under one `@/lib/curriculum/shared/` heading and
 *      naming each module inline rather than spelling out every full
 *      specifier).
 *
 * Run directly: `node scripts/check-folder-boundaries.js`
 * Wired into `npm run lint` / `npm run prebuild` (see package.json).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(PROJECT_ROOT, "src");

/**
 * The blackboxed folder boundaries this project maintains, matching the
 * "Scope" list in docs/dependency-map.md. Each `folder` is a path
 * relative to `src/`, using forward slashes. `readme` is that folder's
 * own contract file, also relative to `src/`.
 *
 * Order doesn't matter here - `boundaryFor()` always picks the longest
 * matching prefix, so a more specific folder (e.g.
 * `components/curriculum/phase2-content`, which also covers its
 * `toolRenderers/` subfolder since nothing more specific is listed for
 * it) is never shadowed by a shorter one.
 */
const BOUNDARIES = [
  { folder: "components/curriculum/phase1-tree", readme: "components/curriculum/phase1-tree/README.md" },
  { folder: "components/curriculum/phase2-content", readme: "components/curriculum/phase2-content/README.md" },
  { folder: "components/shell", readme: "components/shell/README.md" },
  { folder: "components/tools", readme: "components/tools/README.md" },
  { folder: "components/ui", readme: "components/ui/README.md" },
  { folder: "hooks", readme: "hooks/README.md" },
  { folder: "lib/auth", readme: "lib/auth/README.md" },
  { folder: "lib/curriculum/shared", readme: "lib/curriculum/shared/README.md" },
  { folder: "lib/curriculum/phase2-content", readme: "lib/curriculum/phase2-content/README.md" },
  { folder: "lib/tools", readme: "lib/tools/README.md" },
  { folder: "lib/toolRenderer", readme: "lib/toolRenderer/README.md" },
  { folder: "routes", readme: "routes/README.md" },
];

const SCANNABLE_EXTENSIONS = [".ts", ".tsx"];
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/** Files under `src/` that are generated or otherwise out of scope for this check. */
const EXCLUDED_FILES = new Set(["routeTree.gen.ts"]);

function toPosix(p) {
  return p.split(path.sep).join("/");
}

/** Recursively collects every scannable file under `dir`, as paths relative to `src/`. */
function listSourceFiles(dir, baseDir = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(fullPath, baseDir, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXCLUDED_FILES.has(entry.name)) continue;
    if (!SCANNABLE_EXTENSIONS.includes(path.extname(entry.name))) continue;
    out.push(toPosix(path.relative(baseDir, fullPath)));
  }
  return out;
}

/**
 * Finds which boundary folder (if any) owns a file at `relPath`
 * (posix, relative to `src/`), by longest matching prefix.
 */
function boundaryFor(relPath) {
  let best = null;
  for (const boundary of BOUNDARIES) {
    if (relPath === boundary.folder || relPath.startsWith(`${boundary.folder}/`)) {
      if (!best || boundary.folder.length > best.folder.length) {
        best = boundary;
      }
    }
  }
  return best;
}

/**
 * Pulls every import/export/dynamic-import specifier out of a file's
 * source text. Deliberately regex-based rather than a real parser -
 * good enough for this project's plain `import ... from "..."` /
 * `export ... from "..."` / `import("...")` style, and avoids adding a
 * TS parser dependency just for a lint-time sanity check.
 */
function extractSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+[^;'"]*?from\s+["']([^"']+)["']/g,
    /\bexport\s+[^;'"]*?from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /^\s*import\s+["']([^"']+)["']\s*;?\s*$/gm,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

/**
 * Resolves an import specifier used inside `importerRelPath` (posix,
 * relative to `src/`) to the actual target file it points at, also
 * posix-relative to `src/`. Returns null if the specifier isn't an
 * intra-project path (a bare package name) or can't be resolved to a
 * real file.
 */
function resolveSpecifier(specifier, importerRelPath) {
  let targetRelNoExt;

  if (specifier.startsWith("@/")) {
    targetRelNoExt = specifier.slice(2);
  } else if (specifier.startsWith(".")) {
    const importerDir = path.posix.dirname(importerRelPath);
    targetRelNoExt = path.posix.normalize(path.posix.join(importerDir, specifier));
  } else {
    // Bare package specifier (react, lucide-react, sonner, etc.) - not
    // this script's concern.
    return null;
  }

  const candidates = [
    targetRelNoExt,
    ...RESOLVE_EXTENSIONS.map((ext) => `${targetRelNoExt}${ext}`),
    ...RESOLVE_EXTENSIONS.map((ext) => path.posix.join(targetRelNoExt, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    const absolute = path.join(SRC_DIR, candidate);
    if (existsSync(absolute) && statSync(absolute).isFile()) {
      return toPosix(candidate);
    }
  }

  return null;
}

/** Strips a trailing file extension for display/README-matching purposes. */
function stripExtension(relPath) {
  const ext = path.posix.extname(relPath);
  return ext ? relPath.slice(0, -ext.length) : relPath;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const readmeCache = new Map();
function readReadme(readmeRelPath) {
  if (readmeCache.has(readmeRelPath)) return readmeCache.get(readmeRelPath);
  const absolute = path.join(SRC_DIR, readmeRelPath);
  const text = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
  readmeCache.set(readmeRelPath, text);
  return text;
}

/**
 * Whether `readmeText` documents an import of `specifier` (an "@/..."
 * form specifier, without extension). Accepts either the full specifier
 * appearing verbatim, or a path-prefix of it appearing alongside the
 * target's base module name elsewhere in the text - some READMEs (e.g.
 * routes/README.md) group several imports under one folder-level
 * heading and name each module in prose rather than spelling out every
 * full specifier.
 */
function isDeclaredInReadme(readmeText, specifier) {
  if (readmeText.includes(specifier)) return true;

  const segments = specifier.split("/");
  const baseName = segments[segments.length - 1];
  const baseNamePattern = new RegExp(`\\b${escapeRegExp(baseName)}\\b`);

  for (let i = segments.length - 1; i >= 1; i--) {
    const prefix = `${segments.slice(0, i).join("/")}/`;
    if (readmeText.includes(prefix) && baseNamePattern.test(readmeText)) {
      return true;
    }
  }

  return false;
}

function main() {
  const files = listSourceFiles(SRC_DIR);
  const violations = [];
  const unresolved = [];
  const missingReadmes = new Set();

  for (const relPath of files) {
    const owner = boundaryFor(relPath);
    if (!owner) continue; // Not part of any tracked boundary - nothing to check.

    const source = readFileSync(path.join(SRC_DIR, relPath), "utf8");
    const specifiers = extractSpecifiers(source);

    for (const specifier of specifiers) {
      const resolvedTarget = resolveSpecifier(specifier, relPath);
      if (resolvedTarget === null) {
        if (specifier.startsWith(".") || specifier.startsWith("@/")) {
          unresolved.push({ file: relPath, specifier });
        }
        continue;
      }

      const isInternal =
        resolvedTarget === owner.folder || resolvedTarget.startsWith(`${owner.folder}/`);
      if (isInternal) continue;

      const readableSpecifier = `@/${stripExtension(resolvedTarget)}`;
      const readmeText = readReadme(owner.readme);

      if (readmeText === null) {
        missingReadmes.add(owner.readme);
        violations.push({ file: relPath, specifier: readableSpecifier, readme: owner.readme, reason: "no README" });
        continue;
      }

      if (!isDeclaredInReadme(readmeText, readableSpecifier)) {
        violations.push({ file: relPath, specifier: readableSpecifier, readme: owner.readme, reason: "undocumented" });
      }
    }
  }

  if (unresolved.length > 0) {
    console.warn("Warning: could not resolve the following import specifiers (skipped):");
    for (const { file, specifier } of unresolved) {
      console.warn(`  - ${file}: "${specifier}"`);
    }
    console.warn("");
  }

  if (violations.length === 0) {
    console.log("check-folder-boundaries: all cross-folder imports are documented.");
    return;
  }

  console.error("check-folder-boundaries: found undocumented cross-folder imports:\n");

  const byFile = new Map();
  for (const violation of violations) {
    if (!byFile.has(violation.file)) byFile.set(violation.file, []);
    byFile.get(violation.file).push(violation);
  }

  for (const [file, fileViolations] of byFile) {
    console.error(`src/${file}`);
    for (const { specifier, readme, reason } of fileViolations) {
      if (reason === "no README") {
        console.error(`  imports "${specifier}", but src/${readme} does not exist`);
      } else {
        console.error(`  imports "${specifier}", not documented in src/${readme}`);
      }
    }
    console.error("");
  }

  if (missingReadmes.size > 0) {
    console.error("Missing README(s) for boundary folder(s):");
    for (const readme of missingReadmes) {
      console.error(`  - src/${readme}`);
    }
    console.error("");
  }

  console.error(
    `${violations.length} undocumented cross-folder import${violations.length === 1 ? "" : "s"} found. ` +
      "Add the import to the listed README's \"Parent dependencies\" section (or, if the import " +
      "shouldn't exist, remove it) before merging.",
  );
  process.exitCode = 1;
}

main();