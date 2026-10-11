import { Plus, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import type { ArazzoAddStepCommand } from "../../workflow/commands";
import { OpenApiCapabilityIndex } from "../../workflow/capability-index";
import { useWorkflowStore } from "../../workflow/store";
import { useAppStore } from "../../store";
import type { VisualNodeModel } from "../../types";
import { isRecord } from "../../lib/utils";
import { useT } from "../../i18n";

function defaultValue(schema: unknown) {
  return isRecord(schema) && "default" in schema ? schema.default : "";
}

function stepIdBase(operationId: string | undefined, method: string, path: string) {
  const raw = operationId ?? `${method} ${path}`;
  const normalized = raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return normalized || "call-operation";
}

function uniqueStepId(base: string, stepIds: Set<string>) {
  if (!stepIds.has(base)) return base;
  let index = 2;
  while (stepIds.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function AddStepPanel({ operation }: { operation: VisualNodeModel }) {
  const apiDocument = useAppStore((state) => state.document);
  const registry = useWorkflowStore((state) => state.registry);
  const revision = useWorkflowStore((state) => state.revision);
  const activeArazzoDocumentId = useWorkflowStore((state) => state.activeArazzoDocumentId);
  const setActiveArazzoDocument = useWorkflowStore((state) => state.setActiveArazzoDocument);
  const editArazzoDocument = useWorkflowStore((state) => state.editArazzoDocument);
  const setSurface = useWorkflowStore((state) => state.setSurface);
  const t = useT();
  const [chosenArazzoId, setChosenArazzoId] = useState<string>();
  const [chosenWorkflowId, setChosenWorkflowId] = useState<string>();
  void revision;

  const arazzoDocuments = registry.listArazzo();
  const arazzo = arazzoDocuments.find(item => item.id === chosenArazzoId)
    ?? arazzoDocuments.find(item => item.id === activeArazzoDocumentId)
    ?? arazzoDocuments[0];
  const workflows = arazzo?.document?.workflows ?? [];
  const workflow = workflows.find(item => item.workflowId === chosenWorkflowId) ?? workflows[0];

  const capabilityIndex = useMemo(
    () => new OpenApiCapabilityIndex(registry.listOpenApi()),
    [registry, revision],
  );
  const currentDocumentId = apiDocument ? `openapi:${apiDocument.fileName}` : undefined;
  const operationId = typeof operation.metadata.operationId === "string"
    ? operation.metadata.operationId
    : undefined;
  const method = typeof operation.metadata.method === "string" ? operation.metadata.method.toLowerCase() : "";
  const path = typeof operation.metadata.path === "string" ? operation.metadata.path : "";
  const capability = currentDocumentId
    ? operationId
      ? capabilityIndex.findByOperationId(operationId, currentDocumentId)[0]
      : capabilityIndex.findByMethodPath(method, path, currentDocumentId)
    : undefined;

  const bindings = arazzo && currentDocumentId
    ? registry.listBindings(arazzo.id).filter(binding => binding.targetDocumentId === currentDocumentId)
    : [];
  const boundSource = bindings[0]?.sourceName;
  const boundOpenApiCount = arazzo
    ? registry.listBindings(arazzo.id).filter(binding => {
      const target = registry.get(binding.targetDocumentId);
      return target?.kind === "openapi";
    }).length
    : 0;
  const webhook = capability?.webhook === true;
  const operationTarget = boundSource && capability
    ? `$sourceDescriptions.${boundSource}.${webhook ? "webhooks" : "paths"}.${capability.path}.${capability.method.toLowerCase()}`
    : operationId;

  const requiredParameters = capability?.parameters
    .filter(parameter => parameter.required)
    .map(parameter => ({
      name: parameter.name ?? "",
      in: parameter.in,
      value: defaultValue(parameter.schema),
    })) ?? [];
  const requestBody = capability?.requestBody?.required
    ? {
      contentType: capability.requestBody.content[0]?.contentType ?? "application/json",
      payload: {},
    }
    : undefined;

  const command = useMemo<ArazzoAddStepCommand | undefined>(() => {
    if (!arazzo?.document || !workflow || !operationTarget) return undefined;
    const stepIds = new Set(workflow.steps.map(step => step.stepId));
    return {
      type: "arazzo/addStep",
      workflowId: workflow.workflowId,
      stepId: uniqueStepId(stepIdBase(operationId, method, path), stepIds),
      operationId: operationTarget,
      description: operation.description ?? operation.title,
      parameters: requiredParameters.length > 0 ? requiredParameters : undefined,
      requestBody,
    };
  }, [
    arazzo?.document,
    workflow,
    operationTarget,
    operationId,
    method,
    path,
    operation.description,
    operation.title,
    requiredParameters,
    requestBody,
  ]);

  const targetUnavailable = Boolean(operationId && boundOpenApiCount > 1 && !boundSource);

  return (
    <section className="add-step-panel" aria-label={t("addStep.title")}>
      <header>
        <Waypoints size={15} />
        <div>
          <strong>{t("addStep.title")}</strong>
          <p>{t("addStep.subtitle")}</p>
        </div>
      </header>

      {arazzoDocuments.length === 0 || workflows.length === 0 ? (
        <p className="empty-note">{t("addStep.noArazzo")}</p>
      ) : (
        <>
          <label>
            {t("addStep.targetDocument")}
            <select value={arazzo?.id ?? ""} onChange={event => setChosenArazzoId(event.target.value)}>
              {arazzoDocuments.map(item => (
                <option key={item.id} value={item.id}>
                  {item.document?.info.title ?? item.fileName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("addStep.targetWorkflow")}
            <select value={workflow?.workflowId ?? ""} onChange={event => setChosenWorkflowId(event.target.value)}>
              {workflows.map(item => (
                <option key={item.workflowId} value={item.workflowId}>
                  {item.workflowId}
                </option>
              ))}
            </select>
          </label>

          <dl>
            <div>
              <dt>{t("addStep.newStepId")}</dt>
              <dd>{command?.stepId ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("step.target")}</dt>
              <dd title={command?.operationId}>{command?.operationId ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("addStep.initialMappings")}</dt>
              <dd>
                {requiredParameters.length > 0 || requestBody
                  ? t("addStep.requiredSummary", { count: requiredParameters.length, body: requestBody ? t("addStep.withBody") : "" })
                  : t("addStep.noneRequired")}
              </dd>
            </div>
          </dl>

          {targetUnavailable ? (
            <p className="binding-warning">
              Bind this OpenAPI document to a source description first; multiple OpenAPI sources are bound.
            </p>
          ) : null}

          <button
            type="button"
            className="primary-button"
            disabled={!command || targetUnavailable}
            onClick={() => {
              if (!arazzo || !command) return;
              if (!editArazzoDocument(command, arazzo.id)) return;
              setActiveArazzoDocument(arazzo.id);
              setSurface("workflow");
            }}
          >
            <Plus size={14} />
            {t("addStep.add")}
          </button>
        </>
      )}
    </section>
  );
}
