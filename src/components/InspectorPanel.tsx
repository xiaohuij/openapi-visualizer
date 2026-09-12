import { useMemo, useState } from "react";
import YAML from "yaml";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Braces,
  ClipboardCopy,
  FileJson2,
  Layers,
  Link2,
  Route,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
import { useAppStore } from "../store";
import type { VisualNodeModel } from "../types";
import { isRecord, prettyPointer, schemaType, truncate } from "../lib/utils";

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
          <dd>{value === undefined || value === null || value === "" ? "—" : String(value)}</dd>
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
    default:
      return Braces;
  }
}

export function InspectorPanel() {
  const document = useAppStore((state) => state.document);
  const selectedId = useAppStore((state) => state.selectedId);
  const revealNode = useAppStore((state) => state.revealNode);
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

  if (!document || !model) return <aside className="inspector empty">No selection</aside>;
  const Icon = inspectorIcon(model);
  const value = model.value;
  const record = isRecord(value) ? value : {};

  return (
    <aside className="inspector">
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
              {item}
            </button>
          ))}
        </div>
      </header>

      <div className="inspector-body">
        {tab === "definition" ? (
          <>
            {model.description ? (
              <Section title="Description">
                <p className="description">{model.description}</p>
              </Section>
            ) : null}

            {model.kind === "root" ? (
              <>
                <Section title="Document">
                  <KeyValue
                    entries={[
                      ["File", document.fileName],
                      ["Specification", document.stats.specification],
                      ["Title", isRecord(document.raw.info) ? document.raw.info.title : "—"],
                      ["Version", isRecord(document.raw.info) ? document.raw.info.version : "—"],
                      ["Paths", document.stats.paths],
                      ["Operations", document.stats.operations],
                      ["Webhooks", document.stats.webhooks],
                      ["Schemas", document.stats.schemas],
                      ["References", document.stats.refs],
                      ["Deprecated nodes", document.stats.deprecated],
                    ]}
                  />
                </Section>
                <Section title="Health">
                  <KeyValue
                    entries={[
                      ["External references", document.stats.externalRefs],
                      ["Potentially unused schemas", document.stats.orphanSchemas],
                    ]}
                  />
                </Section>
              </>
            ) : null}

            {model.kind === "operation" ? (
              <>
                <Section title="Operation">
                  <KeyValue
                    entries={[
                      ["Method", model.metadata.method ?? "—"],
                      ["Path", model.metadata.path ?? "—"],
                      ["Operation ID", record.operationId ?? "—"],
                      ["Deprecated", record.deprecated ? "yes" : "no"],
                      ["Tags", Array.isArray(record.tags) ? record.tags.join(", ") : "—"],
                      ["Security", Array.isArray(record.security) ? JSON.stringify(record.security) : "global"],
                    ]}
                  />
                </Section>
                <Section title="Parameters">
                  <DataTable
                    headers={["Name", "In", "Required", "Type", "Description"]}
                    rows={parameterTable(model, document.raw)}
                  />
                </Section>
                <Section title="Request body">
                  <KeyValue
                    entries={[
                      ["Required", isRecord(record.requestBody) && record.requestBody.required ? "yes" : "no"],
                      ["Content types", contentTypes(record.requestBody)],
                      ["Schema", firstRef(isRecord(record.requestBody) ? record.requestBody : undefined) ?? "inline"],
                    ]}
                  />
                </Section>
                <Section title="Responses">
                  <DataTable headers={["Status", "Description", "Schema"]} rows={responseTable(record.responses)} />
                </Section>
              </>
            ) : null}

            {model.kind === "schema" || model.kind === "property" || model.kind === "schemaVariant" ? (
              <>
                <Section title="Schema">
                  <KeyValue
                    entries={[
                      ["Type", schemaType(value)],
                      ["Format", record.format ?? "—"],
                      ["Required", model.metadata.required ? "yes" : "no"],
                      ["Nullable", record.nullable ? "yes" : "no"],
                      ["Read only", record.readOnly ? "yes" : "no"],
                      ["Write only", record.writeOnly ? "yes" : "no"],
                    ]}
                  />
                </Section>
                <Section title="Constraints">
                  <p className="description mono">{constraints(value)}</p>
                </Section>
                {isRecord(record.properties) ? (
                  <Section title="Properties">
                    <DataTable
                      headers={["Field", "Type", "Required", "Constraints", "Reference"]}
                      rows={Object.entries(record.properties).map(([name, property]) => [
                        name,
                        schemaType(property),
                        Array.isArray(record.required) && record.required.includes(name) ? "yes" : "no",
                        constraints(property),
                        firstRef(property) ?? "—",
                      ])}
                    />
                  </Section>
                ) : null}
              </>
            ) : null}

            {model.kind === "parameter" ? (
              <Section title="Parameter">
                <KeyValue
                  entries={[
                    ["Name", record.name ?? "—"],
                    ["Location", record.in ?? "—"],
                    ["Required", record.required ? "yes" : "no"],
                    ["Deprecated", record.deprecated ? "yes" : "no"],
                    ["Style", record.style ?? "—"],
                    ["Explode", record.explode ? "yes" : "no"],
                    ["Type", isRecord(record.schema) ? schemaType(record.schema) : "—"],
                  ]}
                />
              </Section>
            ) : null}

            {model.kind === "requestBody" || model.kind === "response" || model.kind === "mediaType" ? (
              <Section title="Payload">
                <KeyValue
                  entries={[
                    ["Content types", contentTypes(value)],
                    ["Description", record.description ?? "—"],
                    ["Required", record.required ? "yes" : "no"],
                    ["Schema reference", firstRef(value) ?? "inline or absent"],
                  ]}
                />
              </Section>
            ) : null}

            {model.kind === "securityScheme" ? (
              <Section title="Security scheme">
                <KeyValue
                  entries={[
                    ["Type", record.type ?? "—"],
                    ["Scheme", record.scheme ?? "—"],
                    ["Bearer format", record.bearerFormat ?? "—"],
                    ["In", record.in ?? "—"],
                    ["Flows", Object.keys(isRecord(record.flows) ? record.flows : {}).join(", ") || "—"],
                  ]}
                />
              </Section>
            ) : null}

            <Section title="Location">
              <p className="mono description">{prettyPointer(model.pointer)}</p>
            </Section>
          </>
        ) : null}

        {tab === "source" ? (
          <div className="source-panel">
            <div className="source-toolbar">
              <span>Normalized YAML for this node</span>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(source);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                }}
              >
                <ClipboardCopy size={14} />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre>{source || "—"}</pre>
          </div>
        ) : null}

        {tab === "relations" ? (
          <div className="relations-panel">
            <Section title={`Incoming (${relations.incoming.length})`}>
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
            <Section title={`Outgoing (${relations.outgoing.length})`}>
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
  );
}

