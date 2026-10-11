import { Radio, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ArazzoResolvedStep } from "../../arazzo/semantic-resolver";
import type { ArazzoStep, ArazzoWorkflow } from "../../arazzo/types";
import type { ArazzoStepPatch } from "../../workflow/commands";
import { useWorkflowStore } from "../../workflow/store";
import { useT } from "../../i18n";

export function AsyncStepEditor({
  resolvedStep,
  workflow,
}: {
  resolvedStep: ArazzoResolvedStep;
  workflow: ArazzoWorkflow;
}) {
  const t = useT();
  const editArazzoDocument = useWorkflowStore((state) => state.editArazzoDocument);
  const step = resolvedStep.step;
  const target = resolvedStep.target;
  const asyncTarget = target.kind === "asyncapi-target" || step.channelPath !== undefined;
  const [action, setAction] = useState<ArazzoStep["action"] | "">(step.action ?? "");
  const [correlationId, setCorrelationId] = useState(step.correlationId ?? "");
  const [timeout, setTimeoutValue] = useState(step.timeout === undefined ? "" : String(step.timeout));
  const [error, setError] = useState<string>();
  const fingerprint = `${step.action ?? ""}:${step.correlationId ?? ""}:${step.timeout ?? ""}`;

  useEffect(() => {
    setAction(step.action ?? "");
    setCorrelationId(step.correlationId ?? "");
    setTimeoutValue(step.timeout === undefined ? "" : String(step.timeout));
    setError(undefined);
  }, [fingerprint, step.action, step.correlationId, step.timeout]);

  const patch = useMemo<ArazzoStepPatch>(() => ({
    action: action ? action : null,
    correlationId: correlationId.trim() ? correlationId.trim() : null,
    timeout: timeout.trim() ? Number(timeout) : null,
  }), [action, correlationId, timeout]);

  if (!asyncTarget) return null;

  const dirty = action !== (step.action ?? "")
    || correlationId !== (step.correlationId ?? "")
    || timeout !== (step.timeout === undefined ? "" : String(step.timeout));

  return (
    <form
      className="async-step-editor"
      onSubmit={event => {
        event.preventDefault();
        if (timeout.trim() && (!Number.isInteger(Number(timeout)) || Number(timeout) < 0)) {
          setError(t("asyncEditor.error.timeout"));
          return;
        }

        const applied = editArazzoDocument({
          type: "arazzo/updateStep",
          workflowId: workflow.workflowId,
          stepId: step.stepId,
          patch,
        });
        setError(applied ? undefined : useWorkflowStore.getState().lastError ?? t("asyncEditor.error.save"));
      }}
    >
      <header>
        <Radio size={15} />
        <div>
          <h3>{t("step.asyncMessaging")}</h3>
          <p>{t("step.asyncMessagingHint")}</p>
        </div>
      </header>

      <div className="async-fields">
        <label>
          {t("step.action")}
          <select
            value={action}
            onChange={event => setAction(event.target.value === "send" || event.target.value === "receive"
              ? event.target.value
              : "")}
          >
            <option value="">{t("workflow.notBound")}</option>
            <option value="send">send</option>
            <option value="receive">receive</option>
          </select>
        </label>
        <label>
          {t("step.correlationId")}
          <input
            value={correlationId}
            placeholder="$inputs.correlationId"
            onChange={event => setCorrelationId(event.target.value)}
          />
        </label>
        <label>
          {t("step.timeout")}
          <input
            value={timeout}
            inputMode="numeric"
            placeholder="6000"
            onChange={event => setTimeoutValue(event.target.value)}
          />
        </label>
      </div>

      {target.kind === "asyncapi-target" && !target.resolved ? (
        <p className="binding-warning">{t("asyncEditor.unboundWarning")}</p>
      ) : null}
      {error ? <p className="mapping-error" role="alert">{error}</p> : null}

      <button type="submit" className="primary-button" disabled={!dirty}>
        <Save size={14} />
        {t("step.applyAsync")}
      </button>
    </form>
  );
}
