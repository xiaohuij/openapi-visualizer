export type JsonPointerSegment = string;

export interface SelectorParseResult<T> {
  value?: T;
  error?: string;
}

export interface JsonPathSegment {
  type: "child" | "recursive" | "index" | "wildcard";
  key?: string;
  index?: number;
}

const MAX_JSON_PATH_SEGMENTS = 64;
const MAX_SELECTOR_RESULTS = 1_000;
const MAX_RECURSIVE_DEPTH = 20;

export function parseJsonPointer(pointer: string): SelectorParseResult<JsonPointerSegment[]> {
  if (pointer === "") return { value: [] };
  if (!pointer.startsWith("/")) {
    return { error: "A JSON Pointer must be empty or start with /." };
  }

  const segments: JsonPointerSegment[] = [];
  for (const rawSegment of pointer.slice(1).split("/")) {
    let segment = "";
    for (let index = 0; index < rawSegment.length; index += 1) {
      const char = rawSegment[index];
      if (char !== "~") {
        segment += char;
        continue;
      }
      const escape = rawSegment[index + 1];
      if (escape === "0") segment += "~";
      else if (escape === "1") segment += "/";
      else return { error: "JSON Pointer escape sequences must be ~0 or ~1." };
      index += 1;
    }
    segments.push(segment);
  }
  return { value: segments };
}

export function evaluateJsonPointer(value: unknown, pointer: string): SelectorParseResult<unknown> {
  const parsed = parseJsonPointer(pointer);
  if (parsed.error || !parsed.value) return { error: parsed.error };

  let current = value;
  for (const segment of parsed.value) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return { error: `Array segment "${segment}" must be an integer.` };
      const index = Number(segment);
      if (index >= current.length) return { error: `Array index ${index} is out of bounds.` };
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null || !(segment in current)) {
      return { error: `Segment "${segment}" does not exist.` };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { value: current };
}

export function parseJsonPath(path: string): SelectorParseResult<JsonPathSegment[]> {
  let cursor = 0;
  if (path[cursor] !== "$") return { error: "A JSONPath expression must start with $." };
  cursor += 1;
  const segments: JsonPathSegment[] = [];

  while (cursor < path.length) {
    if (segments.length >= MAX_JSON_PATH_SEGMENTS) {
      return { error: `JSONPath expressions are limited to ${MAX_JSON_PATH_SEGMENTS} segments.` };
    }

    if (path[cursor] === ".") {
      const recursive = path[cursor + 1] === ".";
      cursor += recursive ? 2 : 1;
      const start = cursor;
      while (cursor < path.length && /[A-Za-z0-9_$-]/.test(path[cursor] ?? "")) cursor += 1;
      const key = path.slice(start, cursor);
      if (!key) return { error: "A JSONPath child name cannot be empty." };
      segments.push(recursive ? { type: "recursive", key } : { type: "child", key });
      continue;
    }

    if (path[cursor] === "[") {
      cursor += 1;
      if (path[cursor] === "'" || path[cursor] === "\"") {
        const quote = path[cursor];
        cursor += 1;
        let key = "";
        while (cursor < path.length && path[cursor] !== quote) {
          if (path[cursor] === "\\" && path[cursor + 1] !== undefined) {
            key += path[cursor + 1];
            cursor += 2;
            continue;
          }
          key += path[cursor];
          cursor += 1;
        }
        if (path[cursor] !== quote) return { error: "A bracketed JSONPath name is missing its closing quote." };
        cursor += 1;
        if (path[cursor] !== "]") return { error: "A bracketed JSONPath name is missing ]." };
        cursor += 1;
        segments.push({ type: "child", key });
        continue;
      }

      const start = cursor;
      while (cursor < path.length && path[cursor] !== "]") cursor += 1;
      if (path[cursor] !== "]") return { error: "A JSONPath bracket is missing ]." };
      const token = path.slice(start, cursor);
      cursor += 1;
      if (token === "*") {
        segments.push({ type: "wildcard" });
        continue;
      }
      if (/^-?\d+$/.test(token)) {
        segments.push({ type: "index", index: Number(token) });
        continue;
      }
      return { error: `Unsupported JSONPath bracket token "${token}".` };
    }

    return { error: `Unsupported JSONPath character "${path[cursor]}" at position ${cursor}.` };
  }

  return { value: segments };
}

function collectRecursive(
  value: unknown,
  key: string,
  output: unknown[],
  visited: WeakSet<object>,
  depth = 0,
) {
  if (output.length >= MAX_SELECTOR_RESULTS || depth > MAX_RECURSIVE_DEPTH) return;
  if (typeof value === "object" && value !== null) {
    if (visited.has(value)) return;
    visited.add(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) collectRecursive(item, key, output, visited, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  if (key in record) {
    output.push(record[key]);
    if (output.length >= MAX_SELECTOR_RESULTS) return;
  }
  for (const child of Object.values(record)) collectRecursive(child, key, output, visited, depth + 1);
}

function evaluateSegments(segments: JsonPathSegment[], values: unknown[], offset = 0): SelectorParseResult<unknown[]> {
  if (offset >= segments.length) return { value: values };
  if (values.length > MAX_SELECTOR_RESULTS) {
    return { error: `Selector evaluation exceeded ${MAX_SELECTOR_RESULTS} results.` };
  }

  const segment = segments[offset];
  const next: unknown[] = [];
  for (const value of values) {
    if (segment.type === "child" && segment.key !== undefined) {
      if (typeof value === "object" && value !== null && !Array.isArray(value) && segment.key in value) {
        next.push((value as Record<string, unknown>)[segment.key]);
      }
    } else if (segment.type === "index" && segment.index !== undefined && Array.isArray(value)) {
      const index = segment.index < 0 ? value.length + segment.index : segment.index;
      if (index >= 0 && index < value.length) next.push(value[index]);
    } else if (segment.type === "wildcard") {
      if (Array.isArray(value)) next.push(...value);
      else if (typeof value === "object" && value !== null) next.push(...Object.values(value));
    } else if (segment.type === "recursive" && segment.key !== undefined) {
      collectRecursive(value, segment.key, next, new WeakSet());
    }
    if (next.length > MAX_SELECTOR_RESULTS) {
      return { error: `Selector evaluation exceeded ${MAX_SELECTOR_RESULTS} results.` };
    }
  }

  return evaluateSegments(segments, next, offset + 1);
}

export function evaluateJsonPath(value: unknown, path: string): SelectorParseResult<unknown[]> {
  const parsed = parseJsonPath(path);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  return evaluateSegments(parsed.value, [value]);
}
