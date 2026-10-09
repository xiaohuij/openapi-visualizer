export type JsonPointerSegment = string;

export interface SelectorParseResult<T> {
  value?: T;
  error?: string;
}

export type JsonPathSelector =
  | { kind: "name"; name: string }
  | { kind: "wildcard" }
  | { kind: "index"; index: number }
  | { kind: "slice"; start?: number; end?: number; step: number }
  | { kind: "union"; selectors: JsonPathSelector[] }
  | { kind: "filter"; expression: JsonPathFilterExpression };

export interface JsonPathSegment {
  type: "child" | "recursive";
  selectors: JsonPathSelector[];
}

export type JsonPathComparisonOperator =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "=~";

export type JsonPathOperand =
  | {
      kind: "path";
      base: "current" | "document";
      segments: JsonPathSegment[];
      singular: boolean;
    }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "regex"; pattern: string }
  | {
      kind: "function";
      name: "length" | "count" | "match" | "search" | "value";
      args: JsonPathOperand[];
    };

export type JsonPathFilterExpression =
  | { kind: "and"; left: JsonPathFilterExpression; right: JsonPathFilterExpression }
  | { kind: "or"; left: JsonPathFilterExpression; right: JsonPathFilterExpression }
  | { kind: "not"; expression: JsonPathFilterExpression }
 | { kind: "existence"; operand: JsonPathOperand }
  | {
      kind: "comparison";
     left: JsonPathOperand;
      operator: JsonPathComparisonOperator;
      right: JsonPathOperand;
    };

const MAX_JSON_PATH_SEGMENTS = 64;
const MAX_SELECTOR_RESULTS = 1_000;
const MAX_RECURSIVE_DEPTH = 20;
const MAX_FILTER_EXPRESSIONS = 256;

const VALUE_FUNCTIONS = new Set(["length", "count", "value"]);
const FUNCTION_NAMES = new Set([...VALUE_FUNCTIONS, "match", "search"]);

