export type ArazzoSpecificationVersion = "1.0" | "1.1";

export type ArazzoSourceDescriptionType = "openapi" | "asyncapi" | "arazzo";

export interface ArazzoInfo {
  pointer: string;
  title: string;
  version: string;
  description?: string;
  [extension: string]: unknown;
}

export interface ArazzoSourceDescription {
  pointer: string;
  name: string;
  type: ArazzoSourceDescriptionType;
  url?: string;
  [extension: string]: unknown;
}

export interface ArazzoParameter {
  name: string;
  in?: string;
  value?: unknown;
  [extension: string]: unknown;
}

export interface ArazzoSelector {
  type?: "jsonpath" | "xpath" | "jsonpointer";
  context?: string;
  selector?: string;
  query?: string;
  version?: string;
  [extension: string]: unknown;
}

export interface ArazzoCriterion {
  context?: string;
  condition?: string;
  type?: string | ArazzoExpressionType;
  version?: string;
  [extension: string]: unknown;
}

export interface ArazzoExpressionType {
  type: string;
  version?: string;
  [extension: string]: unknown;
}

export interface ArazzoSuccessAction {
  name?: string;
  type?: string;
  stepId?: string;
  workflowId?: string;
  criteria?: ArazzoCriterion[];
  [extension: string]: unknown;
}

export interface ArazzoFailureAction {
  name?: string;
  type?: string;
  stepId?: string;
  workflowId?: string;
  retryConfig?: unknown;
  criteria?: ArazzoCriterion[];
  [extension: string]: unknown;
}

export interface ArazzoRequestBody {
  contentType?: string;
  payload?: unknown;
  replacements?: unknown[];
  [extension: string]: unknown;
}

export interface ArazzoStepOutput {
  name?: string;
  selector?: ArazzoSelector;
  [extension: string]: unknown;
}

export type ArazzoOutputs = ArazzoStepOutput[] | Record<string, unknown>;

export interface ArazzoStep {
  pointer: string;
  stepId: string;
  description?: string;
  dependsOn?: string[];
  operationId?: string;
  operationPath?: string;
  channelPath?: string;
  workflowId?: string;
  action?: "send" | "receive";
  correlationId?: string;
  timeout?: number;
  parameters?: ArazzoParameter[];
  requestBody?: ArazzoRequestBody;
  successCriteria?: ArazzoCriterion[];
  onSuccess?: ArazzoSuccessAction[];
  onFailure?: ArazzoFailureAction[];
  outputs?: ArazzoOutputs;
  [extension: string]: unknown;
}

export interface ArazzoWorkflow {
  pointer: string;
  workflowId: string;
  summary?: string;
  description?: string;
  inputs?: unknown;
  parameters?: ArazzoParameter[];
  dependsOn?: string[];
  steps: ArazzoStep[];
  successActions?: ArazzoSuccessAction[];
  failureActions?: ArazzoFailureAction[];
  outputs?: ArazzoOutputs;
  [extension: string]: unknown;
}

export interface ArazzoComponents {
  inputs?: unknown;
  parameters?: unknown;
  requestBodies?: unknown;
  successActions?: unknown;
  failureActions?: unknown;
  [extension: string]: unknown;
}

export interface ArazzoRawDocument {
  arazzo?: string;
  $self?: string;
  info?: unknown;
  sourceDescriptions?: unknown;
  workflows?: unknown;
  components?: unknown;
  [extension: string]: unknown;
}

/**
 * Normalized view used by this application. The raw Arazzo document remains
 * the source of truth; these convenience fields exist for search and graph
 * construction.
 */
export interface ArazzoDocument {
  documentId: string;
  fileName: string;
  sourceText: string;
  version: string;
  specificationVersion: ArazzoSpecificationVersion;
  self?: string;
  info: ArazzoInfo;
  sourceDescriptions: ArazzoSourceDescription[];
  workflows: ArazzoWorkflow[];
  components?: ArazzoComponents;
  raw: ArazzoRawDocument;
}

export interface ArazzoParseResult {
  document?: ArazzoDocument;
  diagnostics: import("./diagnostics").ArazzoDiagnostic[];
}
