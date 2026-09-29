> **⚠️ Deprecated — merged into `curricullumbuilder`.**
> This app's functionality is being folded into
> [`penedv1/client`](..) (package name
> `penedmerge`), which is now the single host app for the merged
> curriculum-tree + lesson-breakdown + AI content-generation pipeline.
> See [`../docs/merge-architecture.md`](../docs/merge-architecture.md)
> for what's been ported over already and what's still pending. Do not
> add new features here — this directory is removed once the
> "Consolidate build tooling and package manifests" roadmap goal lands.

# GEDClient

An AI-assisted content creation app. GEDClient lets you paste a lesson
breakdown (objectives, outcomes, vocabulary, activities, assessment
ideas, prerequisites) as JSON, saves it locally, and assembles a
ready-to-use AI prompt that combines that lesson context with a
registry of available content-rendering "tools" — so an AI model knows
exactly what content blocks it's allowed to generate and what JSON
shape each one expects back.

This is a basic, client-only version: there is no backend and no direct
AI invocation. The generated prompt is meant to be copied or downloaded
and pasted into your AI tool of choice.

## What it does

1. **Start a new lesson** — click "New Lesson" and paste curriculum JSON
   (a lesson breakdown; see the shape below). The app validates it and
   saves it to IndexedDB in your browser.
2. **Browse and inspect lessons** — saved lessons appear in a list; select
   one to see its stored JSON and status (`draft`, `prompt-generated`, or
   `content-generated`). Selecting a lesson always opens its detail panel
   — it never jumps straight to generated content, even once some exists.
3. **Re-import curriculum JSON** — from a lesson's detail view, click
   "Import Curriculum JSON" to reopen the paste form pre-filled with that
   lesson's current breakdown, so you can update it in place.
4. **Generate a prompt** — from a lesson's detail view, click
   "Generate Prompt" to assemble a full AI prompt made of:
   - a fixed instruction block describing the task and output contract,
   - the lesson's saved context JSON,
   - the serialized tool registry (each tool's id, description, and the
     JSON schema it expects as input).
5. **Copy or download the prompt** — the generated prompt is shown in a
   read-only viewer with "Copy to Clipboard" and "Download as Text"
   actions, ready to paste into an AI tool.
6. **Paste the AI response and view content** — once you have a response
   back from your AI tool, click "Paste AI Response" to validate and save
   it. Click "View Content" (an explicit action, never automatic) to see
   the read-only, rendered preview — which may include an Assessment
   block posing a question to the learner.

### Example lesson JSON

```json
{
  "version": "v1",
  "project_id": "5f510b86-4c72-49e7-b4f0-dabba8733592",
  "lesson_node_id": "n_mthorpuv_5",
  "breakdown": {
    "objectives": ["..."],
    "outcomes": ["..."],
    "keyVocabulary": ["..."],
    "suggestedActivities": ["..."],
    "assessmentIdeas": ["..."],
    "prerequisites": ["..."]
  }
}
```

## Getting started

