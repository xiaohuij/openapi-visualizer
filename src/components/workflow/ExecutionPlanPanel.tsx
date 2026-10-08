import { CircleOff, ShieldCheck } from "lucide-react";
import type { ArazzoExecutionPlan, ArazzoExecutionStep } from "../../workflow/execution-plan";
import { cn } from "../../lib/utils";

function targetLabel(step: ArazzoExecutionStep) {
  const target = step.target;
  if (target.kind === "openapi-operation") return `${target.method.toUpperCase()} ${target.path}`;
  if (target.kind === "workflow") return `workflow · ${target.workflowId}`;
  if (target.kind === "asyncapi-target") return `${target.bound ? "async" : "unbound async"} · ${target.reference}`;
  return target.reason;
}

export function ExecutionPlanPanel({ plan }: { plan: ArazzoExecutionPlan }) {
  return (
    <section className="workflow-panel execution-plan" aria-label="Static execution plan">
      <header>
        <div>
          <h2>Static execution plan</h2>
          <p>Topology and bindings only — no requests are prepared or sent.</p>
        </div>
        <div className="execution-policy">
          <span><ShieldCheck size={13} /> static only</span>
          <span><CircleOff size={13} /> no fetching</span>
        </div>
      </header>

      {plan.workflows.map(workflow => (
        <article key={workflow.pointer}>
          <header>
            <h3>{workflow.workflowId}</h3>
            {workflow.cyclic ? <span className="workflow-target unresolved">cyclic</span> : null}
          </header>
          <ol>
            {workflow.steps.map(step => (
              <li key={step.pointer}>
                <div>
                  <strong>{step.topologicalIndex + 1}. {step.stepId}</strong>
                  <span>{targetLabel(step)}</span>
                </div>
                <span className={cn("workflow-target", step.resolved ? "resolved" : "unresolved")}>
                  {step.resolved ? "ready" : "blocked"}
                </span>
              </li>
            ))}
          </ol>
        </article>
      ))}

      {plan.unresolvedTargets.length > 0 ? (
        <div className="execution-unresolved" role="status">
          <strong>{plan.unresolvedTargets.length} unresolved binding{plan.unresolvedTargets.length === 1 ? "" : "s"}</strong>
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