function isWhitespace(char: string | undefined) {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isDigit(char: string | undefined) {
  return char !== undefined && char >= "0" && char <= "9";
}

function isNameStart(char: string | undefined) {
  return char !== undefined && /[A-Za-z_\p{L}]/u.test(char);
}

function isNameChar(char: string | undefined) {
  return char !== undefined && /[A-Za-z0-9_\p{L}\p{N}-]/u.test(char);
}

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

interface ParserContext {
  source: string;
  cursor: number;
  expressions: number;
}

function peek(context: ParserContext, offset = 0) {
  return context.source[context.cursor + offset];
}

function advance(context: ParserContext, count = 1) {
  context.cursor += count;
}

function skipWhitespace(context: ParserContext) {
  while (isWhitespace(peek(context))) advance(context);
}

function errorAt(context: ParserContext, message: string): string {
  return `${message} (at character ${context.cursor}).`;
}

function readQuotedString(context: ParserContext, quote: "'" | "\""): string | undefined {
  advance(context);
  let value = "";
  while (context.cursor < context.source.length) {
    const char = peek(context);
    if (char === quote) {
      advance(context);
      return value;
    }
    if (char === "\\") {
      const escape = peek(context, 1);
      advance(context, 2);
      if (escape === "n") value += "\n";
      else if (escape === "t") value += "\t";
      else if (escape === "r") value += "\r";
      else if (escape === "b") value += "\b";
      else if (escape === "f") value += "\f";
      else if (escape === "u" && /[0-9a-fA-F]{4}/.test(context.source.slice(context.cursor, context.cursor + 4))) {
        value += String.fromCharCode(Number.parseInt(context.source.slice(context.cursor, context.cursor + 4), 16));
        advance(context, 4);
      } else if (escape !== undefined) {
        value += escape;
      } else {
        return undefined;
      }
      continue;
    }
    value += char ?? "";
    advance(context);
  }
  return undefined;
}

function readRegexLiteral(context: ParserContext): string | undefined {
  advance(context);
  let pattern = "";
  while (context.cursor < context.source.length) {
    const char = peek(context);
    if (char === "/") {
      advance(context);
      return pattern;
    }
    if (char === "\\") {
      const escape = peek(context, 1);
      if (escape === undefined) return undefined;
      if (escape === "/") {
        pattern += "/";
        advance(context, 2);
        continue;
      }
      pattern += char + escape;
      advance(context, 2);
      continue;
    }
    pattern += char ?? "";
    advance(context);
  }
  return undefined;
}

function readNumberLiteral(context: ParserContext): number | undefined {
  const start = context.cursor;
  if (peek(context) === "-") advance(context);
  if (!isDigit(peek(context))) return undefined;
  while (isDigit(peek(context))) advance(context);
  if (peek(context) === "." && isDigit(peek(context, 1))) {
    advance(context);
    while (isDigit(peek(context))) advance(context);
  }
  if (peek(context) === "e" || peek(context) === "E") {
    const exponentStart = context.cursor;
    advance(context);
    if (peek(context) === "+" || peek(context) === "-") advance(context);
    if (isDigit(peek(context))) {
      while (isDigit(peek(context))) advance(context);
    } else {
      context.cursor = exponentStart;
    }
  }
  return Number(context.source.slice(start, context.cursor));
}

function readOptionalInteger(context: ParserContext): number | undefined {
  const start = context.cursor;
  if (peek(context) === "-") advance(context);
  while (isDigit(peek(context))) advance(context);
  if (context.cursor === start || (context.cursor === start + 1 && context.source[start] === "-")) {
    context.cursor = start;
    return undefined;
  }
  return Number(context.source.slice(start, context.cursor));
}

function parseFilterPath(context: ParserContext): JsonPathOperand | undefined {
  const base = peek(context) === "$" ? "document" : "current";
  advance(context);
  const segments: JsonPathSegment[] = [];
  let singular = true;

  while (true) {
    skipWhitespace(context);
    const char = peek(context);
    if (char === ".") {
      advance(context);
      const recursive = peek(context) === ".";
      if (recursive) advance(context);
      if (recursive) singular = false;
      if (peek(context) === "*") {
        advance(context);
        singular = false;
        segments.push({ type: recursive ? "recursive" : "child", selectors: [{ kind: "wildcard" }] });
        continue;
      }
      if (recursive && peek(context) === "[") {
        const selectors = parseBracketSelectors(context);
        if (typeof selectors === "string") return undefined;
        segments.push({ type: "recursive", selectors });
        continue;
      }
      const nameStart = context.cursor;
      if (!isNameStart(peek(context))) return undefined;
      advance(context);
      while (isNameChar(peek(context))) advance(context);
      segments.push({
        type: recursive ? "recursive" : "child",
        selectors: [{ kind: "name", name: context.source.slice(nameStart, context.cursor) }],
      });
      continue;
    }
    if (char === "[") {
      const selectors = parseBracketSelectors(context);
      if (typeof selectors === "string") return undefined;
      if (
        selectors.length !== 1
        || (selectors[0].kind !== "name" && selectors[0].kind !== "index")
      ) {
        singular = false;
      }
      segments.push({ type: "child", selectors });
      continue;
    }
    break;
  }

  return { kind: "path", base, segments, singular };
}

function parseFunctionOperand(context: ParserContext): JsonPathOperand | undefined {
  const nameStart = context.cursor;
  advance(context);
  while (/[A-Za-z0-9_]/.test(peek(context) ?? "")) advance(context);
  const name = context.source.slice(nameStart, context.cursor);
  if (!FUNCTION_NAMES.has(name)) return undefined;
  skipWhitespace(context);
  if (peek(context) !== "(") return undefined;
  advance(context);
  const args: JsonPathOperand[] = [];
  skipWhitespace(context);
  if (peek(context) === ")") {
    advance(context);
    return { kind: "function", name: name as "length" | "count" | "match" | "search" | "value", args };
  }
  while (true) {
    skipWhitespace(context);
    const argument = parseOperand(context);
    if (!argument) return undefined;
    args.push(argument);
    skipWhitespace(context);
    if (peek(context) === ",") {
      advance(context);
      continue;
    }
    if (peek(context) === ")") {
      advance(context);
      break;
    }
    return undefined;
  }
  return { kind: "function", name: name as "length" | "count" | "match" | "search" | "value", args };
}

function parseOperand(context: ParserContext): JsonPathOperand | undefined {
  skipWhitespace(context);
  const char = peek(context);
  if (char === "@" || char === "$") return parseFilterPath(context);
  if (char === "'" || char === "\"") {
    const value = readQuotedString(context, char);
    return value === undefined ? undefined : { kind: "literal", value };
  }
  if (char === "/") {
    const pattern = readRegexLiteral(context);
    return pattern === undefined ? undefined : { kind: "regex", pattern };
  }
  if (char === "-" || isDigit(char)) {
    const value = readNumberLiteral(context);
    return value === undefined || Number.isNaN(value) ? undefined : { kind: "literal", value };
  }
  if (isNameStart(char)) {
    const start = context.cursor;
    while (isNameChar(peek(context))) advance(context);
    const word = context.source.slice(start, context.cursor);
    if (word === "true") return { kind: "literal", value: true };
    if (word === "false") return { kind: "literal", value: false };
    if (word === "null") return { kind: "literal", value: null };
    context.cursor = start;
    return parseFunctionOperand(context);
  }
  return undefined;
}

function parseComparisonOperator(context: ParserContext): JsonPathComparisonOperator | undefined {
  skipWhitespace(context);
  const two = context.source.slice(context.cursor, context.cursor + 2);
  if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "=~") {
    advance(context, 2);
    return two;
  }
  const one = peek(context);
  if (one === "<" || one === ">") {
    advance(context);
    return one;
  }
  return undefined;
}

