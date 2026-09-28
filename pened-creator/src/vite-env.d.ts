/// <reference types="vite/client" />

/**
 * Typed environment variables exposed to client code by Vite. Only
 * variables prefixed with VITE_ are available through import.meta.env,
 * and their values are baked into the bundle at build time (changing one
 * means rebuilding). See .env.example.
 */
interface ImportMetaEnv {
  /**
   * Base URL of the penedv1-server API, with no trailing slash, e.g.
   * "http://localhost:4000" or "https://pened-server.fly.dev". Required:
   * apiClient.ts throws a clear error if it is missing or malformed.
   */
  readonly VITE_API_URL: string;
  /**
   * Base URL of the pened Tool Renderer app, with no trailing slash, e.g.
   * "http://192.168.1.66:4500". Optional: when unset, tool-registry
   * content blocks show a clear inline message instead of an embedded
   * frame. See lib/toolRenderer/config.ts.
   */
  readonly VITE_TOOL_RENDERER_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}