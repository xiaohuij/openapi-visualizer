import { arazzoError, arazzoWarning, type ArazzoDiagnostic } from "./diagnostics";
import type {
  ArazzoDocument,
  ArazzoSourceDescription,
  ArazzoStep,
  ArazzoWorkflow,
} from "./types";
import type { OpenApiOperationCapability } from "../workflow/capability-index";
import type { DocumentRegistry, OpenApiWorkspaceDocument } from "../workflow/document-registry";
import type { OpenApiCapabilityIndex } from "../workflow/capability-index";

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "query",
]);

export interface SourceDescriptionExpressionTarget {
  sourceName: string;
  method?: string;
  path?: string;
  webhook?: boolean;
}

export interface ResolvedSourceDescription {
  source: ArazzoSourceDescription;
  targetDocumentId?: string;
  status: "bound" | "unbound";
}

export type ArazzoStepTarget =
  | {
      kind: "openapi-operation";
      sourceName: string;
      operation: OpenApiOperationCapability;
    }
  | {
      kind: "workflow";
      sourceName?: string;
      workflowId: string;
      targetDocumentId: string;
      workflow: ArazzoWorkflow;
      targetPointer: string;
    }
  | {
      kind: "asyncapi-target";
      sourceName: string;
      reference: string;
      targetDocumentId?: string;
      resolved: boolean;
    }
  | {
      kind: "unresolved";
      reason: string;
    };

export interface ArazzoResolvedStep {
  step: ArazzoStep;
  target: ArazzoStepTarget;
}

export interface ArazzoResolvedWorkflow {
  workflow: ArazzoWorkflow;
  sourceDescriptions: ResolvedSourceDescription[];
  steps: ArazzoResolvedStep[];
}

export interface ArazzoResolution {
  document: ArazzoDocument;
  workflows: ArazzoResolvedWorkflow[];
  diagnostics: ArazzoDiagnostic[];
}

