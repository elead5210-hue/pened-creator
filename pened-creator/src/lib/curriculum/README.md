# `lib/curriculum/` — shared curriculum/lesson data and logic

`lib/curriculum/` is now an umbrella folder — it holds no files of
its own directly, only two subfolders that split what used to be one
flat, ad hoc mix of shared and phase-specific modules into two
clearly-scoped ones:

- **[`shared/`](./shared/README.md)** — the explicit cross-phase
  contract: `schema.ts`, `apiClient.ts`, `db.ts`,
  `lessonPipelineStatus.ts`. Both Phase 1 (`phase1-tree/`) and Phase 2
  (`phase2-content/`) depend on this, along with `components/shell/`,
  `hooks/`, `lib/auth/`, and nearly every route. See that folder's
  README for the full contract — files, internal layering, and every
  outside consumer.
- **[`phase2-content/`](./phase2-content/README.md)** — modules only
  Phase 2 needs: the prompt builder (`promptBuilder.ts`; the Phase 2
  tool list is now fetched live from the API instead of a static
  registry), the content validator (`contentValidator.ts`), and the
  `download.ts`, `imagePromptBuilder.ts`, `youtubeClient.ts`,
  `youtubeKeywordPromptBuilder.ts`, and `lessonRecord.ts` helpers.
  Depends on `shared/` for data shapes and the API client. See that
  folder's own README for its full contract.

Why the split: `shared/` and `components/ui/` are the only two truly
cross-cutting dependencies in the project — everything else has a
single owning phase. Narrowing this folder's shared surface to just
`shared/` means `phase1-tree/`'s and `phase2-content/`'s own READMEs
can each point at one clearly-scoped shared dependency instead of an
ad hoc mix of files, which is what made this folder hard to blackbox
before the split. The source audit behind both subfolders' contracts
lives in `docs/dependency-map.md`.

## Notes for an agent working only under this umbrella

- Go straight to the subfolder README relevant to your task —
  `shared/README.md` if it's cross-phase data/API logic,
  `phase2-content/README.md` if it's Phase-2-only prompt/tool/
  validation logic. This top-level README doesn't duplicate their
  per-file contracts.
- If a task would add a new file directly under `lib/curriculum/`
  (outside both subfolders), stop and reconsider: it almost certainly
  belongs in one of the two subfolders above. A truly new cross-cutting
  need belongs in `shared/`; a Phase-2-only need belongs in
  `phase2-content/`.
- If either subfolder's contract changes (new file, new outside
  consumer, new internal dependency), update that subfolder's own
  README rather than this one — this file only needs updating if the
  umbrella structure itself changes (e.g. a future `phase1-tree/`-only
  lib subfolder is added alongside these two).