function validateComparison(
  context: ParserContext,
  left: JsonPathOperand,
  operator: JsonPathComparisonOperator,
  right: JsonPathOperand,
): string | undefined {
  if (operator === "=~") {
    if (right.kind !== "regex") {
      return errorAt(context, "The right side of =~ must be a /regex/ literal");
    }
    return undefined;
  }
  if (left.kind === "regex" || right.kind === "regex") {
    return errorAt(context, "Regex literals are only allowed on the right side of =~");
  }
  for (const operand of [left, right]) {
    if (operand.kind === "path" && !operand.singular) {
      return errorAt(
        context,
        "Comparison operands must use singular queries such as @.name or @.items[0]",
      );
    }
    if (operand.kind === "function" && !VALUE_FUNCTIONS.has(operand.name)) {
      return errorAt(context, `Function ${operand.name}() cannot be used as a comparison operand`);
    }
  }
  return undefined;
}

function parseFilterPrimary(context: ParserContext): JsonPathFilterExpression | string {
  context.expressions += 1;
  if (context.expressions > MAX_FILTER_EXPRESSIONS) {
    return errorAt(context, `JSONPath filters are limited to ${MAX_FILTER_EXPRESSIONS} expressions`);
  }
  skipWhitespace(context);
  if (peek(context) === "(") {
    advance(context);
    const expression = parseFilterOr(context);
    if (typeof expression === "string") return expression;
    skipWhitespace(context);
    if (peek(context) !== ")") return errorAt(context, "A JSONPath filter parenthesis is missing )");
    advance(context);
    return expression;
  }
  const left = parseOperand(context);
  if (!left) return errorAt(context, "A JSONPath filter operand is invalid");
  const operator = parseComparisonOperator(context);
  if (!operator) return { kind: "existence", operand: left };
  skipWhitespace(context);
  const right = parseOperand(context);
  if (!right) return errorAt(context, "A JSONPath filter comparison is missing its right operand");
  const invalid = validateComparison(context, left, operator, right);
  if (invalid) return invalid;
  return { kind: "comparison", left, operator, right };
}

