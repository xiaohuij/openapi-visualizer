import YAML from "yaml";
import { arazzoError, hasErrors, type ArazzoDiagnostic } from "./diagnostics";
import type {
  ArazzoComponents,
  ArazzoDocument,
  ArazzoInfo,
  ArazzoParseResult,
  ArazzoRawDocument,
  ArazzoSourceDescription,
  ArazzoSourceDescriptionType,
  ArazzoSpecificationVersion,
  ArazzoStep,
  ArazzoWorkflow,
} from "./types";

const SUPPORTED_ARAZZO_VERSION =
  /^1\.(0|1)\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SOURCE_DESCRIPTION_TYPES = new Set(["openapi", "asyncapi", "arazzo"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function specificationVersion(version: string): ArazzoSpecificationVersion | undefined {
  if (!SUPPORTED_ARAZZO_VERSION.test(version)) return undefined;
  return version.startsWith("1.0.") ? "1.0" : "1.1";
}

function documentId(fileName: string) {
  return `arazzo:${fileName}`;
}

function parseInfo(value: unknown, diagnostics: ArazzoDiagnostic[]) {
  if (!isRecord(value)) {
    if (value !== undefined) {
      diagnostics.push(arazzoError("ARAZZO_INFO_INVALID", "The info field must be an object.", "#/info"));
    }
    return undefined;
  }

  const title = typeof value.title === "string" ? value.title : undefined;
  const version = typeof value.version === "string" ? value.version : undefined;
  if (!title) {
    diagnostics.push(arazzoError("ARAZZO_INFO_TITLE_REQUIRED", "The info object requires a title.", "#/info/title"));
  }
  if (!version) {
    diagnostics.push(arazzoError("ARAZZO_INFO_VERSION_REQUIRED", "The info object requires a version.", "#/info/version"));
  }
  if (!title || !version) return undefined;

  const info: ArazzoInfo = { pointer: "#/info", title, version, ...value };
  return info;
}

function parseSourceDescriptions(
  value: unknown,
  diagnostics: ArazzoDiagnostic[],
): ArazzoSourceDescription[] | undefined {
  if (!isArray(value) || value.length === 0) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_SOURCE_DESCRIPTIONS_REQUIRED",
        "At least one source description is required.",
        "#/sourceDescriptions",
      ),
    );
    return undefined;
  }

  const sourceDescriptions: ArazzoSourceDescription[] = [];
  value.forEach((item, index) => {
    const pointer = `#/sourceDescriptions/${index}`;
    if (!isRecord(item)) {
      diagnostics.push(arazzoError("ARAZZO_SOURCE_DESCRIPTION_INVALID", "A source description must be an object.", pointer));
      return;
    }

    const name = typeof item.name === "string" ? item.name : undefined;
    const type = typeof item.type === "string" && SOURCE_DESCRIPTION_TYPES.has(item.type)
      ? (item.type as ArazzoSourceDescriptionType)
      : undefined;
    if (!name) {
      diagnostics.push(arazzoError("ARAZZO_SOURCE_DESCRIPTION_NAME_REQUIRED", "A source description requires a name.", `${pointer}/name`));
    }
    if (!type) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_SOURCE_DESCRIPTION_TYPE_INVALID",
          "A source description type must be openapi, asyncapi, or arazzo.",
          `${pointer}/type`,
        ),
      );
    }
    if (!name || !type) return;

    sourceDescriptions.push({ pointer, name, type, ...item });
  });

  if (sourceDescriptions.length === 0) return undefined;
  return sourceDescriptions;
}

