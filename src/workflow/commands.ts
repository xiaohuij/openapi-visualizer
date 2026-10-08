import { arazzoError, type ArazzoDiagnostic } from "../arazzo/diagnostics";
import { serializeArazzoRaw } from "../arazzo/serializer";
import type {
  ArazzoDocument,
  ArazzoStep,
  ArazzoWorkflow,
} from "../arazzo/types";

export interface ArazzoStepPatch {
  description?: string;
  dependsOn?: string[] | null;
  operationId?: string;
  workflowId?: string;
  channelPath?: string | null;
  action?: ArazzoStep["action"] | null;
  correlationId?: string | null;
  timeout?: number | null;
  parameters?: ArazzoStep["parameters"] | null;
  requestBody?: ArazzoStep["requestBody"] | null;
  onSuccess?: ArazzoStep["onSuccess"];
  onFailure?: ArazzoStep["onFailure"];
  outputs?: ArazzoStep["outputs"];
}

export interface ArazzoAddStepCommand {
  type: "arazzo/addStep";
  workflowId: string;
  stepId: string;
  operationId?: string;
  workflowIdTarget?: string;
  description?: string;
  dependsOn?: string[];
  parameters?: ArazzoStep["parameters"];
  requestBody?: ArazzoStep["requestBody"];
}

export type ArazzoEditorCommand =
  | ArazzoAddStepCommand
  | { type: "arazzo/updateStep"; workflowId: string; stepId: string; patch: ArazzoStepPatch }
  | { type: "arazzo/removeStep"; workflowId: string; stepId: string }
  | {
      type: "arazzo/updateWorkflowMetadata";
      workflowId: string;
      summary?: string;
      description?: string;
    };

export interface ArazzoEditorCommandResult {
  document?: ArazzoDocument;
  diagnostics: ArazzoDiagnostic[];
}

export interface ArazzoEditorHistory {
  past: ArazzoEditorHistoryEntry[];
  present: ArazzoDocument;
  future: ArazzoEditorHistoryEntry[];
}

export interface ArazzoEditorHistoryEntry {
  command: ArazzoEditorCommand;
  document: ArazzoDocument;
}

type NullableArazzoStepPatchKeys =
  | "parameters"
  | "requestBody"
  | "dependsOn"
  | "channelPath"
  | "action"
  | "correlationId"
  | "timeout";