function parseFilterNot(context: ParserContext): JsonPathFilterExpression | string {
  skipWhitespace(context);
  if (peek(context) === "!") {
    advance(context);
    const expression = parseFilterNot(context);
    return typeof expression === "string" ? expression : { kind: "not", expression };
  }
  return parseFilterPrimary(context);
}

function parseFilterAnd(context: ParserContext): JsonPathFilterExpression | string {
  let left = parseFilterNot(context);
  if (typeof left === "string") return left;
  while (true) {
    skipWhitespace(context);
    if (context.source.slice(context.cursor, context.cursor + 2) !== "&&") return left;
    advance(context, 2);
    const right = parseFilterNot(context);
    if (typeof right === "string") return right;
    left = { kind: "and", left, right };
  }
}

function parseFilterOr(context: ParserContext): JsonPathFilterExpression | string {
  let left = parseFilterAnd(context);
  if (typeof left === "string") return left;
  while (true) {
    skipWhitespace(context);
    if (context.source.slice(context.cursor, context.cursor + 2) !== "||") return left;
    advance(context, 2);
    const right = parseFilterAnd(context);
    if (typeof right === "string") return right;
    left = { kind: "or", left, right };
  }
}

function parseBracketSelectors(context: ParserContext): JsonPathSelector[] | string {
  if (peek(context) !== "[") return errorAt(context, "A JSONPath bracket selector is missing [");
  advance(context);
  const selectors: JsonPathSelector[] = [];

  while (true) {
    skipWhitespace(context);
    const char = peek(context);
    if (char === "]") {
      advance(context);
      return selectors;
    }
    if (char === undefined) return errorAt(context, "A JSONPath bracket is missing ]");

    if (char === "?") {
      advance(context);
      const expression = parseFilterOr(context);
      if (typeof expression === "string") return expression;
      selectors.push({ kind: "filter", expression });
    } else if (char === "*" && peek(context, 1) === "]") {
      advance(context);
      selectors.push({ kind: "wildcard" });
    } else if (char === "'" || char === "\"") {
      const name = readQuotedString(context, char);
      if (name === undefined) return errorAt(context, "A bracketed JSONPath name is missing its closing quote");
      selectors.push({ kind: "name", name });
    } else if (char === "-" || isDigit(char) || char === ":") {
      const start = readOptionalInteger(context);
      skipWhitespace(context);
      if (peek(context) === ":") {
        advance(context);
        skipWhitespace(context);
        const end = readOptionalInteger(context);
        skipWhitespace(context);
        let step = 1;
        if (peek(context) === ":") {
          advance(context);
          skipWhitespace(context);
          const parsedStep = readOptionalInteger(context);
          if (parsedStep === undefined) return errorAt(context, "A JSONPath slice step is invalid");
          step = parsedStep;
        }
        if (step === 0) return errorAt(context, "A JSONPath slice step cannot be zero");
        selectors.push({ kind: "slice", start, end, step });
      } else if (start !== undefined) {
        selectors.push({ kind: "index", index: start });
      } else {
        return errorAt(context, "A JSONPath bracket selector is invalid");
      }
    } else {
      return errorAt(context, `Unsupported JSONPath bracket selector "${char}"`);
    }

    skipWhitespace(context);
    if (peek(context) === ",") {
      advance(context);
      continue;
    }
    if (peek(context) === "]") {
      advance(context);
      return selectors;
    }
    return errorAt(context, "A JSONPath bracket is missing ] or ,");
  }
}