Requires [Node.js](https://nodejs.org/) (18+) and npm.

```bash
# install dependencies
npm install

# start the local dev server
npm run dev

# build a production bundle into dist/
npm run build

# preview the production build locally
npm run preview
```

Data is stored entirely in your browser's IndexedDB — nothing is sent
to a server, and lessons persist across page reloads but are local to
the browser/profile you're using.

## Deployment / API configuration

The merged app (see the deprecation notice at the top of this file)
talks to a separately deployed API for authentication and data. To
point a deployed build of the client at it:

- Set `VITE_API_URL` in `.env` to the deployed API's base URL, e.g.
  `https://pened-server.fly.dev` (no trailing slash) — see
  `.env.example`. `VITE_*` values are baked into the bundle at build
  time, so changing this means rebuilding (`npm run build`), not just
  restarting.
- On the API, set the `CORS_ORIGIN` secret to this app's exact deployed
  origin (no trailing slash), and set `COOKIE_SAMESITE=none` if the
  client and API are served from different sites — otherwise the
  browser won't attach the session cookie to cross-site requests.
- Browsers are increasingly blocking third-party cookies even with
  `SameSite=None`. The most reliable setup is to serve both apps under
  the same parent domain — for example the client at
  `app.example.com` and the API at `api.example.com` — with
  `COOKIE_DOMAIN` set on the API to the shared parent domain
  (`.example.com`), so the cookie is treated as first-party.

### Manual verification checklist

After deploying or changing any of the above, do a quick manual pass:

1. Register a new account.
2. Log in.
3. Refresh the page and confirm the session is still logged in (you
   should not be bounced back to `/login`).
4. Load the curriculum tree.
5. Run a Phase 3 (content) generation.
6. Log out, and confirm protected pages now redirect to `/login`.

The same checklist lives in
[`docs/qa/deployment-login-checklist.md`](docs/qa/deployment-login-checklist.md)
alongside the other QA checklists.

## Verifying changes

Run `npm run verify` before merging. It is the single check that runs, in
order and stopping at the first failure:

1. `npm run typecheck` (`tsc --noEmit`)
2. `npm run lint` (ESLint, plus the route-tree, folder-boundary and
   client-secret checks)
3. `npm run test` (Vitest)
4. `npm run build` (`vite build`)

The same command runs in CI via `.github/workflows/verify.yml` on every pull
request and on pushes to `main`. Run it after moving, renaming or creating
components so unresolved imports are caught before they reach the main
build.

## Testing

Automated tests run with Vitest and Testing Library (`npm run test`, or
`npm run test:watch` while developing) and are part of `npm run verify`.
Before releases, and after
any change to `src/app.js`, `lessonDetail.js`, `lessonContentView.js`, or
`newLessonForm.js`, run through
[`docs/curriculum-import-regression-checklist.md`](docs/curriculum-import-regression-checklist.md) —
a manual QA checklist that verifies importing/re-importing curriculum
JSON always opens the JSON paste form, and never the read-only generated
content view (which can include an Assessment question), for lessons
both with and without saved generated content.

## Project structure

```
index.html                 App shell; mounts src/app.js
src/app.js                 App entry point: wires together the lesson
                            list, detail view, new-lesson/import-
                            curriculum form, and prompt generation flow

src/db/
  schema.js                IndexedDB database name/version, object
                            store, and index definitions
  lessonRepository.js      CRUD data access layer over IndexedDB
                            (create, get, list, update, delete lessons,
                            plus updateLessonBreakdown for re-importing
                            curriculum JSON)

src/models/
  lesson.js                Lesson record shape, status enum, and
                            factory/update helpers
  lessonSchema.js           Detailed field-level validation for pasted
                            lesson breakdown JSON

src/tools/
  toolRegistry.js           Static registry of content-rendering tools
                            (Introduction, Objectives, Vocabulary,
                            Activity, Assessment, Checklist,
                            Prerequisites), each with an id, name,
                            description, and input JSON Schema

src/prompt/
  promptBuilder.js          Assembles the final AI prompt from the
                            fixed instructions, a lesson's context
                            JSON, and the serialized tool registry

src/components/
  newLessonForm/            Form for pasting/saving a new lesson, and
                            (in edit mode) re-importing curriculum JSON
                            onto an existing lesson
  lessonDetail/              Read-only lesson detail panel with the
                            "Import Curriculum JSON", "Generate Prompt",
                            "Paste AI Response", and "View Content"
                            actions
  lessonContentView/         Read-only, explicit-only view of a
                            lesson's generated content
  promptViewer/              Read-only prompt display with copy/download
                            actions

src/utils/
  download.js                Browser download helper (Blob + anchor)
                            used by the prompt viewer's "Download as
                            Text" action
```

## Extending the tool registry

To make a new content type available to the AI, add an entry to
`TOOL_REGISTRY` in `src/tools/toolRegistry.js` with a unique `id`, a
short `name`, a `description` of when to use it, and an `inputSchema`
(JSON Schema) describing the data it consumes. No other changes are
required — the registry is serialized into every generated prompt
automatically via `serializeToolRegistryForPrompt()`.