type NormalizedArazzoStepPatch = Omit<ArazzoStepPatch, NullableArazzoStepPatchKeys> & {
  parameters?: ArazzoStep["parameters"];
  requestBody?: ArazzoStep["requestBody"];
  dependsOn?: ArazzoStep["dependsOn"];
  channelPath?: ArazzoStep["channelPath"];
  action?: ArazzoStep["action"];
  correlationId?: ArazzoStep["correlationId"];
  timeout?: ArazzoStep["timeout"];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RawWorkflowRecord = Record<string, unknown> & { steps: unknown[] };

function withDocument(document: ArazzoDocument, workflows: ArazzoWorkflow[], raw: ArazzoDocument["raw"]): ArazzoDocument {
  return {
    ...document,
    workflows,
    raw,
    sourceText: serializeArazzoRaw(raw),
  };
}

function workflowIndexes(document: ArazzoDocument, raw: ArazzoDocument["raw"], workflowId: string) {
  const workflowIndex = document.workflows.findIndex(workflow => workflow.workflowId === workflowId);
  if (workflowIndex === -1) {
    return undefined;
  }
  const rawWorkflows = Array.isArray(raw.workflows) ? raw.workflows : [];
  const rawWorkflow = rawWorkflows[workflowIndex];
  if (!isRecord(rawWorkflow) || !Array.isArray(rawWorkflow.steps)) return undefined;
  return { workflowIndex, rawWorkflows, rawWorkflow: rawWorkflow as RawWorkflowRecord };
}

function failure(code: string, message: string, pointer: string): ArazzoEditorCommandResult {
  return { diagnostics: [arazzoError(code, message, pointer)] };
}

function normalizedPatch(patch: ArazzoStepPatch) {
  const {
    parameters = undefined,
    requestBody = undefined,
    dependsOn = undefined,
    channelPath = undefined,
    action = undefined,
    correlationId = undefined,
    timeout = undefined,
    ...rest
  } = patch;
  const normalized: NormalizedArazzoStepPatch = { ...rest };
  if (parameters !== null && parameters !== undefined) normalized.parameters = parameters;
  if (requestBody !== null && requestBody !== undefined) normalized.requestBody = requestBody;
  if (dependsOn !== null && dependsOn !== undefined) normalized.dependsOn = dependsOn;
  if (channelPath !== null && channelPath !== undefined) normalized.channelPath = channelPath;
  if (action !== null && action !== undefined) normalized.action = action;
  if (correlationId !== null && correlationId !== undefined) normalized.correlationId = correlationId;
  if (timeout !== null && timeout !== undefined) normalized.timeout = timeout;
  return normalized;
}

export function applyArazzoEditorCommand(
  document: ArazzoDocument,
  command: ArazzoEditorCommand,
): ArazzoEditorCommandResult {
  const raw = structuredClone(document.raw);
  const rawWorkflows = Array.isArray(raw.workflows) ? raw.workflows : [];

  if (command.type === "arazzo/addStep") {
    if (!command.stepId) return failure("ARAZZO_COMMAND_STEP_ID_REQUIRED", "A new step requires a stepId.", "#/workflows");
    if (!command.operationId && !command.workflowIdTarget) {
      return failure(
        "ARAZZO_COMMAND_STEP_TARGET_REQUIRED",
        "A new step requires an operation or workflow target.",
        "#/workflows",
      );
    }
    if (command.operationId && command.workflowIdTarget) {
      return failure(
        "ARAZZO_COMMAND_STEP_TARGET_CONFLICT",
        "A new step cannot target both an operation and a workflow.",
        "#/workflows",
      );
    }
    const index = document.workflows.findIndex(workflow => workflow.workflowId === command.workflowId);
    if (index === -1) {
      return failure(
        "ARAZZO_COMMAND_WORKFLOW_NOT_FOUND",
        `Workflow "${command.workflowId}" was not found.`,
        "#/workflows",
      );
    }
    const workflow = document.workflows[index];
    if (workflow.steps.some(step => step.stepId === command.stepId)) {
      return failure(
        "ARAZZO_COMMAND_STEP_ID_DUPLICATE",
        `Step ID "${command.stepId}" already exists in workflow "${command.workflowId}".`,
        `${workflow.pointer}/steps`,
      );
    }

    const stepPointer = `${workflow.pointer}/steps/${workflow.steps.length}`;
    const rawStep: Record<string, unknown> = { stepId: command.stepId };
    if (command.description) rawStep.description = command.description;
    if (command.operationId) rawStep.operationId = command.operationId;
    if (command.workflowIdTarget) rawStep.workflowId = command.workflowIdTarget;
    if (command.dependsOn) rawStep.dependsOn = command.dependsOn;
    if (command.parameters) rawStep.parameters = command.parameters;
    if (command.requestBody) rawStep.requestBody = command.requestBody;

    const step = {
      ...rawStep,
      pointer: stepPointer,
    } as ArazzoStep;
    const nextWorkflow = { ...workflow, steps: [...workflow.steps, step] };
    const workflows = document.workflows.map((item, itemIndex) => itemIndex === index ? nextWorkflow : item);
    const rawWorkflow = rawWorkflows[index];
    if (!isRecord(rawWorkflow) || !Array.isArray(rawWorkflow.steps)) {
      return failure(
        "ARAZZO_COMMAND_WORKFLOW_INVALID",
        "The workflow no longer has a valid steps array in the raw document.",
        workflow.pointer,
      );
    }
    rawWorkflow.steps = [...rawWorkflow.steps, rawStep];
    raw.workflows = rawWorkflows;
    return { document: withDocument(document, workflows, raw), diagnostics: [] };
  }

  if (command.type === "arazzo/updateWorkflowMetadata") {
    const index = document.workflows.findIndex(workflow => workflow.workflowId === command.workflowId);
    if (index === -1) {
      return failure(
        "ARAZZO_COMMAND_WORKFLOW_NOT_FOUND",
        `Workflow "${command.workflowId}" was not found.`,
        "#/workflows",
      );
    }
    const workflow = document.workflows[index];
    const nextWorkflow = { ...workflow };
    if (command.summary !== undefined) nextWorkflow.summary = command.summary;
    if (command.description !== undefined) nextWorkflow.description = command.description;
    const rawWorkflow = rawWorkflows[index];
    if (!isRecord(rawWorkflow)) {
      return failure("ARAZZO_COMMAND_WORKFLOW_INVALID", "The raw workflow is invalid.", workflow.pointer);
    }
    if (command.summary !== undefined) rawWorkflow.summary = command.summary;
    if (command.description !== undefined) rawWorkflow.description = command.description;
    raw.workflows = rawWorkflows;
    return {
      document: withDocument(
        document,
        document.workflows.map((item, itemIndex) => itemIndex === index ? nextWorkflow : item),
        raw,
      ),
      diagnostics: [],
    };
  }

  const located = workflowIndexes(document, raw, command.workflowId);
  if (!located) {
    return failure(
      "ARAZZO_COMMAND_WORKFLOW_NOT_FOUND",
      `Workflow "${command.workflowId}" was not found or has invalid raw data.`,
      "#/workflows",
    );
  }
  const { workflowIndex, rawWorkflow } = located;
  const workflow = document.workflows[workflowIndex];
  const stepIndex = workflow.steps.findIndex(step => step.stepId === command.stepId);
  if (stepIndex === -1) {
    return failure(
      "ARAZZO_COMMAND_STEP_NOT_FOUND",
      `Step "${command.stepId}" was not found in workflow "${command.workflowId}".`,
      `${workflow.pointer}/steps`,
    );
  }

  if (command.type === "arazzo/removeStep") {
    if (workflow.steps.length <= 1) {
      return failure(
        "ARAZZO_COMMAND_LAST_STEP_REQUIRED",
        "An Arazzo workflow must retain at least one step.",
        workflow.pointer,
      );
    }
    const workflows = document.workflows.map((item, itemIndex) =>
      itemIndex === workflowIndex
        ? { ...item, steps: item.steps.filter((_, current) => current !== stepIndex) }
        : item,
    );
    rawWorkflow.steps = rawWorkflow.steps.filter((_, current) => current !== stepIndex);
    raw.workflows = rawWorkflows;
    return { document: withDocument(document, workflows, raw), diagnostics: [] };
  }

  const step = workflow.steps[stepIndex];
  const rawStep = rawWorkflow.steps[stepIndex];
  if (!isRecord(rawStep)) {
    return failure("ARAZZO_COMMAND_STEP_INVALID", "The raw step is invalid.", step.pointer);
  }

  if (command.patch.operationId !== undefined && command.patch.workflowId !== undefined) {
    return failure(
      "ARAZZO_COMMAND_STEP_TARGET_CONFLICT",
      "A step cannot target both an operation and a workflow.",
      step.pointer,
    );
  }

  const patch = normalizedPatch(command.patch);
  const nextStep: ArazzoStep = { ...step, ...patch, pointer: step.pointer, stepId: step.stepId };
  if (command.patch.parameters === null) delete nextStep.parameters;
  if (command.patch.requestBody === null) delete nextStep.requestBody;
  if (command.patch.dependsOn === null) delete nextStep.dependsOn;
  if (command.patch.channelPath === null) delete nextStep.channelPath;
  if (command.patch.action === null) delete nextStep.action;
  if (command.patch.correlationId === null) delete nextStep.correlationId;
  if (command.patch.timeout === null) delete nextStep.timeout;
  if (nextStep.operationId !== undefined && nextStep.workflowId !== undefined) {
    return failure(
      "ARAZZO_COMMAND_STEP_TARGET_CONFLICT",
      "A step cannot target both an operation and a workflow.",
      step.pointer,
    );
  }
  const nextWorkflow = {
    ...workflow,
    steps: workflow.steps.map((item, itemIndex) => itemIndex === stepIndex ? nextStep : item),
  };
  const workflows = document.workflows.map((item, itemIndex) => itemIndex === workflowIndex ? nextWorkflow : item);
  const nextRawStep = { ...rawStep, ...patch };
  if (command.patch.parameters === null) delete nextRawStep.parameters;
  if (command.patch.requestBody === null) delete nextRawStep.requestBody;
  if (command.patch.dependsOn === null) delete nextRawStep.dependsOn;
  if (command.patch.channelPath === null) delete nextRawStep.channelPath;
  if (command.patch.action === null) delete nextRawStep.action;
  if (command.patch.correlationId === null) delete nextRawStep.correlationId;
  if (command.patch.timeout === null) delete nextRawStep.timeout;
  rawWorkflow.steps[stepIndex] = nextRawStep;
  raw.workflows = rawWorkflows;
  return { document: withDocument(document, workflows, raw), diagnostics: [] };
}

export function createArazzoEditorHistory(document: ArazzoDocument): ArazzoEditorHistory {
  return { past: [], present: document, future: [] };
}

export function applyToArazzoEditorHistory(
  history: ArazzoEditorHistory,
  command: ArazzoEditorCommand,
): ArazzoEditorHistory {
  const result = applyArazzoEditorCommand(history.present, command);
  if (!result.document) return history;
  return {
    past: [...history.past, { command, document: history.present }],
    present: result.document,
    future: [],
  };
}

export function undoArazzoEditorHistory(history: ArazzoEditorHistory): ArazzoEditorHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous.document,
    future: [{ command: previous.command, document: history.present }, ...history.future],
  };
}

export function redoArazzoEditorHistory(history: ArazzoEditorHistory): ArazzoEditorHistory {
  const next = history.future[0];
  if (!next) return history;
  const result = applyArazzoEditorCommand(history.present, next.command);
  if (!result.document) return history;
  return {
    past: [...history.past, { command: next.command, document: history.present }],
    present: result.document,
    future: history.future.slice(1),
  };
}
