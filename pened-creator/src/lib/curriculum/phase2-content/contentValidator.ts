
import type { ToolInputSchema } from "../shared/apiClient";
import type { Tool } from "@/lib/tools/toolsClient";
import { SLIDESHOW_TOOL_ID } from "./slideshowInteractiveContent";

/**
 * Validates a parsed AI response against the live tool registry (see
 * @/lib/tools/toolsClient.ts's getTools(), GET /api/tools) - the same
 * TOOL REGISTRY data ./promptBuilder.ts puts in the prompt and the Tool
 * Registry page displays. The caller fetches that list and passes it in
 * (see components/curriculum/phase2-content/PasteResponseForm.tsx); this
 * module no longer resolves tools against a static in-repo registry.
 *
 * Expected top-level shape (see ./promptBuilder.ts's output contract):
 *   [
 *     { "tool": "<tool id>", "data": { ...fields matching that tool's inputSchema... } },
 *     ...
 *   ]
 *
 * Produces block-indexed, field-level errors so the UI can point the user
 * at exactly which block/field is wrong, rather than a single pass/fail flag.
 *
 * TS port of contentBuilder's src/tools/contentValidator.js, resolving
 * tools against the caller-supplied tool list instead of a relative
 * import into contentBuilder.
 */

export interface ContentError {
  blockIndex: number;
  path: string;
  message: string;
}

/**
 * Schema for the "slide" object required on every content block (see
 * ./promptBuilder.ts's output contract) — the slide-authoring hints used
 * later to assemble a slideshow deck from this same generated content,
 * without a separate generation pass.
 */
const SLIDE_SCHEMA: ToolInputSchema = {
  type: "object",
  required: ["durationSeconds", "transition", "background"],
  properties: {
    durationSeconds: { type: "number" },
    transition: { type: "string", enum: ["fade", "slide", "cut"] },
    background: { type: "string", enum: ["light", "dark", "image"] },
  },
};

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Minimal JSON Schema validator supporting the subset of schema features
 * used by registered tools' inputSchema: type ("object" | "array" | "string"),
 * required, properties, items, minItems, additionalProperties, enum.
 *
 * Not a general-purpose JSON Schema implementation — only what's needed
 * to validate presentation tool inputSchemas.
 *
 * @param value
 * @param schema
 * @param path - dotted path for error reporting (e.g. "data.headline")
 * @param errors - accumulator, mutated in place
 * @param blockIndex
 */
function validateAgainstSchema(
  value: unknown,
  schema: ToolInputSchema | undefined,
  path: string,
  errors: ContentError[],
  blockIndex: number,
): void {
  if (!schema || typeof schema !== "object") {
    return;
  }

  if (schema.type) {
    const actualType = typeOf(value);
    const expectedType = schema.type;

    const typeMatches =
      expectedType === actualType || (expectedType === "object" && actualType === "object");

    if (!typeMatches) {
      errors.push({
        blockIndex,
        path,
        message: `"${path}" must be of type ${expectedType}, got ${actualType}.`,
      });
      return; // no point checking deeper if the base type is wrong
    }
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value as string)) {
      errors.push({
        blockIndex,
        path,
        message: `"${path}" must be one of: ${schema.enum.join(", ")}.`,
      });
    }
  }

  if (
    schema.type === "object" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const objectValue = value as Record<string, unknown>;
    const properties = (schema.properties as Record<string, ToolInputSchema>) || {};
    const required = schema.required || [];

    for (const key of required) {
      if (!(key in objectValue)) {
        errors.push({
          blockIndex,
          path: path ? `${path}.${key}` : key,
          message: `"${path ? `${path}.${key}` : key}" is required.`,
        });
      }
    }

    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in objectValue) {
        const childPath = path ? `${path}.${key}` : key;
        validateAgainstSchema(objectValue[key], propSchema, childPath, errors, blockIndex);
      }
    }

    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(properties));
      for (const key of Object.keys(objectValue)) {
        if (!allowedKeys.has(key)) {
          errors.push({
            blockIndex,
            path: path ? `${path}.${key}` : key,
            message: `"${path ? `${path}.${key}` : key}" is not a recognized field for this tool.`,
          });
        }
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push({
        blockIndex,
        path,
        message: `"${path}" must contain at least ${schema.minItems} item(s).`,
      });
    }

    if (schema.items) {
      value.forEach((item, index) => {
        validateAgainstSchema(item, schema.items as ToolInputSchema, `${path}[${index}]`, errors, blockIndex);
      });
    }
  }
}

