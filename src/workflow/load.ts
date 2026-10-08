import YAML from "yaml";
import { sampleOpenApi } from "../lib/sample";
import { sampleArazzo } from "../lib/sample-arazzo";
import { useAppStore } from "../store";
import { useWorkflowStore } from "./store";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detectArazzo(source: string, fileName: string) {
  if (/arazzo/i.test(fileName) || /^\s*arazzo\s*:/m.test(source)) return true;
  try {
    const root = YAML.parse(source);
    return isRecord(root) && typeof root.arazzo === "string";
  } catch {
    return false;
  }
}

export function loadWorkspaceSource(source: string, fileName: string) {
  if (detectArazzo(source, fileName)) {
    const workflowLoaded = useWorkflowStore.getState().loadArazzoSource(source, fileName);
    if (!workflowLoaded) {
      window.alert(useWorkflowStore.getState().lastError);
    }
    return workflowLoaded;
  }

  const apiLoaded = useAppStore.getState().loadSource(source, fileName);
  if (!apiLoaded) {
    window.alert(useAppStore.getState().parseError);
    return false;
  }
  return useWorkflowStore.getState().loadOpenApiSource(source, fileName);
}

export async function loadWorkspaceFile(file: File) {
  loadWorkspaceSource(await file.text(), file.name);
}

export function loadOpenApiSample() {
  useAppStore.getState().loadSample();
  useWorkflowStore
    .getState()
    .loadOpenApiSource(sampleOpenApi, "modern-petstore-3.2.openapi.yaml");
}

export function loadArazzoSample() {
  loadOpenApiSample();
  const workflowStore = useWorkflowStore.getState();
  if (!workflowStore.loadArazzoSource(sampleArazzo, "sample-pet-workflow.arazzo.yaml")) return false;
  const arazzoId = useWorkflowStore.getState().activeArazzoDocumentId;
  return arazzoId
    ? useWorkflowStore.getState().bindSourceDescription(
      arazzoId,
      "petstore",
      "openapi:modern-petstore-3.2.openapi.yaml",
    )
    : false;
}
