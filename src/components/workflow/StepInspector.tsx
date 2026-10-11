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
import { useT } from "../../i18n";
import { AsyncStepEditor } from "./AsyncStepEditor";
import { DependencyEditor } from "./DependencyEditor";
import { StepMappingsEditor } from "./StepMappingsEditor";

function targetTitle(target: ArazzoStepTarget, t: ReturnType<typeof useT>) {
  if (target.kind === "openapi-operation") {
    return target.operation.operationId ?? `${target.operation.method} ${target.operation.path}`;
  }
  if (target.kind === "workflow") return target.workflowId;
  if (target.kind === "asyncapi-target") {
    return target.operation
      ? `${target.operation.channelId} · ${target.operation.action}`
      : target.reference;
  }
  return t("workflow.noTarget");
}

function targetDetails(target: ArazzoStepTarget, t: ReturnType<typeof useT>) {
  if (target.kind === "openapi-operation") {
    return [
      [t("inspector.source"), target.sourceName],
      [t("step.operationLabel"), `${target.operation.method.toUpperCase()} ${target.operation.path}`],
      [t("step.document"), target.operation.documentId],
    ] as const;
  }
  if (target.kind === "workflow") {
    return [
      [t("step.workflow"), target.workflowId],
      [t("inspector.source"), target.sourceName ?? t("step.currentDocument")],
      [t("step.document"), target.targetDocumentId],
    ] as const;
  }
  if (target.kind === "asyncapi-target") {
    const entries = [
      [t("inspector.source"), target.sourceName],
      [t("step.reference"), target.reference],
      [t("step.status"), target.resolved ? t("step.boundLocally") : t("step.unbound")],
    ] as Array<readonly [string, unknown]>;
    if (target.operation) {
      entries.push(
        [t("step.channel"), target.operation.channelId],
        [t("step.channelAddress"), target.operation.channelAddress ?? "—"],
        [t("step.action"), target.operation.specificationVersion === "2"
          ? `${target.operation.action} (${target.operation.normalizedAction})`
          : target.operation.action],
        [t("step.operationLabel"), target.operation.operationId ?? "—"],
        [t("step.document"), target.operation.documentId],
        [t("step.messages"), target.operation.messages.map(message => message.name).join(", ") || "—"],
        [t("step.payloadSchema"), target.operation.messages[0]?.payload ?? "—"],
      );
    }
    return entries;
  }
  return [[t("step.reason"), target.reason]] as const;
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
  const t = useT();
  if (diagnostics.length === 0) {
    return <p className="workflow-empty-note">{t("step.noStepDiagnostics")}</p>;
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
  const t = useT();
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
          <span>{t("step.inspector")}</span>
          <h2>{step.stepId}</h2>
        </div>
        <span className={`workflow-target ${target.kind === "unresolved" ? "unresolved" : "resolved"}`}>
          {target.kind === "unresolved" || (target.kind === "asyncapi-target" && !target.resolved)
            ? t("graph.unresolved")
            : t("graph.resolved")}
        </span>
      </header>

      <p className="step-description">{step.description ?? t("step.noDescription")}</p>

      <section>
        <h3>{t("step.target")}</h3>
        <div className="step-target-card">
          <div>
            <strong>{targetTitle(target, t)}</strong>
            <DataList entries={targetDetails(target, t)} />
          </div>
          {target.kind === "openapi-operation" ? (
            <button type="button" className="ghost-button" onClick={() => onOpenOperation(target.operation)}>
              <ExternalLink size={14} />
              {t("step.openOperation")}
            </button>
          ) : null}
        </div>
      </section>

      <AsyncStepEditor resolvedStep={resolvedStep} workflow={workflow} />
      <DependencyEditor workflow={workflow} step={step} />

      <StepMappingsEditor resolvedStep={resolvedStep} workflow={workflow} target={target} />

      {successActions.length > 0 || failureActions.length > 0 ? (
        <section>
          <h3>{t("step.actions")}</h3>
          <ul className="workflow-mappings">
            {successActions.map((action, index) => (
              <li key={`success-${index}`}>
                <strong>onSuccess</strong>
                <span>{action.type ?? t("step.unspecified")}</span>
                <code>{action.stepId ?? action.workflowId ?? t("step.implicit")}</code>
              </li>
            ))}
            {failureActions.map((action, index) => (
              <li key={`failure-${index}`}>
                <strong>onFailure</strong>
                <span>{action.type ?? t("step.unspecified")}</span>
                <code>{action.stepId ?? action.workflowId ?? t("step.implicit")}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {outputs.length > 0 ? (
        <section>
          <h3>{t("step.outputs")}</h3>
          <ul className="workflow-mappings">
            {outputs.map((output) => (
              <li key={output.name}>
                <strong>{output.name}</strong>
                <span>{output.selector?.type ?? t("step.value")}</span>
                <code>{output.selector?.selector ?? output.selector?.query ?? "—"}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3>{t("step.source")}</h3>
        <pre className="step-source">
          <code>{sourceSnippet ?? t("step.sourceUnavailable")}</code>
        </pre>
      </section>

      <section>
        <h3>{t("step.diagnostics")}</h3>
        <DiagnosticList diagnostics={stepDiagnostics} />
      </section>

      <footer className="step-pointer">
        <ListOrdered size={13} />
        <span>{workflow.workflowId} · {step.pointer}</span>
      </footer>
    </aside>
  );
}
