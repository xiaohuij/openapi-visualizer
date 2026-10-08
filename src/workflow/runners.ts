import { arazzoError, type ArazzoDiagnostic } from "../arazzo/diagnostics";
import type { ArazzoExecutionPlan, ArazzoExecutionStep } from "./execution-plan";
import {
  executeArazzoMockPlan,
  type ArazzoMockExecutionContext,
  type ArazzoMockExecutionResult,
} from "./mock-execution";

export type ArazzoRunnerAdapterKind = "mock" | "browser-dry-run" | "server" | "external";

export interface ArazzoRequestPreview {
  workflowId: string;
  stepId: string;
  method: string;
  path: string;
  query: Array<{ name: string; value: unknown }>;
  headers: Array<{ name: string; value: unknown }>;
  contentType?: string;
  body?: unknown;
  note: string;
}

export interface ArazzoRunnerCapabilities {
  mockExecution: boolean;
  requestPreview: boolean;
  liveExecution: boolean;
}

export interface ArazzoRunnerExecutionResult {
  result?: ArazzoMockExecutionResult;
  requestPreviews: ArazzoRequestPreview[];
  diagnostics: ArazzoDiagnostic[];
}

export interface ArazzoRunnerAdapter {
  readonly kind: ArazzoRunnerAdapterKind;
  readonly networkPolicy: "mock-only" | "preview-only" | "future";
  readonly capabilities: ArazzoRunnerCapabilities;
  execute(
    plan: ArazzoExecutionPlan,
    context: ArazzoMockExecutionContext,
  ): ArazzoRunnerExecutionResult;
}

function requestPreview(step: ArazzoExecutionStep): ArazzoRequestPreview | undefined {
  if (step.target.kind !== "openapi-operation") return undefined;
  const query = step.parameters
    .filter(parameter => parameter.in === "query" || parameter.in === "querystring")
    .map(parameter => ({ name: parameter.name, value: parameter.value }));
  const headers = step.parameters
    .filter(parameter => parameter.in === "header" || parameter.in === "cookie")
    .map(parameter => ({ name: parameter.name, value: parameter.value }));

  return {
    workflowId: step.workflowId,
    stepId: step.stepId,
    method: step.target.method,
    path: step.target.path,
    query,
    headers,
    contentType: step.requestBody?.contentType,
    body: step.requestBody?.payload,
    note: "Base URL, authentication, CORS, and credentials must be reviewed before any opt-in live run.",
  };
}

function requestPreviews(plan: ArazzoExecutionPlan) {
  return plan.workflows.flatMap(workflow =>
    workflow.steps
      .map(requestPreview)
      .filter((preview): preview is ArazzoRequestPreview => Boolean(preview)),
  );
}

function unsupported(kind: ArazzoRunnerAdapterKind): ArazzoRunnerExecutionResult {
  return {
    requestPreviews: [],
    diagnostics: [
      arazzoError(
        "ARAZZO_RUNNER_NOT_IMPLEMENTED",
        `The "${kind}" runner adapter is intentionally not enabled for live execution in this release.`,
        "#",
      ),
    ],
  };
}

export const mockArazzoRunner: ArazzoRunnerAdapter = {
  kind: "mock",
  networkPolicy: "mock-only",
  capabilities: {
    mockExecution: true,
    requestPreview: true,
    liveExecution: false,
  },
  execute: (plan, context) => ({
    result: executeArazzoMockPlan(plan, context),
    requestPreviews: requestPreviews(plan),
    diagnostics: [],
  }),
};

export const browserDryRunArazzoRunner: ArazzoRunnerAdapter = {
  kind: "browser-dry-run",
  networkPolicy: "preview-only",
  capabilities: {
    mockExecution: true,
    requestPreview: true,
    liveExecution: false,
  },
  execute: (plan, context) => ({
    result: executeArazzoMockPlan(plan, context),
    requestPreviews: requestPreviews(plan),
    diagnostics: [],
  }),
};

export const serverArazzoRunner: ArazzoRunnerAdapter = {
  kind: "server",
  networkPolicy: "future",
  capabilities: {
    mockExecution: false,
    requestPreview: true,
    liveExecution: false,
  },
  execute: plan => ({
    ...unsupported("server"),
    requestPreviews: requestPreviews(plan),
  }),
};

export const externalArazzoRunner: ArazzoRunnerAdapter = {
  kind: "external",
  networkPolicy: "future",
  capabilities: {
    mockExecution: false,
    requestPreview: true,
    liveExecution: false,
  },
  execute: plan => ({
    ...unsupported("external"),
    requestPreviews: requestPreviews(plan),
  }),
};

export function getArazzoRunnerAdapter(kind: ArazzoRunnerAdapterKind) {
  switch (kind) {
    case "mock":
      return mockArazzoRunner;
    case "browser-dry-run":
      return browserDryRunArazzoRunner;
    case "server":
      return serverArazzoRunner;
    case "external":
      return externalArazzoRunner;
  }
}
