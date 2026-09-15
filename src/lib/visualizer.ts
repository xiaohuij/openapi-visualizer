import YAML from "yaml";
import type {
  DocumentStats,
  VisualDocument,
  VisualEdgeModel,
  VisualNodeKind,
  VisualNodeModel,
  ParseResult,
  RelationType,
  SearchRecord,
} from "../types";
import { isRecord, schemaType } from "./utils";

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "query",
] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];
const SUPPORTED_OPENAPI_VERSION = /^3\.(?:0|1|2)\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SUPPORTED_SWAGGER_VERSION = /^2\.0(?:\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)?$/;
const SEQUENTIAL_MEDIA_TYPES = new Set([
  "application/jsonl",
  "application/json-seq",
  "application/x-ndjson",
  "text/event-stream",
  "multipart/mixed",
]);

const COMPONENT_KINDS: Record<string, VisualNodeKind> = {
  schemas: "schema",
  securitySchemes: "securityScheme",
  parameters: "parameter",
  requestBodies: "requestBody",
  responses: "response",
  examples: "example",
  headers: "parameter",
  links: "generic",
  callbacks: "generic",
  pathItems: "path",
  mediaTypes: "mediaType",
};

const SWAGGER_COMPONENT_KINDS: Record<string, VisualNodeKind> = {
  definitions: "schema",
  parameters: "parameter",
  responses: "response",
  securityDefinitions: "securityScheme",
};

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

interface PathOperationEntry {
  method: string;
  displayMethod: string;
  value: Record<string, unknown>;
  pointer: string;
  additional: boolean;
}

function pathOperations(pathItem: Record<string, unknown>, base: string): PathOperationEntry[] {
  const entries: PathOperationEntry[] = [];
  for (const method of HTTP_METHODS) {
    const value = pathItem[method];
    if (!isRecord(value)) continue;
    entries.push({
      method,
      displayMethod: method.toUpperCase(),
      value,
      pointer: `${base}/${method}`,
      additional: false,
    });
  }

  const additionalOperations = pathItem.additionalOperations;
  if (isRecord(additionalOperations)) {
    for (const [method, value] of Object.entries(additionalOperations)) {
      if (!isRecord(value) || isHttpMethod(method.toLowerCase())) continue;
      entries.push({
        method,
        displayMethod: method,
        value,
        pointer: `${base}/additionalOperations/${appendPointer("", method).replace(/^\//, "")}`,
        additional: true,
      });
    }
  }
  return entries;
}

function isSequentialMediaType(contentType: string) {
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  return SEQUENTIAL_MEDIA_TYPES.has(normalized);
}

