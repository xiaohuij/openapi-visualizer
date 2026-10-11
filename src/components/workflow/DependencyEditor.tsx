import { GitBranch, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { ArazzoStep, ArazzoWorkflow } from "../../arazzo/types";
import { useWorkflowStore } from "../../workflow/store";
import { useT } from "../../i18n";

export function DependencyEditor({
  workflow,
  step,
}: {
  workflow: ArazzoWorkflow;
  step: ArazzoStep;
}) {
  const t = useT();
  const editArazzoDocument = useWorkflowStore((state) => state.editArazzoDocument);
  const [dependencies, setDependencies] = useState<string[]>(step.dependsOn ?? []);

  useEffect(() => {
    setDependencies(step.dependsOn ?? []);
  }, [step.pointer, step.dependsOn]);

  const candidates = workflow.steps.filter(candidate => candidate.stepId !== step.stepId);
  const dirty = dependencies.join("\n") !== (step.dependsOn ?? []).join("\n");

  return (
    <form
      className="dependency-editor"
      onSubmit={event => {
        event.preventDefault();
        editArazzoDocument({
          type: "arazzo/updateStep",
          workflowId: workflow.workflowId,
          stepId: step.stepId,
          patch: { dependsOn: dependencies.length > 0 ? dependencies : null },
        });
      }}
    >
      <header>
        <GitBranch size={15} />
        <div>
          <h3>{t("dep.title")}</h3>
          <p>{t("dep.hint")}</p>
        </div>
      </header>

      {candidates.length === 0 ? (
        <p className="empty-note">{t("dep.noOtherSteps")}</p>
      ) : (
        <div className="dependency-options" role="group" aria-label={t("dep.groupFor", { stepId: step.stepId })}>
          {candidates.map(candidate => (
            <label key={candidate.stepId}>
              <input
                type="checkbox"
                checked={dependencies.includes(candidate.stepId)}
                onChange={event => {
                  setDependencies(current => event.target.checked
                    ? [...current, candidate.stepId]
                    : current.filter(item => item !== candidate.stepId));
                }}
              />
              <span>{candidate.stepId}</span>
            </label>
          ))}
        </div>
      )}

      <button type="submit" className="primary-button" disabled={!dirty}>
        <Save size={14} />
        {t("dep.apply")}
      </button>
    </form>
  );
}
