import { arazzoError, arazzoInfo, type ArazzoDiagnostic } from "./diagnostics";
import type { ArazzoSpecificationVersion } from "./types";

interface HyperjumpOutputNode {
  valid: boolean;
  keyword?: string;
  keywordLocation?: string;
  absoluteKeywordLocation?: string;
  instanceLocation?: string;
  errors?: HyperjumpOutputNode[];
}

type HyperjumpValidator = (value: unknown, options?: unknown) => HyperjumpOutputNode;

interface HyperjumpCore {
  registerSchema(schema: unknown, retrievalUri: string): void;
  validate(uri: string): Promise<HyperjumpValidator>;
}

const BASIC = "BASIC";
const MAX_SCHEMA_DIAGNOSTICS = 20;
const MESSAGES_PER_LOCATION = 3;

const validatorCache = new Map<ArazzoSpecificationVersion, Promise<HyperjumpValidator>>();

async function loadValidator(version: ArazzoSpecificationVersion) {
  if (!validatorCache.has(version)) {
    validatorCache.set(
      version,
      (async () => {
        const [{ default: schema }, coreModule] = await Promise.all([
          version === "1.1"
            ? import("./schemas/arazzo-1.1.schema.json")
            : import("./schemas/arazzo-1.0.schema.json"),
          import("@hyperjump/json-schema") as Promise<HyperjumpCore & Record<string, unknown>>,
        ]);
        await import("@hyperjump/json-schema/draft-2020-12");
        const core = coreModule as unknown as HyperjumpCore;
        const id = typeof schema.$id === "string" ? schema.$id : `https://openapi-visualizer.local/arazzo/${version}/schema`;
        core.registerSchema(schema, id);
        return core.validate(id);
      })(),
    );
  }
  return validatorCache.get(version)!;
}

function flattenErrors(node: HyperjumpOutputNode, output: HyperjumpOutputNode[] = []) {
  if (node.valid) return output;
  if (node.keyword && node.instanceLocation) output.push(node);
  for (const error of node.errors ?? []) flattenErrors(error, output);
  return output;
}

function resolveSchemaFragment(schema: unknown, fragment: string | undefined) {
  if (!fragment || !fragment.startsWith("/")) return undefined;
  let current: unknown = schema;
  for (const rawSegment of fragment.slice(1).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveInstanceFragment(instance: unknown, pointer: string | undefined) {
  if (!pointer || pointer === "#") return instance;
  if (!pointer.startsWith("#/")) return undefined;
  let current: unknown = instance;
  for (const rawSegment of pointer.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function keywordName(keyword: string | undefined) {
  return keyword?.split("/").pop() ?? "unknown";
}

function list(values: readonly string[]) {
  return values.length <= 3 ? values.join(", ") : `${values.slice(0, 3).join(", ")}, …`;
}

function messageForError(
  schema: unknown,
  error: HyperjumpOutputNode,
  instance: unknown,
) {
  const name = keywordName(error.keyword);
  const fragment = error.absoluteKeywordLocation?.split("#")[1];
  const keywordSchema = resolveSchemaFragment(schema, fragment);
  const target = resolveInstanceFragment(instance, error.instanceLocation);

  switch (name) {
    case "type":
      return Array.isArray(keywordSchema)
        ? `value must be ${keywordSchema.join(" or ")}`
        : `value must be of type ${String(keywordSchema)}`;
    case "required": {
      const required = Array.isArray(keywordSchema) ? keywordSchema.map(String) : [];
      const record = typeof target === "object" && target !== null && !Array.isArray(target)
        ? target as Record<string, unknown>
        : {};
      const missing = required.filter(property => !(property in record));
      return missing.length > 0
        ? `missing required propert${missing.length > 1 ? "ies" : "y"} ${list(missing)}`
        : "a required property is missing";
    }
    case "pattern":
      return `value must match pattern ${String(keywordSchema)}`;
    case "enum":
      return `value must be one of ${JSON.stringify(keywordSchema)}`;
    case "const":
      return `value must equal ${JSON.stringify(keywordSchema)}`;
    case "minItems":
      return `array must contain at least ${String(keywordSchema)} item(s)`;
    case "maxItems":
      return `array must contain at most ${String(keywordSchema)} item(s)`;
    case "uniqueItems":
      return "array items must be unique";
    case "minLength":
      return `string must contain at least ${String(keywordSchema)} character(s)`;
    case "maxLength":
      return `string must contain at most ${String(keywordSchema)} character(s)`;
    case "minProperties":
      return `object must contain at least ${String(keywordSchema)} propert${keywordSchema === 1 ? "y" : "ies"}`;
    case "format":
      return `value must match format ${String(keywordSchema)}`;
    case "unevaluatedProperties":
      return "object contains properties that the schema does not allow";
    case "anyOf":
    case "oneOf":
      return "value does not match any allowed shape";
    default:
      return `value failed the ${name} constraint`;
  }
}

/**
 * Validates the raw Arazzo document against the vendored official JSON Schema.
 * The hand-written validator remains responsible for semantic and product
 * rules; this closes structural edge cases at schema fidelity.
 */
export async function validateArazzoSchemaStructure(
  instance: unknown,
  version: ArazzoSpecificationVersion,
  documentId?: string,
): Promise<ArazzoDiagnostic[]> {
  try {
    const validator = await loadValidator(version);
    const output = validator(instance, BASIC);
    if (output.valid) return [];

    const schemaModule = version === "1.1"
      ? await import("./schemas/arazzo-1.1.schema.json")
      : await import("./schemas/arazzo-1.0.schema.json");
    const errors = flattenErrors(output);
    const byLocation = new Map<string, string[]>();
    for (const error of errors) {
      const location = error.instanceLocation ?? "#";
      byLocation.set(location, [
        ...(byLocation.get(location) ?? []),
        messageForError(schemaModule.default, error, instance),
      ]);
    }

    const locations = [...byLocation.entries()];
    const diagnostics: ArazzoDiagnostic[] = locations.slice(0, MAX_SCHEMA_DIAGNOSTICS).map(
      ([location, messages]) => arazzoError(
        "ARAZZO_SCHEMA_INVALID",
        [...new Set(messages)].slice(0, MESSAGES_PER_LOCATION).join("; "),
        location,
        documentId,
      ),
    );
    if (locations.length > MAX_SCHEMA_DIAGNOSTICS) {
      diagnostics.push(
        arazzoInfo(
          "ARAZZO_SCHEMA_INVALID_TRUNCATED",
          `${locations.length - MAX_SCHEMA_DIAGNOSTICS} additional schema locations were not shown.`,
          "#",
          documentId,
        ),
      );
    }
    return diagnostics;
  } catch (error) {
    return [
      arazzoError(
        "ARAZZO_SCHEMA_VALIDATION_FAILED",
        `Schema validation could not run: ${error instanceof Error ? error.message : String(error)}`,
        "#",
        documentId,
      ),
    ];
  }
}