function parameterTable(model: VisualNodeModel, root: Record<string, unknown>) {
  const operation = isRecord(model.value) ? model.value : {};
  const parentPointer = model.pointer.split("/").slice(0, -1).join("/");
  const parent = isRecord(valueAtPointer(root, parentPointer)) ? valueAtPointer(root, parentPointer) as Record<string, unknown> : {};
  const own = Array.isArray(operation.parameters) ? operation.parameters : [];
  const common = Array.isArray(parent.parameters) ? parent.parameters : [];
  const parameters = [...own, ...common];
  if (parameters.length === 0) return [["—", "—", "—", "—", "No parameters"] as React.ReactNode[]];
  return parameters.map((parameter, index) => {
    if (typeof parameter === "string") {
      return [parameter, "$ref", index < own.length ? "derived" : "path-level", "—", parameter] as React.ReactNode[];
    }
    if (!isRecord(parameter)) return ["—", "—", "—", "—", "—"] as React.ReactNode[];
    return [
      String(parameter.name ?? "—"),
      String(parameter.in ?? "—"),
      parameter.required ? "yes" : "no",
      isRecord(parameter.schema) ? schemaType(parameter.schema) : "—",
      String(parameter.description ?? parameter.summary ?? "—"),
    ] as React.ReactNode[];
  });
}

function responseTable(responses: unknown) {
  if (!isRecord(responses)) return [["—", "No responses", "—"] as React.ReactNode[]];
  return Object.entries(responses).map(([status, response]) => [
    status,
    isRecord(response) ? String(response.description ?? "—") : "—",
    firstRef(response) ?? "inline or absent",
  ] as React.ReactNode[]);
}

function contentTypes(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.content)) return "—";
  const types = Object.keys(payload.content);
  return types.length > 0 ? types.join(", ") : "—";
}
