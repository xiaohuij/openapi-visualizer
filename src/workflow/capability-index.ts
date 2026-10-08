import { isRecord } from "../lib/utils";
import type { VisualNodeModel } from "../types";
import type { OpenApiWorkspaceDocument } from "./document-registry";

export interface OpenApiContentCapability {
  contentType: string;
  value: unknown;
}

export interface OpenApiParameterCapability {
  name?: string;
  in?: string;
  required: boolean;
  deprecated: boolean;
  schema: unknown;
  content: OpenApiContentCapability[];
  nodeId?: string;
  pointer: string;
}

export interface OpenApiRequestBodyCapability {
  required: boolean;
  content: OpenApiContentCapability[];
  nodeId: string;
  pointer: string;
  value: unknown;
}

export interface OpenApiResponseCapability {
  status: string;
  description?: string;
  content: OpenApiContentCapability[];
  nodeId: string;
  pointer: string;
  value: unknown;
}

export interface OpenApiOperationCapability {
  documentId: string;
  sourceName: string;
  operationId?: string;
  path: string;
  method: string;
  webhook: boolean;
  title: string;
  summary?: string;
  description?: string;
  deprecated: boolean;
  nodeId: string;
  pointer: string;
  value: unknown;
  parameters: OpenApiParameterCapability[];
  requestBody?: OpenApiRequestBodyCapability;
  responses: OpenApiResponseCapability[];
}

function contentEntries(value: unknown) {
  if (!isRecord(value) || !isRecord(value.content)) return [];
  return Object.entries(value.content).map(([contentType, contentValue]) => ({
    contentType,
    value: contentValue,
  }));
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function parameterCapability(model: VisualNodeModel): OpenApiParameterCapability {
  const value = isRecord(model.value) ? model.value : {};
  return {
    name: text(value.name) ?? text(model.metadata.name),
    in: text(value.in) ?? text(model.metadata.in),
    required: value.required === true || model.metadata.required === true,
    deprecated: value.deprecated === true || model.metadata.deprecated === true,
    schema: value.schema,
    content: contentEntries(value),
    nodeId: model.id,
    pointer: model.pointer,
  };
}

function requestBodyCapability(model: VisualNodeModel): OpenApiRequestBodyCapability {
  const value = isRecord(model.value) ? model.value : {};
  return {
    required: value.required === true,
    content: contentEntries(value),
    nodeId: model.id,
    pointer: model.pointer,
    value,
  };
}

function responseCapability(model: VisualNodeModel): OpenApiResponseCapability {
  const value = isRecord(model.value) ? model.value : {};
  return {
    status: text(model.metadata.status) ?? model.title,
    description: text(value.description),
    content: contentEntries(value),
    nodeId: model.id,
    pointer: model.pointer,
    value,
  };
}

function operationCapabilities(entry: OpenApiWorkspaceDocument) {
  const operations: OpenApiOperationCapability[] = [];
  const outgoing = new Map<string, VisualNodeModel[]>();

  for (const edge of entry.document.edges) {
    if (edge.source === edge.target) continue;
    const targets = outgoing.get(edge.source) ?? [];
    const target = entry.document.models.get(edge.target);
    if (target) targets.push(target);
    outgoing.set(edge.source, targets);
  }

  for (const model of entry.document.models.values()) {
    if (model.kind !== "operation") continue;
    const value = isRecord(model.value) ? model.value : {};
    const path = text(model.metadata.path) ?? "";
    const method = text(model.metadata.method) ?? "";
    const children = outgoing.get(model.id) ?? [];

    operations.push({
      documentId: entry.id,
      sourceName: entry.fileName,
      operationId: text(value.operationId) ?? text(model.metadata.operationId),
      path,
      method,
      webhook: model.metadata.webhook === true,
      title: model.title,
      summary: text(value.summary),
      description: text(value.description),
      deprecated: model.metadata.deprecated === true,
      nodeId: model.id,
      pointer: model.pointer,
      value,
      parameters: children
        .filter((child) => child.kind === "parameter")
        .map(parameterCapability),
      requestBody: children
        .filter((child) => child.kind === "requestBody")
        .map(requestBodyCapability)[0],
      responses: children
        .filter((child) => child.kind === "response")
        .map(responseCapability),
    });
  }

  return operations;
}

export class OpenApiCapabilityIndex {
  readonly operations: OpenApiOperationCapability[];
  private readonly byOperationId = new Map<string, OpenApiOperationCapability[]>();
  private readonly byDocumentAndOperationId = new Map<string, OpenApiOperationCapability[]>();
  private readonly byDocumentMethodPath = new Map<string, OpenApiOperationCapability>();

  constructor(documents: readonly OpenApiWorkspaceDocument[]) {
    this.operations = documents.flatMap(operationCapabilities);
    for (const operation of this.operations) {
      if (operation.operationId) {
        const idKey = operation.operationId.toLowerCase();
        this.byOperationId.set(idKey, [
          ...(this.byOperationId.get(idKey) ?? []),
          operation,
        ]);
        const documentKey = `${operation.documentId}|${idKey}`;
        this.byDocumentAndOperationId.set(documentKey, [
          ...(this.byDocumentAndOperationId.get(documentKey) ?? []),
          operation,
        ]);
      }
      this.byDocumentMethodPath.set(
        `${operation.documentId}|${operation.method.toUpperCase()}|${operation.path}`,
        operation,
      );
    }
  }

  findByOperationId(operationId: string, documentId?: string) {
    const key = operationId.toLowerCase();
    if (documentId) {
      return this.byDocumentAndOperationId.get(`${documentId}|${key}`) ?? [];
    }
    return this.byOperationId.get(key) ?? [];
  }

  findByMethodPath(method: string, path: string, documentId: string) {
    return this.byDocumentMethodPath.get(`${documentId}|${method.toUpperCase()}|${path}`);
  }

  listDocument(documentId: string) {
    return this.operations.filter((operation) => operation.documentId === documentId);
  }
}
