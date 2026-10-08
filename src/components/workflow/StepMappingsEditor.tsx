import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import YAML from "yaml";
import type {
  ArazzoResolvedStep,
  ArazzoStepTarget,
} from "../../arazzo/semantic-resolver";
import type { ArazzoWorkflow } from "../../arazzo/types";
import type { ArazzoStepPatch } from "../../workflow/commands";
import { useWorkflowStore } from "../../workflow/store";
import { isRecord } from "../../lib/utils";

interface ParameterDraft {
  name: string;
  in: string;
  value: string;
}

function formatValue(value: unknown) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 0);
  } catch {
    return String(value);
  }
}

function parseValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("$")) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    const parsed = YAML.parse(trimmed);
    return parsed === undefined ? trimmed : parsed;
  }
}

function defaultValue(schema: unknown) {
  return isRecord(schema) && "default" in schema ? formatValue(schema.default) : "";
}

function schemaType(schema: unknown) {
  if (!isRecord(schema)) return "any";
  if (typeof schema.$ref === "string") return "$ref";
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  return typeof schema.type === "string" ? schema.type : "object";
}

function parameterDrafts(parameters: ArazzoWorkflow["parameters"]) {
  return (parameters ?? []).map(parameter => ({
    name: parameter.name ?? "",
    in: parameter.in ?? "",
    value: formatValue(parameter.value),
  }));
}

