import type { ArazzoCriterion } from "../arazzo/types";
import {
  evaluateJsonPath,
  evaluateJsonPointer,
  parseJsonPointer,
} from "../arazzo/selectors";
import { evaluateXPath, evaluateXPathCriterion } from "../arazzo/xpath";
import type {
  ArazzoExecutionPlan,
  ArazzoExecutionStep,
} from "./execution-plan";

export interface ArazzoMockExample {
  statusCode?: number;
  response?: {
    body?: unknown;
    header?: Record<string, unknown>;
  };
  message?: {
    payload?: unknown;
  };
  timeout?: boolean;
}

export interface ArazzoMockExecutionContext {
  inputs: Record<string, unknown>;
  examples?: Record<string, ArazzoMockExample>;
  sourceDescriptions?: Record<string, Record<string, unknown>>;
}

export interface ArazzoMockEvaluationScope {
  inputs: Record<string, unknown>;
  steps: Record<string, Record<string, unknown>>;
  workflows?: Record<string, Record<string, unknown>>;
  sourceDescriptions?: Record<string, Record<string, unknown>>;
  statusCode?: number;
  response?: ArazzoMockExample["response"];
  message?: ArazzoMockExample["message"];
}

export interface ArazzoMockCriterionResult {
  condition: string;
  passed: boolean;
  error?: string;
}

export interface ArazzoMockStepResult {
  stepId: string;
  pointer: string;
  status: "succeeded" | "failed" | "blocked";
  parameters: Record<string, unknown>;
  requestBody?: unknown;
  outputs: Record<string, unknown>;
  criteria: ArazzoMockCriterionResult[];
  action?: {
    kind: "success" | "failure";
    type: string;
    target?: string;
  };
  failureReason?: string;
}

export interface ArazzoMockWorkflowResult {
  workflowId: string;
  pointer: string;
  steps: ArazzoMockStepResult[];
}

export interface ArazzoMockExecutionResult {
  networkPolicy: "mock-only";
  fetchPolicy: "none";
  workflows: ArazzoMockWorkflowResult[];
}

const EXPRESSION_PATTERN =
  /^\$(inputs|steps|workflows|sourceDescriptions|response|message)((?:\.[A-Za-z0-9_-]+)+)?(#.*)?$/;
const EMBEDDED_EXPRESSION_PATTERN =
  /\{?\$(?:(?:inputs|steps|workflows|sourceDescriptions|response|message)(?:\.[A-Za-z0-9_-]+)+|statusCode)\}?/g;
const MAX_MATERIALIZE_DEPTH = 12;

function pathValue(root: unknown, segments: string[]) {
  return segments.reduce((current, segment) => {
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) && index >= 0 && index < current.length
        ? current[index]
        : undefined;
    }
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, root);
}

export function evaluateArazzoMockExpression(
  expression: string,
  scope: ArazzoMockEvaluationScope,
) {
  if (expression === "$statusCode") return scope.statusCode;

  const match = EXPRESSION_PATTERN.exec(expression);
  if (!match) return undefined;
  const [, rootMarker, pathMarker = "", pointer = ""] = match;
  const rootName = rootMarker as keyof ArazzoMockEvaluationScope;
  let root: unknown;
  switch (rootName) {
    case "inputs":
      root = scope.inputs;
      break;
    case "steps":
      root = scope.steps;
      break;
    case "workflows":
      root = scope.workflows ?? {};
      break;
    case "sourceDescriptions":
      root = scope.sourceDescriptions ?? {};
      break;
    case "response":
      root = scope.response ?? {};
      break;
    case "message":
      root = scope.message ?? {};
      break;
    default:
      return undefined;
  }

  const segments = pathMarker.split(".").filter(Boolean);
  let value = pathValue(root, segments);
  if (pointer) {
    const parsed = parseJsonPointer(pointer);
    if (parsed.value) {
      for (const segment of parsed.value) {
        if (Array.isArray(value)) value = value[Number(segment)];
        else if (typeof value === "object" && value !== null) {
          value = (value as Record<string, unknown>)[segment];
        } else return undefined;
      }
    }
  }
  return value;
}