export function parseJsonPath(path: string): SelectorParseResult<JsonPathSegment[]> {
  const context: ParserContext = { source: path, cursor: 0, expressions: 0 };
  skipWhitespace(context);
  if (peek(context) !== "$") return { error: "A JSONPath expression must start with $." };
  advance(context);
  const segments: JsonPathSegment[] = [];

  while (true) {
    skipWhitespace(context);
    const char = peek(context);
    if (char === undefined) break;
    if (segments.length >= MAX_JSON_PATH_SEGMENTS) {
      return { error: `JSONPath expressions are limited to ${MAX_JSON_PATH_SEGMENTS} segments.` };
    }

    if (char === ".") {
      advance(context);
      const recursive = peek(context) === ".";
      if (recursive) advance(context);
      if (peek(context) === "*") {
        advance(context);
        segments.push({
          type: recursive ? "recursive" : "child",
          selectors: [{ kind: "wildcard" }],
        });
        continue;
      }
      if (recursive && peek(context) === "[") {
        const selectors = parseBracketSelectors(context);
        if (typeof selectors === "string") return { error: selectors };
        segments.push({ type: "recursive", selectors });
        continue;
      }
      const nameStart = context.cursor;
      if (!isNameStart(peek(context))) {
        return { error: "A JSONPath child name cannot be empty." };
      }
      advance(context);
      while (isNameChar(peek(context))) advance(context);
      segments.push({
        type: recursive ? "recursive" : "child",
        selectors: [{ kind: "name", name: context.source.slice(nameStart, context.cursor) }],
      });
      continue;
    }

    if (char === "[") {
      const selectors = parseBracketSelectors(context);
      if (typeof selectors === "string") return { error: selectors };
      if (selectors.length === 0) {
        return { error: "A JSONPath bracket selector cannot be empty." };
      }
      if (selectors.length > 1) {
        segments.push({ type: "child", selectors: [{ kind: "union", selectors }] });
      } else {
        segments.push({ type: "child", selectors });
      }
      continue;
    }

    return { error: `Unsupported JSONPath character "${char}" at position ${context.cursor}.` };
  }

  return { value: segments };
}

interface ComparableValue {
  nothing: boolean;
  value?: unknown;
}

function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEquals(item, right[index]));
  }
  if (Array.isArray(left) || Array.isArray(right)) return false;
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const leftKeys = Object.keys(left as Record<string, unknown>);
    const rightKeys = Object.keys(right as Record<string, unknown>);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(key =>
      key in (right as Record<string, unknown>)
      && deepEquals(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
    );
  }
  return false;
}

function codepointLength(value: unknown): ComparableValue {
  if (typeof value === "string") return { nothing: false, value: [...value].length };
  if (Array.isArray(value)) return { nothing: false, value: value.length };
  if (typeof value === "object" && value !== null) {
    return { nothing: false, value: Object.keys(value as Record<string, unknown>).length };
  }
  return { nothing: true };
}

function evaluateFunction(
  operand: JsonPathOperand & { kind: "function" },
  current: unknown,
  root: unknown,
): ComparableValue {
  const evaluateArgument = (argument: JsonPathOperand): ComparableValue => {
    if (argument.kind === "path") {
      const nodes = evaluatePath(argument, current, root);
      if (operand.name === "count" || operand.name === "value") {
        return { nothing: false, value: nodes };
      }
      if (nodes.length === 0) return { nothing: true };
      return { nothing: false, value: nodes[0] };
    }
    return evaluateComparable(argument, current, root);
  };

  const args = operand.args.map(evaluateArgument);
  if (args.some(argument => argument.nothing)) return { nothing: true };

  if (operand.name === "count") {
    const nodes = args[0]?.value;
    return { nothing: false, value: Array.isArray(nodes) ? nodes.length : 0 };
  }
  if (operand.name === "value") {
    const nodes = args[0]?.value;
    if (!Array.isArray(nodes) || nodes.length === 0) return { nothing: true };
    return { nothing: false, value: nodes[0] };
  }
  if (operand.name === "length") {
    return codepointLength(args[0]?.value);
  }
  if (operand.name === "match" || operand.name === "search") {
    const subject = args[0]?.value;
    const pattern = args[1]?.value;
    if (typeof subject !== "string" || typeof pattern !== "string") return { nothing: true };
    try {
      if (operand.name === "search") {
        return { nothing: false, value: new RegExp(pattern).test(subject) };
      }
      return { nothing: false, value: new RegExp(`^(?:${pattern})$`).test(subject) };
    } catch {
      return { nothing: true };
    }
  }
  return { nothing: true };
}

