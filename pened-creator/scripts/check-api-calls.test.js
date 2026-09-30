import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkSource } from "./check-api-calls.js";

const SCRIPT_PATH = fileURLToPath(new URL("./check-api-calls.js", import.meta.url));
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

const RELATIVE_RULE = /relative "\/api\/\.\.\." string/;
const NOT_API_URL_RULE = /not built with apiUrl\(\)/;

describe("check-api-calls: checkSource", () => {
  describe("flags calls that bypass the shared client", () => {
    it("flags fetch() with a relative /api string using the relative-path rule", () => {
      const violations = checkSource('await fetch("/api/tools");');

      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBe(1);
      expect(violations[0].rule).toMatch(RELATIVE_RULE);
    });

    it("flags single-quoted and template-literal relative /api paths too", () => {
      expect(checkSource("fetch('/api/tools')")[0].rule).toMatch(RELATIVE_RULE);
      expect(checkSource("fetch(`/api/tools/${id}`)")[0].rule).toMatch(RELATIVE_RULE);
    });

    it("flags a relative /api path even when init options follow", () => {
      const violations = checkSource(
        'fetch("/api/tool-suggestions", { method: "POST", credentials: "include" });',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toMatch(RELATIVE_RULE);
    });

    it("flags fetch(url) as not built with apiUrl()", () => {
      const violations = checkSource("const res = await fetch(url);");

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toMatch(NOT_API_URL_RULE);
    });

    it("flags fetch(`${base}/api/x`) as not built with apiUrl()", () => {
      const violations = checkSource("await fetch(`${base}/api/x`);");

      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toMatch(NOT_API_URL_RULE);
    });

    it("flags the global reached through window, globalThis or self", () => {
      expect(checkSource("window.fetch(url)")).toHaveLength(1);
      expect(checkSource("globalThis.fetch(url)")).toHaveLength(1);
      expect(checkSource("self.fetch(url)")).toHaveLength(1);
    });

    it("flags a call passed to await inside an async function", () => {
      const source = "async function load() {\n  return await fetch(url);\n}";

      const violations = checkSource(source);

      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBe(2);
    });

    it("reports the line number of each violation", () => {
      const source = ["const a = 1;", 'fetch("/api/a");', "", "fetch(other);"].join("\n");

      expect(checkSource(source).map((v) => v.line)).toEqual([2, 4]);
    });
  });

  describe("allows calls built with apiUrl()", () => {
    it("passes fetch(apiUrl(path), init)", () => {
      const source =
        'const res = await fetch(apiUrl(TOOL_SUGGESTIONS_PATH), { credentials: "include" });';

      expect(checkSource(source)).toEqual([]);
    });

    it("passes fetch(apiUrl(...)) with a literal path and whitespace before the paren", () => {
      expect(checkSource('fetch(apiUrl("/api/tool-suggestions/mine"))')).toEqual([]);
      expect(checkSource('fetch( apiUrl ("/api/x"), { method: "GET" })')).toEqual([]);
    });
  });

  describe("ignores things that are not a call to the global fetch()", () => {
    it("ignores handler.fetch(...)", () => {
      expect(checkSource("const response = await handler.fetch(request, env, ctx);")).toEqual([]);
    });

    it("ignores refetch(...) and other identifiers that merely end in fetch", () => {
      expect(checkSource("refetch();")).toEqual([]);
      expect(checkSource("await prefetch(url);")).toEqual([]);
      expect(checkSource("query.fetch(url);")).toEqual([]);
    });

    it("ignores a fetch method defined on an export default object (src/server.ts)", () => {
      const source = [
        "export default {",
        "  async fetch(request, env, ctx) {",
        "    return new Response('ok');",
        "  },",
        "};",
      ].join("\n");

      expect(checkSource(source)).toEqual([]);
    });

    it("ignores a non-async fetch method definition", () => {
      const source = "const server = {\n  fetch(request) {\n    return handle(request);\n  },\n};";

      expect(checkSource(source)).toEqual([]);
    });

    it("ignores a class method named fetch, including static and typed ones", () => {
      expect(checkSource("class A {\n  fetch(input) {\n    return 1;\n  }\n}")).toEqual([]);
      expect(checkSource("class A {\n  static fetch(input) {\n    return 1;\n  }\n}")).toEqual([]);
      expect(
        checkSource(
          "class A {\n  async fetch(input: Request): Promise<Response> {\n    return r;\n  }\n}",
        ),
      ).toEqual([]);
    });

    it("ignores a function declaration named fetch", () => {
      expect(checkSource("function fetch(input) {\n  return input;\n}")).toEqual([]);
      expect(checkSource("async function fetch(input) {\n  return input;\n}")).toEqual([]);
    });

    it("still flags a real call that sits right next to a definition", () => {
      const source = [
        "export default {",
        "  async fetch(request) {",
        "    return fetch(request);",
        "  },",
        "};",
      ].join("\n");

      const violations = checkSource(source);

      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBe(3);
    });

    it("ignores fetch( inside a line comment", () => {
      expect(checkSource('// fetch("/api/tools") is not allowed\nconst x = 1;')).toEqual([]);
    });

    it("ignores fetch( inside a block comment", () => {
      expect(
        checkSource('/*\n * Never call fetch("/api/tools") directly.\n */\nconst x = 1;'),
      ).toEqual([]);
    });

    it("ignores fetch( inside string literals", () => {
      expect(checkSource('const message = "Do not call fetch(url) here";')).toEqual([]);
      expect(checkSource("const message = 'fetch(\"/api/x\") is banned';")).toEqual([]);
      expect(checkSource("const message = `use apiUrl instead of fetch(${path})`;")).toEqual([]);
    });
  });

  it("returns nothing for source with no fetch calls at all", () => {
    expect(checkSource("export const answer = 42;\n")).toEqual([]);
    expect(checkSource("")).toEqual([]);
  });
});

describe("check-api-calls: running the guard", () => {
  it("exits 0 against the real src/ tree", () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("check-api-calls: OK");
  });

  it("does not scan src/ or exit the process when the module is only imported", () => {
    // Importing at the top of this file would already have exited the test
    // run if main() ran on import; assert the export is usable as proof.
    expect(typeof checkSource).toBe("function");
  });
});
