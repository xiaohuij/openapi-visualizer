import type { ArazzoWorkflow } from "./types";

export interface ArazzoWorkflowInput {
  name: string;
  required: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function workflowInputs(workflow: ArazzoWorkflow): ArazzoWorkflowInput[] {
  const inputs: ArazzoWorkflowInput[] = (workflow.parameters ?? [])
    .filter(parameter => parameter.name)
    .map(parameter => ({
      name: parameter.name,
      required: parameter.required === true,
    }));

  const schema = workflow.inputs;
  if (isRecord(schema) && isRecord(schema.properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const name of Object.keys(schema.properties)) {
      if (!inputs.some(input => input.name === name)) {
        inputs.push({ name, required: required.has(name) });
      }
    }
  }

  return inputs;
}
