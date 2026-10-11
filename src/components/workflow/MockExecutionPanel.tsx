import { Play, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { ArazzoExecutionPlan } from "../../workflow/execution-plan";
import {
  type ArazzoMockExecutionContext,
  type ArazzoMockExecutionResult,
} from "../../workflow/mock-execution";
import { browserDryRunArazzoRunner, type ArazzoRequestPreview } from "../../workflow/runners";
import { cn } from "../../lib/utils";

const initialSource = `{\n  "inputs": {},\n  "examples": {}\n}`;

export function MockExecutionPanel({
  plan,
  onResult,
  onReplay,
  hasResult,
}: {
  plan: ArazzoExecutionPlan;
  onResult?: (result: ArazzoMockExecutionResult | undefined) => void;
  onReplay?: () => void;
  hasResult?: boolean;
}) {
  const [source, setSource] = useState(initialSource);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ArazzoMockExecutionResult>();
  const [previews, setPreviews] = useState<ArazzoRequestPreview[]>();

  return (
    <section className="workflow-panel mock-execution" aria-label="Mock workflow execution">
      <header>
        <div>
          <h2>Mock execution</h2>
          <p>Evaluate expressions, selectors, criteria, and actions in memory.</p>
        </div>
        <span><ShieldCheck size={13} /> mock only</span>
      </header>

      <label>
        Mock inputs and examples
        <textarea
          value={source}
          rows={7}
          spellCheck={false}
          onChange={event => setSource(event.target.value)}
        />
      </label>
      <p className="mock-hint">
        Provide `inputs`, per-step `examples` with `statusCode`, `response.body`, or `message.payload`.
        Values stay in this browser and no requests are sent.
      </p>

      <button
        type="button"
        className="primary-button"
        onClick={() => {
          try {
            const context = JSON.parse(source) as ArazzoMockExecutionContext;
            const runnerResult = browserDryRunArazzoRunner.execute(plan, context);
            setResult(runnerResult.result);
            setPreviews(runnerResult.requestPreviews);
            onResult?.(runnerResult.result);
            setError(runnerResult.diagnostics.length > 0
              ? runnerResult.diagnostics.map(diagnostic => diagnostic.message).join("; ")
              : undefined);
          } catch (exception) {
            setResult(undefined);
            onResult?.(undefined);
            setError(exception instanceof Error ? exception.message : "Unable to parse mock context.");
          }
        }}
      >
        <Play size={14} />
        Run mock
      </button>

      {error ? <p className="mapping-error" role="alert">{error}</p> : null}

      {hasResult && onReplay ? (
        <button type="button" className="ghost-button replay-button" onClick={onReplay}>
          <RotateCcw size={13} />
          Replay on graph
        </button>
      ) : null}

      {result ? (
        <div className="mock-results">
          {result.workflows.map(workflow => (
            <article key={workflow.pointer}>
              <h3>{workflow.workflowId}</h3>
              <ul>
                {workflow.steps.map(step => (
                  <li key={step.pointer}>
                    <div>
                      <strong>{step.stepId}</strong>
                      <span>
                        {step.criteria.map(criterion => `${criterion.passed ? "✓" : "✕"} ${criterion.condition}`).join(" · ")
                          || step.failureReason
                          || "completed"}
                      </span>
                    </div>
                    <span className={cn("workflow-target", step.status === "succeeded" ? "resolved" : "unresolved")}>
                      {step.status}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      {previews?.length ? (
        <details className="request-previews">
          <summary>{previews.length} request preview{previews.length === 1 ? "" : "s"}</summary>
          <ul>
            {previews.map(preview => (
              <li key={`${preview.workflowId}-${preview.stepId}`}>
                <strong>{preview.method.toUpperCase()} {preview.path}</strong>
                <span>{preview.stepId} · preview only, not sent</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
