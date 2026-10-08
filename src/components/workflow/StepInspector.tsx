import { CircleAlert, ExternalLink, ListOrdered } from "lucide-react";
import type { ArazzoDiagnostic } from "../../arazzo/diagnostics";
import type {
  ArazzoResolvedStep,
  ArazzoStepTarget,
} from "../../arazzo/semantic-resolver";
import { arazzoSourceSnippet } from "../../arazzo/source-snippet";
import { arazzoOutputEntries } from "../../arazzo/outputs";
import type { ArazzoWorkflow } from "../../arazzo/types";
import type { OpenApiOperationCapability } from "../../workflow/capability-index";
import { getText } from "../../lib/utils";
import { AsyncStepEditor } from "./AsyncStepEditor";
import { DependencyEditor } from "./DependencyEditor";
import { StepMappingsEditor } from "./StepMappingsEditor";

function targetTitle(target: ArazzoStepTarget) {
  if (target.kind === "openapi-operation") {
    return target.operation.operationId ?? `${target.operation.method} ${target.operation.path}`;
  }
  if (target.kind === "workflow") return target.workflowId;
  if (target.kind === "asyncapi-target") return target.reference;
  return "Unresolved target";
}

function targetDetails(target: ArazzoStepTarget) {
  if (target.kind === "openapi-operation") {
    return [
      ["Source", target.sourceName],
      ["Operation", `${target.operation.method.toUpperCase()} ${target.operation.path}`],
      ["Document", target.operation.documentId],
    ] as const;
  }
  if (target.kind === "workflow") {
    return [
      ["Workflow", target.workflowId],
      ["Source", target.sourceName ?? "Current document"],
      ["Document", target.targetDocumentId],
    ] as const;
  }
  if (target.kind === "asyncapi-target") {
    return [
      ["Source", target.sourceName],
      ["Reference", target.reference],
      ["Status", target.resolved ? "bound locally" : "unbound"],
    ] as const;
  }
  return [["Reason", target.reason]] as const;
}

function DataList({ entries }: { entries: ReadonlyArray<readonly [string, unknown]> }) {
  return (
    <dl className="workflow-data-list">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd title={getText(value)}>{getText(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function DiagnosticList({ diagnostics }: { diagnostics: ArazzoDiagnostic[] }) {
  if (diagnostics.length === 0) {
    return <p className="workflow-empty-note">No diagnostics for this step.</p>;
  }
  return (
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
  );
}

export function StepInspector({
  resolvedStep,
  workflow,
  sourceText,
  diagnostics,
  onOpenOperation,
}: {
  resolvedStep: ArazzoResolvedStep;
  workflow: ArazzoWorkflow;
  sourceText: string;
  diagnostics: ArazzoDiagnostic[];
  onOpenOperation: (operation: OpenApiOperationCapability) => void;
}) {
  const step = resolvedStep.step;
  const target = resolvedStep.target;
  const outputs = arazzoOutputEntries(step.outputs);
  const sourceSnippet = arazzoSourceSnippet(sourceText, step.pointer, 24);
  const stepDiagnostics = diagnostics.filter(
    diagnostic => diagnostic.pointer === step.pointer || diagnostic.pointer.startsWith(`${step.pointer}/`),
  );
  const successActions = step.onSuccess ?? [];
  const failureActions = step.onFailure ?? [];

  return (
    <aside className="workflow-panel step-inspector" aria-label={`Step ${step.stepId} details`}>
      <header>
        <div>
          <span>Step inspector</span>
          <h2>{step.stepId}</h2>
        </div>
        <span className={`workflow-target ${target.kind === "unresolved" ? "unresolved" : "resolved"}`}>
          {target.kind === "unresolved" || (target.kind === "asyncapi-target" && !target.resolved)
            ? "unresolved"
            : "resolved"}
        </span>
      </header>

      <p className="step-description">{step.description ?? "No step description."}</p>

      <section>
        <h3>Target</h3>
        <div className="step-target-card">
          <div>
            <strong>{targetTitle(target)}</strong>
            <DataList entries={targetDetails(target)} />
          </div>
          {target.kind === "openapi-operation" ? (
            <button type="button" className="ghost-button" onClick={() => onOpenOperation(target.operation)}>
              <ExternalLink size={14} />
              Open operation
            </button>
          ) : null}
        </div>
      </section>

      <AsyncStepEditor resolvedStep={resolvedStep} workflow={workflow} />
      <DependencyEditor workflow={workflow} step={step} />

      <StepMappingsEditor resolvedStep={resolvedStep} workflow={workflow} target={target} />

      {successActions.length > 0 || failureActions.length > 0 ? (
        <section>
          <h3>Actions</h3>
          <ul className="workflow-mappings">
            {successActions.map((action, index) => (
              <li key={`success-${index}`}>
                <strong>onSuccess</strong>
                <span>{action.type ?? "unspecified"}</span>
                <code>{action.stepId ?? action.workflowId ?? "implicit"}</code>
              </li>
            ))}
            {failureActions.map((action, index) => (
              <li key={`failure-${index}`}>
                <strong>onFailure</strong>
                <span>{action.type ?? "unspecified"}</span>
                <code>{action.stepId ?? action.workflowId ?? "implicit"}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {outputs.length > 0 ? (
        <section>
          <h3>Outputs</h3>
          <ul className="workflow-mappings">
            {outputs.map((output) => (
              <li key={output.name}>
                <strong>{output.name}</strong>
                <span>{output.selector?.type ?? "value"}</span>
                <code>{output.selector?.selector ?? output.selector?.query ?? "—"}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3>Source</h3>
        <pre className="step-source">
          <code>{sourceSnippet ?? "Source range unavailable."}</code>
        </pre>
      </section>

      <section>
        <h3>Diagnostics</h3>
        <DiagnosticList diagnostics={stepDiagnostics} />
      </section>

      <footer className="step-pointer">
        <ListOrdered size={13} />
        <span>{workflow.workflowId} · {step.pointer}</span>
      </footer>
    </aside>
  );
}
