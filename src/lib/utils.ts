import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getText(value: unknown, fallback = "—"): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => getText(item)).join(", ");
  return JSON.stringify(value);
}

export function schemaType(schema: unknown): string {
  if (!isRecord(schema)) return typeof schema === "undefined" ? "any" : typeof schema;
  if (typeof schema.$ref === "string") return "$ref";
  const combinations = ["allOf", "anyOf", "oneOf"].filter((key) => Array.isArray(schema[key]));
  if (combinations.length) return combinations.join(" + ");
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  return typeof schema.type === "string" ? schema.type : "object";
}

export function truncate(value: string, length = 180) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export function prettyPointer(pointer: string) {
  return pointer
    .replace(/^#\//, "")
    .replace(/~1/g, "/")
    .replace(/~0/g, "~");
}