function materialize(value: unknown, scope: ArazzoMockEvaluationScope, depth = 0): unknown {
  if (depth > MAX_MATERIALIZE_DEPTH) return undefined;
  if (typeof value === "string") {
    if (!value.includes("$")) return value;
    const direct = evaluateArazzoMockExpression(value, scope);
    if (direct !== undefined || /^\$(?:inputs|steps|workflows|sourceDescriptions|response|message|statusCode)/.test(value)) {
      return direct;
    }

    return value.replace(EMBEDDED_EXPRESSION_PATTERN, match => {
      const expression = match.startsWith("{") && match.endsWith("}")
        ? match.slice(1, -1)
        : match;
      const evaluated = expression === "$statusCode"
        ? scope.statusCode
        : evaluateArazzoMockExpression(expression, scope);
      return evaluated === undefined ? "" : String(evaluated);
    });
  }
  if (Array.isArray(value)) return value.map(item => materialize(item, scope, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, materialize(item, scope, depth + 1)]),
    );
  }
  return value;
}

function literal(value: unknown) {
  if (typeof value !== "string") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1);
  return value;
}

function criterionType(criterion: ArazzoCriterion) {
  const type = criterion.type;
  if (typeof type === "string") return type;
  if (
    typeof type === "object"
    && type !== null
    && !Array.isArray(type)
    && typeof type.type === "string"
  ) {
    return type.type;
  }
  return "simple";
}

