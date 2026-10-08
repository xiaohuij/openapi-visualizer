import YAML from "yaml";
import type { ArazzoDocument, ArazzoRawDocument } from "./types";

export type ArazzoSerializationFormat = "yaml" | "json";

export function serializeArazzoRaw(
  raw: ArazzoRawDocument,
  format: ArazzoSerializationFormat = "yaml",
) {
  if (format === "json") {
    return `${JSON.stringify(raw, null, 2)}\n`;
  }
  return YAML.stringify(raw, { lineWidth: 120 });
}

export function serializeArazzoDocument(
  document: ArazzoDocument,
  format: ArazzoSerializationFormat = "yaml",
) {
  return serializeArazzoRaw(document.raw, format);
}
