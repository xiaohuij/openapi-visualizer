import { arazzoError, arazzoWarning, type ArazzoDiagnostic } from "../diagnostics";
import type {
  ArazzoDocument,
  ArazzoStep,
  ArazzoWorkflow,
} from "../types";
import { arazzoOutputEntries } from "../outputs";
import { parseJsonPath, parseJsonPointer } from "../selectors";
import { parseXPathQuery } from "../xpath";
import { workflowInputs } from "../workflow-inputs";

export type ArazzoRuntimeExpressionRoot =
  | "inputs"
  | "steps"
  | "workflows"
  | "sourceDescriptions";

export interface ArazzoRuntimeExpression {
  root: ArazzoRuntimeExpressionRoot;
  segments: string[];
}

const EXPRESSION_PATTERN =
  /^\$(inputs|steps|workflows|sourceDescriptions)(?:\.[A-Za-z0-9_-]+)+$/;
const EMBEDDED_EXPRESSION_PATTERN =
  /\$(?:inputs|steps|workflows|sourceDescriptions)(?:\.[A-Za-z0-9_-]+)+/g;
const MAX_EXPRESSION_SCAN_DEPTH = 12;

export function parseArazzoRuntimeExpression(value: string): ArazzoRuntimeExpression | undefined {
  if (!EXPRESSION_PATTERN.test(value)) return undefined;
  const [rootMarker, ...segments] = value.split(".");
  return { root: rootMarker.slice(1) as ArazzoRuntimeExpressionRoot, segments };
}

function expressionShapeError(expression: ArazzoRuntimeExpression) {
  switch (expression.root) {
    case "inputs":
      return expression.segments.length < 1
        ? "Workflow input expressions use the form $inputs.name or $inputs.object.property."
        : undefined;
    case "steps":
      return expression.segments.length !== 3 || expression.segments[1] !== "outputs"
        ? "Step output expressions use the form $steps.stepId.outputs.name."
        : undefined;
    case "workflows":
      return expression.segments.length !== 3 || expression.segments[1] !== "outputs"
        ? "Workflow output expressions use the form $workflows.workflowId.outputs.name."
        : undefined;
    case "sourceDescriptions":
      return expression.segments.length !== 2
        ? "Source-description expressions use the form $sourceDescriptions.name.field."
        : undefined;
  }
}

export function validateArazzoRuntimeExpression(
  document: ArazzoDocument,
  workflow: ArazzoWorkflow,
  value: string,
  pointer: string,
  currentStep?: ArazzoStep,
): ArazzoDiagnostic[] {
  const expression = parseArazzoRuntimeExpression(value);
  if (!expression) {
    return [
      arazzoError(
        "ARAZZO_RUNTIME_EXPRESSION_INVALID",
        "Runtime expression syntax is not recognized.",
        pointer,
        document.documentId,
      ),
    ];
  }

  const shapeError = expressionShapeError(expression);
  if (shapeError) {
    return [
      arazzoError(
        "ARAZZO_RUNTIME_EXPRESSION_INVALID",
        shapeError,
        pointer,
        document.documentId,
      ),
    ];
  }

  const diagnostics: ArazzoDiagnostic[] = [];
  if (expression.root === "inputs") {
    const inputName = expression.segments[0];
    if (!workflowInputs(workflow).some(parameter => parameter.name === inputName)) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_WORKFLOW_INPUT_UNRESOLVED",
          `Workflow input "${inputName}" is not declared.`,
          pointer,
          document.documentId,
        ),
      );
    }
  } else if (expression.root === "steps") {
    const [stepId, , outputName] = expression.segments;
    const target = workflow.steps.find(step => step.stepId === stepId);
    if (!target) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_STEP_UNRESOLVED",
          `Runtime expression references unknown step "${stepId}".`,
          pointer,
          document.documentId,
        ),
      );
    } else if (!arazzoOutputEntries(target.outputs).some(output => output.name === outputName)) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_STEP_OUTPUT_UNRESOLVED",
          `Step "${stepId}" does not declare output "${outputName}".`,
          pointer,
          document.documentId,
        ),
      );
    } else if (currentStep && target.stepId !== currentStep.stepId && !currentStep.dependsOn?.includes(stepId)) {
      diagnostics.push(
        arazzoWarning(
          "ARAZZO_EXPRESSION_STEP_NOT_DEPENDENCY",
          `Step "${currentStep.stepId}" reads step "${stepId}" without declaring it in dependsOn.`,
          pointer,
          document.documentId,
        ),
      );
    }
  } else if (expression.root === "workflows") {
    const [workflowId, , outputName] = expression.segments;
    const target = document.workflows.find(item => item.workflowId === workflowId);
    if (!target) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_WORKFLOW_UNRESOLVED",
          `Runtime expression references unknown workflow "${workflowId}".`,
          pointer,
          document.documentId,
        ),
      );
    } else if (!arazzoOutputEntries(target.outputs).some(output => output.name === outputName)) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_WORKFLOW_OUTPUT_UNRESOLVED",
          `Workflow "${workflowId}" does not declare output "${outputName}".`,
          pointer,
          document.documentId,
        ),
      );
    }
  } else if (expression.root === "sourceDescriptions") {
    const sourceName = expression.segments[0];
    if (!document.sourceDescriptions.some(source => source.name === sourceName)) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_SOURCE_DESCRIPTION_UNRESOLVED",
          `Runtime expression references unknown source description "${sourceName}".`,
          pointer,
          document.documentId,
        ),
      );
    }
  }

  return diagnostics;
}

function embeddedExpressions(value: string) {
  if (!value.includes("$")) return [];
  return [...value.matchAll(EMBEDDED_EXPRESSION_PATTERN)].map(match => match[0]);
}

