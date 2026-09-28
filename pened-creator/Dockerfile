# syntax=docker/dockerfile:1

# ---- build stage: install dependencies and build the app ----
# Vite 8 needs Node 20.19+ or 22.12+, so this uses the current 22 LTS line.
FROM node:22-slim AS build

WORKDIR /app

# Manifests first so this layer stays cached until dependencies change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_API_URL is baked into the client bundle at build time, so it has to be
# supplied here as a build argument (see [build.args] in fly.toml, or
# `docker build --build-arg VITE_API_URL=https://...`). Setting it only at
# runtime would have no effect. It must be a full https:// URL with no trailing
# slash, and the API's CORS_ORIGIN must allow this app's origin.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "ERROR: the VITE_API_URL build arg is required." >&2 && exit 1)

# VITE_TOOL_RENDERER_BASE_URL is baked in the same way as VITE_API_URL above.
# Optional: if unset, the tool renderer card shows a clear inline message
# instead of an embedded frame. No trailing slash.
ARG VITE_TOOL_RENDERER_BASE_URL
ENV VITE_TOOL_RENDERER_BASE_URL=$VITE_TOOL_RENDERER_BASE_URL

# Calls vite directly instead of `npm run build`: that script's `prebuild`
# step runs `git diff` on the generated route tree, which needs .git, and .git
# is deliberately excluded from the build context (see .dockerignore). Run
# `npm run routes:check` locally or in CI instead.
RUN npx vite build

# ---- runtime stage: just the built server, no source or node_modules ----
FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0

WORKDIR /app

# .output is nitro's self-contained node-server build, which bundles the
# dependencies it needs. It runs as the unprivileged `node` user that ships
# with the official image.
COPY --from=build --chown=node:node /app/.output ./.output

USER node

# Must match PORT above and `internal_port` in fly.toml.
EXPOSE 4000

# Checks /login rather than /: the root route calls the API during SSR to
# check the session, so it can redirect or fail if the API is unreachable,
# while /login renders on its own. Uses Node's built-in fetch, so no
# curl/wget is needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Exec form so Node is PID 1 and receives SIGTERM for a graceful shutdown.
CMD ["node", ".output/server/index.mjs"]