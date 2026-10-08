import YAML from "yaml";
import { arazzoError, hasErrors, type ArazzoDiagnostic } from "../arazzo/diagnostics";
import type {
  AsyncApiChannel,
  AsyncApiDocument,
  AsyncApiInfo,
  AsyncApiMessage,
  AsyncApiOperation,
  AsyncApiOperationAction,
  AsyncApiParseResult,
  AsyncApiRawDocument,
  AsyncApiSpecificationVersion,
} from "./types";

const SUPPORTED_ASYNCAPI_VERSION = /^([23])\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const ACTIONS = new Set(["send", "receive", "publish", "subscribe"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function documentId(fileName: string) {
  return `asyncapi:${fileName}`;
}

function specificationVersion(version: string): AsyncApiSpecificationVersion | undefined {
  const match = SUPPORTED_ASYNCAPI_VERSION.exec(version);
  return match ? (match[1] as AsyncApiSpecificationVersion) : undefined;
}

function pointerSegment(value: string) {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function parseInfo(value: unknown, diagnostics: ArazzoDiagnostic[]): AsyncApiInfo | undefined {
  if (!isRecord(value)) {
    if (value !== undefined) {
      diagnostics.push(arazzoError("ASYNCAPI_INFO_INVALID", "The info field must be an object.", "#/info"));
    }
    return undefined;
  }

  const title = text(value.title);
  const version = text(value.version);
  if (!title) {
    diagnostics.push(arazzoError("ASYNCAPI_INFO_TITLE_REQUIRED", "The AsyncAPI info object requires a title.", "#/info/title"));
  }
  if (!version) {
    diagnostics.push(arazzoError("ASYNCAPI_INFO_VERSION_REQUIRED", "The AsyncAPI info object requires a version.", "#/info/version"));
  }
  if (!title || !version) return undefined;

  return {
    pointer: "#/info",
    title,
    version,
    description: text(value.description),
  };
}

function resolveLocalReference(root: unknown, reference: unknown, seen = new Set<string>()): unknown {
  if (!isRecord(reference) || typeof reference.$ref !== "string") return reference;
  const pointer = reference.$ref;
  if (!pointer.startsWith("#/") || seen.has(pointer)) return reference;
  seen.add(pointer);

  let current: unknown = root;
  for (const rawSegment of pointer.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    current = isRecord(current) ? current[segment] : Array.isArray(current) ? current[Number(segment)] : undefined;
    if (current === undefined) return reference;
  }
  return resolveLocalReference(root, current, seen);
}

function messageCapability(
  root: unknown,
  value: unknown,
  fallbackName: string,
  pointer: string,
): AsyncApiMessage {
  const resolved = resolveLocalReference(root, value);
  const record = isRecord(resolved) ? resolved : {};
  const payload = record.payload ?? undefined;
  const headers = record.headers ?? undefined;
  return {
    messageId: text(record.messageId),
    name: text(record.name) ?? text(record.messageId) ?? fallbackName,
    title: text(record.title),
    summary: text(record.summary),
    contentType: text(record.contentType),
    payload,
    headers,
    pointer,
    value: resolved,
  };
}

function messageList(root: unknown, message: unknown, pointer: string): AsyncApiMessage[] {
  if (message === undefined) return [];
  if (Array.isArray(message)) {
    return message.map((item, index) => messageCapability(root, item, `message[${index}]`, `${pointer}/${index}`));
  }
  const resolved = resolveLocalReference(root, message);
  if (isRecord(resolved) && Array.isArray(resolved.oneOf)) {
    return resolved.oneOf.map((item, index) =>
      messageCapability(root, item, `message[${index}]`, `${pointer}/oneOf/${index}`),
    );
  }
  return [messageCapability(root, message, "message", pointer)];
}

function channelOperationsFromVersion2(
  root: unknown,
  channelId: string,
  channelValue: Record<string, unknown>,
  channelPointer: string,
): AsyncApiOperation[] {
  const operations: AsyncApiOperation[] = [];
  for (const action of ["publish", "subscribe"] as const) {
    const value = channelValue[action];
    if (!isRecord(value)) continue;
    const pointer = `${channelPointer}/${action}`;
    operations.push({
      operationId: text(value.operationId),
      action,
      channelId,
      summary: text(value.summary),
      description: text(value.description),
      deprecated: value.deprecated === true,
      pointer,
      value,
      messages: messageList(root, value.message, `${pointer}/message`),
    });
  }
  return operations;
}

function parseChannels(
  root: unknown,
  value: unknown,
  specificationVersion: AsyncApiSpecificationVersion,
  diagnostics: ArazzoDiagnostic[],
): AsyncApiChannel[] {
  if (!isRecord(value)) {
    diagnostics.push(
      arazzoError(
        "ASYNCAPI_CHANNELS_INVALID",
        "An AsyncAPI document requires a channels object.",
        "#/channels",
      ),
    );
    return [];
  }

  const channels: AsyncApiChannel[] = [];
  for (const [channelId, rawChannel] of Object.entries(value)) {
    if (!isRecord(rawChannel)) {
      diagnostics.push(
        arazzoError(
          "ASYNCAPI_CHANNEL_INVALID",
          `Channel "${channelId}" must be an object.`,
          `#/channels/${pointerSegment(channelId)}`,
        ),
      );
      continue;
    }
    const pointer = `#/channels/${pointerSegment(channelId)}`;
    channels.push({
      channelId,
      address: text(rawChannel.address),
      title: text(rawChannel.title),
      summary: text(rawChannel.summary),
      description: text(rawChannel.description),
      pointer,
      value: rawChannel,
      operations:
        specificationVersion === "2"
          ? channelOperationsFromVersion2(root, channelId, rawChannel, pointer)
          : [],
    });
  }

  if (channels.length === 0) {
    diagnostics.push(
      arazzoError("ASYNCAPI_CHANNELS_REQUIRED", "At least one channel is required.", "#/channels"),
    );
  }
  return channels;
}

function parseVersion3Operations(
  root: unknown,
  raw: AsyncApiRawDocument,
  channels: AsyncApiChannel[],
  diagnostics: ArazzoDiagnostic[],
): AsyncApiOperation[] {
  if (!isRecord(raw.operations)) return [];
  const channelsById = new Map(channels.map(channel => [channel.channelId, channel]));
  const operations: AsyncApiOperation[] = [];

  for (const [operationId, value] of Object.entries(raw.operations)) {
    if (!isRecord(value)) {
      diagnostics.push(
        arazzoError(
          "ASYNCAPI_OPERATION_INVALID",
          `Operation "${operationId}" must be an object.`,
          `#/operations/${pointerSegment(operationId)}`,
        ),
      );
      continue;
    }

    const pointer = `#/operations/${pointerSegment(operationId)}`;
    const action = text(value.action);
    const channelReference = resolveLocalReference(root, value.channel);
    const channelId = isRecord(channelReference) ? channelIdFromReference(value.channel) : undefined;
    if (!action || !ACTIONS.has(action)) {
      diagnostics.push(
        arazzoError(
          "ASYNCAPI_OPERATION_ACTION_INVALID",
          `Operation "${operationId}" requires an action of send or receive.`,
          `${pointer}/action`,
        ),
      );
      continue;
    }
    if (!channelId || !channelsById.has(channelId)) {
      diagnostics.push(
        arazzoError(
          "ASYNCAPI_OPERATION_CHANNEL_UNRESOLVED",
          `Operation "${operationId}" must reference a channel in this document.`,
          `${pointer}/channel`,
        ),
      );
      continue;
    }

    operations.push({
      operationId,
      action: action as AsyncApiOperationAction,
      channelId,
      summary: text(value.summary),
      description: text(value.description),
      deprecated: value.deprecated === true,
      pointer,
      value,
      messages: Array.isArray(value.messages)
        ? value.messages.map((item, index) =>
            messageCapability(root, item, `messages[${index}]`, `${pointer}/messages/${index}`),
          )
        : [],
    });
  }

  return operations;
}

function channelIdFromReference(channel: unknown) {
  if (!isRecord(channel) || typeof channel.$ref !== "string") return undefined;
  const match = /^#\/channels\/([^/]+)$/.exec(channel.$ref);
  return match ? match[1].replace(/~1/g, "/").replace(/~0/g, "~") : undefined;
}

export function parseAsyncApiSource(sourceText: string, fileName: string): AsyncApiParseResult {
  const diagnostics: ArazzoDiagnostic[] = [];

  let parsed: unknown;
  try {
    parsed = YAML.parse(sourceText, { prettyErrors: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push(arazzoError("ASYNCAPI_PARSE_FAILED", `Unable to parse AsyncAPI YAML/JSON: ${message}`));
    return { diagnostics };
  }

  if (!isRecord(parsed)) {
    diagnostics.push(arazzoError("ASYNCAPI_ROOT_INVALID", "An AsyncAPI document must be a YAML/JSON object."));
    return { diagnostics };
  }

  const raw = parsed as AsyncApiRawDocument;
  const version = text(raw.asyncapi);
  if (!version) {
    diagnostics.push(arazzoError("ASYNCAPI_VERSION_REQUIRED", "The asyncapi version field is required.", "#/asyncapi"));
    return { diagnostics };
  }

  const normalizedVersion = specificationVersion(version);
  if (!normalizedVersion) {
    diagnostics.push(
      arazzoError(
        "ASYNCAPI_VERSION_UNSUPPORTED",
        `Unsupported AsyncAPI version "${version}". Supported versions are 2.x and 3.x.`,
        "#/asyncapi",
      ),
    );
    return { diagnostics };
  }

  const info = parseInfo(raw.info, diagnostics);
  const channels = parseChannels(parsed, raw.channels, normalizedVersion, diagnostics);
  if (!info || channels.length === 0 || hasErrors(diagnostics)) {
    return { diagnostics };
  }

  const rootOperations =
    normalizedVersion === "3"
      ? parseVersion3Operations(parsed, raw, channels, diagnostics)
      : [];
  const channelOperations = channels.flatMap(channel => channel.operations);
  if (normalizedVersion === "3" && rootOperations.length === 0 && !hasErrors(diagnostics)) {
    diagnostics.push(
      arazzoError(
        "ASYNCAPI_OPERATIONS_REQUIRED",
        "AsyncAPI 3.x documents require at least one operation.",
        "#/operations",
      ),
    );
  }
  if (hasErrors(diagnostics)) return { diagnostics };

  const document: AsyncApiDocument = {
    documentId: documentId(fileName),
    fileName,
    sourceText,
    version,
    specificationVersion: normalizedVersion,
    info,
    channels,
    operations: normalizedVersion === "3" ? rootOperations : channelOperations,
    raw,
  };

  return { document, diagnostics };
}