export function evaluateArazzoMockCriterion(
  criterion: ArazzoCriterion,
  scope: ArazzoMockEvaluationScope,
): ArazzoMockCriterionResult {
  const condition = criterion.condition ?? "";
  const type = criterionType(criterion);

  try {
    if (type === "jsonpath") {
      const context = criterion.context
        ? evaluateArazzoMockExpression(criterion.context, scope)
        : undefined;
      const selected = evaluateJsonPath(context, condition);
      return {
        condition,
        passed: Boolean(selected.value?.some(value => Boolean(value))),
        error: selected.error,
      };
    }

    if (type === "jsonpointer") {
      const context = criterion.context
        ? evaluateArazzoMockExpression(criterion.context, scope)
        : undefined;
      const selected = evaluateJsonPointer(context, condition);
      return {
        condition,
        passed: Boolean(selected.value),
        error: selected.error,
      };
    }

    if (type === "xpath") {
      const context = criterion.context
        ? evaluateArazzoMockExpression(criterion.context, scope)
        : undefined;
      const selected = evaluateXPathCriterion(context, condition);
      return {
        condition,
        passed: Boolean(selected.value),
        error: selected.error,
      };
    }

    if (type === "regex") {
      const context = criterion.context
        ? evaluateArazzoMockExpression(criterion.context, scope)
        : undefined;
      return { condition, passed: new RegExp(condition).test(String(context ?? "")) };
    }

    const match = /^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/.exec(condition);
    if (!match) return { condition, passed: Boolean(condition), error: "Unsupported simple condition." };
    const [, leftSource, operator, rightSource] = match;
    const left = leftSource.includes("$")
      ? evaluateArazzoMockExpression(leftSource, scope)
      : literal(leftSource);
    const right = rightSource.includes("$")
      ? evaluateArazzoMockExpression(rightSource, scope)
      : literal(rightSource);
    let passed = false;
    if (operator === "==") passed = left === right;
    else if (operator === "!=") passed = left !== right;
    else if (typeof left === "number" && typeof right === "number") {
      passed = operator === ">" ? left > right
        : operator === "<" ? left < right
        : operator === ">=" ? left >= right
        : left <= right;
    }
    return { condition, passed };
  } catch (error) {
    return {
      condition,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function outputValue(step: ArazzoExecutionStep, scope: ArazzoMockEvaluationScope) {
  return (output: ArazzoExecutionStep["outputs"][number]) => {
    if (output.selector) {
      const context = output.selectorContext
        ? evaluateArazzoMockExpression(output.selectorContext, scope)
        : undefined;
      const result = output.selectorType === "jsonpointer"
        ? evaluateJsonPointer(context, output.selector)
        : output.selectorType === "xpath"
          ? evaluateXPath(context, output.selector)
        : evaluateJsonPath(context, output.selector);
      if (result.error) throw new Error(result.error);
      return result.value;
    }
    return materialize(output.value, scope);
  };
}

function selectedAction(
  actions: Array<{ type?: string; stepId?: string; workflowId?: string; criteria?: ArazzoCriterion[] }>,
  scope: ArazzoMockEvaluationScope,
  kind: "success" | "failure",
) {
  for (const action of actions) {
    if (!action.criteria?.length) {
      return action;
    }
    const results = action.criteria.map(criterion => evaluateArazzoMockCriterion(criterion, scope));
    if (results.every(result => result.passed)) return action;
  }
  return actions.length > 0 && kind === "success" ? undefined : actions[0];
}

export function executeArazzoMockPlan(
  plan: ArazzoExecutionPlan,
  context: ArazzoMockExecutionContext,
): ArazzoMockExecutionResult {
  const stepOutputs: Record<string, Record<string, { outputs: Record<string, unknown> }>> = {};
  const workflows = plan.workflows.map(workflow => {
    stepOutputs[workflow.workflowId] = {};
    const results = workflow.steps.map(step => {
      const outputRecord: Record<string, unknown> = {};
      stepOutputs[workflow.workflowId][step.stepId] = { outputs: outputRecord };

      const unboundAsyncWithoutExample = step.target.kind === "asyncapi-target"
        && !step.target.bound
        && step.async?.action === "receive"
        && !context.examples?.[step.stepId];
      if (step.target.kind === "unresolved" || unboundAsyncWithoutExample) {
        return {
          stepId: step.stepId,
          pointer: step.pointer,
          status: "blocked" as const,
          parameters: {},
          outputs: outputRecord,
          criteria: [],
          failureReason: "Step target is unresolved.",
        } satisfies ArazzoMockStepResult;
      }

      const example = context.examples?.[step.stepId] ?? {};
      const scope: ArazzoMockEvaluationScope = {
        inputs: context.inputs,
        steps: stepOutputs[workflow.workflowId],
        sourceDescriptions: context.sourceDescriptions,
        statusCode: example.statusCode,
        response: example.response,
        message: example.message,
      };

      const parameters = Object.fromEntries(step.parameters.map(parameter => [
        parameter.name,
        materialize(parameter.value, scope),
      ]));
      const requestBody = step.requestBody
        ? materialize(step.requestBody.payload, scope)
        : undefined;

      if (step.async?.action === "receive" && (example.timeout === true || !example.message)) {
        return {
          stepId: step.stepId,
          pointer: step.pointer,
          status: "failed" as const,
          parameters,
          requestBody,
          outputs: outputRecord,
          criteria: [],
          failureReason: example.timeout === true
            ? `Timed out after ${step.async.timeout ?? "an unspecified"} ms.`
            : "No mock message was supplied.",
        } satisfies ArazzoMockStepResult;
      }

      const criteria = step.successCriteria.map(criterion =>
        evaluateArazzoMockCriterion(criterion, scope),
      );
      const succeeded = criteria.length === 0 || criteria.every(result => result.passed);
      const actionSource = succeeded ? step.successActions : step.failureActions;
      const action = selectedAction(actionSource, scope, succeeded ? "success" : "failure");

      if (succeeded) {
        try {
          for (const output of step.outputs) {
            outputRecord[output.name] = outputValue(step, scope)(output);
          }
        } catch (error) {
          return {
            stepId: step.stepId,
            pointer: step.pointer,
            status: "failed" as const,
            parameters,
            requestBody,
            outputs: outputRecord,
            criteria,
            failureReason: error instanceof Error ? error.message : String(error),
          } satisfies ArazzoMockStepResult;
        }
      }

      return {
        stepId: step.stepId,
        pointer: step.pointer,
        status: succeeded ? "succeeded" as const : "failed" as const,
        parameters,
        requestBody,
        outputs: outputRecord,
        criteria,
        action: action
          ? {
            kind: succeeded ? "success" as const : "failure" as const,
            type: action.type ?? "unspecified",
            target: action.stepId ?? action.workflowId,
          }
          : undefined,
        failureReason: succeeded ? undefined : "Success criteria were not satisfied.",
      } satisfies ArazzoMockStepResult;
    });

    return {
      workflowId: workflow.workflowId,
      pointer: workflow.pointer,
      steps: results,
    };
  });

  return { networkPolicy: "mock-only", fetchPolicy: "none", workflows };
}
