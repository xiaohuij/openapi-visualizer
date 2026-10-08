import { create } from "zustand";
import { parseArazzoSource } from "../arazzo/parser";
import { parseOpenApiSource } from "../lib/visualizer";
import {
  applyArazzoEditorCommand,
  applyToArazzoEditorHistory,
  createArazzoEditorHistory,
  redoArazzoEditorHistory,
  undoArazzoEditorHistory,
  type ArazzoEditorCommand,
  type ArazzoEditorHistory,
} from "./commands";
import { DocumentRegistry } from "./document-registry";

export type WorkspaceSurface = "api" | "workflow";

interface WorkflowAppState {
  registry: DocumentRegistry;
  revision: number;
  surface: WorkspaceSurface;
  activeArazzoDocumentId: string | undefined;
  lastError: string | undefined;
  editorHistories: Record<string, ArazzoEditorHistory>;
  setSurface: (surface: WorkspaceSurface) => void;
  loadOpenApiSource: (source: string, fileName: string) => boolean;
  loadArazzoSource: (source: string, fileName: string) => boolean;
  removeDocument: (id: string) => void;
  setActiveArazzoDocument: (id: string) => void;
  bindSourceDescription: (arazzoDocumentId: string, sourceName: string, targetDocumentId: string) => boolean;
  unbindSourceDescription: (arazzoDocumentId: string, sourceName: string) => void;
  editArazzoDocument: (
    command: ArazzoEditorCommand,
    arazzoDocumentId?: string,
  ) => boolean;
  undoArazzoEdit: (arazzoDocumentId?: string) => void;
  redoArazzoEdit: (arazzoDocumentId?: string) => void;
}

const registry = new DocumentRegistry();

export const useWorkflowStore = create<WorkflowAppState>((set, get) => ({
  registry,
  revision: 0,
  surface: "api",
  activeArazzoDocumentId: undefined,
  lastError: undefined,
  editorHistories: {},

  setSurface: (surface) => set({ surface }),

  loadOpenApiSource: (source, fileName) => {
    const result = parseOpenApiSource(source, fileName);
    if (!result.document || result.error) {
      set({ lastError: result.error ?? "Unable to parse OpenAPI document." });
      return false;
    }
    get().registry.upsertOpenApi(result.document);
    set({
      revision: get().revision + 1,
      surface: "api",
      lastError: undefined,
    });
    return true;
  },

  loadArazzoSource: (source, fileName) => {
    const result = parseArazzoSource(source, fileName);
    if (!result.document || result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      set({
        lastError: result.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message
          ?? "Unable to parse Arazzo document.",
      });
      return false;
    }

    const entry = get().registry.upsertArazzo(result.document, result.diagnostics);
    const editorHistories = { ...get().editorHistories };
    for (const key of Object.keys(editorHistories)) {
      if (key === entry.id || !get().registry.get(key)) delete editorHistories[key];
    }
    editorHistories[entry.id] = createArazzoEditorHistory(result.document);
    set({
      revision: get().revision + 1,
      surface: "workflow",
      activeArazzoDocumentId: entry.id,
      lastError: undefined,
      editorHistories,
    });
    return true;
  },

  removeDocument: (id) => {
    const { registry: currentRegistry, activeArazzoDocumentId } = get();
    currentRegistry.remove(id);
    const remainingArazzo = currentRegistry.listArazzo();
    const nextActive = activeArazzoDocumentId === id ? remainingArazzo[0]?.id : activeArazzoDocumentId;
    const { [id]: _removedHistory, ...editorHistories } = get().editorHistories;
    set({
      revision: get().revision + 1,
      activeArazzoDocumentId: nextActive,
      surface: activeArazzoDocumentId === id && remainingArazzo.length === 0 ? "api" : get().surface,
      editorHistories,
    });
  },

  setActiveArazzoDocument: (id) => {
    if (!get().registry.get(id)) return;
    set({ activeArazzoDocumentId: id });
  },

  bindSourceDescription: (arazzoDocumentId, sourceName, targetDocumentId) => {
    const binding = get().registry.bindSourceDescription(arazzoDocumentId, sourceName, targetDocumentId);
    set({
      revision: get().revision + 1,
      lastError: binding ? undefined : "Unable to bind source description.",
    });
    return binding !== undefined;
  },

  unbindSourceDescription: (arazzoDocumentId, sourceName) => {
    get().registry.unbindSourceDescription(arazzoDocumentId, sourceName);
    set({ revision: get().revision + 1 });
  },

  editArazzoDocument: (command, arazzoDocumentId) => {
    const state = get();
    const documentId = arazzoDocumentId ?? state.activeArazzoDocumentId;
    const entry = documentId ? state.registry.get(documentId) : undefined;
    if (!entry || entry.kind !== "arazzo" || !entry.document) {
      set({ lastError: "Select an Arazzo document before editing." });
      return false;
    }

    const history = state.editorHistories[entry.id] ?? createArazzoEditorHistory(entry.document);
    const nextHistory = applyToArazzoEditorHistory(history, command);
    if (nextHistory.present === history.present) {
      const result = applyArazzoEditorCommand(entry.document, command);
      set({
        lastError: result.document
          ? "The command produced no document change."
          : result.diagnostics[0]?.message ?? "Unable to edit Arazzo document.",
      });
      return false;
    }

    state.registry.upsertArazzo(nextHistory.present, []);
    set({
      revision: state.revision + 1,
      activeArazzoDocumentId: entry.id,
      surface: "workflow",
      lastError: undefined,
      editorHistories: { ...state.editorHistories, [entry.id]: nextHistory },
    });
    return true;
  },

  undoArazzoEdit: (arazzoDocumentId) => {
    const state = get();
    const documentId = arazzoDocumentId ?? state.activeArazzoDocumentId;
    const entry = documentId ? state.registry.get(documentId) : undefined;
    if (!entry || entry.kind !== "arazzo" || !entry.document) return;
    const history = state.editorHistories[entry.id] ?? createArazzoEditorHistory(entry.document);
    const nextHistory = undoArazzoEditorHistory(history);
    if (nextHistory === history) return;
    state.registry.upsertArazzo(nextHistory.present, []);
    set({
      revision: state.revision + 1,
      activeArazzoDocumentId: entry.id,
      editorHistories: { ...state.editorHistories, [entry.id]: nextHistory },
    });
  },

  redoArazzoEdit: (arazzoDocumentId) => {
    const state = get();
    const documentId = arazzoDocumentId ?? state.activeArazzoDocumentId;
    const entry = documentId ? state.registry.get(documentId) : undefined;
    if (!entry || entry.kind !== "arazzo" || !entry.document) return;
    const history = state.editorHistories[entry.id] ?? createArazzoEditorHistory(entry.document);
    const nextHistory = redoArazzoEditorHistory(history);
    if (nextHistory === history) return;
    state.registry.upsertArazzo(nextHistory.present, []);
    set({
      revision: state.revision + 1,
      activeArazzoDocumentId: entry.id,
      surface: "workflow",
      editorHistories: { ...state.editorHistories, [entry.id]: nextHistory },
    });
  },
}));