function escapePointerSegment(value: string) {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function scanMappingValue(
  document: ArazzoDocument,
  workflow: ArazzoWorkflow,
  step: ArazzoStep,
  value: unknown,
  pointer: string,
  diagnostics: ArazzoDiagnostic[],
  depth = 0,
) {
  if (depth > MAX_EXPRESSION_SCAN_DEPTH || value === undefined || value === null) return;
  if (typeof value === "string") {
    for (const expression of embeddedExpressions(value)) {
      diagnostics.push(...validateArazzoRuntimeExpression(document, workflow, expression, pointer, step));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scanMappingValue(document, workflow, step, item, `${pointer}/${index}`, diagnostics, depth + 1);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      scanMappingValue(
        document,
        workflow,
        step,
        item,
        `${pointer}/${escapePointerSegment(key)}`,
        diagnostics,
        depth + 1,
      );
    }
  }
}

function validateSelector(
  document: ArazzoDocument,
  selector: { type?: string; context?: string; selector?: string; query?: string },
  pointer: string,
  diagnostics: ArazzoDiagnostic[],
) {
  if (!selector.context) {
    diagnostics.push(
      arazzoWarning(
        "ARAZZO_SELECTOR_CONTEXT_MISSING",
        "A selector should declare the runtime-expression context it evaluates against.",
        pointer,
        document.documentId,
      ),
    );
  }
  const query = selector.selector ?? selector.query;
  if (!query) {
    diagnostics.push(
      arazzoWarning(
        "ARAZZO_SELECTOR_QUERY_MISSING",
        "A selector should declare a query.",
        pointer,
        document.documentId,
      ),
    );
    return;
  }

  const type = selector.type ?? "jsonpath";
  if (type === "jsonpath") {
    const parsed = parseJsonPath(query);
    if (parsed.error) {
      diagnostics.push(
        arazzoError("ARAZZO_SELECTOR_INVALID", parsed.error, pointer, document.documentId),
      );
    }
    return;
  }
  if (type === "jsonpointer") {
    const parsed = parseJsonPointer(query);
    if (parsed.error) {
      diagnostics.push(
        arazzoError("ARAZZO_SELECTOR_INVALID", parsed.error, pointer, document.documentId),
      );
    }
    return;
  }
  if (type === "xpath") {
    const parsed = parseXPathQuery(query);
    if (parsed.error) {
      diagnostics.push(
        arazzoError("ARAZZO_SELECTOR_INVALID", parsed.error, pointer, document.documentId),
      );
    }
    return;
  }

  diagnostics.push(
    arazzoWarning(
      "ARAZZO_SELECTOR_TYPE_UNSUPPORTED",
      `Selector type "${type}" is not evaluated by the built-in MVP selector engine.`,
      pointer,
      document.documentId,
    ),
  );
}

export function validateArazzoRuntimeExpressions(document: ArazzoDocument): ArazzoDiagnostic[] {
  const diagnostics: ArazzoDiagnostic[] = [];

  for (const workflow of document.workflows) {
    for (const parameter of workflow.parameters ?? []) {
      for (const expression of embeddedExpressions(String(parameter.value ?? ""))) {
        diagnostics.push(
          ...validateArazzoRuntimeExpression(
            document,
            workflow,
            expression,
            `${workflow.pointer}/parameters/${workflow.parameters?.indexOf(parameter) ?? 0}/value`,
          ),
        );
      }
    }

    for (const [index, output] of arazzoOutputEntries(workflow.outputs).entries()) {
      if (output.selector) {
        validateSelector(
          document,
          output.selector,
          `${workflow.pointer}/outputs/${Array.isArray(workflow.outputs) ? index : escapePointerSegment(output.name)}/selector`,
          diagnostics,
        );
      }
    }

    for (const step of workflow.steps) {
      for (const parameter of step.parameters ?? []) {
        scanMappingValue(
          document,
          workflow,
          step,
          parameter.value,
          `${step.pointer}/parameters/${step.parameters?.indexOf(parameter) ?? 0}/value`,
          diagnostics,
        );
      }
      if (step.requestBody) {
        scanMappingValue(
          document,
          workflow,
          step,
          step.requestBody.payload,
          `${step.pointer}/requestBody/payload`,
          diagnostics,
        );
      }
      for (const [index, output] of arazzoOutputEntries(step.outputs).entries()) {
        if (output.selector) {
          validateSelector(
            document,
            output.selector,
            `${step.pointer}/outputs/${Array.isArray(step.outputs) ? index : escapePointerSegment(output.name)}/selector`,
            diagnostics,
          );
        }
      }
      for (const criterion of step.successCriteria ?? []) {
        const criterionType = typeof criterion.type === "string"
          ? criterion.type
          : typeof criterion.type === "object" && criterion.type !== null && !Array.isArray(criterion.type)
            ? criterion.type.type
            : undefined;
        if (criterionType === "xpath" && criterion.condition) {
          const parsed = parseXPathQuery(criterion.condition);
          if (parsed.error) {
            diagnostics.push(
              arazzoError(
                "ARAZZO_SELECTOR_INVALID",
                parsed.error,
                `${step.pointer}/successCriteria/${step.successCriteria?.indexOf(criterion) ?? 0}/condition`,
                document.documentId,
              ),
            );
          }
        }
        for (const expression of [
          ...(criterion.context ? [criterion.context] : []),
          ...(criterion.condition ? [criterion.condition] : []),
        ]) {
          diagnostics.push(
            ...validateArazzoRuntimeExpression(document, workflow, expression, step.pointer, step)
              .filter(diagnostic => diagnostic.code !== "ARAZZO_RUNTIME_EXPRESSION_INVALID"),
          );
        }
      }
    }
  }

  return diagnostics;
}
