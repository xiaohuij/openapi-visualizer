import { arazzoError, type ArazzoDiagnostic } from "../arazzo/diagnostics";
import { arazzoOutputEntries } from "../arazzo/outputs";
import type {
  ArazzoFailureAction,
  ArazzoCriterion,
  ArazzoParameter,
  ArazzoRequestBody,
  ArazzoSuccessAction,
} from "../arazzo/types";
import type { ArazzoResolution, ArazzoStepTarget } from "../arazzo/semantic-resolver";

export type ArazzoExecutionTarget =
  | {
      kind: "openapi-operation";
      documentId: string;
      operationId?: string;
      method: string;
      path: string;
      nodeId: string;
    }
  | {
      kind: "workflow";
      documentId: string;
      workflowId: string;
      pointer: string;
    }
  | {
      kind: "asyncapi-target";
      sourceName: string;
      reference: string;
      bound: boolean;
      operationId?: string;
      channelId?: string;
      action?: string;
    }
  | {
      kind: "unresolved";
      reason: string;
    };

export interface ArazzoExecutionBinding {
  name: string;
  in?: string;
  value: unknown;
  dynamic: boolean;
}

export interface ArazzoExecutionBodyBinding {
  contentType?: string;
  payload: unknown;
  dynamic: boolean;
}

export interface ArazzoExecutionOutput {
  name: string;
  selector?: string;
  selectorType?: "jsonpath" | "xpath" | "jsonpointer";
  selectorContext?: string;
  value?: unknown;
}

export interface ArazzoExecutionStep {
  key: string;
  stepId: string;
  workflowId: string;
  pointer: string;
  sourceIndex: number;
  topologicalIndex: number;
  dependencies: string[];
  target: ArazzoExecutionTarget;
  resolved: boolean;
  parameters: ArazzoExecutionBinding[];
  requestBody?: ArazzoExecutionBodyBinding;
  outputs: ArazzoExecutionOutput[];
  successActions: ArazzoSuccessAction[];
  failureActions: ArazzoFailureAction[];
  successCriteria: ArazzoCriterion[];
  async?: {
    action?: "send" | "receive";
    correlationId?: string;
    timeout?: number;
  };
}

export interface ArazzoExecutionWorkflow {
  workflowId: string;
  pointer: string;
  steps: ArazzoExecutionStep[];
  cyclic: boolean;
}

export interface ArazzoExecutionPlan {
  documentId: string;
  networkPolicy: "static-only";
  fetchPolicy: "none";
  workflows: ArazzoExecutionWorkflow[];
  unresolvedTargets: Array<{
    workflowId: string;
    stepId: string;
    reason: string;
    pointer: string;
  }>;
  diagnostics: ArazzoDiagnostic[];
}

function dynamicValue(value: unknown) {
  return typeof value === "string"
    && /\$(?:inputs|steps|workflows|sourceDescriptions|response|message)\b/.test(value);
}

function executionTarget(target: ArazzoStepTarget): ArazzoExecutionTarget {
  if (target.kind === "openapi-operation") {
    return {
      kind: "openapi-operation",
      documentId: target.operation.documentId,
      operationId: target.operation.operationId,
      method: target.operation.method,
      path: target.operation.path,
      nodeId: target.operation.nodeId,
    };
  }
  if (target.kind === "workflow") {
    return {
      kind: "workflow",
      documentId: target.targetDocumentId,
      workflowId: target.workflowId,
      pointer: target.targetPointer,
    };
  }
  if (target.kind === "asyncapi-target") {
    return {
      kind: "asyncapi-target",
      sourceName: target.sourceName,
      reference: target.reference,
      bound: target.resolved,
      operationId: target.operation?.operationId,
      channelId: target.operation?.channelId,
      action: target.operation?.action,
    };
  }
  return { kind: "unresolved", reason: target.reason };
}

function parameterBinding(parameter: ArazzoParameter): ArazzoExecutionBinding {
  return {
    name: parameter.name,
    in: parameter.in,
    value: parameter.value,
    dynamic: dynamicValue(parameter.value),
  };
}

function bodyBinding(requestBody: ArazzoRequestBody | undefined) {
  if (!requestBody) return undefined;
  return {
    contentType: requestBody.contentType,
    payload: requestBody.payload,
    dynamic: dynamicValue(requestBody.payload),
  };
}

