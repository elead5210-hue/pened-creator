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