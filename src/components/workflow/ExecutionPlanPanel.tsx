import { CircleOff, ShieldCheck } from "lucide-react";
import type { ArazzoExecutionPlan, ArazzoExecutionStep } from "../../workflow/execution-plan";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";

function targetLabel(step: ArazzoExecutionStep, t: ReturnType<typeof useT>) {
  const target = step.target;
  if (target.kind === "openapi-operation") return `${target.method.toUpperCase()} ${target.path}`;
  if (target.kind === "workflow") return `${t("exec.workflowLabel")} · ${target.workflowId}`;
  if (target.kind === "asyncapi-target") {
    if (target.channelId) {
      return `${target.bound ? t("exec.async") : t("exec.unboundAsync")} · ${target.action ?? "?"} ${target.channelId}`;
    }
    return `${target.bound ? t("exec.async") : t("exec.unboundAsync")} · ${target.reference}`;
  }
  return target.reason;
}

export function ExecutionPlanPanel({ plan }: { plan: ArazzoExecutionPlan }) {
  const t = useT();
  return (
    <section className="workflow-panel execution-plan" aria-label={t("plan.title")}>
      <header>
        <div>
          <h2>{t("plan.title")}</h2>
          <p>{t("plan.subtitle")}</p>
        </div>
        <div className="execution-policy">
          <span><ShieldCheck size={13} /> {t("plan.staticOnly")}</span>
          <span><CircleOff size={13} /> {t("plan.noFetching")}</span>
        </div>
      </header>

      {plan.workflows.map(workflow => (
        <article key={workflow.pointer}>
          <header>
            <h3>{workflow.workflowId}</h3>
            {workflow.cyclic ? <span className="workflow-target unresolved">{t("exec.cyclic")}</span> : null}
          </header>
          <ol>
            {workflow.steps.map(step => (
              <li key={step.pointer}>
                <div>
                  <strong>{step.topologicalIndex + 1}. {step.stepId}</strong>
                  <span>{targetLabel(step, t)}</span>
                </div>
                <span className={cn("workflow-target", step.resolved ? "resolved" : "unresolved")}>
                  {step.resolved ? t("plan.ready") : t("plan.blocked")}
                </span>
              </li>
            ))}
          </ol>
        </article>
      ))}

      {plan.unresolvedTargets.length > 0 ? (
        <div className="execution-unresolved" role="status">
          <strong>{t("plan.unresolvedBindings", { count: plan.unresolvedTargets.length })}</strong>
          <ul>
            {plan.unresolvedTargets.map(target => (
              <li key={`${target.workflowId}-${target.stepId}`}>
                {target.stepId}: {target.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
