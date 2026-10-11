import { useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Braces,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  FileJson2,
  Layers,
  Link2,
  Route,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Tag as TagIcon,
  Server as ServerIcon,
} from "lucide-react";
import { useAppStore } from "../store";
import { AddStepPanel } from "./workflow/AddStepPanel";
import type { VisualNodeModel } from "../types";
import { isRecord, prettyPointer, schemaType, truncate } from "../lib/utils";
import { useT } from "../i18n";

type InspectorTab = "definition" | "source" | "relations";

function valueAtPointer(root: Record<string, unknown>, pointer: string) {
  let current: unknown = root;
  for (const token of pointer
    .replace(/^#?\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((item) => item.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (Array.isArray(current)) current = current[Number(token)];
    else if (isRecord(current)) current = current[token];
    else return undefined;
  }
  return current;
}

function collectRefs(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string") return value.startsWith("#/") ? [value] : [];
  if (!isRecord(value) && !Array.isArray(value)) return [];
  const entries = Array.isArray(value) ? value.map((item) => [undefined, item] as const) : Object.entries(value);
  return entries.flatMap(([key, item]) => {
    if (key === "$ref" && typeof item === "string") return [item];
    return collectRefs(item, depth + 1);
  });
}

function firstRef(value: unknown) {
  return collectRefs(value, 0)[0];
}

function constraints(schema: unknown) {
  if (!isRecord(schema)) return "—";
  const keys = [
    "format",
    "enum",
    "default",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
    "uniqueItems",
  ];
  const parts = keys
    .filter((key) => schema[key] !== undefined)
    .map((key) => `${key}: ${JSON.stringify(schema[key])}`);
  return parts.length > 0 ? truncate(parts.join(" · "), 140) : "—";
}

function displayValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return value;
  try {
    return truncate(JSON.stringify(value) ?? String(value), 180);
  } catch {
    return truncate(String(value), 180);
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function KeyValue({ entries }: { entries: Array<[string, unknown]> }) {
  return (
    <dl className="key-value">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{displayValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function exampleRows(examples: unknown, t: ReturnType<typeof useT>): React.ReactNode[][] {
  if (!isRecord(examples) || Object.keys(examples).length === 0) {
    return [["—", "—", "—", t("inspector.noNamedExamples")] as React.ReactNode[]];
  }
  return Object.entries(examples).map(([name, example]) => {
    if (!isRecord(example)) return [name, "—", "inline", displayValue(example)] as React.ReactNode[];
    const representation = ["dataValue", "serializedValue", "value", "externalValue"].find(
      (key) => example[key] !== undefined,
    );
    return [
      name,
      String(example.summary ?? "—"),
      representation ?? "—",
      representation ? displayValue(example[representation]) : "—",
    ] as React.ReactNode[];
  });
}

interface EncodingRecordRow {
  path: string;
  contentType: unknown;
  style: unknown;
  explode: unknown;
  nested: string[];
}

function collectEncodingRows(
  value: unknown,
  path: string,
  output: EncodingRecordRow[],
  depth = 0,
) {
  if (!isRecord(value) || depth > 4) return;
  output.push({
    path,
    contentType: value.contentType,
    style: value.style,
    explode: value.explode,
    nested: [
      ...Object.keys(isRecord(value.encoding) ? value.encoding : {}).map((key) => `encoding:${key}`),
      ...(Array.isArray(value.prefixEncoding) ? value.prefixEncoding.map((_, index) => `prefix:${index}`) : []),
      ...(isRecord(value.itemEncoding) ? ["itemEncoding"] : []),
    ],
  });

  if (isRecord(value.encoding)) {
    for (const [name, encoding] of Object.entries(value.encoding)) {
      collectEncodingRows(encoding, `${path}/encoding:${name}`, output, depth + 1);
    }
  }
  if (Array.isArray(value.prefixEncoding)) {
    value.prefixEncoding.forEach((encoding, index) => {
      collectEncodingRows(encoding, `${path}/prefix:${index}`, output, depth + 1);
    });
  }
  if (isRecord(value.itemEncoding)) {
    collectEncodingRows(value.itemEncoding, `${path}/itemEncoding`, output, depth + 1);
  }
}

function encodingRows(value: unknown): React.ReactNode[][] {
  const rows: EncodingRecordRow[] = [];
  collectEncodingRows(value, "media type", rows);
  if (rows.length <= 1 && (rows.length === 0 || rows[0].nested.length === 0)) return [];
  return rows.map((row) => [
    row.path,
    displayValue(row.contentType),
    displayValue(row.style),
    row.explode === true ? "yes" : row.explode === false ? "no" : "—",
    row.nested.length > 0 ? row.nested.join(", ") : "—",
  ]);
}

function oauthFlowRows(flows: Record<string, unknown>, t: ReturnType<typeof useT>): React.ReactNode[][] {
  const rows = Object.entries(flows).map(([name, flow]) => {
    const record = isRecord(flow) ? flow : {};
    return [
      name,
      displayValue(record.authorizationUrl ?? record.deviceAuthorizationUrl),
      displayValue(record.tokenUrl),
      displayValue(record.refreshUrl),
      Object.keys(isRecord(record.scopes) ? record.scopes : {}).join(", ") || "—",
    ] as React.ReactNode[];
  });
  return rows.length > 0 ? rows : [["—", "—", "—", "—", t("inspector.noOauthFlows")] as React.ReactNode[]];
}

function inspectorIcon(model: VisualNodeModel) {
  switch (model.kind) {
    case "root":
      return FileJson2;
    case "group":
      return Layers;
    case "path":
    case "webhook":
      return Route;
    case "parameter":
      return SlidersHorizontal;
    case "requestBody":
      return ArrowUpRight;
    case "response":
      return ArrowDownLeft;
    case "securityScheme":
      return Shield;
    case "mediaType":
      return Braces;
    case "tag":
      return TagIcon;
    case "server":
      return ServerIcon;
    case "example":
      return Sparkles;
    default:
      return Braces;
  }
}

interface InspectorPanelProps {
  open: boolean;
  onToggle: () => void;
}

export function InspectorPanel({ open, onToggle }: InspectorPanelProps) {
  const t = useT();
  const document = useAppStore((state) => state.document);
  const selectedId = useAppStore((state) => state.selectedId);
  const revealNode = useAppStore((state) => state.revealNode);
  const panelRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [tab, setTab] = useState<InspectorTab>("definition");
  const [copied, setCopied] = useState(false);
  const model = document?.models.get(selectedId);

  const source = useMemo(() => {
    if (!model) return "";
    try {
      return YAML.stringify(model.value, { lineWidth: 110 });
    } catch {
      return JSON.stringify(model.value, null, 2);
    }
  }, [model]);

  const relations = useMemo(() => {
    if (!document || !model) return { incoming: [], outgoing: [] };
    return {
      incoming: document.edges.filter((edge) => edge.target === model.id),
      outgoing: document.edges.filter((edge) => edge.source === model.id),
    };
  }, [document, model]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const shouldMoveFocus = panelRef.current?.contains(window.document.activeElement);
      onToggle();
      if (shouldMoveFocus) toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onToggle]);

  const toggleInspector = () => {
    const shouldMoveFocus = open && panelRef.current?.contains(window.document.activeElement);
    onToggle();
    if (shouldMoveFocus) toggleRef.current?.focus();
  };
  const toggleLabel = model
    ? open
      ? `Collapse details for ${model.title}`
      : `Expand details for ${model.title}`
    : open
      ? t("inspector.collapseDetails")
      : t("inspector.expandDetails");
  const toggleButton = (
    <button
      ref={toggleRef}
      type="button"
      className="inspector-toggle"
      aria-expanded={open}
      aria-controls="inspector-panel"
      aria-label={toggleLabel}
      title={toggleLabel}
      onClick={toggleInspector}
    >
      {open ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      <span className="inspector-toggle-label">{t("inspector.details")}</span>
    </button>
  );

  if (!document || !model) {
    return (
      <section className={`inspector-drawer${open ? " open" : ""}`} aria-label={t("inspector.detailsDrawer")}>
        {toggleButton}
        <aside id="inspector-panel" ref={panelRef} className="inspector empty" aria-hidden={!open}>
          {t("inspector.noSelection")}
        </aside>
      </section>
    );
  }
  const Icon = inspectorIcon(model);
  const value = model.value;
  const record = isRecord(value) ? value : {};

  return (
    <section className={`inspector-drawer${open ? " open" : ""}`} aria-label={t("inspector.detailsDrawer")}>
      {toggleButton}
      <aside id="inspector-panel" ref={panelRef} className="inspector" aria-hidden={!open}>
      <header className="inspector-header">
        <div className="inspector-title">
          <span className="inspector-icon">
            <Icon size={19} />
          </span>
          <div>
            <h2>{model.title}</h2>
            <p>{model.subtitle ?? prettyPointer(model.pointer)}</p>
          </div>
        </div>
        <div className="tab-strip">
          {(["definition", "source", "relations"] as InspectorTab[]).map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {t(`inspector.tab.${item}`)}
            </button>
          ))}
        </div>
      </header>

      <div className="inspector-body">
        {tab === "definition" ? (
          <>
            {model.description ? (
              <Section title={t("inspector.description")}>
                <p className="description">{model.description}</p>
              </Section>
            ) : null}

            {model.kind === "root" ? (
              <>
                <Section title={t("inspector.document")}>
                  <KeyValue
                    entries={[
                      [t("inspector.file"), document.fileName],
                      [t("inspector.specification"), document.stats.specification],
                      ["$self", document.raw.$self],
                      [t("inspector.jsonSchemaDialect"), document.raw.jsonSchemaDialect],
                      [t("inspector.title"), isRecord(document.raw.info) ? document.raw.info.title : "—"],
                      [t("inspector.version"), isRecord(document.raw.info) ? document.raw.info.version : "—"],
                      [t("inspector.paths"), document.stats.paths],
                      [t("inspector.operations"), document.stats.operations],
                      [t("inspector.webhooks"), document.stats.webhooks],
                      [t("inspector.schemas"), document.stats.schemas],
                      [t("inspector.reusableMediaTypes"), document.stats.mediaTypes],
                      [t("inspector.additionalOperations"), document.stats.additionalOperations],
                      [t("inspector.streamingMediaTypes"), document.stats.streamingMediaTypes],
                      [t("inspector.references"), document.stats.refs],
                      [t("inspector.deprecatedNodes"), document.stats.deprecated],
                    ]}
                  />
                </Section>
                <Section title={t("inspector.health")}>
                  <KeyValue
                    entries={[
                      [t("inspector.externalReferences"), document.stats.externalRefs],
                      [t("inspector.unresolvedInternal"), document.stats.unresolvedInternalRefs],
                      [t("inspector.potentiallyUnused"), document.stats.orphanSchemas],
                    ]}
                  />
                </Section>
              </>
            ) : null}

            {model.kind === "operation" ? (
              <>
                <Section title={t("inspector.operation")}>
                  <KeyValue
                    entries={[
                      [t("inspector.method"), model.metadata.method ?? "—"],
                      [t("inspector.operationKind"), model.metadata.additionalOperation === true ? t("inspector.additionalOperation") : t("inspector.fixedOperation")],
                      [t("inspector.path"), model.metadata.path ?? "—"],
                      [t("inspector.operationId"), record.operationId ?? "—"],
                      [t("inspector.deprecated"), record.deprecated ? t("inspector.yes") : t("inspector.no")],
                      [t("inspector.tags"), Array.isArray(record.tags) ? record.tags.join(", ") : "—"],
                      [t("inspector.security"), Array.isArray(record.security) ? JSON.stringify(record.security) : "global"],
                    ]}
                  />
                </Section>
                <AddStepPanel operation={model} />
                <Section title={t("inspector.parameters")}>
                  <DataTable
                    headers={[t("inspector.name"), "In", "Required", "Type", "Description"]}
                    rows={parameterTable(model, document.raw, t)}
                  />
                </Section>
                <Section title={t("inspector.requestBody")}>
                  <KeyValue
                    entries={[
                      [t("inspector.required"), isRecord(record.requestBody) && record.requestBody.required ? t("inspector.yes") : t("inspector.no")],
                      [t("inspector.contentTypes"), contentTypes(record.requestBody)],
                      [t("inspector.schema"), firstRef(isRecord(record.requestBody) ? record.requestBody : undefined) ?? t("inspector.inline")],
                    ]}
                  />
                </Section>
                <Section title={t("inspector.responses")}>
                  <DataTable headers={[t("inspector.status"), t("inspector.description"), t("inspector.schema")]} rows={responseTable(record.responses, t)} />
                </Section>
              </>
            ) : null}

            {model.kind === "schema" || model.kind === "property" || model.kind === "schemaVariant" ? (
              <>
                <Section title={t("inspector.schema")}>
                  <KeyValue
                    entries={[
                      [t("inspector.type"), schemaType(value)],
                      [t("inspector.format"), record.format ?? "—"],
                      [t("inspector.required"), model.metadata.required ? t("inspector.yes") : t("inspector.no")],
                      [t("inspector.nullable"), record.nullable ? t("inspector.yes") : t("inspector.no")],
                      [t("inspector.readOnly"), record.readOnly ? t("inspector.yes") : t("inspector.no")],
                      [t("inspector.writeOnly"), record.writeOnly ? t("inspector.yes") : t("inspector.no")],
                    ]}
                  />
                </Section>
                <Section title={t("inspector.constraints")}>
                  <p className="description mono">{constraints(value)}</p>
                </Section>
                {isRecord(record.discriminator) ? (
                  <Section title={t("inspector.discriminator")}>
                    <KeyValue
                      entries={[
                        [t("inspector.propertyName"), record.discriminator.propertyName],
                        [t("inspector.defaultMapping"), record.discriminator.defaultMapping],
                      ]}
                    />
                    {isRecord(record.discriminator.mapping) ? (
                      <DataTable
                        headers={[t("inspector.payloadValue"), t("inspector.schemaNameOrUri")]}
                        rows={Object.entries(record.discriminator.mapping).map(([payloadValue, target]) => [
                          payloadValue,
                          displayValue(target),
                        ])}
                      />
                    ) : null}
                  </Section>
                ) : null}
                {isRecord(record.xml) ? (
                  <Section title={t("inspector.xml")}>
                    <KeyValue
                      entries={[
                        [t("inspector.nodeType"), record.xml.nodeType],
                        [t("inspector.name"), record.xml.name],
                        [t("inspector.namespace"), record.xml.namespace],
                        [t("inspector.prefix"), record.xml.prefix],
                        [t("inspector.attribute"), record.xml.attribute ? t("inspector.yes") : t("inspector.no")],
                        [t("inspector.wrapped"), record.xml.wrapped ? t("inspector.yes") : t("inspector.no")],
                      ]}
                    />
                  </Section>
                ) : null}
                {isRecord(record.properties) ? (
                  <Section title={t("inspector.properties")}>
                    <DataTable
                      headers={[t("inspector.field"), t("inspector.type"), t("inspector.required"), t("inspector.constraints"), t("inspector.reference")]}
                      rows={Object.entries(record.properties).map(([name, property]) => [
                        name,
                        schemaType(property),
                        Array.isArray(record.required) && record.required.includes(name) ? t("inspector.yes") : t("inspector.no"),
                        constraints(property),
                        firstRef(property) ?? "—",
                      ])}
                    />
                  </Section>
                ) : null}
              </>
            ) : null}

            {model.kind === "parameter" ? (
              <Section title={t("inspector.parameter")}>
                <KeyValue
                  entries={[
                    [t("inspector.name"), record.name ?? "—"],
                    [t("inspector.location"), record.in ?? "—"],
                    [t("inspector.required"), record.required ? t("inspector.yes") : t("inspector.no")],
                    [t("inspector.deprecated"), record.deprecated ? t("inspector.yes") : t("inspector.no")],
                    [t("inspector.style"), record.style ?? "—"],
                    [t("inspector.explode"), record.explode ? t("inspector.yes") : t("inspector.no")],
                    [t("inspector.type"), isRecord(record.schema) ? schemaType(record.schema) : "—"],
                    [t("inspector.contentTypes"), contentTypes(record)],
                  ]}
                />
              </Section>
            ) : null}
            {model.kind === "parameter" && (record.example !== undefined || isRecord(record.examples)) ? (
              <Section title={t("inspector.parameterExamples")}>
                {record.example !== undefined ? (
                  <KeyValue
                    entries={[
                      [t("inspector.inlineExample"), record.example],
                    ]}
                  />
                ) : null}
                {isRecord(record.examples) ? (
                  <DataTable headers={[t("inspector.name"), "Summary", "Representation", "Value"]} rows={exampleRows(record.examples, t)} />
                ) : null}
              </Section>
            ) : null}

            {model.kind === "requestBody" || model.kind === "response" || model.kind === "mediaType" ? (
              <Section title={model.kind === "mediaType" ? t("inspector.mediaType") : t("inspector.payload")}>
                <KeyValue
                  entries={[
                    [
                      "Content types",
                      model.kind === "mediaType"
                        ? model.metadata.contentType ?? model.title
                        : contentTypes(value),
                    ],
                    [t("inspector.description"), record.description ?? "—"],
                    [t("inspector.required"), record.required ? t("inspector.yes") : t("inspector.no")],
                    [t("inspector.schemaReference"), firstRef(record.schema) ?? firstRef(value) ?? "inline or absent"],
                    [t("inspector.itemSchemaReference"), firstRef(record.itemSchema) ?? "—"],
                    [t("inspector.sequentialStreaming"), model.metadata.streaming === true ? t("inspector.yes") : t("inspector.no")],
                    [t("inspector.inlineExample"), model.kind === "mediaType" ? record.example : undefined],
                  ]}
                />
                {encodingRows(value).length > 0 ? (
                  <DataTable
                    headers={[t("inspector.path"), "Content type", "Style", "Explode", "Nested"]}
                    rows={encodingRows(value)}
                  />
                ) : null}
              </Section>
            ) : null}

            {model.kind === "mediaType" ? (
              <Section title={t("inspector.examples")}>
                <DataTable
                  headers={[t("inspector.name"), "Summary", "Representation", "Value"]}
                  rows={exampleRows(record.examples, t)}
                />
              </Section>
            ) : null}

            {model.kind === "securityScheme" ? (
              <Section title={t("inspector.securityScheme")}>
                <KeyValue
                  entries={[
                    [t("inspector.type"), record.type ?? "—"],
                    [t("inspector.scheme"), record.scheme ?? "—"],
                    [t("inspector.bearerFormat"), record.bearerFormat ?? "—"],
                    [t("inspector.in"), record.in ?? "—"],
                    [t("inspector.flows"), Object.keys(isRecord(record.flows) ? record.flows : {}).join(", ") || "—"],
                    [t("inspector.oauthMetadataUrl"), record.oauth2MetadataUrl],
                    [t("inspector.openIdConnectUrl"), record.openIdConnectUrl],
                    [t("inspector.deprecated"), record.deprecated ? t("inspector.yes") : t("inspector.no")],
                  ]}
                />
                {isRecord(record.flows) ? (
                  <DataTable
                    headers={[t("inspector.flow"), t("inspector.authorizationUrl"), t("inspector.tokenUrl"), t("inspector.refreshUrl"), t("inspector.scopes")]}
                    rows={oauthFlowRows(record.flows, t)}
                  />
                ) : null}
              </Section>
            ) : null}

            {model.kind === "tag" ? (
              <Section title={t("inspector.tag")}>
                <KeyValue
                  entries={[
                    [t("inspector.name"), record.name],
                    [t("inspector.summary"), record.summary],
                    [t("inspector.kindLabel"), record.kind],
                    [t("inspector.parent"), record.parent],
                    [t("inspector.externalDocs"), isRecord(record.externalDocs) ? record.externalDocs.url : undefined],
                  ]}
                />
              </Section>
            ) : null}

            {model.kind === "server" ? (
              <Section title={t("inspector.server")}>
                <KeyValue
                  entries={[
                    [t("inspector.name"), record.name],
                    [t("inspector.url"), record.url],
                    [t("inspector.description"), record.description],
                    [t("inspector.variables"), Object.keys(isRecord(record.variables) ? record.variables : {}).join(", ")],
                  ]}
                />
              </Section>
            ) : null}

            {model.kind === "example" ? (
              <Section title={t("inspector.example")}>
                <KeyValue
                  entries={[
                    [t("inspector.summary"), record.summary],
                    [t("inspector.description"), record.description],
                    [t("inspector.dataValue"), record.dataValue],
                    [t("inspector.serializedValue"), record.serializedValue],
                    [t("inspector.externalValue"), record.externalValue],
                    [t("inspector.legacyValue"), record.value],
                  ]}
                />
              </Section>
            ) : null}

            <Section title={t("inspector.location")}>
              <p className="mono description">{prettyPointer(model.pointer)}</p>
            </Section>
          </>
        ) : null}

        {tab === "source" ? (
          <div className="source-panel">
            <div className="source-toolbar">
              <span>{t("inspector.normalizedYaml")}</span>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(source);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                }}
              >
                <ClipboardCopy size={14} />
                {copied ? t("inspector.copied") : t("inspector.copy")}
              </button>
            </div>
            <pre>{source || "—"}</pre>
          </div>
        ) : null}

        {tab === "relations" ? (
          <div className="relations-panel">
            <Section title={t("inspector.incomingCount", { count: relations.incoming.length })}>
              <div className="relation-list">
                {relations.incoming.map((edge) => {
                  const target = document.models.get(edge.source);
                  if (!target) return null;
                  return (
                    <button key={edge.id} onClick={() => revealNode(target.id)}>
                      <Link2 size={14} />
                      <span>{target.title}</span>
                      <em>{edge.relation}</em>
                    </button>
                  );
                })}
              </div>
            </Section>
            <Section title={t("inspector.outgoingCount", { count: relations.outgoing.length })}>
              <div className="relation-list">
                {relations.outgoing.map((edge) => {
                  const target = document.models.get(edge.target);
                  if (!target) return null;
                  return (
                    <button key={edge.id} onClick={() => revealNode(target.id)}>
                      <Link2 size={14} />
                      <span>{target.title}</span>
                      <em>{edge.relation}</em>
                    </button>
                  );
                })}
              </div>
            </Section>
          </div>
        ) : null}
      </div>
    </aside>
    </section>
  );
}

function parameterTable(model: VisualNodeModel, root: Record<string, unknown>, t: ReturnType<typeof useT>) {
  const operation = isRecord(model.value) ? model.value : {};
  const parentPointer = model.pointer.split("/").slice(0, -1).join("/");
  const parent = isRecord(valueAtPointer(root, parentPointer)) ? valueAtPointer(root, parentPointer) as Record<string, unknown> : {};
  const own = Array.isArray(operation.parameters) ? operation.parameters : [];
  const common = Array.isArray(parent.parameters) ? parent.parameters : [];
  const parameters = [...own, ...common];
  if (parameters.length === 0) return [["—", "—", "—", "—", t("inspector.noParameters")] as React.ReactNode[]];
  return parameters.map((parameter, index) => {
    if (typeof parameter === "string") {
      return [parameter, "$ref", index < own.length ? t("inspector.derived") : t("inspector.pathLevel"), "—", parameter] as React.ReactNode[];
    }
    if (!isRecord(parameter)) return ["—", "—", "—", "—", "—"] as React.ReactNode[];
    return [
      String(parameter.name ?? "—"),
      String(parameter.in ?? "—"),
      parameter.required ? t("inspector.yes") : t("inspector.no"),
      isRecord(parameter.schema) ? schemaType(parameter.schema) : "—",
      String(parameter.description ?? parameter.summary ?? "—"),
    ] as React.ReactNode[];
  });
}

function responseTable(responses: unknown, t: ReturnType<typeof useT>) {
  if (!isRecord(responses)) return [["—", t("inspector.noResponses"), "—"] as React.ReactNode[]];
  return Object.entries(responses).map(([status, response]) => [
    status,
    isRecord(response) ? String(response.summary ?? response.description ?? "—") : "—",
    firstRef(response) ?? t("inspector.inlineOrAbsent"),
  ] as React.ReactNode[]);
}

function contentTypes(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.content)) return "—";
  const types = Object.keys(payload.content);
  return types.length > 0 ? types.join(", ") : "—";
}
