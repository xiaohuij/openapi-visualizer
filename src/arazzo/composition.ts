import { arazzoError, arazzoWarning, type ArazzoDiagnostic } from "./diagnostics";
import { arazzoOutputEntries } from "./outputs";
import { workflowInputs } from "./workflow-inputs";
import { parseWorkflowTargetExpression } from "./semantic-resolver";
import type { ArazzoDocument, ArazzoStep, ArazzoWorkflow } from "./types";
import type { DocumentRegistry } from "../workflow/document-registry";

interface WorkflowTarget {
  documentId: string;
  workflow: ArazzoWorkflow;
}


function resolveWorkflowTarget(
  document: ArazzoDocument,
  registry: DocumentRegistry,
  workflowCall: string,
): WorkflowTarget | undefined {
  const local = document.workflows.find(workflow => workflow.workflowId === workflowCall);
  if (local) return { documentId: document.documentId, workflow: local };

  const expression = parseWorkflowTargetExpression(workflowCall);
  for (const source of document.sourceDescriptions) {
    if (source.type !== "arazzo") continue;
    if (expression && source.name !== expression.sourceName) continue;

    const resolved = registry.resolveSourceDescription(document.documentId, source.name);
    const target = resolved?.target;
    if (target?.kind !== "arazzo" || !target.document) continue;

    const workflow = target.document.workflows.find(item =>
      item.workflowId === (expression?.workflowId ?? workflowCall),
    );
    if (workflow) return { documentId: target.document.documentId, workflow };
  }

  return undefined;
}

function validateCallMappings(
  document: ArazzoDocument,
  step: ArazzoStep,
  target: WorkflowTarget,
  diagnostics: ArazzoDiagnostic[],
) {
  const mappedInputs = new Set((step.parameters ?? []).map(parameter => parameter.name));
  const targetInputs = workflowInputs(target.workflow);
  const targetOutputs = arazzoOutputEntries(target.workflow.outputs);

  for (const parameter of targetInputs) {
    if (parameter.required && !mappedInputs.has(parameter.name)) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_WORKFLOW_INPUT_REQUIRED_MISSING",
          `Workflow call "${step.stepId}" does not map required input "${parameter.name}".`,
          step.pointer,
          document.documentId,
        ),
      );
    }
  }

  for (const [index, parameter] of (step.parameters ?? []).entries()) {
    if (!targetInputs.some(candidate => candidate.name === parameter.name)) {
      diagnostics.push(
        arazzoWarning(
          "ARAZZO_WORKFLOW_INPUT_MAPPING_UNKNOWN",
          `Mapped input "${parameter.name}" is not declared by workflow "${target.workflow.workflowId}".`,
          `${step.pointer}/parameters/${index}`,
          document.documentId,
        ),
      );
    }
  }

  for (const output of arazzoOutputEntries(step.outputs)) {
    if (output.name && !targetOutputs.some(candidate => candidate.name === output.name)) {
      diagnostics.push(
        arazzoError(
          "ARAZZO_WORKFLOW_OUTPUT_MAPPING_UNRESOLVED",
          `Workflow call output "${output.name}" is not declared by workflow "${target.workflow.workflowId}".`,
          `${step.pointer}/outputs/${output.name}`,
          document.documentId,
        ),
      );
    }
  }
}

function compositionEdges(registry: DocumentRegistry) {
  const edges = new Map<string, WorkflowTarget[]>();
  const labels = new Map<string, string>();

  for (const entry of registry.listArazzo()) {
    const document = entry.document;
    if (!document) continue;
    for (const workflow of document.workflows) {
      const key = `${document.documentId} ${workflow.pointer}`;
      labels.set(key, `${document.info.title} / ${workflow.workflowId}`);
      const targets: WorkflowTarget[] = [];
      for (const step of workflow.steps) {
        if (!step.workflowId) continue;
        const target = resolveWorkflowTarget(document, registry, step.workflowId);
        if (target) targets.push(target);
      }
      edges.set(key, targets);
    }
  }

  return { edges, labels };
}

export function validateArazzoWorkflowComposition(
  document: ArazzoDocument,
  registry: DocumentRegistry,
): ArazzoDiagnostic[] {
  const diagnostics: ArazzoDiagnostic[] = [];

  for (const workflow of document.workflows) {
    for (const step of workflow.steps) {
      if (!step.workflowId) continue;
      const target = resolveWorkflowTarget(document, registry, step.workflowId);
      if (target) validateCallMappings(document, step, target, diagnostics);
    }
  }

  const { edges, labels } = compositionEdges(registry);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycle: string[] | undefined;

  const visit = (key: string, path: string[]) => {
    if (cycle || visited.has(key)) return;
    if (visiting.has(key)) {
      const start = path.indexOf(key);
      cycle = [...path.slice(start), key];
      return;
    }

    visiting.add(key);
    for (const target of edges.get(key) ?? []) {
      const targetKey = `${target.documentId} ${target.workflow.pointer}`;
      visit(targetKey, [...path, key]);
    }
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of edges.keys()) visit(key, []);
  if (cycle) {
    const readableCycle = cycle.map(key => labels.get(key) ?? key);
    diagnostics.push(
      arazzoError(
        "ARAZZO_WORKFLOW_RECURSION",
        `Workflow composition contains a recursive call cycle: ${readableCycle.join(" → ")}.`,
        document.workflows[0]?.pointer ?? "#/workflows",
        document.documentId,
      ),
    );
  }

  return diagnostics;
}
