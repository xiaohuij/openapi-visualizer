import {
  arazzoError,
  arazzoWarning,
  type ArazzoDiagnostic,
} from "./diagnostics";
import {
  parseSourceDescriptionExpression,
  parseSourceDescriptionPointer,
} from "./semantic-resolver";
import type { ArazzoDocument, ArazzoStep, ArazzoWorkflow } from "./types";

const SUCCESS_ACTION_TYPES = new Set(["proceed", "goto", "end"]);
const FAILURE_ACTION_TYPES = new Set(["retry", "goto", "end"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionTarget(action: Record<string, unknown>) {
  return action.workflowId ?? action.stepId;
}

function validateAction(
  document: ArazzoDocument,
  workflow: ArazzoWorkflow,
  action: unknown,
  actionPath: string,
  allowedTypes: Set<string>,
  diagnostics: ArazzoDiagnostic[],
) {
  if (!isRecord(action)) {
    diagnostics.push(
      arazzoError("ARAZZO_ACTION_INVALID", "An action must be an object.", actionPath, document.documentId),
    );
    return;
  }

  if (typeof action.type !== "string" || !allowedTypes.has(action.type)) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_ACTION_TYPE_INVALID",
        `Action type must be one of ${[...allowedTypes].join(", ")}.`,
        `${actionPath}/type`,
        document.documentId,
      ),
    );
    return;
  }

  const hasWorkflowId = typeof action.workflowId === "string";
  const hasStepId = typeof action.stepId === "string";
  if (action.type === "goto" && !hasWorkflowId && !hasStepId) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_ACTION_GOTO_TARGET_REQUIRED",
        "A goto action requires a stepId or workflowId.",
        actionPath,
        document.documentId,
      ),
    );
  }
  if (hasWorkflowId && hasStepId) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_ACTION_TARGET_CONFLICT",
        "An action cannot declare both stepId and workflowId.",
        actionPath,
        document.documentId,
      ),
    );
  }

  const workflowTarget = action.workflowId;
  if (
    typeof workflowTarget === "string" &&
    workflowTarget !== workflow.workflowId &&
    !document.workflows.some((candidate) => candidate.workflowId === workflowTarget)
  ) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_ACTION_WORKFLOW_UNRESOLVED",
        `Action workflow target "${workflowTarget}" does not exist in this Arazzo document.`,
        `${actionPath}/workflowId`,
        document.documentId,
      ),
    );
  }

  const stepTarget = action.stepId;
  if (typeof stepTarget === "string" && !workflow.steps.some((step) => step.stepId === stepTarget)) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_ACTION_STEP_UNRESOLVED",
        `Action step target "${stepTarget}" does not exist in workflow "${workflow.workflowId}".`,
        `${actionPath}/stepId`,
        document.documentId,
      ),
    );
  }
}