function evaluateComparable(
  operand: JsonPathOperand,
  current: unknown,
  root: unknown,
): ComparableValue {
  switch (operand.kind) {
    case "literal":
      return { nothing: false, value: operand.value };
    case "regex":
      return { nothing: false, value: operand.pattern };
    case "function":
      return evaluateFunction(operand, current, root);
    case "path": {
      const nodes = evaluatePath(operand, current, root);
      if (nodes.length === 0) return { nothing: true };
      return { nothing: false, value: nodes[0] };
    }
  }
}

function compareValues(
  left: ComparableValue,
  right: ComparableValue,
  operator: JsonPathComparisonOperator,
): boolean {
  if (operator === "==") {
    if (left.nothing || right.nothing) return left.nothing && right.nothing;
    return deepEquals(left.value, right.value);
  }
  if (operator === "!=") {
    if (left.nothing || right.nothing) return !(left.nothing && right.nothing);
    return !deepEquals(left.value, right.value);
  }
  if (operator === "=~") {
    if (left.nothing || right.nothing) return false;
    if (typeof left.value !== "string" || typeof right.value !== "string") return false;
    try {
      return new RegExp(right.value).test(left.value);
    } catch {
      return false;
    }
  }
  if (left.nothing || right.nothing) return false;
  if (typeof left.value !== "number" || typeof right.value !== "number") return false;
  return operator === "<" ? left.value < right.value
    : operator === "<=" ? left.value <= right.value
    : operator === ">" ? left.value > right.value
    : left.value >= right.value;
}

function evaluateFilter(
  expression: JsonPathFilterExpression,
  current: unknown,
  root: unknown,
): boolean {
  switch (expression.kind) {
    case "and":
      return evaluateFilter(expression.left, current, root) && evaluateFilter(expression.right, current, root);
    case "or":
      return evaluateFilter(expression.left, current, root) || evaluateFilter(expression.right, current, root);
    case "not":
      return !evaluateFilter(expression.expression, current, root);
    case "existence": {
      if (expression.operand.kind === "path") {
        return evaluatePath(expression.operand, current, root).length > 0;
      }
      const comparable = evaluateComparable(expression.operand, current, root);
      return !comparable.nothing && Boolean(comparable.value);
    }
    case "comparison":
      return compareValues(
        evaluateComparable(expression.left, current, root),
        evaluateComparable(expression.right, current, root),
        expression.operator,
      );
  }
}

function applySlice(
  values: readonly unknown[],
  selector: JsonPathSelector & { kind: "slice" },
): unknown[] {
  const { start, end, step } = selector;
  const length = values.length;
  const output: unknown[] = [];
  let normalizedStart: number;
  let normalizedEnd: number;

  if (step > 0) {
    normalizedStart = start === undefined ? 0 : start < 0 ? Math.max(length + start, 0) : Math.min(start, length);
    normalizedEnd = end === undefined ? length : end < 0 ? Math.max(length + end, 0) : Math.min(end, length);
    for (let index = normalizedStart; index < normalizedEnd; index += step) {
      output.push(values[index]);
    }
    return output;
  }

  normalizedStart = start === undefined ? length - 1 : start < 0 ? Math.max(length + start, -1) : Math.min(start, length - 1);
  normalizedEnd = end === undefined ? -1 : end < 0 ? Math.max(length + end, -1) : Math.min(end, length - 1);
  for (let index = normalizedStart; index > normalizedEnd; index += step) {
    output.push(values[index]);
  }
  return output;
}