/**
 * Validates a single content block ({ tool, data }) against the supplied
 * tool registry, resolving the referenced tool and checking its data
 * payload.
 *
 * @param block
 * @param blockIndex
 * @param errors - accumulator, mutated in place
 * @param tools - the live registry to resolve "tool" ids against (see
 *   @/lib/tools/toolsClient.ts's getTools())
 */
function validateBlock(
  block: unknown,
  blockIndex: number,
  errors: ContentError[],
  tools: Tool[],
): void {
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    errors.push({
      blockIndex,
      path: "",
      message: `Block ${blockIndex} must be an object with "tool" and "data" fields.`,
    });
    return;
  }

  const blockObject = block as { tool?: unknown; data?: unknown };

  if (typeof blockObject.tool !== "string" || !blockObject.tool) {
    errors.push({
      blockIndex,
      path: "tool",
      message: `Block ${blockIndex} is missing a valid "tool" id.`,
    });
    return;
  }

  if (blockObject.tool === SLIDESHOW_TOOL_ID) {
    errors.push({
      blockIndex,
      path: "tool",
      message: `Block ${blockIndex} references the "${SLIDESHOW_TOOL_ID}" tool, which cannot be authored as a content block. Slideshow decks are assembled automatically from the other blocks' slide hints - remove this block from the response.`,
    });
    return;
  }

  const toolDef = tools.find((tool) => tool.id === blockObject.tool);
  if (!toolDef) {
    errors.push({
      blockIndex,
      path: "tool",
      message: `Block ${blockIndex} references unknown tool "${blockObject.tool}". It is not present in the tool registry.`,
    });
    return;
  }

  if (
    !("data" in blockObject) ||
    blockObject.data === null ||
    typeof blockObject.data !== "object" ||
    Array.isArray(blockObject.data)
  ) {
    errors.push({
      blockIndex,
      path: "data",
      message: `Block ${blockIndex} ("${blockObject.tool}") is missing a valid "data" object.`,
    });
    return;
  }

  validateAgainstSchema(blockObject.data, toolDef.inputSchema as ToolInputSchema, "data", errors, blockIndex);

  if (
    !("slide" in blockObject) ||
    (blockObject as { slide?: unknown }).slide === null ||
    typeof (blockObject as { slide?: unknown }).slide !== "object" ||
    Array.isArray((blockObject as { slide?: unknown }).slide)
  ) {
    errors.push({
      blockIndex,
      path: "slide",
      message: `Block ${blockIndex} ("${blockObject.tool}") is missing a valid "slide" object.`,
    });
    return;
  }

  validateAgainstSchema((blockObject as { slide?: unknown }).slide, SLIDE_SCHEMA, "slide", errors, blockIndex);
}

/**
 * Validates a full parsed AI response: must be a non-empty array of
 * { tool, data } blocks, each resolvable against the supplied tool
 * registry and conforming to that tool's inputSchema.
 *
 * @param parsedResponse - the result of JSON.parse on the pasted AI response
 * @param tools - the live tool registry to validate against (see
 *   @/lib/tools/toolsClient.ts's getTools())
 */
export function validateGeneratedContent(
  parsedResponse: unknown,
  tools: Tool[],
): {
  valid: boolean;
  errors: ContentError[];
} {
  const errors: ContentError[] = [];

  if (!Array.isArray(parsedResponse)) {
    return {
      valid: false,
      errors: [{ blockIndex: -1, path: "", message: "The AI response must be a JSON array of content blocks." }],
    };
  }

  if (parsedResponse.length === 0) {
    return {
      valid: false,
      errors: [{ blockIndex: -1, path: "", message: "The AI response must contain at least one content block." }],
    };
  }

  parsedResponse.forEach((block, index) => {
    validateBlock(block, index, errors, tools);
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Formats a list of content errors into a single human-readable string,
 * prefixing each with its block index for context.
 *
 * @param errors
 */
export function formatContentErrors(errors: ContentError[]): string {
  return errors
    .map((error) => (error.blockIndex >= 0 ? `Block ${error.blockIndex}: ${error.message}` : error.message))
    .join("\n");
}