function validateStep(
  document: ArazzoDocument,
  workflow: ArazzoWorkflow,
  step: ArazzoStep,
  stepIds: Set<string>,
  diagnostics: ArazzoDiagnostic[],
) {
  const declaredTargets = [
    step.operationId,
    step.operationPath,
    step.workflowId,
    step.channelPath,
  ].filter(value => value !== undefined);
  if (declaredTargets.length > 1) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_STEP_TARGET_CONFLICT",
        "A step can declare only one of operationId, operationPath, workflowId, or channelPath.",
        step.pointer,
        document.documentId,
      ),
    );
  }

  const targetExpression = parseSourceDescriptionExpression(step.channelPath ?? step.operationId ?? "");
  const targetPointer = parseSourceDescriptionPointer(step.channelPath ?? step.operationPath ?? "");
  const sourceName = targetExpression?.sourceName ?? targetPointer?.sourceName;
  const source = sourceName
    ? document.sourceDescriptions.find(item => item.name === sourceName)
    : undefined;
  const isAsyncStep = source?.type === "asyncapi" || step.channelPath !== undefined;
  if (step.channelPath && !targetExpression && !targetPointer) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_CHANNEL_TARGET_INVALID",
        "channelPath must use a $sourceDescriptions runtime expression with an AsyncAPI channel or operation pointer.",
        `${step.pointer}/channelPath`,
        document.documentId,
      ),
    );
  }
  if (step.operationPath !== undefined && !targetPointer) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_OPERATION_PATH_INVALID",
        "operationPath must use a $sourceDescriptions runtime expression with a paths, webhooks, channels, or operations pointer.",
        `${step.pointer}/operationPath`,
        document.documentId,
      ),
    );
  }
  if (
    step.operationPath !== undefined
    && targetPointer
    && targetPointer.container === "paths"
    && !targetPointer.method
  ) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_OPERATION_PATH_METHOD_REQUIRED",
        "OpenAPI operationPath targets must end with an HTTP method.",
        `${step.pointer}/operationPath`,
        document.documentId,
      ),
    );
  }

  if (step.action !== undefined && step.action !== "send" && step.action !== "receive") {
    diagnostics.push(
      arazzoError(
        "ARAZZO_ASYNC_ACTION_INVALID",
        "Async step action must be send or receive.",
        `${step.pointer}/action`,
        document.documentId,
      ),
    );
  }
  if (step.action !== undefined && !isAsyncStep) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_ASYNC_ACTION_SOURCE_REQUIRED",
        "An async action requires an AsyncAPI operation or channel target.",
        `${step.pointer}/action`,
        document.documentId,
      ),
    );
  }
  if (isAsyncStep && step.action === undefined) {
    diagnostics.push(
      arazzoWarning(
        "ARAZZO_ASYNC_ACTION_MISSING",
        "AsyncAPI steps should declare whether they send or receive.",
        `${step.pointer}/action`,
        document.documentId,
      ),
    );
  }
  if (step.correlationId !== undefined && step.action !== "receive") {
    diagnostics.push(
      arazzoError(
        "ARAZZO_CORRELATION_ACTION_INVALID",
        "correlationId is only applicable to AsyncAPI receive steps.",
        `${step.pointer}/correlationId`,
        document.documentId,
      ),
    );
  }
  if (step.timeout !== undefined && (!Number.isInteger(step.timeout) || step.timeout < 0)) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_STEP_TIMEOUT_INVALID",
        "timeout must be a non-negative integer number of milliseconds.",
        `${step.pointer}/timeout`,
        document.documentId,
      ),
    );
  }
  if (step.action === "receive" && (step.successCriteria ?? []).length === 0) {
    diagnostics.push(
      arazzoWarning(
        "ARAZZO_ASYNC_RECEIVE_CRITERIA_MISSING",
        "AsyncAPI receive steps should define successCriteria for the received message payload.",
        step.pointer,
        document.documentId,
      ),
    );
  }

  for (const [index, dependency] of (step.dependsOn ?? []).entries()) {
    if (!stepIds.has(dependency)) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_DEPENDENCY_UNRESOLVED",
          `Step dependency "${dependency}" does not exist in workflow "${workflow.workflowId}".`,
          `${step.pointer}/dependsOn/${index}`,
          document.documentId,
        ),
      );
    }
  }

  const successActions = Array.isArray(step.onSuccess) ? step.onSuccess : [];
  successActions.forEach((action, index) => {
    validateAction(
      document,
      workflow,
      action,
      `${step.pointer}/onSuccess/${index}`,
      SUCCESS_ACTION_TYPES,
      diagnostics,
    );
  });

  const failureActions = Array.isArray(step.onFailure) ? step.onFailure : [];
  failureActions.forEach((action, index) => {
    validateAction(
      document,
      workflow,
      action,
      `${step.pointer}/onFailure/${index}`,
      FAILURE_ACTION_TYPES,
      diagnostics,
    );
  });

  if (successActions.length === 0 && failureActions.length === 0) {
    diagnostics.push(
      arazzoWarning(
        "ARAZZO_STEP_ACTIONS_MISSING",
        "Step has no success or failure actions; execution behavior may be implicit.",
        step.pointer,
        document.documentId,
      ),
    );
  }
}