function applySelector(
  selector: JsonPathSelector,
  value: unknown,
  root: unknown,
  output: unknown[],
): void {
  if (selector.kind === "name") {
    if (typeof value === "object" && value !== null && !Array.isArray(value) && selector.name in value) {
      output.push((value as Record<string, unknown>)[selector.name]);
    }
    return;
  }
  if (selector.kind === "wildcard") {
    if (Array.isArray(value)) output.push(...value);
    else if (typeof value === "object" && value !== null) {
      output.push(...Object.values(value as Record<string, unknown>));
    }
    return;
  }
  if (selector.kind === "index") {
    if (!Array.isArray(value)) return;
    const index = selector.index < 0 ? value.length + selector.index : selector.index;
    if (index >= 0 && index < value.length) output.push(value[index]);
    return;
  }
  if (selector.kind === "slice") {
    if (Array.isArray(value)) output.push(...applySlice(value, selector));
    return;
  }
  if (selector.kind === "union") {
    for (const child of selector.selectors) applySelector(child, value, root, output);
    return;
  }
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? Object.values(value as Record<string, unknown>)
      : [];
  for (const candidate of candidates) {
    if (evaluateFilter(selector.expression, candidate, root)) output.push(candidate);
  }
}

function collectRecursiveNodes(
  value: unknown,
  output: unknown[],
  visited: WeakSet<object>,
  depth = 0,
): void {
  if (output.length >= MAX_SELECTOR_RESULTS || depth > MAX_RECURSIVE_DEPTH) return;
  output.push(value);
  if (Array.isArray(value)) {
    if (visited.has(value)) return;
    visited.add(value);
    for (const item of value) collectRecursiveNodes(item, output, visited, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (visited.has(value)) return;
  visited.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    collectRecursiveNodes(child, output, visited, depth + 1);
  }
}

function evaluatePathSegments(
  segments: readonly JsonPathSegment[],
  values: unknown[],
  root: unknown,
  offset = 0,
): SelectorParseResult<unknown[]> {
  if (offset >= segments.length) return { value: values };
  if (values.length > MAX_SELECTOR_RESULTS) {
    return { error: `Selector evaluation exceeded ${MAX_SELECTOR_RESULTS} results.` };
  }

  const segment = segments[offset];
  const next: unknown[] = [];

  if (segment.type === "child") {
    for (const value of values) {
      for (const selector of segment.selectors) {
        applySelector(selector, value, root, next);
        if (next.length > MAX_SELECTOR_RESULTS) {
          return { error: `Selector evaluation exceeded ${MAX_SELECTOR_RESULTS} results.` };
        }
      }
    }
  } else {
    for (const value of values) {
      const visitedNodes: unknown[] = [];
      collectRecursiveNodes(value, visitedNodes, new WeakSet());
      for (const visited of visitedNodes) {
        for (const selector of segment.selectors) {
          applySelector(selector, visited, root, next);
          if (next.length > MAX_SELECTOR_RESULTS) {
            return { error: `Selector evaluation exceeded ${MAX_SELECTOR_RESULTS} results.` };
          }
        }
      }
    }
  }

  return evaluatePathSegments(segments, next, root, offset + 1);
}

function evaluatePath(
  operand: JsonPathOperand & { kind: "path" },
  current: unknown,
  root: unknown,
): unknown[] {
  const base = operand.base === "current" ? current : root;
  const result = evaluatePathSegments(operand.segments, [base], root);
  return result.value ?? [];
}

export function evaluateJsonPath(value: unknown, path: string): SelectorParseResult<unknown[]> {
  const parsed = parseJsonPath(path);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  return evaluatePathSegments(parsed.value, [value], value);
}