function pointerTokens(pointer: string) {
  return pointer
    .replace(/^#?\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function appendPointer(parent: string, key: string | number) {
  const escaped = String(key).replace(/~/g, "~0").replace(/\//g, "~1");
  return `${parent}/${escaped}`;
}

function valueAtPointer(root: Record<string, unknown>, pointer: string): unknown {
  let current: unknown = root;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (isRecord(current)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
}

function inferKindFromPointer(pointer: string): VisualNodeKind {
  const normalized = pointer.replace(/~1/g, "/").replace(/~0/g, "~");
  if (normalized.includes("/properties/")) return "property";
  if (normalized.includes("/schemas/") || normalized.includes("/definitions/")) return "schema";
  if (normalized.includes("/parameters/")) return "parameter";
  if (normalized.includes("/requestBodies/")) return "requestBody";
  if (normalized.includes("/responses/")) return "response";
  if (normalized.includes("/examples/")) return "example";
  if (normalized.includes("/mediaTypes/")) return "mediaType";
  return "generic";
}

function countRefs(value: unknown): { internal: number; external: number } {
  const references = collectRefs(value);
  return {
    internal: references.filter((reference) => reference.startsWith("#/")).length,
    external: references.filter((reference) => !reference.startsWith("#/")).length,
  };
}

function collectRefs(value: unknown): string[] {
  const references: string[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!isRecord(item)) return;
    for (const [key, child] of Object.entries(item)) {
      if (key === "$ref" && typeof child === "string") {
        references.push(child);
      }
      visit(child);
    }
  };
  visit(value);
  return references;
}

interface CreateModelInput {
  id?: string;
  kind: VisualNodeKind;
  title: string;
  subtitle?: string;
  pointer: string;
  value: unknown;
  metadata?: Record<string, unknown>;
}

class VisualDocumentBuilder {
  readonly models = new Map<string, VisualNodeModel>();
  readonly children = new Map<string, VisualNodeModel[]>();
  readonly edges = new Map<string, VisualEdgeModel>();
  readonly refIndex = new Map<string, string>();
  private edgePairs = new Set<string>();

  constructor(
    raw: Record<string, unknown>,
    sourceText: string,
    fileName: string,
  ) {
    this.raw = raw;
    this.sourceText = sourceText;
    this.fileName = fileName;
  }

  private readonly raw: Record<string, unknown>;
  private readonly sourceText: string;
  private readonly fileName: string;

  create(input: CreateModelInput): VisualNodeModel {
    const model: VisualNodeModel = {
      id: input.id ?? `visualizer:${input.pointer}`,
      kind: input.kind,
      title: input.title,
      subtitle: input.subtitle,
      description: isRecord(input.value) ? getDescription(input.value) : undefined,
      pointer: input.pointer,
      value: input.value,
      badges: [],
      metadata: input.metadata ?? {},
    };
    if (!this.models.has(model.id)) this.models.set(model.id, model);
    return this.models.get(model.id)!;
  }

  connect(
    parent: VisualNodeModel,
    child: VisualNodeModel,
    relation: RelationType = "contains",
    label?: string,
  ) {
    if (parent.id === child.id) return;
    const pair = `${parent.id}→${child.id}:${relation}:${label ?? ""}`;
    if (this.edgePairs.has(pair)) return;
    this.edgePairs.add(pair);
    const edge: VisualEdgeModel = {
      id: `edge:${pair}`,
      source: parent.id,
      target: child.id,
      relation,
      label,
    };
    this.edges.set(edge.id, edge);
    const children = this.children.get(parent.id) ?? [];
    if (!children.some((item) => item.id === child.id)) children.push(child);
    this.children.set(parent.id, children);
    if (!child.primaryParentId) child.primaryParentId = parent.id;
  }

  createGroup(id: string, title: string, value: unknown, parent: VisualNodeModel, subtitle?: string) {
    return this.create({
      id,
      kind: "group",
      title,
      subtitle,
      pointer: "#",
      value,
      metadata: { group: true },
    });
    void parent;
  }

  build(): VisualDocument {
    const specification = typeof this.raw.openapi === "string"
      ? `OpenAPI ${this.raw.openapi}`
      : typeof this.raw.swagger === "string"
        ? `Swagger ${this.raw.swagger}`
        : "Unknown OpenAPI version";

    const root = this.create({
      id: "visualizer:root",
      kind: "root",
      title: getTitle(this.raw),
      subtitle: specification,
      pointer: "#",
      value: this.raw,
      metadata: {
        specification,
        self: this.raw.$self,
        jsonSchemaDialect: this.raw.jsonSchemaDialect,
      },
    });

    this.createTopLevelGroups(root);
    this.preloadVisualModel();
    const searchRecords = this.buildSearchRecords();
    const stats = this.buildStats(specification);

    return {
      fileName: this.fileName,
      sourceText: this.sourceText,
      raw: this.raw,
      models: this.models,
      children: this.children,
      edges: [...this.edges.values()],
      refIndex: this.refIndex,
      searchRecords,
      stats,
    };
  }

  private createTopLevelGroups(root: VisualNodeModel) {
    const tagModels = this.createTagTopology(root);

    if (isRecord(this.raw.paths)) {
      const group = this.create({
        id: "visualizer:group/paths",
        kind: "group",
        title: "Endpoint Paths",
        subtitle: `${Object.keys(this.raw.paths).length} paths`,
        pointer: "#/paths",
        value: this.raw.paths,
      });
      this.connect(root, group);
      this.createPathItems(group, this.raw.paths, "#/paths", false, tagModels);
    }

    if (isRecord(this.raw.webhooks)) {
      const group = this.create({
        id: "visualizer:group/webhooks",
        kind: "group",
        title: "Webhooks",
        subtitle: `${Object.keys(this.raw.webhooks).length} channels`,
        pointer: "#/webhooks",
        value: this.raw.webhooks,
      });
      this.connect(root, group);
      this.createPathItems(group, this.raw.webhooks, "#/webhooks", true, tagModels);
    }

    const components = isRecord(this.raw.components) ? this.raw.components : undefined;
    const componentEntries = Object.entries(components ?? {});
    const handledCategories = new Set<string>();

    for (const [category, value] of componentEntries) {
      if (!isRecord(value)) continue;
      handledCategories.add(category);
      const group = this.create({
        id: `visualizer:group/components/${category}`,
        kind: "group",
        title: prettifyCategory(category),
        subtitle: `${Object.keys(value).length} definitions`,
        pointer: `#/components/${category}`,
        value,
      });
      this.connect(root, group);
      this.createComponentItems(group, category, value, `#/components/${category}`);
    }

    for (const [category, kind] of Object.entries(SWAGGER_COMPONENT_KINDS)) {
      const value = (this.raw as Record<string, Record<string, unknown>>)[category];
      if (!isRecord(value)) continue;
      handledCategories.add(category);
      const group = this.create({
        id: `visualizer:group/${category}`,
        kind: "group",
        title: prettifyCategory(category),
        subtitle: `${Object.keys(value).length} definitions`,
        pointer: `#/${category}`,
        value,
      });
      this.connect(root, group);
      this.createComponentItems(group, category, value, `#/${category}`, kind);
    }

    this.connectOperationSecurity();

    if (Array.isArray(this.raw.servers) && this.raw.servers.length > 0) {
      const group = this.create({
        id: "visualizer:group/servers",
        kind: "group",
        title: "Servers",
        subtitle: `${this.raw.servers.length} environments`,
        pointer: "#/servers",
        value: this.raw.servers,
      });
      this.connect(root, group);
      this.raw.servers.forEach((server, index) => {
        const name = isRecord(server) && typeof server.name === "string" ? server.name : undefined;
        const url = isRecord(server) && typeof server.url === "string" ? server.url : undefined;
        const model = this.create({
          kind: "server",
          title: name ?? url ?? `Server ${index + 1}`,
          subtitle: name ? url ?? getDescription(server) : getDescription(server),
          pointer: `#/servers/${index}`,
          value: server,
          metadata: { serverName: name },
        });
        this.connect(group, model);
      });
    }

    if (!Array.isArray(this.raw.servers) && typeof this.raw.host === "string") {
      const group = this.create({
        id: "visualizer:group/servers",
        kind: "group",
        title: "Servers",
        subtitle: "Swagger host configuration",
        pointer: "#",
        value: {
          host: this.raw.host,
          basePath: this.raw.basePath,
          schemes: this.raw.schemes,
        },
      });
      this.connect(root, group);
      const server = this.create({
        kind: "server",
        title: `${this.raw.host}${typeof this.raw.basePath === "string" ? this.raw.basePath : ""}`,
        subtitle: Array.isArray(this.raw.schemes) ? this.raw.schemes.join(", ") : undefined,
        pointer: "#/host",
        value: {
          host: this.raw.host,
          basePath: this.raw.basePath,
          schemes: this.raw.schemes,
        },
      });
      this.connect(group, server);
    }

    const remainingComponents = componentEntries.filter(([category]) => !handledCategories.has(category));
    if (remainingComponents.length > 0) {
      const value = Object.fromEntries(remainingComponents);
      const group = this.create({
        id: "visualizer:group/components/other",
        kind: "group",
        title: "Other Components",
        subtitle: `${remainingComponents.length} categories`,
        pointer: "#/components",
        value,
      });
      this.connect(root, group);
    }

    if (Array.isArray(this.raw.security)) {
      const securityModels = new Set<VisualNodeModel>();
      for (const requirement of this.raw.security) {
        if (!isRecord(requirement)) continue;
        for (const name of Object.keys(requirement)) {
          const targetId = this.refIndex.get(`security-name:${name}`);
          const target = targetId ? this.models.get(targetId) : undefined;
          if (target) securityModels.add(target);
        }
      }
      if (securityModels.size > 0) {
        const group = this.create({
          id: "visualizer:group/security-requirements",
          kind: "group",
          title: "Global Security",
          subtitle: `${securityModels.size} scheme${securityModels.size === 1 ? "" : "s"}`,
          pointer: "#/security",
          value: this.raw.security,
        });
        this.connect(root, group);
        securityModels.forEach((target) => this.connect(group, target, "security", target.title));
      }
    }
  }

  private connectOperationSecurity() {
    for (const model of this.models.values()) {
      if (model.kind !== "operation" || !isRecord(model.value) || !Array.isArray(model.value.security)) continue;
      for (const requirement of model.value.security) {
        if (!isRecord(requirement)) continue;
        for (const name of Object.keys(requirement)) {
          const targetId = this.refIndex.get(`security-name:${name}`);
          const target = targetId ? this.models.get(targetId) : undefined;
          if (target) this.connect(model, target, "security", name);
        }
      }
    }
  }

  private createTagTopology(root: VisualNodeModel) {
    const modelsByName = new Map<string, VisualNodeModel>();
    if (!Array.isArray(this.raw.tags) || this.raw.tags.length === 0) return modelsByName;

    const group = this.create({
      id: "visualizer:group/tags",
      kind: "group",
      title: "Tags",
      subtitle: `${this.raw.tags.length} tags`,
      pointer: "#/tags",
      value: this.raw.tags,
      metadata: { tagHierarchy: true },
    });
    this.connect(root, group);

    this.raw.tags.forEach((tag, index) => {
      if (!isRecord(tag) || typeof tag.name !== "string") return;
      const model = this.create({
        kind: "tag",
        title: tag.name,
        subtitle: [tag.kind, tag.summary].filter(Boolean).join(" · ") || getDescription(tag),
        pointer: `#/tags/${index}`,
        value: tag,
        metadata: {
          summary: tag.summary,
          kind: tag.kind,
          parent: tag.parent,
        },
      });
      modelsByName.set(tag.name, model);
    });

    for (const model of modelsByName.values()) {
      const parentName = model.metadata.parent;
      const parent = typeof parentName === "string" ? modelsByName.get(parentName) : undefined;
      if (parent) this.connect(parent, model, "contains", "parent");
      else this.connect(group, model);
    }
    return modelsByName;
  }

  private createPathItems(
    parent: VisualNodeModel,
    pathItems: Record<string, unknown>,
    base: string,
    webhook: boolean,
    tagModels: Map<string, VisualNodeModel>,
  ) {
    for (const [path, item] of Object.entries(pathItems)) {
      if (!isRecord(item)) continue;
      const pointer = `${base}/${appendPointer("", path).replace(/^\//, "")}`;
      const operations = pathOperations(item, pointer);
      const pathModel = this.create({
        kind: webhook ? "webhook" : "path",
        title: path,
        subtitle: `${operations.length} operation${operations.length === 1 ? "" : "s"}`,
        pointer,
        value: item,
        metadata: { path, webhook },
      });
      this.connect(parent, pathModel);

      for (const entry of operations) {
        const operation = entry.value;
        const operationModel = this.create({
          kind: "operation",
          title: entry.displayMethod,
          subtitle: typeof operation.operationId === "string"
            ? operation.operationId
            : getDescription(operation, entry.displayMethod),
          pointer: entry.pointer,
          value: operation,
          metadata: {
            method: entry.displayMethod,
            path,
            webhook,
            operationId: operation.operationId,
            deprecated: operation.deprecated === true,
            tags: operation.tags,
            additionalOperation: entry.additional,
          },
        });
        this.connect(pathModel, operationModel, "contains", entry.displayMethod);
        this.createOperationChildren(operationModel, operation, item, entry.pointer, pointer);

        if (Array.isArray(operation.tags)) {
          for (const tagName of operation.tags) {
            if (typeof tagName !== "string") continue;
            const target = tagModels.get(tagName);
            if (target) this.connect(operationModel, target, "tag", tagName);
          }
        }
      }

      if (Array.isArray(item.parameters)) {
        item.parameters.forEach((parameter, index) => {
          const model = this.createParameterModel(parameter, `${pointer}/parameters/${index}`, pathModel, "parameter");
          this.connect(pathModel, model, "parameter");
        });
      }
    }
  }

  private createOperationChildren(
    operation: VisualNodeModel,
    value: Record<string, unknown>,
    pathItem: Record<string, unknown>,
    base: string,
    pathBase: string,
  ) {
    const commonParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    const ownParameters = Array.isArray(value.parameters) ? value.parameters : [];
    const parameters = [...ownParameters, ...commonParameters];

    parameters.forEach((parameter, index) => {
      if (typeof parameter === "string" && parameter.startsWith("#/")) {
        const target = this.resolveInternalRef(parameter);
        if (target) this.connect(operation, target, "parameter");
        return;
      }
      const pointer = index < ownParameters.length
        ? `${base}/parameters/${index}`
        : `${pathBase}/parameters/${index - ownParameters.length}`;
      const model = this.createParameterModel(parameter, pointer, operation, "parameter");
      this.connect(operation, model, "parameter");
    });

    if (isRecord(value.requestBody)) {
      const model = this.create({
        kind: "requestBody",
        title: "Request Body",
        subtitle: value.requestBody.required === true ? "required" : "optional",
        pointer: `${base}/requestBody`,
        value: value.requestBody,
      });
      this.connect(operation, model, "request");
    }

    if (isRecord(value.responses)) {
      for (const [status, response] of Object.entries(value.responses)) {
        const model = this.create({
          kind: "response",
          title: status,
          subtitle: isRecord(response) ? getDescription(response) : undefined,
          pointer: `${base}/responses/${appendPointer("", status).replace(/^\//, "")}`,
          value: response,
          metadata: { status },
        });
        this.connect(operation, model, "response", status);
      }
    }

    if (isRecord(value.callbacks)) {
      for (const [name, callback] of Object.entries(value.callbacks)) {
        const model = this.create({
          kind: "generic",
          title: `Callback: ${name}`,
          pointer: `${base}/callbacks/${appendPointer("", name).replace(/^\//, "")}`,
          value: callback,
        });
        this.connect(operation, model);
      }
    }

    if (Array.isArray(value.security)) {
      for (const requirement of value.security) {
        if (!isRecord(requirement)) continue;
        for (const name of Object.keys(requirement)) {
          const targetId = this.refIndex.get(`security-name:${name}`);
          const target = targetId ? this.models.get(targetId) : undefined;
          if (target) this.connect(operation, target, "security", name);
        }
      }
    }
  }

  private createParameterModel(
    value: unknown,
    pointer: string,
    parent: VisualNodeModel,
    relation: RelationType = "parameter",
  ) {
    void parent;
    if (typeof value === "string" && value.startsWith("#/")) {
      const target = this.resolveInternalRef(value);
      if (target) return target;
    }
    const record = isRecord(value) ? value : {};
    return this.create({
      kind: "parameter",
      title: [record.in, record.name].filter(Boolean).join(":") || "Parameter",
      subtitle: isRecord(record.schema) ? schemaType(record.schema) : undefined,
      pointer,
      value,
      metadata: {
        name: record.name,
        in: record.in,
        querystring: record.in === "querystring",
        required: record.required === true,
        deprecated: record.deprecated === true,
        style: record.style,
      },
    });
  }

  private createComponentItems(
    parent: VisualNodeModel,
    category: string,
    items: Record<string, unknown>,
    base: string,
    overrideKind?: VisualNodeKind,
  ) {
    for (const [name, value] of Object.entries(items)) {
      const kind = overrideKind ?? COMPONENT_KINDS[category] ?? "generic";
      const pointer = `${base}/${appendPointer("", name).replace(/^\//, "")}`;
      const record = isRecord(value) ? value : {};
      const model = this.create({
        kind,
        title: name,
        subtitle: kind === "schema"
          ? schemaType(value)
          : kind === "mediaType"
            ? mediaTypeSubtitle(value)
            : kind === "securityScheme"
              ? [record.type, record.scheme].filter(Boolean).join(" · ") || undefined
              : kind === "response"
                ? getDescription(record)
                : undefined,
        pointer,
        value,
        metadata: {
          componentName: name,
          category,
          contentType: kind === "mediaType" ? name : undefined,
          streaming: kind === "mediaType" ? isSequentialMediaType(name) || isRecord(record.itemSchema) : undefined,
          deprecated: record.deprecated === true,
          oauth2MetadataUrl: record.oauth2MetadataUrl,
        },
      });
      this.connect(parent, model);
      if (kind === "securityScheme") {
        this.refIndex.set(`security-name:${name}`, model.id);
      }
      this.refIndex.set(pointer, model.id);
    }
  }

  private createMediaTypeModel(
    parent: VisualNodeModel,
    contentType: string,
    value: unknown,
    pointer: string,
    relation: RelationType,
  ) {
    const record = isRecord(value) ? value : {};
    const streaming = isSequentialMediaType(contentType) || isRecord(record.itemSchema);
    const model = this.create({
      kind: "mediaType",
      title: contentType,
      subtitle: mediaTypeSubtitle(value),
      pointer,
      value,
      metadata: {
        contentType,
        streaming,
        reusable: typeof record.$ref === "string",
      },
    });
    if (streaming) model.badges.push("stream");
    this.connect(parent, model, relation, contentType);

    if (typeof record.$ref === "string") {
      const target = this.resolveReference(record.$ref, model);
      if (target) this.connect(model, target, "ref", "$ref");
    }
    return model;
  }

  private createExampleModel(parent: VisualNodeModel, name: string, value: unknown, pointer: string) {
    const record = isRecord(value) ? value : {};
    const representation = ["dataValue", "serializedValue", "value", "externalValue"].find((key) => record[key] !== undefined);
    const model = this.create({
      kind: "example",
      title: name,
      subtitle: representation ? `${representation}: ${formatShortValue(record[representation])}` : getDescription(record),
      pointer,
      value,
      metadata: {
        exampleName: name,
        representation,
      },
    });
    this.connect(parent, model, "contains", "example");
    return model;
  }

  private createExampleChildren(parent: VisualNodeModel, value: unknown, base: string) {
    if (!isRecord(value)) return;
    const examples = value.examples;
    if (!isRecord(examples)) return;
    for (const [name, example] of Object.entries(examples)) {
      this.createExampleModel(
        parent,
        name,
        example,
        `${base}/examples/${appendPointer("", name).replace(/^\//, "")}`,
      );
    }
  }

  private createEncodingModel(
    parent: VisualNodeModel,
    title: string,
    value: unknown,
    pointer: string,
    role: string,
  ) {
    const model = this.create({
      kind: "generic",
      title,
      subtitle: isRecord(value) && typeof value.contentType === "string" ? value.contentType : undefined,
      pointer,
      value,
      metadata: { encodingRole: role },
    });
    this.connect(parent, model, "contains", role);
    return model;
  }

  private createEncodingChildren(model: VisualNodeModel) {
    const value = model.value;
    if (!isRecord(value)) return;

    if (isRecord(value.headers)) {
      for (const [name, header] of Object.entries(value.headers)) {
        const child = this.createParameterModel(
          header,
          `${model.pointer}/headers/${appendPointer("", name).replace(/^\//, "")}`,
          model,
          "parameter",
        );
        this.connect(model, child, "parameter", name);
      }
    }

    if (isRecord(value.encoding)) {
      for (const [name, encoding] of Object.entries(value.encoding)) {
        this.createEncodingModel(
          model,
          `Encoding: ${name}`,
          encoding,
          `${model.pointer}/encoding/${appendPointer("", name).replace(/^\//, "")}`,
          `encoding:${name}`,
        );
      }
    }

    if (Array.isArray(value.prefixEncoding)) {
      value.prefixEncoding.forEach((encoding, index) => {
        this.createEncodingModel(
          model,
          `Prefix ${index}`,
          encoding,
          `${model.pointer}/prefixEncoding/${index}`,
          `prefix:${index}`,
        );
      });
    }

    if (isRecord(value.itemEncoding)) {
      this.createEncodingModel(
        model,
        "Item encoding",
        value.itemEncoding,
        `${model.pointer}/itemEncoding`,
        "item",
      );
    }
  }

  private preloadVisualModel() {
    const processed = new Set<string>();
    let frontier = [...this.models.values()];
    while (frontier.length > 0) {
      const next: VisualNodeModel[] = [];
      for (const model of frontier) {
        if (processed.has(model.id)) continue;
        processed.add(model.id);
        this.computeChildren(model).forEach((child) => {
          if (!processed.has(child.id)) next.push(child);
        });
      }
      frontier = next;
    }
  }

  private computeChildren(model: VisualNodeModel): VisualNodeModel[] {
    const before = this.children.get(model.id)?.length ?? 0;
    const value = model.value;

    switch (model.kind) {
      case "parameter": {
        if (isRecord(value)) {
          if (typeof value.$ref === "string") {
            const target = this.resolveReference(value.$ref, model);
            if (target) this.connect(model, target, "ref", "$ref");
          }
          if (isRecord(value.schema)) {
            const schema = this.create({
              kind: "schema",
              title: "Schema",
              subtitle: schemaType(value.schema),
              pointer: `${model.pointer}/schema`,
              value: value.schema,
            });
            this.connect(model, schema, "parameter");
          }
          if (isRecord(value.content)) {
            for (const [contentType, mediaType] of Object.entries(value.content)) {
              this.createMediaTypeModel(
                model,
                contentType,
                mediaType,
                `${model.pointer}/content/${appendPointer("", contentType).replace(/^\//, "")}`,
                "parameter",
              );
            }
          }
          this.createExampleChildren(model, value, model.pointer);
        }
        break;
      }
      case "requestBody":
      case "response": {
        if (isRecord(value)) {
          if (typeof value.$ref === "string") {
            const target = this.resolveReference(value.$ref, model);
            if (target) this.connect(model, target, "ref", "$ref");
          }
          if (isRecord(value.content)) {
            for (const [contentType, mediaType] of Object.entries(value.content)) {
              this.createMediaTypeModel(
                model,
                contentType,
                mediaType,
                `${model.pointer}/content/${appendPointer("", contentType).replace(/^\//, "")}`,
                model.kind === "response" ? "response" : "request",
              );
            }
          }
          if (isRecord(value.schema)) {
            const child = this.create({
              kind: "schema",
              title: "Response Schema",
              subtitle: schemaType(value.schema),
              pointer: `${model.pointer}/schema`,
              value: value.schema,
            });
            this.connect(model, child, "response");
          }
          if (isRecord(value.headers)) {
            for (const [name, header] of Object.entries(value.headers)) {
              const child = this.createParameterModel(
                header,
                `${model.pointer}/headers/${appendPointer("", name).replace(/^\//, "")}`,
                model,
                "parameter",
              );
              this.connect(model, child, "parameter", name);
            }
          }
        }
        break;
      }
      case "mediaType": {
        if (isRecord(value)) {
          if (typeof value.$ref === "string") {
            const target = this.resolveReference(value.$ref, model);
            if (target) this.connect(model, target, "ref", "$ref");
          }
        }
        if (isRecord(value) && isRecord(value.schema)) {
          const relation: RelationType = model.pointer.includes("/responses/") ? "response" : "request";
          const child = this.create({
            kind: "schema",
            title: "Schema",
            subtitle: schemaType(value.schema),
            pointer: `${model.pointer}/schema`,
            value: value.schema,
          });
          this.connect(model, child, relation);
        }
        if (isRecord(value) && isRecord(value.itemSchema)) {
          const relation: RelationType = model.pointer.includes("/responses/") ? "response" : "request";
          const child = this.create({
            kind: "schema",
            title: "Item Schema",
            subtitle: schemaType(value.itemSchema),
            pointer: `${model.pointer}/itemSchema`,
            value: value.itemSchema,
            metadata: { itemSchema: true },
          });
          this.connect(model, child, relation, "itemSchema");
        }
        if (isRecord(value)) {
          this.createEncodingChildren(model);
          this.createExampleChildren(model, value, model.pointer);
        }
        break;
      }
      case "path":
      case "webhook": {
        if (isRecord(value) && typeof value.$ref === "string") {
          const target = this.resolveReference(value.$ref, model);
          if (target) this.connect(model, target, "ref", "$ref");
        }
        break;
      }
      case "schema":
      case "property":
      case "schemaVariant": {
        this.createSchemaChildren(model);
        break;
      }
      case "generic":
      case "example": {
        if (model.metadata.encodingRole !== undefined) {
          this.createEncodingChildren(model);
          break;
        }
        if (!isRecord(value) && !Array.isArray(value)) break;
        const entries = Array.isArray(value)
          ? value.map((item, index) => [String(index), item] as const)
          : Object.entries(value).filter(([, item]) => isRecord(item) || Array.isArray(item));
        for (const [key, item] of entries) {
          const child = this.create({
            kind: "generic",
            title: key,
            pointer: `${model.pointer}/${appendPointer("", key).replace(/^\//, "")}`,
            value: item,
          });
          this.connect(model, child);
        }
        break;
      }
      default:
        break;
    }

    return this.children.get(model.id) ?? [];
  }

  private createSchemaChildren(model: VisualNodeModel) {
    const value = model.value;
    if (!isRecord(value)) return;

    if (typeof value.$ref === "string") {
      const target = this.resolveReference(value.$ref, model);
      if (target) this.connect(model, target, "ref", "$ref");
      return;
    }

    if (isRecord(value.discriminator)) {
      this.connectDiscriminator(model, value.discriminator);
    }

    if (isRecord(value.properties)) {
      for (const [name, property] of Object.entries(value.properties)) {
        const child = this.create({
          kind: "property",
          title: name,
          subtitle: schemaType(property),
          pointer: `${model.pointer}/properties/${appendPointer("", name).replace(/^\//, "")}`,
          value: property,
          metadata: {
            required: Array.isArray(value.required) && value.required.includes(name),
          },
        });
        this.connect(model, child);
      }
    }

    for (const composition of ["allOf", "anyOf", "oneOf", "prefixItems"] as const) {
      const variants = value[composition];
      if (!Array.isArray(variants)) continue;
      variants.forEach((variant, index) => {
        const child = this.create({
          kind: "schemaVariant",
          title: `${composition}[${index}]`,
          subtitle: schemaType(variant),
          pointer: `${model.pointer}/${composition}/${index}`,
          value: variant,
          metadata: { composition, index },
        });
        this.connect(model, child, "ref", composition);
      });
    }

    const singleSchemaKeys: Array<[string, string]> = [
      ["items", "Items"],
      ["not", "Not"],
      ["contains", "Contains"],
      ["propertyNames", "Property Names"],
      ["if", "If"],
      ["then", "Then"],
      ["else", "Else"],
      ["additionalProperties", "Additional Properties"],
      ["unevaluatedItems", "Unevaluated Items"],
      ["unevaluatedProperties", "Unevaluated Properties"],
    ];
    for (const [key, title] of singleSchemaKeys) {
      const schemaValue = value[key];
      if (!isRecord(schemaValue)) continue;
      const child = this.create({
        kind: "schema",
        title,
        subtitle: schemaType(schemaValue),
        pointer: `${model.pointer}/${key}`,
        value: schemaValue,
      });
      this.connect(model, child, "ref", key);
    }

    if (isRecord(value.patternProperties)) {
      for (const [pattern, property] of Object.entries(value.patternProperties)) {
        const child = this.create({
          kind: "property",
          title: pattern,
          subtitle: schemaType(property),
          pointer: `${model.pointer}/patternProperties/${appendPointer("", pattern).replace(/^\//, "")}`,
          value: property,
          metadata: { patternProperty: true },
        });
        this.connect(model, child);
      }
    }

    if (isRecord(value.dependentSchemas)) {
      for (const [property, schema] of Object.entries(value.dependentSchemas)) {
        const child = this.create({
          kind: "schemaVariant",
          title: `dependentSchemas:${property}`,
          subtitle: schemaType(schema),
          pointer: `${model.pointer}/dependentSchemas/${appendPointer("", property).replace(/^\//, "")}`,
          value: schema,
        });
        this.connect(model, child, "ref", "dependentSchemas");
      }
    }

    for (const definitionsKey of ["$defs", "definitions"] as const) {
      const definitions = value[definitionsKey];
      if (!isRecord(definitions)) continue;
      for (const [name, schema] of Object.entries(definitions)) {
        const child = this.create({
          kind: "schema",
          title: name,
          subtitle: schemaType(schema),
          pointer: `${model.pointer}/${definitionsKey}/${appendPointer("", name).replace(/^\//, "")}`,
          value: schema,
          metadata: { localDefinition: true },
        });
        this.connect(model, child, "ref", definitionsKey);
      }
    }
  }

  private connectDiscriminator(model: VisualNodeModel, discriminator: Record<string, unknown>) {
    const mapping = isRecord(discriminator.mapping) ? discriminator.mapping : {};
    const targets: Array<[string, string]> = Object.entries(mapping).map(([key, target]) => [
      `mapping:${key}`,
      typeof target === "string" ? target : "",
    ]);
    if (typeof discriminator.defaultMapping === "string") {
      targets.push(["defaultMapping", discriminator.defaultMapping]);
    }

    for (const [label, targetValue] of targets) {
      if (!targetValue) continue;
      const target = this.resolveSchemaNameOrReference(targetValue);
      if (target) this.connect(model, target, "ref", label);
    }
  }

  private resolveSchemaNameOrReference(value: string) {
    if (value.startsWith("#/")) return this.resolveInternalRef(value);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || value.startsWith("./") || value.startsWith("../")) {
      const root = this.models.get("visualizer:root");
      return root ? this.resolveReference(value, root) : undefined;
    }

    for (const base of ["#/components/schemas/", "#/definitions/"]) {
      const pointer = `${base}${appendPointer("", value).replace(/^\//, "")}`;
      const existingId = this.refIndex.get(pointer);
      const existing = existingId ? this.models.get(existingId) : undefined;
      if (existing) return existing;
      if (valueAtPointer(this.raw, pointer) !== undefined) return this.resolveInternalRef(pointer);
    }
    return undefined;
  }

  private resolveReference(reference: string, context: VisualNodeModel): VisualNodeModel | undefined {
    if (reference.startsWith("#/")) return this.resolveInternalRef(reference);
    const resolvedReference = this.resolveExternalReference(reference);
    const id = `visualizer:external/${resolvedReference}`;
    return this.create({
      id,
      kind: "externalRef",
      title: resolvedReference,
      subtitle: "External reference",
      pointer: resolvedReference,
      value: { $ref: resolvedReference, relativeReference: reference !== resolvedReference ? reference : undefined },
      metadata: { external: true },
    });
    void context;
  }

  private resolveExternalReference(reference: string) {
    const self = this.raw.$self;
    if (typeof self !== "string" || !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(self)) return reference;
    try {
      return new URL(reference, self).toString();
    } catch {
      return reference;
    }
  }

  private resolveInternalRef(reference: string): VisualNodeModel | undefined {
    const existingId = this.refIndex.get(reference);
    if (existingId) return this.models.get(existingId);
    const value = valueAtPointer(this.raw, reference);
    if (value === undefined) return undefined;
    return this.create({
      id: `visualizer:${reference}`,
      kind: inferKindFromPointer(reference),
      title: pointerTokens(reference).at(-1) ?? reference,
      subtitle: schemaType(value),
      pointer: reference,
      value,
    });
  }

  private buildSearchRecords(): SearchRecord[] {
    const scores: Partial<Record<VisualNodeKind, number>> = {
      root: 105,
      operation: 100,
      path: 92,
      webhook: 92,
      schema: 90,
      property: 78,
      parameter: 70,
      response: 68,
      requestBody: 68,
      securityScheme: 66,
      tag: 60,
      server: 52,
      group: 45,
      externalRef: 35,
      generic: 30,
      mediaType: 30,
      example: 30,
      schemaVariant: 30,
    };
    return [...this.models.values()]
      .map((model) => {
        const description = model.description ?? "";
        const operationId = typeof model.metadata.operationId === "string" ? model.metadata.operationId : "";
        const path = typeof model.metadata.path === "string" ? model.metadata.path : "";
        const componentName = typeof model.metadata.componentName === "string" ? model.metadata.componentName : "";
        const compactValue = safeStableStringify(model.value);
        return {
          id: model.id,
          title: model.title,
          subtitle: model.subtitle,
          kind: model.kind,
          score: scores[model.kind] ?? 20,
          text: [model.title, model.subtitle, description, operationId, path, componentName, model.pointer, compactValue]
            .filter(Boolean)
            .join("\n")
            .toLowerCase(),
        } satisfies SearchRecord;
      })
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  }

  private buildStats(specification: string): DocumentStats {
    const models = [...this.models.values()];
    const operations = models.filter((model) => model.kind === "operation" && model.metadata.webhook !== true);
    const webhooks = models.filter((model) => model.kind === "operation" && model.metadata.webhook === true);
    const schemas = models.filter(
      (model) => model.kind === "schema" && (model.pointer.includes("schemas") || model.pointer.includes("definitions")),
    );
    const mediaTypeModels = models.filter((model) => model.kind === "mediaType");
    const streamingMediaKeys = new Set(
      mediaTypeModels
        .filter((model) => model.metadata.streaming === true)
        .map((model) => {
          const reference = isRecord(model.value) && typeof model.value.$ref === "string" ? model.value.$ref : "";
          return reference || `${model.metadata.contentType ?? model.pointer}`;
        }),
    );
    const refs = countRefs(this.raw);
    const unresolvedInternalRefs = new Set(
      collectRefs(this.raw).filter((reference) => reference.startsWith("#/") && valueAtPointer(this.raw, reference) === undefined),
    );
    const incomingSemanticEdges = [...this.edges.values()].filter((edge) => edge.relation !== "contains");
    const referencedSchemaIds = new Set(
      incomingSemanticEdges
        .map((edge) => this.models.get(edge.target))
        .filter((model): model is VisualNodeModel => model?.kind === "schema")
        .map((model) => model.id),
    );
    schemas.forEach((schema) => {
      schema.metadata.orphan = !referencedSchemaIds.has(schema.id);
    });

    return {
      specification,
      paths: models.filter((model) => model.kind === "path").length,
      operations: operations.length,
      webhooks: webhooks.length,
      schemas: schemas.length,
      mediaTypes: mediaTypeModels.filter((model) => model.pointer.startsWith("#/components/mediaTypes/")).length,
      additionalOperations: operations.filter((model) => model.metadata.additionalOperation === true).length,
      streamingMediaTypes: streamingMediaKeys.size,
      refs: refs.internal + refs.external,
      externalRefs: refs.external,
      unresolvedInternalRefs: unresolvedInternalRefs.size,
      deprecated: models.filter((model) => model.metadata.deprecated === true).length,
      orphanSchemas: schemas.filter((schema) => !referencedSchemaIds.has(schema.id)).length,
    };
  }
}

function getDescription(value: Record<string, unknown>, fallback?: string) {
  if (typeof value.summary === "string" && value.summary.trim()) return value.summary;
  if (typeof value.description === "string" && value.description.trim()) return value.description;
  return fallback;
}

function mediaTypeSubtitle(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (typeof value.$ref === "string") return value.$ref;
  if (isRecord(value.itemSchema)) return `item: ${schemaType(value.itemSchema)}`;
  if (isRecord(value.schema)) return schemaType(value.schema);
  return undefined;
}

function formatShortValue(value: unknown) {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function getTitle(raw: Record<string, unknown>) {
  if (isRecord(raw.info)) {
    if (typeof raw.info.title === "string") return raw.info.title;
  }
  return "OpenAPI Document";
}

function prettifyCategory(category: string) {
  if (category === "securitySchemes") return "Security Schemes";
  if (category === "requestBodies") return "Request Bodies";
  if (category === "pathItems") return "Path Items";
  if (category === "securityDefinitions") return "Security Definitions";
  return category.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function safeStableStringify(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => safeStableStringify(item, depth + 1)).join(" ");
  if (!isRecord(value)) return typeof value === "string" ? value : String(value ?? "");
  return Object.entries(value)
    .slice(0, 80)
    .map(([key, item]) => `${key} ${safeStableStringify(item, depth + 1)}`)
    .join(" ");
}

export function parseOpenApiSource(sourceText: string, fileName: string): ParseResult {
  try {
    const parsed = YAML.parse(sourceText, { merge: true });
    if (!isRecord(parsed)) {
      return { error: "The file must contain a YAML mapping or JSON object at the top level." };
    }
    if (typeof parsed.openapi === "string") {
      if (!SUPPORTED_OPENAPI_VERSION.test(parsed.openapi)) {
        return {
          error:
            `Unsupported OpenAPI version \`${parsed.openapi}\`. Supported versions are OpenAPI 3.0.x, 3.1.x, and 3.2.x.`,
        };
      }
    } else if (typeof parsed.swagger === "string") {
      if (!SUPPORTED_SWAGGER_VERSION.test(parsed.swagger)) {
        return {
          error: `Unsupported Swagger version \`${parsed.swagger}\`. Supported version is Swagger 2.0.x.`,
        };
      }
    } else {
      return { error: "Missing required `openapi` or `swagger` version field." };
    }
    if (!isRecord(parsed.paths) && !isRecord(parsed.webhooks) && !isRecord(parsed.components)) {
      return { error: "Missing an API surface: expected `paths`, `webhooks`, or `components`." };
    }
    return { document: new VisualDocumentBuilder(parsed, sourceText, fileName).build() };
  } catch (error) {
    return {
      error: error instanceof Error ? `${fileName}: ${error.message}` : `${fileName}: Unable to parse document.`,
    };
  }
}
