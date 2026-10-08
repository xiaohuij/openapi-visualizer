import type { ArazzoDiagnostic } from "../arazzo/diagnostics";

export type AsyncApiSpecificationVersion = "2" | "3";

export type AsyncApiOperationAction = "send" | "receive" | "publish" | "subscribe";

export interface AsyncApiInfo {
  pointer: string;
  title: string;
  version: string;
  description?: string;
}

export interface AsyncApiMessage {
  messageId?: string;
  name: string;
  title?: string;
  summary?: string;
  contentType?: string;
  payload?: unknown;
  headers?: unknown;
  pointer: string;
  value: unknown;
}

export interface AsyncApiOperation {
  operationId?: string;
  action: AsyncApiOperationAction;
  channelId: string;
  summary?: string;
  description?: string;
  deprecated: boolean;
  pointer: string;
  value: unknown;
  messages: AsyncApiMessage[];
}

export interface AsyncApiChannel {
  channelId: string;
  address?: string;
  title?: string;
  summary?: string;
  description?: string;
  pointer: string;
  value: unknown;
  operations: AsyncApiOperation[];
}

export interface AsyncApiRawDocument {
  asyncapi?: string;
  info?: unknown;
  channels?: unknown;
  operations?: unknown;
  components?: unknown;
  [extension: string]: unknown;
}

/**
 * Normalized read model for AsyncAPI documents. The raw document remains the
 * canonical representation; this view exists for capability indexing and
 * Arazzo semantic resolution.
 */
export interface AsyncApiDocument {
  documentId: string;
  fileName: string;
  sourceText: string;
  version: string;
  specificationVersion: AsyncApiSpecificationVersion;
  info: AsyncApiInfo;
  channels: AsyncApiChannel[];
  operations: AsyncApiOperation[];
  raw: AsyncApiRawDocument;
}

export interface AsyncApiParseResult {
  document?: AsyncApiDocument;
  diagnostics: ArazzoDiagnostic[];
}
