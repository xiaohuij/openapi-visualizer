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
import { AsyncApiCapabilityIndex, type AsyncApiOperationCapability } from "../workflow/asyncapi-capability-index";

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
  reference?: string;
  method?: string;
  path?: string;
  webhook?: boolean;
}

export type SourceDescriptionPointerContainer = "paths" | "webhooks" | "channels" | "operations";

export interface SourceDescriptionPointerTarget {
  sourceName: string;
  container: SourceDescriptionPointerContainer;
  /** Raw JSON Pointer (starting with `/`) resolved from either expression form. */
  pointer: string;
  segments: string[];
  /** OpenAPI path or webhook name (without the method segment). */
  path?: string;
  method?: string;
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
      operation?: AsyncApiOperationCapability;
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

  return { sourceName, reference: remainder };
}

function decodePointer(pointer: string) {
  return pointer
    .split("/")
    .filter(segment => segment.length > 0)
    .map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function encodePointer(segments: readonly string[]) {
  return `/${segments.map(segment => segment.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

/**
 * Parses both standard `operationPath`/`channelPath` forms:
 *
 * - Dot form: `$sourceDescriptions.<name>.paths./pets/{id}.get`
 * - URL-interpolation + JSON Pointer form:
 *   `{$sourceDescriptions.<name>.url}#/paths/~1pets~1{id}/get`
 */
export function parseSourceDescriptionPointer(value: string): SourceDescriptionPointerTarget | undefined {
  const trimmed = value.trim();

  const urlPointerMatch = /^\{\$sourceDescriptions\.([A-Za-z0-9_-]+)\.url\}#(\/.*)$/.exec(trimmed);
  if (urlPointerMatch) {
    const [, sourceName, pointer] = urlPointerMatch;
    const segments = decodePointer(pointer);
    const container = segments[0];
    if (container === "paths" || container === "webhooks" || container === "channels" || container === "operations") {
    const rest = segments.slice(1);
    const method = rest.at(-1);
    if ((container === "paths" || container === "webhooks") && method && HTTP_METHODS.has(method.toLowerCase())) {
      const joined = rest.slice(0, -1).join("/");
      return {
        sourceName,
        container,
        pointer,
        segments: rest,
        path: container === "paths" && !joined.startsWith("/") ? `/${joined}` : joined,
        method: method.toLowerCase(),
      };
    }
    return { sourceName, container, pointer, segments: rest };
    }
    return undefined;
  }

  const dotMatch = /^\$sourceDescriptions\.([A-Za-z0-9_-]+)\.(paths|webhooks|channels|operations)\.([\s\S]+)$/.exec(trimmed);
  if (dotMatch) {
    const [, sourceName, container, remainder] = dotMatch;
    const segments = remainder.split(".");
    const containerKind = container as SourceDescriptionPointerContainer;
    if (containerKind === "paths" || containerKind === "webhooks") {
      const methodIndex = segments.findIndex(segment => HTTP_METHODS.has(segment.toLowerCase()));
      if (methodIndex > 0) {
        return {
          sourceName,
          container: containerKind,
          pointer: encodePointer([container, ...segments]),
          segments,
          path: segments.slice(0, methodIndex).join(".") || "/",
          method: segments[methodIndex].toLowerCase(),
        };
      }
    }
    return { sourceName, container: containerKind, pointer: encodePointer([containerKind, ...segments]), segments };
  }

  return undefined;
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

const ASYNC_ACTIONS = new Set(["send", "receive", "publish", "subscribe"]);

function onlyBoundOperationSource(sources: ResolvedSourceDescription[]) {
  const bound = sources.filter((item) => item.status === "bound" && item.source.type !== "arazzo");
  if (bound.length === 1) return bound[0];
  return undefined;
}

function asyncChannelOperation(
  pointer: SourceDescriptionPointerTarget,
  asyncIndex: AsyncApiCapabilityIndex,
  documentId: string,
  step: ArazzoStep,
): AsyncApiOperationCapability | undefined {
  if (pointer.container === "operations") {
    return asyncIndex.findByOperationId(pointer.segments.join("."), documentId)[0];
  }
  if (pointer.container !== "channels") return undefined;

  const last = pointer.segments.at(-1);
  const actionLike = last !== undefined && ASYNC_ACTIONS.has(last.toLowerCase());
  const channelId = actionLike && last
    ? pointer.segments.slice(0, -1).join("/")
    : pointer.segments.join("/");

  if (actionLike && last) {
    return asyncIndex.findByChannelAction(channelId, last, documentId);
  }
  const candidates = asyncIndex.listDocument(documentId).filter(operation => operation.channelId === channelId);
  if (step.action) {
    const byAction = candidates.find(operation =>
      operation.action === step.action || operation.normalizedAction === step.action,
    );
    if (byAction) return byAction;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function resolveArazzoDocument(
  document: ArazzoDocument,
  registry: DocumentRegistry,
  capabilityIndex: OpenApiCapabilityIndex,
  asyncApiIndex: AsyncApiCapabilityIndex = new AsyncApiCapabilityIndex([]),
): ArazzoResolution {
  const diagnostics: ArazzoDiagnostic[] = [];
  const workflows = document.workflows.map((workflow) => {
    const sources = document.sourceDescriptions.map((source) =>
      sourceDescriptionStatus(document, registry, source),
    );
    const steps = workflow.steps.map((step) => {
      const target = resolveStep(document, registry, capabilityIndex, asyncApiIndex, sources, step, diagnostics);
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
  asyncApiIndex: AsyncApiCapabilityIndex,
  sources: ResolvedSourceDescription[],
  step: ArazzoStep,
  diagnostics: ArazzoDiagnostic[],
): ArazzoStepTarget {
  if (step.channelPath) {
    const pointer = parseSourceDescriptionPointer(step.channelPath);
    const expression = parseSourceDescriptionExpression(step.channelPath);
    const sourceName = pointer?.sourceName ?? expression?.sourceName;
    const source = sourceName
      ? sources.find(item => item.source.name === sourceName)
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

    if (source.status === "bound" && source.targetDocumentId) {
      const targetDocument = registry.get(source.targetDocumentId);
      if (targetDocument?.kind === "asyncapi" && pointer) {
        const operation = asyncChannelOperation(pointer, asyncApiIndex, targetDocument.id, step);
        if (operation) {
          return {
            kind: "asyncapi-target",
            sourceName: source.source.name,
            reference: step.channelPath,
            targetDocumentId: targetDocument.id,
            resolved: true,
            operation,
          };
        }
        diagnostics.push(
          arazzoError(
            "ARAZZO_CHANNEL_UNRESOLVED",
            `Channel target "${step.channelPath}" was not found in bound AsyncAPI source "${source.source.name}".`,
            `${step.pointer}/channelPath`,
            document.documentId,
          ),
        );
        return {
          kind: "asyncapi-target",
          sourceName: source.source.name,
          reference: step.channelPath,
          targetDocumentId: targetDocument.id,
          resolved: false,
        };
      }
      if (!pointer) {
        diagnostics.push(
          arazzoError(
            "ARAZZO_CHANNEL_TARGET_INVALID",
            "channelPath must use a $sourceDescriptions runtime expression with a channels or operations JSON Pointer.",
            `${step.pointer}/channelPath`,
            document.documentId,
          ),
        );
        return { kind: "unresolved", reason: "Channel target expression is invalid." };
      }
      if (targetDocument && targetDocument.kind !== "asyncapi") {
        diagnostics.push(
          arazzoError(
            "ARAZZO_SOURCE_TYPE_UNSUPPORTED",
            "Channel targets require a bound AsyncAPI source document.",
            `${step.pointer}/channelPath`,
            document.documentId,
          ),
        );
        return { kind: "unresolved", reason: "Target source is not an AsyncAPI document." };
      }
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

  const operationReference = step.operationPath ?? step.operationId;
  if (!operationReference) {
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

  const pointerExpression = step.operationPath !== undefined
    ? parseSourceDescriptionPointer(step.operationPath)
    : undefined;
  if (step.operationPath !== undefined && !pointerExpression) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_OPERATION_PATH_INVALID",
        "operationPath must use a $sourceDescriptions runtime expression with a paths, webhooks, channels, or operations JSON Pointer.",
        `${step.pointer}/operationPath`,
        document.documentId,
      ),
    );
    return { kind: "unresolved", reason: "Operation path expression is invalid." };
  }

  const expression = !step.operationPath && operationIdExpressionSource(operationReference)
    ? parseSourceDescriptionExpression(operationReference)
    : undefined;
  const sourceName = pointerExpression?.sourceName ?? expression?.sourceName;
  const targetField = step.operationPath !== undefined ? "operationPath" : "operationId";
  const source = sourceName
    ? sources.find((item) => item.source.name === sourceName)
    : onlyBoundOperationSource(sources);

  if (!source) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_SOURCE_UNRESOLVED",
        sourceName
          ? `Source description "${sourceName}" is not bound to a local document.`
          : "A unique bound OpenAPI or AsyncAPI source description is required to resolve a literal operationId.",
        `${step.pointer}/${targetField}`,
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
        reference: operationReference,
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
  if (source.source.type === "asyncapi") {
    if (!targetDocument || targetDocument.kind !== "asyncapi") {
      diagnostics.push(
        arazzoError(
          "ARAZZO_SOURCE_TYPE_UNSUPPORTED",
          "AsyncAPI operation targets require a bound AsyncAPI source document.",
          `${step.pointer}/${targetField}`,
          document.documentId,
        ),
      );
      return { kind: "unresolved", reason: "Target source is not an AsyncAPI document." };
    }

    const operation = pointerExpression
      ? asyncChannelOperation(pointerExpression, asyncApiIndex, targetDocument.id, step)
      : asyncApiIndex.findByOperationId(expression?.reference ?? operationReference, targetDocument.id)[0];
    if (!operation) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_ASYNC_OPERATION_UNRESOLVED",
          `AsyncAPI operation target "${operationReference}" was not found in source "${source.source.name}".`,
          `${step.pointer}/${targetField}`,
          document.documentId,
        ),
      );
      return {
        kind: "asyncapi-target",
        sourceName: source.source.name,
        reference: operationReference,
        targetDocumentId: targetDocument.id,
        resolved: false,
      };
    }

    return {
      kind: "asyncapi-target",
      sourceName: source.source.name,
      reference: operationReference,
      targetDocumentId: targetDocument.id,
      resolved: true,
      operation,
    };
  }

  if (!targetDocument || targetDocument.kind !== "openapi") {
    diagnostics.push(
      arazzoError(
        "ARAZZO_SOURCE_TYPE_UNSUPPORTED",
        "OpenAPI operation targets require a bound OpenAPI source document.",
        `${step.pointer}/${targetField}`,
        document.documentId,
      ),
    );
    return { kind: "unresolved", reason: "Target source is not an OpenAPI document." };
  }

  let operation: OpenApiOperationCapability | undefined;
  const methodPath = pointerExpression?.method && pointerExpression.path
    ? { method: pointerExpression.method, path: pointerExpression.path, webhook: pointerExpression.container === "webhooks" }
    : expression?.method && expression.path
      ? { method: expression.method, path: expression.path, webhook: expression.webhook }
      : undefined;
  if (methodPath) {
    operation = capabilityIndex.findByMethodPath(methodPath.method, methodPath.path, targetDocument.id);
    if (!operation) {
      operation = capabilityIndex
        .listDocument(targetDocument.id)
        .find((item) => item.pointer === pointerForPath(methodPath.path!, methodPath.method!, methodPath.webhook));
    }
  }
  if (!operation && !pointerExpression) {
    operation = capabilityIndex.findByOperationId(expression?.reference ?? operationReference, targetDocument.id)[0];
  }
  if (!operation && pointerExpression) {
    operation = capabilityIndex.findByPointer(`#${pointerExpression.pointer}`, targetDocument.id);
  }

  if (!operation) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_OPERATION_UNRESOLVED",
        `Operation target "${operationReference}" was not found in source "${source.source.name}".`,
        `${step.pointer}/${targetField}`,
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
