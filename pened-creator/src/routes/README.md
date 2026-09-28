# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## Conventions

| File | URL |
| --- | --- |
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/index.tsx` | `/users` |
| `users/$id.tsx` | `/users/:id` (dynamic — bare `$`, no curly braces) |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment) |
| `files/$.tsx` | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx` | layout route (renders children via `<Outlet />`) |
| `__root.tsx` | app shell — wraps every page; preserve `<Outlet />` |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.

## Parent dependencies

`routes/` is the composition root of the app, not a leaf: it imports
from every other blackboxed folder rather than the reverse. An agent
working only inside this folder needs visibility into the exported
surface of each folder below (see that folder's own README for its
full contract) — this list is the source audit from
`docs/dependency-map.md`, kept here so the contract for this folder is
self-contained.

### `@/components/ui/*`
Used throughout. Each bullet names the underlying module (in
parentheses) alongside the exports the routes use from it:
- `Button` (`button`) — used throughout.
- `Input` (`input`) — used in `login.tsx` and `register.tsx`.
- `Tabs`/`TabsList`/`TabsTrigger` (`tabs`) — used in `index.tsx`.
- `Card`, `CardContent`, `CardDescription`, `CardHeader`, `CardTitle`
  (`card`) — used in `login.tsx` and `register.tsx`.
- `Form`, `FormControl`, `FormField`, `FormItem`, `FormLabel`,
  `FormMessage` (`form`) — used in `login.tsx` and `register.tsx`.
- `Toaster` (`sonner`) — used in `__root.tsx`, imported from
  `../components/ui/sonner`.

Other primitives may be used depending on the route.

### `@/components/shell/`
- `__root.tsx` imports `GlobalToolbar` (mounted app-wide, above
  `<Outlet />`).
- `lessons.$lessonId.tsx` imports `LessonPipelineBadge`.

### `@/components/curriculum/phase1-tree/`
- `index.tsx` imports `TreeView`, `QuestionInboxDialog`,
  `LessonBreakdownPanel`.

### `@/components/curriculum/phase2-content/`
- `lessons.$lessonId.tsx` imports `PromptViewer`, `PasteResponseForm`,
  `LessonContentView`, `ImagePromptGenerator`, `YoutubeKeywordGenerator`,
  `StepSidebar`.

### `@/components/curriculum/phase3-games/`
- `lessons.$lessonId.tsx` imports `GamesPlaceholder` to render the new
  "Games" tab.

### `@/components/tools/`
- `tools.tsx` imports `ToolRegistryCard` (default "Tool Registry" side
  tab) and `SlideshowSchemaViewer` (new "Slideshow Schema" side tab).

### `@/lib/auth/`
- `requireAuth` (from `routeGuard.ts`) — `index.tsx`,
  `lessons.$lessonId.tsx`, `tools.tsx`.
- `loginUser`/`registerUser` (from `authClient.ts`) — `login.tsx`,
  `register.tsx`.
- `AuthProvider` (from `AuthContext.tsx`) — `__root.tsx`.

### `@/lib/curriculum/shared/`
Nearly every route imports from here — `apiClient`, `schema`,
`lessonPipelineStatus`, and `db` (used directly by `index.tsx` and
`lessons.$lessonId.tsx`) — see
`docs/dependency-map.md` for the per-route breakdown.

### `@/lib/curriculum/phase2-content/`
`lessons.$lessonId.tsx` imports `promptBuilder`, `download`,
`lessonRecord` — see `docs/dependency-map.md` for the per-route
breakdown.

### `@/lib/tools/`
- `tools.tsx` imports `getTools`, `Tool` (type) from `toolsClient.ts`.

### `@/hooks/`
- `index.tsx` imports `useTreeExpandedState` from
  `use-tree-expanded-state.ts`.

## Imported by (outside this folder)

None. Nothing outside `routes/` imports from it — `src/router.tsx`
consumes the generated `routeTree.gen.ts`, which is produced from this
folder by the TanStack Router codegen rather than by hand-written
imports (see `AGENTS.md`).

## Notes for an agent working only in this folder

- Because this folder depends on every other blackboxed folder, you
  need to treat each of their READMEs as authoritative for what's safe
  to call — don't assume an export exists here without checking there
  first.
- If you add a new cross-folder import, add it to the appropriate
  subsection above so this contract stays accurate.