function dependencyCycle(workflow: ArazzoWorkflow) {
  const steps = new Map(workflow.steps.map((step) => [step.stepId, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycle: string[] | undefined;

  const visit = (stepId: string, path: string[]) => {
    if (visited.has(stepId) || cycle) return;
    if (visiting.has(stepId)) {
      const start = path.indexOf(stepId);
      cycle = [...path.slice(start), stepId];
      return;
    }
    visiting.add(stepId);
    const step = steps.get(stepId);
    for (const dependency of step?.dependsOn ?? []) {
      if (steps.has(dependency)) visit(dependency, [...path, stepId]);
    }
    visiting.delete(stepId);
    visited.add(stepId);
  };

  for (const step of workflow.steps) visit(step.stepId, []);
  return cycle;
}

function validateWorkflow(
  document: ArazzoDocument,
  workflow: ArazzoWorkflow,
  workflowIds: Set<string>,
  diagnostics: ArazzoDiagnostic[],
) {
  const stepIds = new Set(workflow.steps.map((step) => step.stepId));
  workflow.steps.forEach((step) => validateStep(document, workflow, step, stepIds, diagnostics));

  const cycle = dependencyCycle(workflow);
  if (cycle) {
    diagnostics.push(
      arazzoError(
        "ARAZZO_DEPENDENCY_CYCLE",
        `Workflow "${workflow.workflowId}" contains a dependency cycle: ${cycle.join(" → ")}.`,
        workflow.pointer,
        document.documentId,
      ),
    );
  }
}

export function validateArazzoDocument(document: ArazzoDocument): ArazzoDiagnostic[] {
  const diagnostics: ArazzoDiagnostic[] = [];
  const sourceNames = new Set<string>();

  document.sourceDescriptions.forEach((source, index) => {
    const key = source.name.toLowerCase();
    if (sourceNames.has(key)) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_SOURCE_NAME_DUPLICATE",
          `Source description name "${source.name}" is used more than once. Names are case-insensitive for uniqueness.`,
          `${source.pointer}/name`,
          document.documentId,
        ),
      );
    }
    sourceNames.add(key);
    if (!source.url) {
      diagnostics.push(
        arazzoWarning(
          "ARAZZO_SOURCE_URL_MISSING",
          "Source description has no URL; bind it to a local document in Workflow Studio.",
          source.pointer,
          document.documentId,
        ),
      );
    }
  });

  const workflowIds = new Set<string>();
  document.workflows.forEach((workflow) => {
    const key = workflow.workflowId.toLowerCase();
    if (workflowIds.has(key)) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_WORKFLOW_ID_DUPLICATE",
          `Workflow ID "${workflow.workflowId}" is used more than once. IDs are case-insensitive for uniqueness.`,
          `${workflow.pointer}/workflowId`,
          document.documentId,
        ),
      );
    }
    workflowIds.add(key);
    validateWorkflow(document, workflow, workflowIds, diagnostics);
  });

  const globalStepIds = new Set<string>();
  for (const workflow of document.workflows) {
    for (const step of workflow.steps) {
      const key = `${workflow.workflowId}:${step.stepId}`.toLowerCase();
      if (globalStepIds.has(key)) {
        diagnostics.push(
          arazzoError(
            "ARAZZO_STEP_ID_DUPLICATE",
            `Step ID "${step.stepId}" is used more than once in workflow "${workflow.workflowId}".`,
            `${step.pointer}/stepId`,
            document.documentId,
          ),
        );
      }
      globalStepIds.add(key);
    }
  }

  return diagnostics;
}
