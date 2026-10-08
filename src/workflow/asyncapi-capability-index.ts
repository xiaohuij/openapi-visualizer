import type {
  AsyncApiDocument,
  AsyncApiMessage,
  AsyncApiOperationAction,
} from "../asyncapi/types";
import type { AsyncApiWorkspaceDocument } from "./document-registry";

export interface AsyncApiMessageCapability extends AsyncApiMessage {}

export interface AsyncApiOperationCapability {
  documentId: string;
  sourceName: string;
  operationId?: string;
  channelId: string;
  channelAddress?: string;
  action: AsyncApiOperationAction;
  normalizedAction: "send" | "receive";
  specificationVersion: "2" | "3";
  title: string;
  summary?: string;
  description?: string;
  deprecated: boolean;
  pointer: string;
  channelPointer: string;
  value: unknown;
  messages: AsyncApiMessageCapability[];
}

function normalizedAction(action: AsyncApiOperationAction): "send" | "receive" {
  return action === "send" || action === "publish" ? "send" : "receive";
}

function operationCapability(
  entry: AsyncApiWorkspaceDocument,
  operation: AsyncApiDocument["operations"][number],
): AsyncApiOperationCapability {
  const channel = entry.document.channels.find(item => item.channelId === operation.channelId);
  return {
    documentId: entry.id,
    sourceName: entry.fileName,
    operationId: operation.operationId,
    channelId: operation.channelId,
    channelAddress: channel?.address,
    action: operation.action,
    normalizedAction: normalizedAction(operation.action),
    specificationVersion: entry.document.specificationVersion,
    title: operation.operationId ?? `${operation.channelId} ${operation.action}`,
    summary: operation.summary,
    description: operation.description,
    deprecated: operation.deprecated,
    pointer: operation.pointer,
    channelPointer: channel?.pointer ?? `#/channels/${operation.channelId}`,
    value: operation.value,
    messages: operation.messages,
  };
}

/**
 * Immutable index over the AsyncAPI documents currently present in the local
 * workspace. Rebuild it whenever the document registry changes.
 */
export class AsyncApiCapabilityIndex {
  readonly operations: AsyncApiOperationCapability[];
  private readonly byOperationId = new Map<string, AsyncApiOperationCapability[]>();
  private readonly byDocumentAndOperationId = new Map<string, AsyncApiOperationCapability[]>();
  private readonly byChannelAction = new Map<string, AsyncApiOperationCapability>();
  private readonly byPointer = new Map<string, AsyncApiOperationCapability>();

  constructor(documents: readonly AsyncApiWorkspaceDocument[]) {
    this.operations = documents.flatMap(entry =>
      entry.document.operations.map(operation => operationCapability(entry, operation)),
    );

    for (const operation of this.operations) {
      if (operation.operationId) {
        const key = operation.operationId.toLowerCase();
        this.byOperationId.set(key, [...(this.byOperationId.get(key) ?? []), operation]);
        this.byDocumentAndOperationId.set(`${operation.documentId}|${key}`, [
          ...(this.byDocumentAndOperationId.get(`${operation.documentId}|${key}`) ?? []),
          operation,
        ]);
      }
      for (const action of [operation.action, operation.normalizedAction]) {
        this.byChannelAction.set(
          `${operation.documentId}|${operation.channelId}|${action.toLowerCase()}`,
          operation,
        );
      }
      this.byPointer.set(`${operation.documentId}|${operation.pointer}`, operation);
      this.byPointer.set(`${operation.documentId}|${operation.channelPointer}`, operation);
    }
  }

  findByOperationId(operationId: string, documentId?: string) {
    const key = operationId.toLowerCase();
    if (documentId) {
      return this.byDocumentAndOperationId.get(`${documentId}|${key}`) ?? [];
    }
    return this.byOperationId.get(key) ?? [];
  }

  findByChannelAction(channelId: string, action: string, documentId: string) {
    return this.byChannelAction.get(`${documentId}|${channelId}|${action.toLowerCase()}`);
  }

  findByPointer(pointer: string, documentId: string) {
    return this.byPointer.get(`${documentId}|${pointer}`);
  }

  listDocument(documentId: string) {
    return this.operations.filter(operation => operation.documentId === documentId);
  }
}
