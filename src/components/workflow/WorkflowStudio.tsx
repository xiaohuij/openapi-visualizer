import { useCallback, useMemo, useState } from "react";
import { CircleAlert, Download, FileJson2, Redo2, Route, Trash2, Undo2 } from "lucide-react";
import { validateArazzoWorkflowComposition } from "../../arazzo/composition";
import { validateArazzoDocument } from "../../arazzo/validator";
import type { ArazzoDiagnostic } from "../../arazzo/diagnostics";
import { resolveArazzoDocument, type ArazzoStepTarget } from "../../arazzo/semantic-resolver";
import { validateArazzoRuntimeExpressions } from "../../arazzo/runtime-expression";
import { serializeArazzoDocument, type ArazzoSerializationFormat } from "../../arazzo/serializer";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { cn } from "../../lib/utils";
import { OpenApiCapabilityIndex } from "../../workflow/capability-index";
import { compileArazzoExecutionPlan } from "../../workflow/execution-plan";
import type { ArazzoWorkspaceDocument, WorkspaceDocument } from "../../workflow/document-registry";
import { useWorkflowStore } from "../../workflow/store";
import { useAppStore } from "../../store";
import { StepInspector } from "./StepInspector";
import { ExecutionPlanPanel } from "./ExecutionPlanPanel";
import { MockExecutionPanel } from "./MockExecutionPanel";

function documentTitle(document: WorkspaceDocument) {
  if (document.kind === "openapi") {
    const root = [...document.document.models.values()].find((model) => model.id === "visualizer:root");
    return root?.title ?? document.fileName;
  }
  return document.document?.info.title ?? document.fileName;
}