export function StepMappingsEditor({
  resolvedStep,
  workflow,
  target,
}: {
  resolvedStep: ArazzoResolvedStep;
  workflow: ArazzoWorkflow;
  target: ArazzoStepTarget;
}) {
  const editArazzoDocument = useWorkflowStore((state) => state.editArazzoDocument);
  const step = resolvedStep.step;
  const [parameters, setParameters] = useState<ParameterDraft[]>(() =>
    parameterDrafts(step.parameters),
  );
  const [requestBodyEnabled, setRequestBodyEnabled] = useState(Boolean(step.requestBody));
  const [contentType, setContentType] = useState(step.requestBody?.contentType ?? "application/json");
  const [payload, setPayload] = useState(() => formatValue(step.requestBody?.payload));
  const [error, setError] = useState<string>();
  const fingerprint = useMemo(
    () => JSON.stringify({ parameters: step.parameters, requestBody: step.requestBody }),
    [step.parameters, step.requestBody],
  );

  useEffect(() => {
    setParameters(parameterDrafts(step.parameters));
    setRequestBodyEnabled(Boolean(step.requestBody));
    setContentType(step.requestBody?.contentType ?? "application/json");
    setPayload(formatValue(step.requestBody?.payload));
    setError(undefined);
  }, [fingerprint, step.parameters, step.requestBody]);

  const operationParameters = target.kind === "openapi-operation"
    ? target.operation.parameters
    : undefined;
  const operationRequestBody = target.kind === "openapi-operation"
    ? target.operation.requestBody
    : undefined;

  const schemaFor = (draft: ParameterDraft) => operationParameters?.find(parameter =>
    parameter.name === draft.name && (!draft.in || !parameter.in || parameter.in === draft.in),
  );
  const missingRequired = (operationParameters ?? [])
    .filter(parameter => parameter.required && parameter.name)
    .filter(parameter => !parameters.some(draft => draft.name === parameter.name))
    .map(parameter => ({
      name: parameter.name ?? "",
      in: parameter.in ?? "",
      value: defaultValue(parameter.schema),
    }));

  const nextPatch = (): ArazzoStepPatch | undefined => {
    const patch: ArazzoStepPatch = {};
    if (parameters.length > 0 || step.parameters) {
      patch.parameters = parameters.map(parameter => ({
        name: parameter.name,
        in: parameter.in || undefined,
        value: parseValue(parameter.value),
      }));
    }
    if (requestBodyEnabled) {
      patch.requestBody = {
        contentType,
        payload: parseValue(payload),
      };
    } else if (step.requestBody) {
      patch.requestBody = null;
    }
    return Object.keys(patch).length > 0 ? patch : undefined;
  };

  const dirty = useMemo(
    () =>
      JSON.stringify(parameters) !== JSON.stringify(parameterDrafts(step.parameters))
      || requestBodyEnabled !== Boolean(step.requestBody)
      || (requestBodyEnabled && contentType !== (step.requestBody?.contentType ?? "application/json"))
      || (requestBodyEnabled && payload !== formatValue(step.requestBody?.payload)),
    [parameters, requestBodyEnabled, contentType, payload, step.parameters, step.requestBody],
  );

  const submit = () => {
    if (parameters.some(parameter => !parameter.name.trim())) {
      setError("Every parameter needs a name.");
      return;
    }
    if (requestBodyEnabled && !contentType.trim()) {
      setError("Request body needs a content type.");
      return;
    }
    let patch: ArazzoStepPatch | undefined;
    try {
      patch = nextPatch();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Unable to parse mapping value.");
      return;
    }

    if (!patch) return;
    const applied = editArazzoDocument({
      type: "arazzo/updateStep",
      workflowId: workflow.workflowId,
      stepId: step.stepId,
      patch,
    });
    if (!applied) {
      setError(useWorkflowStore.getState().lastError ?? "Unable to save mappings.");
      return;
    }
    setError(undefined);
  };

  return (
    <form
      className="step-mappings-editor"
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
    >
      <header>
        <div>
          <h3>Parameter and request-body mappings</h3>
          <p>Use `$` runtime expressions or JSON/YAML static values.</p>
        </div>
        {missingRequired.length > 0 ? (
          <button
            type="button"
            className="ghost-button"
            onClick={() => setParameters(current => [...current, ...missingRequired])}
          >
            <Plus size={13} />
            Add required
          </button>
        ) : null}
      </header>

      <div className="mapping-rows" role="list" aria-label="Parameter mappings">
        {parameters.length === 0 ? (
          <p className="empty-note">No parameter mappings.</p>
        ) : parameters.map((parameter, index) => {
          const capability = schemaFor(parameter);
          return (
            <div className="mapping-row" role="listitem" key={`${parameter.name}-${index}`}>
              <label>
                Name
                <input
                  value={parameter.name}
                  onChange={event => setParameters(current => current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: event.target.value } : item,
                  ))}
                />
              </label>
              <label>
                In
                <input
                  value={parameter.in}
                  placeholder="query"
                  onChange={event => setParameters(current => current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, in: event.target.value } : item,
                  ))}
                />
              </label>
              <label className="wide">
                Value
                <input
                  value={parameter.value}
                  onChange={event => setParameters(current => current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, value: event.target.value } : item,
                  ))}
                />
              </label>
              <div className="mapping-meta">
                <span>{capability ? schemaType(capability.schema) : "unmatched"}</span>
                {capability?.required ? <strong>required</strong> : null}
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove parameter ${parameter.name || index + 1}`}
                onClick={() => setParameters(current => current.filter((_, itemIndex) => itemIndex !== index))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="ghost-button"
        onClick={() => setParameters(current => [...current, { name: "", in: "", value: "" }])}
      >
        <Plus size={13} />
        Add parameter
      </button>

      <div className="request-body-editor">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={requestBodyEnabled}
            onChange={event => setRequestBodyEnabled(event.target.checked)}
          />
          <span>Send a request body</span>
        </label>
        {requestBodyEnabled ? (
          <>
            <label>
              Content type
              {operationRequestBody?.content.length ? (
                <select value={contentType} onChange={event => setContentType(event.target.value)}>
                  {operationRequestBody.content.map(content => (
                    <option key={content.contentType} value={content.contentType}>
                      {content.contentType}
                    </option>
                  ))}
                  {!operationRequestBody.content.some(content => content.contentType === contentType) ? (
                    <option value={contentType}>{contentType}</option>
                  ) : null}
                </select>
              ) : (
                <input value={contentType} onChange={event => setContentType(event.target.value)} />
              )}
            </label>
            <label>
              Payload
              <textarea
                value={payload}
                rows={5}
                spellCheck={false}
                onChange={event => setPayload(event.target.value)}
              />
            </label>
          </>
        ) : null}
      </div>

      {error ? <p className="mapping-error" role="alert">{error}</p> : null}
      <button type="submit" className="primary-button" disabled={!dirty}>
        <Check size={14} />
        Apply mappings
      </button>
    </form>
  );
}
