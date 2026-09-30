/**
 * Read-only data layer for the Tools registry, talking to the same
 * penedv1-server /api/tools endpoints pened-admin's toolsClient.ts uses
 * (see ../curriculum/shared/apiClient.ts for the underlying request/
 * response handling, error shaping, and auth). The creator account has
 * no ability to register, edit, or remove tools - this module only
 * lists and fetches what's already been registered elsewhere (in the
 * admin app), so it exposes getTools/getTool and nothing else.
 *
 * This is now the only path to GET /api/tools in this app - the AI
 * prompt builder (see ../curriculum/phase2-content/promptBuilder.ts) and
 * the Paste AI Response validator (see
 * ../curriculum/phase2-content/contentValidator.ts, called from
 * components/curriculum/phase2-content/PasteResponseForm.tsx) both fetch
 * the tool list via getTools() below rather than a separate
 * implementation, so the prompt, the paste-response validation, and the
 * Tools Registry page always see the exact same data.
 */

import { apiGet, ApiError } from "../curriculum/shared/apiClient";

/** The two modes a registered tool's content can be used for. */
export type ToolMode = "presentation" | "evaluation";

/**
 * A tool as stored and returned by the server. `inputSchema` is stored
 * as-is (a JSON object) rather than validated as a real JSON Schema —
 * see the server's migrations/013_create_tools.sql and
 * src/lib/validation.js for details.
 */
export interface Tool {
  id: string;
  name: string;
  description: string;
  mode: ToolMode;
  inputSchema: Record<string, unknown>;
  createdAt: string;
}

/**
 * Lists every registered tool, ordered by createdAt ascending. Pass
 * `mode` to filter to a single mode ("presentation" or "evaluation")
 * server-side rather than filtering the full list client-side.
 */
export async function getTools(mode?: ToolMode): Promise<Tool[]> {
  return apiGet<Tool[]>("/api/tools", { mode });
}

/**
 * Retrieves a single registered tool by id, or undefined if none exists
 * with that id. A 404 from the API is treated as "not found" rather than
 * an error, matching the undefined-on-404 convention used elsewhere in
 * this app's data layer (see e.g. getLesson in
 * ../curriculum/shared/db.ts).
 */
export async function getTool(id: string): Promise<Tool | undefined> {
  try {
    return await apiGet<Tool>(`/api/tools/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}