function DocumentListItem({ document }: { document: WorkspaceDocument }) {
  const activeArazzoDocumentId = useWorkflowStore((state) => state.activeArazzoDocumentId);
  const setActiveArazzoDocument = useWorkflowStore((state) => state.setActiveArazzoDocument);
  const removeDocument = useWorkflowStore((state) => state.removeDocument);
  const active = document.kind === "arazzo" && document.id === activeArazzoDocumentId;

  return (
    <li className={cn("workflow-document", active && "active")}>
      <button
        type="button"
        onClick={() => {
          if (document.kind === "arazzo") setActiveArazzoDocument(document.id);
        }}
        disabled={document.kind !== "arazzo"}
        aria-current={active ? "true" : undefined}
      >
        <span className="workflow-document-kind">{document.kind}</span>
        <strong>{documentTitle(document)}</strong>
        <span>{document.fileName}</span>
      </button>
      <button
        type="button"
        className="workflow-remove-button"
        onClick={() => removeDocument(document.id)}
        aria-label={`Remove ${document.fileName} from workflow workspace`}
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

function SourceDescriptionBindings({ document }: { document: ArazzoWorkspaceDocument }) {
  const registry = useWorkflowStore((state) => state.registry);
  const revision = useWorkflowStore((state) => state.revision);
  const bindSourceDescription = useWorkflowStore((state) => state.bindSourceDescription);
  const unbindSourceDescription = useWorkflowStore((state) => state.unbindSourceDescription);
  void revision;
  if (!document.document) return null;

  return (
    <section className="workflow-panel" aria-label="Source descriptions">
      <h2>Source descriptions</h2>
      {document.document.sourceDescriptions.map((source) => {
        const binding = registry.getBinding(document.id, source.name);
        const candidates = registry
          .list()
          .filter((item) => item.kind === (source.type as WorkspaceDocument["kind"]));
        return (
          <div className="source-binding" key={source.name}>
            <div>
              <strong>{source.name}</strong>
              <span>{source.type}</span>
            </div>
            {source.type === "asyncapi" ? (
              <p>AsyncAPI local documents are supported in a later increment.</p>
            ) : (
              <label>
                <span>Bound local document</span>
                <select
                  value={binding?.targetDocumentId ?? ""}
                  onChange={(event) => {
                    if (event.target.value) {
                      bindSourceDescription(document.id, source.name, event.target.value);
                    } else {
                      unbindSourceDescription(document.id, source.name);
                    }
                  }}
                >
                  <option value="">Not bound</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {documentTitle(candidate)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })}
    </section>
  );
}

function targetLabel(target: ArazzoStepTarget | undefined) {
  if (!target) return "Unresolved target";
  if (target.kind === "openapi-operation") return `resolved · ${target.operation.method} ${target.operation.path}`;
  if (target.kind === "workflow") return `resolved workflow · ${target.workflowId}`;
  if (target.kind === "asyncapi-target") {
    return `${target.resolved ? "async target" : "unbound async target"} · ${target.reference}`;
  }
  return target.reason;
}

function targetState(target: ArazzoStepTarget | undefined) {
  if (!target || target.kind === "unresolved") return "unresolved";
  if (target.kind === "asyncapi-target") return target.resolved ? "resolved" : "unresolved";
  return "resolved";
}

function DiagnosticsPanel({
  document,
  semanticDiagnostics,
  validationDiagnostics,
}: {
  document: ArazzoWorkspaceDocument;
  semanticDiagnostics: ArazzoDiagnostic[];
  validationDiagnostics: ArazzoDiagnostic[];
}) {
  const diagnostics = [...document.diagnostics, ...semanticDiagnostics, ...validationDiagnostics];
  return (
    <section className="workflow-panel" aria-label="Arazzo diagnostics">
      <h2>Diagnostics</h2>
      {diagnostics.length === 0 ? (
        <p className="workflow-empty-note">No diagnostics.</p>
      ) : (
        <ul className="workflow-diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <li className={diagnostic.severity} key={`${diagnostic.code}-${diagnostic.pointer}-${index}`}>
              <CircleAlert size={14} />
              <div>
                <strong>{diagnostic.code}</strong>
                <span>{diagnostic.pointer}</span>
                <p>{diagnostic.message}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WorkflowStudio() {
  const registry = useWorkflowStore((state) => state.registry);
  const revision = useWorkflowStore((state) => state.revision);
  const activeArazzoDocumentId = useWorkflowStore((state) => state.activeArazzoDocumentId);
  const lastError = useWorkflowStore((state) => state.lastError);
  const setSurface = useWorkflowStore((state) => state.setSurface);
  const undoArazzoEdit = useWorkflowStore((state) => state.undoArazzoEdit);
  const redoArazzoEdit = useWorkflowStore((state) => state.redoArazzoEdit);
  const editorHistories = useWorkflowStore((state) => state.editorHistories);
  const loadOpenApiDocument = useAppStore((state) => state.loadSource);
  const revealNode = useAppStore((state) => state.revealNode);
  const [selectedStepPointer, setSelectedStepPointer] = useState<string>();
  const documents = registry.list();
  const active = documents.find(
    (document): document is ArazzoWorkspaceDocument =>
      document.kind === "arazzo" && document.id === activeArazzoDocumentId,
  ) ?? documents.find((document): document is ArazzoWorkspaceDocument => document.kind === "arazzo");
  const capabilityIndex = useMemo(
    () => new OpenApiCapabilityIndex(registry.listOpenApi()),
    [registry, revision],
  );
  const resolution = useMemo(
    () => (active?.document ? resolveArazzoDocument(active.document, registry, capabilityIndex) : undefined),
    [active?.document, registry, capabilityIndex],
  );
  const executionPlan = useMemo(
    () => (resolution ? compileArazzoExecutionPlan(resolution) : undefined),
    [resolution],
  );
  const validationDiagnostics = useMemo(
    () => (active?.document ? validateArazzoDocument(active.document) : []),
    [active?.document],
  );
  const runtimeDiagnostics = useMemo(
    () => (active?.document ? validateArazzoRuntimeExpressions(active.document) : []),
    [active?.document],
  );
  const compositionDiagnostics = useMemo(
    () => (active?.document ? validateArazzoWorkflowComposition(active.document, registry) : []),
    [active?.document, registry, revision],
  );
  const diagnostics = useMemo(
    () => [
      ...(active?.diagnostics ?? []),
      ...(resolution?.diagnostics ?? []),
      ...validationDiagnostics,
      ...runtimeDiagnostics,
      ...compositionDiagnostics,
    ],
    [
      active?.diagnostics,
      resolution?.diagnostics,
      validationDiagnostics,
      runtimeDiagnostics,
      compositionDiagnostics,
    ],
  );
  const selectedStep = resolution?.workflows
    .flatMap(resolvedWorkflow =>
      resolvedWorkflow.steps.map(resolvedStep => ({ resolvedWorkflow, resolvedStep })),
    )
    .find(item => item.resolvedStep.step.pointer === selectedStepPointer);
  const openOperation = useCallback(
    (documentId: string, nodeId: string) => {
      const target = registry.get(documentId);
      if (target?.kind !== "openapi") return;
      if (!loadOpenApiDocument(target.document.sourceText, target.document.fileName)) return;
      revealNode(nodeId);
      setSurface("api");
    },
    [loadOpenApiDocument, registry, revealNode, setSurface],
  );
  const downloadArazzo = useCallback(
    (format: ArazzoSerializationFormat) => {
      if (!active?.document) return;
      const source = serializeArazzoDocument(active.document, format);
      const blob = new Blob([source], {
        type: format === "json" ? "application/json" : "application/yaml",
      });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${active.document.fileName.replace(/\.(ya?ml|json)$/i, "")}.arazzo.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [active?.document],
  );

  return (
    <main className="workflow-studio" aria-labelledby="workflow-studio-title">
      <aside className="workflow-sidebar">
        <header>
          <Route size={18} />
          <h1 id="workflow-studio-title">Workflow Studio</h1>
        </header>
        <section className="workflow-panel" aria-label="Workspace documents">
          <h2>Documents</h2>
          {documents.length === 0 ? (
            <p className="workflow-empty-note">Open an Arazzo document to start a local workflow workspace.</p>
          ) : (
            <ul className="workflow-documents">
              {documents.map((document) => (
                <DocumentListItem key={document.id} document={document} />
              ))}
            </ul>
          )}
        </section>
        {active?.document ? <SourceDescriptionBindings document={active} /> : null}
      </aside>

      <section className="workflow-content">
        {lastError ? <div className="workflow-error" role="alert">{lastError}</div> : null}
        {!active?.document ? (
          <div className="workflow-empty-state">
            <FileJson2 size={32} />
            <h2>No Arazzo document selected</h2>
            <p>
              Import an Arazzo YAML or JSON file. Documents stay in this browser and source
              description URLs are not fetched automatically.
            </p>
          </div>
        ) : (
          <>
            <header className="workflow-document-header">
              <div>
                <span>Arazzo {active.document.version}</span>
                <h2>{active.document.info.title}</h2>
                <p>{active.document.info.description ?? active.document.fileName}</p>
              </div>
              <div className="workflow-document-actions">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!editorHistories[active.id]?.past.length}
                  onClick={() => undoArazzoEdit(active.id)}
                >
                  <Undo2 size={14} />
                  Undo
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!editorHistories[active.id]?.future.length}
                  onClick={() => redoArazzoEdit(active.id)}
                >
                  <Redo2 size={14} />
                  Redo
                </button>
                <button type="button" className="ghost-button" onClick={() => downloadArazzo("yaml")}>
                  <Download size={14} />
                  YAML
                </button>
                <button type="button" className="ghost-button" onClick={() => downloadArazzo("json")}>
                  <Download size={14} />
                  JSON
                </button>
              </div>
            </header>
            {resolution ? (
              <WorkflowCanvas
                resolution={resolution}
                selectedStepPointer={selectedStep?.resolvedStep.step.pointer}
                onSelectStep={setSelectedStepPointer}
              />
            ) : null}
            {executionPlan ? <ExecutionPlanPanel plan={executionPlan} /> : null}
            {executionPlan ? <MockExecutionPanel plan={executionPlan} /> : null}
            {selectedStep ? (
              <StepInspector
                resolvedStep={selectedStep.resolvedStep}
                workflow={selectedStep.resolvedWorkflow.workflow}
                sourceText={active.document.sourceText}
                diagnostics={diagnostics}
                onOpenOperation={operation => openOperation(operation.documentId, operation.nodeId)}
              />
            ) : null}
            <div className="workflow-list">
              {active.document.workflows.map((workflow) => (
                <article className="workflow-card" key={workflow.workflowId}>
                  <header>
                    <div>
                      <h3>{workflow.workflowId}</h3>
                      <p>{workflow.summary ?? workflow.description ?? "No workflow summary"}</p>
                    </div>
                  </header>
                  <ol className="workflow-steps">
                    {workflow.steps.map((step) => {
                      const resolvedStep = resolution?.workflows
                        .find((item) => item.workflow.workflowId === workflow.workflowId)
                        ?.steps.find((item) => item.step.stepId === step.stepId);
                      return (
                        <li key={step.stepId}>
                          <div className={cn("workflow-step-summary", selectedStep?.resolvedStep.step.pointer === step.pointer && "selected")}>
                            <strong>{step.stepId}</strong>
                            <span>
                              {step.operationId
                                ? `operation: ${step.operationId}`
                                : step.workflowId
                                  ? `workflow: ${step.workflowId}`
                                  : "No target"}
                            </span>
                            <span className={`workflow-target ${targetState(resolvedStep?.target)}`}>
                              {targetLabel(resolvedStep?.target)}
                            </span>
                            {step.dependsOn?.length ? <em>depends on {step.dependsOn.join(", ")}</em> : null}
                            <button type="button" onClick={() => setSelectedStepPointer(step.pointer)}>
                              Inspect step
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </article>
              ))}
            </div>
            <DiagnosticsPanel
              document={active}
              semanticDiagnostics={resolution?.diagnostics ?? []}
              validationDiagnostics={validationDiagnostics}
            />
          </>
        )}
      </section>
    </main>
  );
}