function pointerForPath(path: string, method: string, webhook = false) {
  const escaped = path.replace(/~/g, "~0").replace(/\//g, "~1");
  return webhook ? `#/webhooks/${escaped}/${method}` : `#/paths/${escaped}/${method}`;
}

export function parseSourceDescriptionExpression(value: string): SourceDescriptionExpressionTarget | undefined {
  const match = /^\$sourceDescriptions\.([A-Za-z0-9_-]+)(?:\.([\s\S]+))?$/.exec(value.trim());
  if (!match) return undefined;
  const [, sourceName, remainder = ""] = match;
  if (!remainder) return { sourceName };

  const parts = remainder.split(".");
  if (parts[0] === "paths" || parts[0] === "webhooks") {
    const webhook = parts[0] === "webhooks";
    const methodIndex = parts.findIndex((part, index) => index > 0 && HTTP_METHODS.has(part.toLowerCase()));
    if (methodIndex > 1) {
      return {
        sourceName,
        webhook,
        path: parts.slice(1, methodIndex).join(".") || "/",
        method: parts[methodIndex].toLowerCase(),
      };
    }
  }

  return { sourceName };
}

export function parseWorkflowTargetExpression(value: string) {
  const match = /^\$sourceDescriptions\.([A-Za-z0-9_-]+)(?:\.workflows)?\.([A-Za-z0-9_-]+)$/.exec(value.trim());
  return match ? { sourceName: match[1], workflowId: match[2] } : undefined;
}

function operationIdExpressionSource(value: string) {
  return value.trim().startsWith("$sourceDescriptions.");
}

function sourceDescriptionStatus(
  document: ArazzoDocument,
  registry: DocumentRegistry,
  source: ArazzoSourceDescription,
): ResolvedSourceDescription {
  const resolved = registry.resolveSourceDescription(document.documentId, source.name);
  return {
    source,
    targetDocumentId: resolved?.target.id,
    status: resolved ? "bound" : "unbound",
  };
}

function onlyBoundOpenApiSource(sources: ResolvedSourceDescription[]) {
  const bound = sources.filter((item) => item.status === "bound");
  if (bound.length === 1) return bound[0];
  return undefined;
}

export function resolveArazzoDocument(
  document: ArazzoDocument,
  registry: DocumentRegistry,
  capabilityIndex: OpenApiCapabilityIndex,
): ArazzoResolution {
  const diagnostics: ArazzoDiagnostic[] = [];
  const workflows = document.workflows.map((workflow) => {
    const sources = document.sourceDescriptions.map((source) =>
      sourceDescriptionStatus(document, registry, source),
    );
    const steps = workflow.steps.map((step) => {
      const target = resolveStep(document, registry, capabilityIndex, sources, step, diagnostics);
      return { step, target };
    });
    return { workflow, sourceDescriptions: sources, steps };
  });

  return { document, workflows, diagnostics };
}

function resolveStep(
  document: ArazzoDocument,
  registry: DocumentRegistry,
  capabilityIndex: OpenApiCapabilityIndex,
  sources: ResolvedSourceDescription[],
  step: ArazzoStep,
  diagnostics: ArazzoDiagnostic[],
): ArazzoStepTarget {
  if (step.channelPath) {
    const expression = parseSourceDescriptionExpression(step.channelPath);
    const source = expression
      ? sources.find(item => item.source.name === expression.sourceName)
      : undefined;
    if (!source) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_SOURCE_UNRESOLVED",
          `Channel target references unknown source description "${expression?.sourceName ?? step.channelPath}".`,
          `${step.pointer}/channelPath`,
          document.documentId,
        ),
      );
      return { kind: "unresolved", reason: "Channel source description is not resolvable." };
    }

    return {
      kind: "asyncapi-target",
      sourceName: source.source.name,
      reference: step.channelPath,
      targetDocumentId: source.targetDocumentId,
      resolved: source.status === "bound",
    };
  }

  if (step.workflowId) {
    const local = document.workflows.find((item) => item.workflowId === step.workflowId);
    if (local) {
      return {
        kind: "workflow",
        workflowId: local.workflowId,
        targetDocumentId: document.documentId,
        workflow: local,
        targetPointer: local.pointer,
      };
    }

    const expression = parseWorkflowTargetExpression(step.workflowId);
    const arazzoSource = expression
      ? sources.find(item => item.source.name === expression.sourceName && item.status === "bound")
      : sources.find((item) => item.source.type === "arazzo" && item.status === "bound");
    if (arazzoSource?.targetDocumentId) {
      const target = registry.get(arazzoSource.targetDocumentId);
      const targetWorkflow = target?.kind === "arazzo"
        ? target.document?.workflows.find((item) => item.workflowId === (expression?.workflowId ?? step.workflowId))
        : undefined;
      if (targetWorkflow) {
        return {
          kind: "workflow",
          sourceName: arazzoSource.source.name,
          workflowId: targetWorkflow.workflowId,
          targetDocumentId: arazzoSource.targetDocumentId,
          workflow: targetWorkflow,
          targetPointer: targetWorkflow.pointer,
        };
      }
    }

    diagnostics.push(
      arazzoError(
        "ARAZZO_WORKFLOW_TARGET_UNRESOLVED",
        `Workflow "${step.workflowId}" was not found in this Arazzo document or a bound Arazzo source description.`,
        `${step.pointer}/workflowId`,
        document.documentId,
      ),
    );
    return { kind: "unresolved", reason: "Workflow target not found." };
  }

  if (!step.operationId) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_STEP_TARGET_REQUIRED",
        "A step must reference an operation or workflow.",
        step.pointer,
        document.documentId,
      ),
    );
    return { kind: "unresolved", reason: "Step has no target." };
  }

  const expression = operationIdExpressionSource(step.operationId)
    ? parseSourceDescriptionExpression(step.operationId)
    : undefined;
  const sourceName = expression?.sourceName;
  const source = sourceName
    ? sources.find((item) => item.source.name === sourceName)
    : onlyBoundOpenApiSource(sources);

  if (!source) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_SOURCE_UNRESOLVED",
        sourceName
          ? `Source description "${sourceName}" is not bound to a local document.`
          : "A unique bound OpenAPI source description is required to resolve a literal operationId.",
        `${step.pointer}/operationId`,
        document.documentId,
      ),
    );
    return { kind: "unresolved", reason: "Source description is not resolvable." };
  }

  if (source.status !== "bound" || !source.targetDocumentId) {
    if (source.source.type === "asyncapi") {
      diagnostics.push(
        arazzoWarning(
          "ARAZZO_ASYNC_SOURCE_UNBOUND",
          `AsyncAPI source "${source.source.name}" is not bound to a local document; the step is modeled but cannot be inspected.`,
          source.source.pointer,
          document.documentId,
        ),
      );
      return {
        kind: "asyncapi-target",
        sourceName: source.source.name,
        reference: step.operationId!,
        resolved: false,
      };
    }

    diagnostics.push(
      arazzoError(
        "ARAZZO_SOURCE_UNBOUND",
        `Source description "${source.source.name}" is not bound to a local document.`,
        `#/sourceDescriptions/${document.sourceDescriptions.indexOf(source.source)}`,
        document.documentId,
      ),
    );
    return { kind: "unresolved", reason: "Source description is not bound." };
  }

  const targetDocument = registry.get(source.targetDocumentId);
  if (!targetDocument || targetDocument.kind !== "openapi") {
    diagnostics.push(
      arazzoError(
        "ARAZZO_SOURCE_TYPE_UNSUPPORTED",
        "OpenAPI operation targets require a bound OpenAPI source document.",
        `${step.pointer}/operationId`,
        document.documentId,
      ),
    );
    return { kind: "unresolved", reason: "Target source is not an OpenAPI document." };
  }

  let operation: OpenApiOperationCapability | undefined;
  if (expression?.method && expression.path) {
    operation = capabilityIndex.findByMethodPath(expression.method, expression.path, targetDocument.id);
    if (!operation) {
      operation = capabilityIndex
        .listDocument(targetDocument.id)
        .find((item) => item.pointer === pointerForPath(expression.path!, expression.method!, expression.webhook));
    }
  }
  if (!operation && !expression) {
    operation = capabilityIndex.findByOperationId(step.operationId, targetDocument.id)[0];
  }

  if (!operation) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_OPERATION_UNRESOLVED",
        `Operation target "${step.operationId}" was not found in source "${source.source.name}".`,
        `${step.pointer}/operationId`,
        document.documentId,
      ),
    );
    return { kind: "unresolved", reason: "Operation target not found." };
  }

  return {
    kind: "openapi-operation",
    sourceName: source.source.name,
    operation,
  };
}
