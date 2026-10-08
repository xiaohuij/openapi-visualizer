import type { ArazzoOutputs, ArazzoSelector, ArazzoStepOutput } from "./types";

export interface NormalizedArazzoOutput {
  name: string;
  selector?: ArazzoSelector;
  value?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function arazzoOutputEntries(outputs: ArazzoOutputs | undefined): NormalizedArazzoOutput[] {
  if (!outputs) return [];
  if (Array.isArray(outputs)) {
    return (outputs as ArazzoStepOutput[])
      .filter(output => typeof output.name === "string")
      .map(output => ({
        name: output.name!,
        selector: output.selector,
        value: output.value,
      }));
  }

  return Object.entries(outputs).map(([name, value]) => {
    const selector = isRecord(value) && isRecord(value.selector)
      ? value.selector as ArazzoSelector
      : isRecord(value) && typeof value.selector === "string"
        ? value as unknown as ArazzoSelector
        : undefined;
    return { name, selector, value };
  });
}