function topologicalOrder(stepIds: string[], dependenciesByStep: Map<string, string[]>) {
  const indexByStepId = new Map(stepIds.map((stepId, index) => [stepId, index]));
  const incoming = new Map(stepIds.map(stepId => [stepId, 0]));
  const outgoing = new Map<string, string[]>();

  for (const stepId of stepIds) {
    for (const dependency of dependenciesByStep.get(stepId) ?? []) {
      if (!indexByStepId.has(dependency)) continue;
      incoming.set(stepId, (incoming.get(stepId) ?? 0) + 1);
      outgoing.set(dependency, [...(outgoing.get(dependency) ?? []), stepId]);
    }
  }

  const queue = stepIds.filter(stepId => (incoming.get(stepId) ?? 0) === 0);
  const ordered: string[] = [];
  while (queue.length > 0) {
    const stepId = queue.shift()!;
    ordered.push(stepId);
    for (const dependent of outgoing.get(stepId) ?? []) {
      const next = (incoming.get(dependent) ?? 0) - 1;
      incoming.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  const remaining = stepIds.filter(stepId => !ordered.includes(stepId));
  return {
    ordered: [...ordered, ...remaining],
    cyclic: remaining.length > 0,
  };
}

export function compileArazzoExecutionPlan(resolution: ArazzoResolution): ArazzoExecutionPlan {
  const diagnostics: ArazzoDiagnostic[] = [...resolution.diagnostics];
  const workflows = resolution.workflows.map(resolvedWorkflow => {
    const dependenciesByStep = new Map<string, string[]>();
    const stepsById = new Map(resolvedWorkflow.steps.map(resolvedStep => [
      resolvedStep.step.stepId,
      resolvedStep,
    ]));

    for (const resolvedStep of resolvedWorkflow.steps) {
      dependenciesByStep.set(
        resolvedStep.step.stepId,
        (resolvedStep.step.dependsOn ?? []).filter(dependency => stepsById.has(dependency)),
      );
    }

    const order = topologicalOrder(
      resolvedWorkflow.steps.map(resolvedStep => resolvedStep.step.stepId),
      dependenciesByStep,
    );
    const topoIndex = new Map(order.ordered.map((stepId, index) => [stepId, index]));

    if (order.cyclic) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_EXECUTION_PLAN_CYCLE",
          `Workflow "${resolvedWorkflow.workflow.workflowId}" has no static topological execution order because it contains a dependency cycle.`,
          resolvedWorkflow.workflow.pointer,
          resolution.document.documentId,
        ),
      );
    }

    const steps = order.ordered.map(stepId => {
      const sourceIndex = resolvedWorkflow.steps.findIndex(item => item.step.stepId === stepId);
      const resolvedStep = resolvedWorkflow.steps[sourceIndex];
      const step = resolvedStep.step;
      const target = executionTarget(resolvedStep.target);
      return {
        key: step.pointer,
        stepId: step.stepId,
        workflowId: resolvedWorkflow.workflow.workflowId,
        pointer: step.pointer,
        sourceIndex,
        topologicalIndex: topoIndex.get(stepId) ?? sourceIndex,
        dependencies: dependenciesByStep.get(stepId) ?? [],
        target,
        resolved: target.kind !== "unresolved" && !(target.kind === "asyncapi-target" && !target.bound),
        parameters: (step.parameters ?? []).map(parameterBinding),
        requestBody: bodyBinding(step.requestBody),
        outputs: arazzoOutputEntries(step.outputs).map(output => ({
          name: output.name,
          selector: output.selector?.selector ?? output.selector?.query,
          selectorType: output.selector?.type,
          selectorContext: output.selector?.context,
          value: output.value,
        })),
        successActions: step.onSuccess ?? [],
        failureActions: step.onFailure ?? [],
        successCriteria: step.successCriteria ?? [],
        async: step.action || step.correlationId !== undefined || step.timeout !== undefined
          ? {
            action: step.action,
            correlationId: step.correlationId,
            timeout: step.timeout,
          }
          : undefined,
      } satisfies ArazzoExecutionStep;
    });

    return {
      workflowId: resolvedWorkflow.workflow.workflowId,
      pointer: resolvedWorkflow.workflow.pointer,
      steps,
      cyclic: order.cyclic,
    } satisfies ArazzoExecutionWorkflow;
  });

  return {
    documentId: resolution.document.documentId,
    networkPolicy: "static-only",
    fetchPolicy: "none",
    workflows,
    unresolvedTargets: workflows.flatMap(workflow =>
      workflow.steps
        .filter(step => !step.resolved)
        .map(step => ({
          workflowId: workflow.workflowId,
          stepId: step.stepId,
          reason: step.target.kind === "unresolved"
            ? step.target.reason
            : step.target.kind === "asyncapi-target"
              ? "AsyncAPI source is not bound locally."
              : "",
          pointer: step.pointer,
        })),
    ),
    diagnostics,
  };
}
