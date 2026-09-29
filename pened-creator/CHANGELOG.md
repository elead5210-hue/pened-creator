# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Note:** This file was just created and does not yet reflect any
> completed work. The entries below describe the *intended* changes for
> the in-progress update (adding a YouTube Keywords / Video Search step
> to Phase 2), not changes that have actually landed in the code yet.
> This file will be revised to reflect what was actually implemented
> after each batch of tasks in this update is completed.

## [Unreleased]

### Added

- **Tool suggestions API contract hand-off document** — added a document
  describing the API contract for the new tool suggestions feature, to be
  used as a hand-off reference between frontend and backend work.
- **YouTube Keywords / Video Search step (Phase 2)** — a new step in the
  Phase 2 (Content Generation) lifecycle, placed between "View Content"
  and "Image Generation" in the lesson detail step sidebar.
  - Generates a structured prompt from the lesson's already-generated
    content, asking an AI to propose a list of YouTube search keywords
    relevant to the lesson.
  - The generated prompt can be copied/downloaded, pasted into an AI,
    and the AI's structured JSON response pasted back into the app and
    validated, mirroring the existing Image Generation step's
    generate-prompt / paste-response pattern.
  - The saved keyword list is used to call the API's
    `POST /api/youtube/search` endpoint, and the returned videos are
    displayed in a list the user can watch.
  - Keywords and search results for this step are **session-only**:
    nothing is persisted to the lesson record or the server, so they're
    cleared on a page/session refresh and must be regenerated.
- **Global Nav context menu** — added a context menu to the Global Nav,
  giving users quick access to additional actions from the top-level
  navigation.
- **Single `npm run verify` step** — runs typecheck, lint, test and build
  in sequence and stops at the first failure. Documented in `README.md`
  and `AGENTS.md`.
- **`test` and `typecheck` npm scripts** — `npm run test` runs Vitest
  (jsdom, Testing Library, jest-dom matchers via `src/test/setup.ts`);
  `npm run typecheck` runs `tsc --noEmit`.
- **CI check for `verify`** — `.github/workflows/verify.yml` runs
  `npm ci` and `npm run verify` on pull requests and pushes to `main`.
- **QA checklist notes** — the route-tree and end-to-end regression
  checklists now include a step to run `npm run verify` and confirm there
  are no unresolved imports after moving or creating components or routes.
- **Node 22.12+ requirement** — added an `engines.node` field
  (`>=22.12.0`) to `package.json` and an `.nvmrc` pinning Node 22, matching
  what the `@tanstack/react-start` packages need. The `verify` CI workflow
  now reads its Node version from `.nvmrc`, so local and CI runs use the
  same version. Documented in `README.md` and `AGENTS.md`.

### Fixed

- **Unresolved imports reaching the main build** — imports broken by
  moving or creating components are now caught before merge by the
  typecheck and build steps of `npm run verify`, enforced in CI. Also
  aligned `import.meta.env` typings for the tool suggestions client
  (`VITE_USE_MOCK_TOOL_SUGGESTIONS`) with `ImportMetaEnv`.
- **Unresolved `ToolSuggestionModal` import** — `GlobalToolbar.tsx` imported
  the modal from `@/components/shell/ToolSuggestionModal`, a path that does
  not exist, which made `npm run build:dev` fail with an
  `UNLOADABLE_DEPENDENCY` error. The modal lives at
  `src/components/tools/ToolSuggestionModal.tsx`, so the import now points
  to `@/components/tools/ToolSuggestionModal`. The shell and tools READMEs
  describe this location.
- **Stale `src/routeTree.gen.ts`** — committed the regenerated route tree
  so `npm run routes:check`, `npm run build` and the `verify` workflow pass.
  Running on an unsupported Node version could otherwise produce a
  different generated file and fail the check.

### Changed

- **Dev server port is now fixed and strict** — `vite dev` serves on port
  3000 with `strictPort: true` (`server.port` in `vite.config.ts`), so a port
  clash fails loudly instead of silently moving to 3001 and invalidating the
  documented LAN URLs. Documented in `README.md`.
- **Build and cache output is ignored consistently** — `.gitignore`,
  `.prettierignore` and `eslint.config.js` now cover `.vite`,
  `.routes-check-tmp` and `node_modules/.nitro` alongside `.output`, and
  `.dockerignore` already excluded them from the Docker build context.
  `AGENTS.md` and `README.md` note that this output must never be committed
  and that `src/routeTree.gen.ts` is the only tracked generated file.

### Removed

- **Tracked `.vite/deps` files** — removed `.vite/deps/_metadata.json` and
  `.vite/deps/package.json`, which are machine-generated dependency-optimizer
  cache files that should not be in git.

### Verification

- The full `npm run verify` chain (typecheck, lint, Vitest, build) is the
  check for these changes and runs on Node 22 (see `.nvmrc`), both locally
  and in the `verify` CI workflow. It includes the Testing Library tests for
  `GlobalToolbar`, `ToolSuggestionModal` and `toolSuggestionsClient`.

[Unreleased]: #