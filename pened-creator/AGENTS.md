## Node version

Use **Node 22.12 or newer**. The version is pinned in `.nvmrc` (run
`nvm use` or `fnm use` in this directory), declared in `package.json`
(`engines.node`), and read by CI from the same `.nvmrc`. The
`@tanstack/react-start` packages require it, and codegen output such as
`src/routeTree.gen.ts` can differ between Node and tool versions. On an
older Node, `npm run routes:check` (and so `npm run lint`, `npm run build`
and `npm run verify`) can fail with a diff that CI would not show, or the
reverse. Check `node --version` before you regenerate or commit generated
files, and never commit a route tree generated on an unsupported Node.

## Generated files and build output

Never commit build or cache output: `.output`, `.vite`, `.routes-check-tmp`
(and `node_modules/.nitro`) are git-ignored, and `.output`, `.vite` and
`.routes-check-tmp` are also excluded from Prettier and ESLint. If one of
them shows up in `git status`, leave it out of the commit and fix the ignore
files instead. `src/routeTree.gen.ts` is the only tracked generated file. It
is excluded from Prettier so formatting cannot make it drift from the codegen
output, and it should only ever change by re-running `npm run dev` or
`npm run build` (see "Route tree" below).

## Pre-merge verification (`npm run verify`)

`npm run verify` is the single required check before merging. It runs, in
order and stopping at the first failure:

1. `npm run typecheck` (`tsc --noEmit`)
2. `npm run lint` (ESLint, plus the route-tree, folder-boundary and
   client-secret checks)
3. `npm run test` (Vitest)
4. `npm run build` (`vite build`)

The same command runs in CI via `.github/workflows/verify.yml` on every pull
request and on pushes to `main`, so anything that fails locally will also
fail there.

Run it whenever you **move, rename, or create** a component, hook, or lib
module, and again before you finish a task. Unresolved imports (a path that
no longer exists after a move, a typo in an `@/` alias, a missing named
export) are caught by the typecheck and build steps, but only if you
actually run them. Do not report a change as done, and do not open a pull
request, until `npm run verify` passes.

## Route tree (`src/routeTree.gen.ts`)

`src/routeTree.gen.ts` is **generated** by the TanStack Router codegen (via
`@tanstack/router-plugin`, bundled through the `tanstackStart` plugin from
`@tanstack/react-start`). It is produced automatically from the
file-based routes under `src/routes/` every time `vite dev` or `vite build`
runs — see the header comment at the top of the file itself.

Because of that:

- **Never hand-edit `src/routeTree.gen.ts`.** Any manual change will be
  silently overwritten the next time the dev server or build runs, and in
  the meantime it can drift out of sync with `src/routes/`, producing
  confusing routing bugs.
- **Never commit a stale `routeTree.gen.ts`.** If you add, remove, or rename
  a file under `src/routes/`, run `npm run dev` or `npm run build` once
  locally before committing so the generated file picks up the change.
- To add or change a route, edit the corresponding file under `src/routes/`
  (or add a new one) and let the codegen regenerate the route tree — don't
  add routes by editing `routeTree.gen.ts` directly.

Run `npm run routes:check` to verify `src/routeTree.gen.ts` is in sync with
`src/routes/` before pushing — it's the same check enforced in CI by
`.github/workflows/verify-routes.yml`, which regenerates the route tree and
fails the build if it doesn't match what's committed. This check also runs
as part of `npm run lint` and as a `prebuild` step ahead of `npm run build`,
so a stale route tree will fail locally before it ever reaches CI.