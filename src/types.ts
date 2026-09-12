export type VisualNodeKind =
  | "root"
  | "group"
  | "path"
  | "webhook"
  | "operation"
  | "parameter"
  | "requestBody"
  | "response"
  | "mediaType"
  | "schema"
  | "property"
  | "schemaVariant"
  | "securityScheme"
  | "server"
  | "tag"
  | "example"
  | "externalRef"
  | "generic";

export type RelationType =
  | "contains"
  | "parameter"
  | "request"
  | "response"
  | "security"
  | "ref";

export interface VisualNodeModel {
  id: string;
  kind: VisualNodeKind;
  title: string;
  subtitle?: string;
  description?: string;
  pointer: string;
  value: unknown;
  primaryParentId?: string;
  badges: string[];
  metadata: Record<string, unknown>;
}

export interface VisualEdgeModel {
  id: string;
  source: string;
  target: string;
  relation: RelationType;
  label?: string;
}

export interface SearchRecord {
  id: string;
  title: string;
  subtitle?: string;
  kind: VisualNodeKind;
  score: number;
  text: string;
}

export interface DocumentStats {
  specification: string;
  paths: number;
  operations: number;
  webhooks: number;
  schemas: number;
  refs: number;
  externalRefs: number;
  deprecated: number;
  orphanSchemas: number;
}

export interface VisualDocument {
  fileName: string;
  sourceText: string;
  raw: Record<string, unknown>;
  models: Map<string, VisualNodeModel>;
  children: Map<string, VisualNodeModel[]>;
  edges: VisualEdgeModel[];
  refIndex: Map<string, string>;
  searchRecords: SearchRecord[];
  stats: DocumentStats;
}

export interface ParseResult {
  document?: VisualDocument;
  error?: string;
}