function parseSteps(value: unknown, workflowPointer: string, diagnostics: ArazzoDiagnostic[]) {
  if (!isArray(value) || value.length === 0) {
    diagnostics.push(
      arazzoError("ARAZZO_STEPS_REQUIRED", "A workflow requires at least one step.", `${workflowPointer}/steps`),
    );
    return undefined;
  }

  const steps: ArazzoStep[] = [];
  value.forEach((item, index) => {
    const pointer = `${workflowPointer}/steps/${index}`;
    if (!isRecord(item)) {
      diagnostics.push(arazzoError("ARAZZO_STEP_INVALID", "A workflow step must be an object.", pointer));
      return;
    }
    const stepId = typeof item.stepId === "string" ? item.stepId : undefined;
    if (!stepId) {
      diagnostics.push(arazzoError("ARAZZO_STEP_ID_REQUIRED", "A workflow step requires a stepId.", `${pointer}/stepId`));
      return;
    }
    steps.push({ pointer, stepId, ...item } as ArazzoStep);
  });

  if (steps.length === 0) return undefined;
  return steps;
}

function parseWorkflows(value: unknown, diagnostics: ArazzoDiagnostic[]) {
  if (!isArray(value) || value.length === 0) {
    diagnostics.push(
      arazzoError("ARAZZO_WORKFLOWS_REQUIRED", "At least one workflow is required.", "#/workflows"),
    );
    return undefined;
  }

  const workflows: ArazzoWorkflow[] = [];
  value.forEach((item, index) => {
    const pointer = `#/workflows/${index}`;
    if (!isRecord(item)) {
      diagnostics.push(arazzoError("ARAZZO_WORKFLOW_INVALID", "A workflow must be an object.", pointer));
      return;
    }
    const workflowId = typeof item.workflowId === "string" ? item.workflowId : undefined;
    if (!workflowId) {
      diagnostics.push(arazzoError("ARAZZO_WORKFLOW_ID_REQUIRED", "A workflow requires a workflowId.", `${pointer}/workflowId`));
      return;
    }

    const steps = parseSteps(item.steps, pointer, diagnostics);
    if (!steps) return;
    workflows.push({ ...item, pointer, workflowId, steps } as ArazzoWorkflow);
  });

  if (workflows.length === 0) return undefined;
  return workflows;
}

function parseComponents(value: unknown): ArazzoComponents | undefined {
  return isRecord(value) ? (value as ArazzoComponents) : undefined;
}

export function parseArazzoSource(sourceText: string, fileName: string): ArazzoParseResult {
  const diagnostics: ArazzoDiagnostic[] = [];

  let parsed: unknown;
  try {
    parsed = YAML.parse(sourceText, { prettyErrors: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push(arazzoError("ARAZZO_PARSE_FAILED", `Unable to parse Arazzo YAML/JSON: ${message}`));
    return { diagnostics };
  }

  if (!isRecord(parsed)) {
    diagnostics.push(arazzoError("ARAZZO_ROOT_INVALID", "An Arazzo document must be a YAML/JSON object."));
    return { diagnostics };
  }

  const raw = parsed as ArazzoRawDocument;
  const version = typeof raw.arazzo === "string" ? raw.arazzo : undefined;
  if (!version) {
    diagnostics.push(arazzoError("ARAZZO_VERSION_REQUIRED", "The arazzo version field is required.", "#/arazzo"));
    return { diagnostics };
  }

  const normalizedVersion = specificationVersion(version);
  if (!normalizedVersion) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_VERSION_UNSUPPORTED",
        `Unsupported Arazzo version "${version}". Supported versions are 1.0.x and 1.1.x.`,
        "#/arazzo",
      ),
    );
    return { diagnostics };
  }

  const info = parseInfo(raw.info, diagnostics);
  const sourceDescriptions = parseSourceDescriptions(raw.sourceDescriptions, diagnostics);
  const workflows = parseWorkflows(raw.workflows, diagnostics);

  if (!info || !sourceDescriptions || !workflows || hasErrors(diagnostics)) {
    return { diagnostics };
  }

  const document: ArazzoDocument = {
    documentId: documentId(fileName),
    fileName,
    sourceText,
    version,
    specificationVersion: normalizedVersion,
    self: typeof raw.$self === "string" ? raw.$self : undefined,
    info,
    sourceDescriptions,
    workflows,
    components: parseComponents(raw.components),
    raw,
  };

  return { document, diagnostics };
}
